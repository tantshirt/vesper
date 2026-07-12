import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { PERMISSIONS, OPERATIONAL_PERMISSIONS } from "./roles";

// Admin Story 1.4 — audited, time-boxed break-glass. Break-glass is the sanctioned, logged, EXPIRING
// escape hatch: a `breakglass.use` holder confers a specific `scope` of permissions on a staff member
// for a bounded window with a MANDATORY reason. The elevation is enforced through the ONE permission
// path (rbac.ts `effectivePermissions`), which unions active break-glass scope on top of role
// permissions and treats any expired (clock) or revoked (status) grant as conferring NOTHING — so the
// grant is real while `Date.now() < expiresAt` and vanishes the instant it lapses. Every invocation
// writes an immutable `breakglass.invoked` audit entry AND leaves a compliance-visible `breakGlass`
// row (listActiveBreakGlass). This is deliberately distinct from role permissions: `platform_admin`'s
// ROLE still carries zero operational power (roles.ts) — break-glass is the audited, time-boxed
// exception, not a standing grant.

// Hard upper bound on a break-glass window. Access this powerful must never be open-ended; a longer
// need must be re-invoked (and thus re-audited), never silently extended.
export const MAX_BREAK_GLASS_MINUTES = 60;

// invokeBreakGlass — mint a bounded elevation. Gated on `breakglass.use` (platform_admin today). The
// reason is MANDATORY and the scope must be non-empty catalog permissions; the window is clamped-by-
// rejection to MAX_BREAK_GLASS_MINUTES so no caller can mint an over-long grant.
export const invokeBreakGlass = mutation({
  args: {
    workosId: v.string(), // the staff member to elevate
    scope: v.array(v.string()), // the permissions to confer while active
    reason: v.string(), // MANDATORY justification
    durationMinutes: v.optional(v.number()), // ≤ MAX_BREAK_GLASS_MINUTES; defaults to the max
  },
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "breakglass.use");
    const actor = caller.name || caller.email || caller.workosId;

    const workosId = args.workosId.trim();
    const reason = args.reason.trim();
    // Mandatory, meaningful inputs — an unattributed or empty-reason break-glass entry is worthless,
    // and an empty/unknown scope would confer nothing or something forged. These are genuine validation
    // errors, so they THROW (unlike a business-rejected grant, which returns).
    if (!workosId) throw new Error("invokeBreakGlass requires a non-empty workosId");
    if (!reason) throw new Error("invokeBreakGlass requires a non-empty reason");
    if (args.scope.length === 0) {
      throw new Error("invokeBreakGlass requires a non-empty scope");
    }
    for (const p of args.scope) {
      if (!(p in PERMISSIONS)) throw new Error(`invokeBreakGlass: unknown permission in scope: ${p}`);
    }

    const duration = args.durationMinutes ?? MAX_BREAK_GLASS_MINUTES;
    if (!(duration > 0) || duration > MAX_BREAK_GLASS_MINUTES) {
      throw new Error(
        `invokeBreakGlass duration must be > 0 and ≤ ${MAX_BREAK_GLASS_MINUTES} minutes`,
      );
    }

    // SoD guard (a) — NO SELF break-glass. Break-glass is the escape hatch for granting a DISTINCT
    // emergency human access; a caller elevating THEMSELVES is self-escalation (mirrors
    // rbacAdmin.detectGrantConflicts' self_grant rule). platform_admin holds breakglass.use, so without
    // this a platform_admin could mint THEMSELVES gate.sign/mint.execute/etc. — exactly the operational
    // power their role is designed to lack. Ordered AFTER input validation so a plain malformed request
    // (empty reason, unknown scope, over-long window) still surfaces its own precise error.
    if (workosId === caller.workosId) {
      throw new Error(
        "Self break-glass is not permitted — break-glass grants emergency access to a DISTINCT human",
      );
    }

    // SoD guard (b) — a `platform_admin` target must stay operationally powerless. Refuse to confer any
    // OPERATIONAL permission (gate.sign / mint.execute / freeze.execute / distribution.execute) on a
    // staff member who holds platform_admin (mirrors detectGrantConflicts' platform_admin_operational
    // rule). The time-boxed hatch stays open for granting a DISTINCT operational human emergency access.
    const operational = new Set<string>(OPERATIONAL_PERMISSIONS);
    const requestedOperational = args.scope.filter((p) => operational.has(p));
    if (requestedOperational.length > 0) {
      const target = await ctx.db
        .query("staff")
        .withIndex("by_workosId", (q) => q.eq("workosId", workosId))
        .unique();
      if (target && target.roles.includes("platform_admin")) {
        throw new Error(
          `platform_admin may hold no operational permission — refusing to break-glass operational scope (${requestedOperational.join(", ")}) to a platform_admin target`,
        );
      }
    }

    const now = Date.now();
    const expiresAt = now + duration * 60_000;

    const id = await ctx.db.insert("breakGlass", {
      workosId,
      scope: args.scope,
      reason,
      invokedBy: actor,
      createdAt: now,
      expiresAt,
      status: "active",
    });

    // Immutable audit entry (durable) + the row above is the compliance-visible record.
    await writeAudit(ctx, {
      actor,
      action: "breakglass.invoked",
      target: workosId,
      meta: { scope: args.scope, reason, expiresAt, durationMinutes: duration },
    });

    return { id, expiresAt };
  },
});

// revokeBreakGlass — end an active elevation early. Gated on `breakglass.use`. Flipping status to
// "revoked" makes effectivePermissions stop conferring the scope immediately (it requires
// status === "active"), and the revocation is audited.
export const revokeBreakGlass = mutation({
  args: { id: v.id("breakGlass") },
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "breakglass.use");
    const actor = caller.name || caller.email || caller.workosId;

    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("break-glass record not found");
    if (record.status === "active") {
      await ctx.db.patch(args.id, { status: "revoked" });
    }

    await writeAudit(ctx, {
      actor,
      action: "breakglass.revoked",
      target: record.workosId,
      meta: { scope: record.scope, reason: record.reason },
    });

    return { revoked: true };
  },
});

// listActiveBreakGlass — the compliance-visible read of every CURRENTLY-active elevation. Gated on
// `audit.read` (compliance oversight) — platform_admin also holds it. Returns only rows that are both
// status "active" AND still inside their time box; a lapsed row is filtered out here exactly as
// effectivePermissions ignores it, so the list never overstates who is elevated right now.
export const listActiveBreakGlass = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "audit.read");
    const now = Date.now();
    const rows = await ctx.db.query("breakGlass").collect();
    return rows
      .filter((r) => r.status === "active" && now < r.expiresAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r._id,
        workosId: r.workosId,
        scope: r.scope,
        reason: r.reason,
        invokedBy: r.invokedBy,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));
  },
});
