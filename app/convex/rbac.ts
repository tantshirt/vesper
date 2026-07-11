import { query, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { isWorkosIdentity } from "./security";
import {
  permissionsForRoles,
  roleValidator,
  PERMISSIONS,
  type Permission,
  type StaffRole,
} from "./roles";

// Per-request RBAC enforcement — the surface EVERY admin query and mutation resolves the caller
// through before reading or writing any data. RBAC is decided server-side on every request; a UI
// that hides a nav item is a convenience, never the enforcement point.
//
// permissionsForRoles is re-exported (not re-implemented) so there is exactly ONE derivation path.
export { permissionsForRoles } from "./roles";

type StaffReadCtx = QueryCtx | MutationCtx;

// requireStaff — the WorkOS half of the scope wall. A caller is staff IFF they present a recognized
// WorkOS identity AND an active `staff` row exists for their workosId. Staff access is grant-only: a
// valid WorkOS JWT with no row is NOT staff (never self-provisioned). Distinct throw messages so a
// consumer token, a missing row, and a revoked member are each diagnosable at the call site.
export async function requireStaff(ctx: StaffReadCtx): Promise<Doc<"staff">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  // A Privy (consumer) token, or any non-WorkOS issuer, is refused here — the scope wall.
  if (!isWorkosIdentity(identity)) throw new Error("Not authenticated as staff");

  const staff = await ctx.db
    .query("staff")
    .withIndex("by_workosId", (q) => q.eq("workosId", identity.subject))
    .unique();
  if (!staff) throw new Error("Not authenticated as staff");
  if (staff.status === "revoked") throw new Error("Staff access revoked");
  return staff;
}

// effectivePermissions — the SINGLE permission-resolution path, now including audited break-glass.
// The base is `permissionsForRoles(staff.roles)` (still the only role-derivation path — unchanged, so
// a staff member with no break-glass row resolves to EXACTLY their role permissions, and every 1-1
// test stays green). On top of that we UNION the scope of every ACTIVE, NON-EXPIRED break-glass grant
// for this staff member (Admin Story 1.4). "Active" means both `status === "active"` AND
// `Date.now() < expiresAt` — a revoked grant (status) OR a lapsed one (clock) contributes NOTHING, so
// break-glass confers scope only inside its time box. Scope entries are re-validated against the
// permission catalog here as a belt-and-braces guard (invokeBreakGlass already validates at write).
export async function effectivePermissions(
  ctx: StaffReadCtx,
  staff: Doc<"staff">,
): Promise<Permission[]> {
  const out = new Set<Permission>(permissionsForRoles(staff.roles));
  const now = Date.now();
  const grants = await ctx.db
    .query("breakGlass")
    .withIndex("by_workosId", (q) => q.eq("workosId", staff.workosId))
    .collect();
  for (const g of grants) {
    if (g.status !== "active" || now >= g.expiresAt) continue; // expired/revoked confers nothing
    for (const p of g.scope) {
      if (p in PERMISSIONS) out.add(p as Permission);
    }
  }
  return [...out];
}

// requirePermission — requireStaff, then check the EFFECTIVE permission set (roles ∪ active
// break-glass). On a MUTATION a denial first writes an `rbac.denied` audit entry naming the actor, the
// permission, and the roles held.
//
// HONEST LIMITATION: that write is inside the failing mutation's transaction, so it rolls back with
// the throw — it is NOT a durable blocked-attempt record today. Durable blocked-attempt logging is
// Story 1.3's job (immutable AuditLog), which is exactly why Story 1.2 depends on 1.3. A denial on a
// QueryCtx has no db.insert at all and so cannot audit. Neither is a bug; both are named future work.
export async function requirePermission(
  ctx: StaffReadCtx,
  permission: Permission,
): Promise<Doc<"staff">> {
  const staff = await requireStaff(ctx);
  const permissions = await effectivePermissions(ctx, staff);
  if (permissions.includes(permission)) return staff;

  if ("insert" in ctx.db) {
    await writeAudit(ctx as MutationCtx, {
      actor: staff.email || staff.name || staff.workosId,
      action: "rbac.denied",
      target: permission,
      meta: { permission, roles: staff.roles },
    });
  }
  throw new Error(`Not permitted: ${permission}`);
}

// `me` — the console's own identity read: the named human, their roles, and their DERIVED permissions
// (or null). There is deliberately NO `status` field on the wire: a revoked member already resolves
// to null below, so a status would be dead — always "active" — and invite the client to trust it.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !isWorkosIdentity(identity)) return null;

    const staff = await ctx.db
      .query("staff")
      .withIndex("by_workosId", (q) => q.eq("workosId", identity.subject))
      .unique();
    if (!staff || staff.status === "revoked") return null;

    return {
      name: staff.name,
      email: staff.email,
      roles: staff.roles,
      // EFFECTIVE permissions — role permissions plus any active break-glass scope (Story 1.4). The
      // nav/console read the same set the server enforces, so an active elevation shows immediately and
      // vanishes the instant it expires.
      permissions: await effectivePermissions(ctx, staff),
    };
  },
});

// grantRoles — the crown jewel. Whoever can grant roles can grant themselves `ops_diligence` (which
// carries gate.sign + mint.execute + distribution.execute), so the grant path is strictly more
// powerful than every operational permission combined. It is therefore an **internalMutation**:
// ABSENT from the public `api`, reachable only through the Convex CLI/dashboard (which already
// requires deployment credentials). In Story 1.1 there is NO public grant surface at all — this also
// resolves bootstrap cleanly, since the first `staff` row is created by whoever owns the deployment.
export const grantRoles = internalMutation({
  args: {
    workosId: v.string(),
    email: v.string(),
    name: v.string(),
    roles: v.array(roleValidator),
    // The human who AUTHORIZED this grant — audited as the actor. NEVER the grantee: an entry reading
    // "Priya granted platform_admin to Priya" names nobody.
    grantedBy: v.string(),
    // Optional: pass explicitly to (re)activate or revoke. Omitting it on a name/role edit must NOT
    // silently reactivate a revoked member (see below).
    status: v.optional(v.union(v.literal("active"), v.literal("revoked"))),
  },
  handler: async (ctx, args) => {
    return await applyGrant(ctx, args);
  },
});

// applyGrant — the SINGLE grant core, shared verbatim by the internal `grantRoles` (1-1, the
// deployment-owner bootstrap path) and the public `rbac.manage`-gated `manageStaffRoles` (1-4). There
// is exactly ONE place that trims/validates identity fields, upserts the `staff` row (revoke-preserving
// on edits), and writes the `staff.granted` audit attributing the AUTHORIZER — so the two surfaces can
// never drift on what a grant means. `manageStaffRoles` layers its self-grant / SoD / platform-admin
// guards BEFORE calling this; this function itself performs no permission check (its two callers own
// that: `grantRoles` is internal-only, `manageStaffRoles` is `rbac.manage`-gated).
export async function applyGrant(
  ctx: MutationCtx,
  args: {
    workosId: string;
    email: string;
    name: string;
    roles: StaffRole[];
    grantedBy: string;
    status?: "active" | "revoked";
  },
): Promise<Id<"staff">> {
  const workosId = args.workosId.trim();
  const email = args.email.trim();
  const name = args.name.trim();
  const grantedBy = args.grantedBy.trim();
  // Reject empty identity/actor fields — an audit entry naming no human is worthless, and a role
  // grant is the platform's most security-relevant write.
  if (!workosId || !email || !name || !grantedBy || args.roles.length === 0) {
    throw new Error(
      "grantRoles requires non-empty workosId, email, name, grantedBy, and at least one role",
    );
  }

  const existing = await ctx.db
    .query("staff")
    .withIndex("by_workosId", (q) => q.eq("workosId", workosId))
    .unique();

  let staffId: Id<"staff">;
  let resolvedStatus: "active" | "revoked";
  if (existing) {
    // Preserve an existing `revoked` status unless `status` is passed explicitly. A name/role edit
    // must never silently reactivate revoked staff.
    resolvedStatus = args.status ?? existing.status;
    await ctx.db.patch(existing._id, { email, name, roles: args.roles, status: resolvedStatus });
    staffId = existing._id;
  } else {
    resolvedStatus = args.status ?? "active";
    staffId = await ctx.db.insert("staff", {
      workosId,
      email,
      name,
      roles: args.roles,
      status: resolvedStatus,
      createdAt: Date.now(),
    });
  }

  await writeAudit(ctx, {
    actor: grantedBy, // the authorizer, never the grantee
    action: "staff.granted",
    target: workosId,
    meta: { roles: args.roles, email, name, status: resolvedStatus },
  });

  return staffId;
}
