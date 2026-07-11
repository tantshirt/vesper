import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { roleValidator } from "./roles";

// Admin Story 1.2 — the segregation-of-duties ENGINE. These are the reusable primitives the gate
// ceremony (Story 3-1) and later mint/distribution flows call; this story does NOT build that
// ceremony. Two integrity walls central to the product:
//   (a) a staff member with a FEE/LISTING stake in a property must not sign that property's gates —
//       the listing-revenue-vs-diligence wall (assertNoFeeConflict).
//   (b) a multi-party gate must be signed by DISTINCT humans — no self-approval (assertDistinctSigner).
// The platform_admin-has-no-operational-power wall is ALREADY enforced by 1-1 (that role holds no
// operational permission); here it falls out of requirePermission("gate.sign") at the top of the flow.
//
// ── DURABILITY (AO2 "attempts blocked") ────────────────────────────────────────────────────────────
// A blocked attempt must persist EVEN THOUGH the offending operation aborts. In Convex, scheduling
// (ctx.scheduler.runAfter) is TRANSACTIONAL with a *mutation* — if a mutation throws, its scheduled
// jobs are cancelled and rolled back with it (empirically verified). An *action* is NOT transactional:
// a job scheduled from an action commits immediately and SURVIVES the action's later throw. That is
// exactly the "separate transaction" the AO2 mechanism needs. Therefore the check/entry helpers below
// run in ACTION context: they `ctx.scheduler.runAfter(0, internal.sod.logBlockedAttempt, {...})` and
// THEN throw, and the blocked-attempt audit persists. The DB reads (permission + interest) are done
// via internal queries so 1-1's single permission path (requirePermission) is reused verbatim, never
// forked. NOTE ON SPEC: the spec sketched these helpers on a MutationCtx; a mutation cannot durably
// log-then-throw (its schedule rolls back), so the ctx is an ActionCtx here — the smallest change that
// makes the spec's own scheduler.runAfter-before-throw mechanism actually durable. Story 3-1's gate
// ceremony (already an action, since it signs on chain) calls `requireGateSigner(ctx, ...)` directly.

// resolveGateSigner — the permission gate, reusing 1-1's requirePermission (the ONE derivation path)
// on a QueryCtx: platform_admin (no gate.sign) is denied HERE, before any SoD wall, proving the 1-1
// wall. Returns the caller's staff doc so the action can run the interest/self-approval checks on it.
export const resolveGateSigner = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"staff">> => {
    return await requirePermission(ctx, "gate.sign");
  },
});

// hasFeeInterest — indexed lookup: does this staff member hold a recorded fee/listing/billing stake in
// this property? Returns the conflicting kind (for the audit) or null. Read-only.
export const hasFeeInterest = internalQuery({
  args: { workosId: v.string(), propertyId: v.id("properties") },
  handler: async (ctx, args): Promise<{ kind: "listing" | "billing" | "fee" } | null> => {
    const row = await ctx.db
      .query("staffPropertyInterest")
      .withIndex("by_staff_property", (q) =>
        q.eq("workosId", args.workosId).eq("propertyId", args.propertyId),
      )
      .first();
    return row ? { kind: row.kind } : null;
  },
});

// assertNoFeeConflict — the listing-revenue-vs-diligence wall. If the staff member holds a recorded
// interest in this property, durably log the blocked attempt (survives the throw — see header) then
// throw. ActionCtx because only an action's schedule outlives its own throw.
export async function assertNoFeeConflict(
  ctx: ActionCtx,
  staff: Doc<"staff">,
  propertyId: Id<"properties">,
): Promise<void> {
  const conflict = await ctx.runQuery(internal.sod.hasFeeInterest, {
    workosId: staff.workosId,
    propertyId,
  });
  if (!conflict) return;

  await ctx.scheduler.runAfter(0, internal.sod.logBlockedAttempt, {
    actor: staff.email || staff.name || staff.workosId,
    reason: "sod.fee_conflict",
    propertyId,
    roles: staff.roles,
    detail: { kind: conflict.kind, required: "a distinct signer with no fee interest" },
  });
  throw new Error("SoD: fee/listing interest bars signing this property");
}

// assertDistinctSigner — no self-approval. Compares by staff IDENTITY (workosId), never display name,
// so two people sharing a name stay distinct and one person under two names is still caught. The
// existing-signer set is passed IN so this stays storage-agnostic (Story 3-1 owns where it lives);
// propertyId is carried only to give the durable audit a target.
export async function assertDistinctSigner(
  ctx: ActionCtx,
  staff: Doc<"staff">,
  existingSignerWorkosIds: readonly string[],
  propertyId: Id<"properties">,
): Promise<void> {
  if (!existingSignerWorkosIds.includes(staff.workosId)) return;

  await ctx.scheduler.runAfter(0, internal.sod.logBlockedAttempt, {
    actor: staff.email || staff.name || staff.workosId,
    reason: "sod.self_approval",
    propertyId,
    roles: staff.roles,
    detail: { required: "a distinct second signer" },
  });
  throw new Error("SoD: a distinct second signer is required");
}

// requireGateSigner — the SINGLE entry point Story 3-1's gate ceremony calls. Ordering is deliberate:
// permission FIRST (platform_admin denied at 1-1's wall, no SoD leakage), then the fee-conflict wall,
// then the self-approval wall. Returns the caller's staff doc on success.
export async function requireGateSigner(
  ctx: ActionCtx,
  propertyId: Id<"properties">,
  existingSignerWorkosIds: readonly string[],
): Promise<Doc<"staff">> {
  const staff: Doc<"staff"> = await ctx.runQuery(internal.sod.resolveGateSigner, {});
  await assertNoFeeConflict(ctx, staff, propertyId);
  await assertDistinctSigner(ctx, staff, existingSignerWorkosIds, propertyId);
  return staff;
}

// requireGateSignerAction — the registered internalAction wrapper over requireGateSigner. It is the
// callable/testable seam: convex-test drives the full durable path through it, and any caller that is
// itself a mutation (not an action) can reach the engine via ctx.runAction. Internal-only.
export const requireGateSignerAction = internalAction({
  args: {
    propertyId: v.id("properties"),
    existingSignerWorkosIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"staff">> => {
    return await requireGateSigner(ctx, args.propertyId, args.existingSignerWorkosIds);
  },
});

// logBlockedAttempt — the DURABLE blocked-attempt record. An internalMutation invoked ONLY via
// ctx.scheduler.runAfter(0, internal.sod.logBlockedAttempt, ...) from an action, so it runs in its own
// committed transaction and survives the caller's throw. Absent from the public `api` — no browser can
// forge a "blocked" entry. This is the AO2 "attempts blocked" mechanism.
export const logBlockedAttempt = internalMutation({
  args: {
    actor: v.string(),
    reason: v.string(),
    propertyId: v.id("properties"),
    roles: v.array(roleValidator),
    permission: v.optional(v.string()),
    detail: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await writeAudit(ctx, {
      actor: args.actor,
      action: "sod.blocked",
      target: args.propertyId,
      meta: {
        reason: args.reason,
        permission: args.permission,
        propertyId: args.propertyId,
        roles: args.roles,
        detail: args.detail,
      },
    });
  },
});

// recordPropertyInterest — the ONLY way a fee/listing/billing conflict is recorded. An internalMutation
// (mirroring 1-1's grantRoles posture): ABSENT from the public `api`, reachable only through the Convex
// CLI/dashboard, and audited to the human who recorded it (never self-attributed). Empty identity/actor
// fields are rejected — an audit entry naming no human is worthless.
export const recordPropertyInterest = internalMutation({
  args: {
    workosId: v.string(),
    propertyId: v.id("properties"),
    kind: v.union(v.literal("listing"), v.literal("billing"), v.literal("fee")),
    recordedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const workosId = args.workosId.trim();
    const recordedBy = args.recordedBy.trim();
    if (!workosId || !recordedBy) {
      throw new Error("recordPropertyInterest requires non-empty workosId and recordedBy");
    }

    const interestId = await ctx.db.insert("staffPropertyInterest", {
      workosId,
      propertyId: args.propertyId,
      kind: args.kind,
      recordedBy,
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      actor: recordedBy,
      action: "sod.interest.recorded",
      target: workosId,
      meta: { propertyId: args.propertyId, kind: args.kind },
    });

    return interestId;
  },
});

// removePropertyInterest — the audited inverse. Removes every recorded interest for (workosId,
// propertyId) and audits the removal to the human who authorized it. Also internal-only.
export const removePropertyInterest = internalMutation({
  args: {
    workosId: v.string(),
    propertyId: v.id("properties"),
    recordedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const workosId = args.workosId.trim();
    const recordedBy = args.recordedBy.trim();
    if (!workosId || !recordedBy) {
      throw new Error("removePropertyInterest requires non-empty workosId and recordedBy");
    }

    const rows = await ctx.db
      .query("staffPropertyInterest")
      .withIndex("by_staff_property", (q) =>
        q.eq("workosId", workosId).eq("propertyId", args.propertyId),
      )
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }

    await writeAudit(ctx, {
      actor: recordedBy,
      action: "sod.interest.removed",
      target: workosId,
      meta: { propertyId: args.propertyId, removed: rows.length },
    });

    return rows.length;
  },
});
