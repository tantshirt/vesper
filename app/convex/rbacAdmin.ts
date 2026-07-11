import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { requirePermission, applyGrant } from "./rbac";
import {
  permissionsForRoles,
  rolesWithOperationalPower,
  roleValidator,
  type StaffRole,
} from "./roles";

// Admin Story 1.4 — the ONLY new public grant surface. 1-1 deliberately left `grantRoles` an
// internalMutation (no public grant path at all); this file adds the single controlled, `rbac.manage`-
// gated door. Whoever can grant roles can grant operational power, so this surface layers three grant-
// time guards over 1-1's `applyGrant` core:
//   1. NO self-escalation — the caller may not grant/modify their OWN workosId.
//   2. Platform-Admin stays operationally powerless — a grant may not combine `platform_admin` with any
//      operational (money/ownership/eligibility/gate) role.
//   3. Segregation of duties — a gate.sign-bearing role may not go to a staff member who holds a
//      recorded fee/listing interest (reuses 1-2's `staffPropertyInterest` data).
//
// ── WHY RETURN-REJECTION, NOT throw+schedule ─────────────────────────────────────────────────────────
// A blocked grant is a BUSINESS rejection, not a system error. `manageStaffRoles` is a `mutation`, so
// the clean, durable way to record a block is: detect it, `writeAudit` the block INLINE, DO NOT apply
// the grant, and RETURN `{ blocked: true, reason }`. The mutation then commits normally — it wrote one
// audit row and performed no grant — so the block record is durable with NO scheduler needed. This is
// the opposite of 1-2's SoD engine: there a guard fires mid-operation and MUST throw to abort, so it
// needs the action+scheduler mechanism whose job survives the throw. Here nothing needs aborting, so
// throwing (and scheduler-then-throw especially — it rolls the audit back) would be exactly wrong.
// Genuine VALIDATION errors (empty required fields) still `throw` via applyGrant.

type GrantConflict = {
  // Maps to the audit action: self_grant → `rbac.self_grant_blocked`; the other two →
  // `rbac.sod_grant_blocked` (both are separation-of-duties / least-privilege violations).
  kind: "self_grant" | "platform_admin_operational" | "sod_fee";
  reason: string;
};

// detectGrantConflicts — the shared conflict oracle used by BOTH `manageStaffRoles` (which audits +
// returns them) and `previewGrantConflicts` (which just surfaces them to the UI before submit). Read-
// only: it inspects the proposed roles and 1-2's recorded interests, and writes nothing.
async function detectGrantConflicts(
  ctx: QueryCtx | MutationCtx,
  caller: Doc<"staff">,
  workosId: string,
  roles: StaffRole[],
): Promise<GrantConflict[]> {
  const conflicts: GrantConflict[] = [];

  // 1. Self-escalation: the caller cannot grant or modify roles for their OWN identity.
  if (workosId === caller.workosId) {
    conflicts.push({
      kind: "self_grant",
      reason: "Self-escalation blocked: a Platform Admin cannot grant or modify their own roles.",
    });
    // A self-grant is disqualifying on its own; no need to also evaluate the target's interests.
    return conflicts;
  }

  const perms = permissionsForRoles(roles);

  // 2. Platform-Admin must stay operationally powerless: refuse to combine `platform_admin` with any
  // operational role (this covers both "add platform_admin to an operational person" and "add an
  // operational role to a platform admin" — the resulting role set is what matters).
  if (roles.includes("platform_admin")) {
    const opRoles = rolesWithOperationalPower(roles);
    if (opRoles.length > 0) {
      conflicts.push({
        kind: "platform_admin_operational",
        reason: `platform_admin may hold no operational permission — refusing to combine it with operational role(s): ${opRoles.join(", ")}.`,
      });
    }
  }

  // 3. SoD fee-vs-gate: a gate.sign-bearing role must not go to a staff member who holds a recorded
  // fee/listing/billing interest. Reuses 1-2's `staffPropertyInterest` data (indexed by workosId).
  if (perms.includes("gate.sign")) {
    const interests = await ctx.db
      .query("staffPropertyInterest")
      .withIndex("by_staff_property", (q) => q.eq("workosId", workosId))
      .collect();
    if (interests.length > 0) {
      const named = await Promise.all(
        interests.map(async (i) => {
          const property = await ctx.db.get(i.propertyId);
          const label = property?.name ?? i.propertyId;
          return `${label} (${i.kind})`;
        }),
      );
      conflicts.push({
        kind: "sod_fee",
        reason: `SoD conflict: cannot grant a gate-signing role to a staff member holding a fee/listing interest in ${named.join(", ")}.`,
      });
    }
  }

  return conflicts;
}

// manageStaffRoles — the public, rbac.manage-gated grant surface. Order: gate → detect conflicts →
// (blocked: audit inline + return, do NOT apply) → (clean: applyGrant, which audits `staff.granted`).
export const manageStaffRoles = mutation({
  args: {
    workosId: v.string(),
    email: v.string(),
    name: v.string(),
    roles: v.array(roleValidator),
    status: v.optional(v.union(v.literal("active"), v.literal("revoked"))),
  },
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "rbac.manage");
    const actor = caller.name || caller.email || caller.workosId;
    const workosId = args.workosId.trim();

    const conflicts = await detectGrantConflicts(ctx, caller, workosId, args.roles);
    if (conflicts.length > 0) {
      // Durably record EACH block inline — the mutation commits, so no scheduler is needed and no throw
      // may occur (a throw would roll these audits back).
      for (const c of conflicts) {
        await writeAudit(ctx, {
          actor, // the authorizer who attempted the blocked grant
          action: c.kind === "self_grant" ? "rbac.self_grant_blocked" : "rbac.sod_grant_blocked",
          target: workosId,
          meta: { kind: c.kind, reason: c.reason, roles: args.roles },
        });
      }
      return { blocked: true as const, reason: conflicts.map((c) => c.reason).join(" ") };
    }

    // Clean grant — delegate to 1-1's single grant core, attributing the acting Platform Admin.
    const staffId = await applyGrant(ctx, { ...args, grantedBy: actor });
    return { blocked: false as const, staffId };
  },
});

// previewGrantConflicts — the read-only companion the roles UI calls to surface conflicts BEFORE a
// submit (rendered loss-red inline). Same oracle, same rbac.manage gate, zero writes.
export const previewGrantConflicts = query({
  args: {
    workosId: v.string(),
    roles: v.array(roleValidator),
  },
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "rbac.manage");
    const conflicts = await detectGrantConflicts(ctx, caller, args.workosId.trim(), args.roles);
    return {
      wouldBlock: conflicts.length > 0,
      conflicts: conflicts.map((c) => ({ kind: c.kind, reason: c.reason })),
    };
  },
});
