import { MutationCtx, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// FR16 / spine I3: every money/ownership/eligibility/diligence mutation writes an immutable audit entry.
// There is no update/delete on auditLog — append only.
// Admin Story 1.3: `onchainRef` is an OPTIONAL field — an on-chain tx signature / mint an admin
// action produces. It is threaded through only when supplied, so the 25 existing callers (which pass
// no such field) keep compiling and behaving identically. Append-only stays the invariant: still the
// single `insert`, still no update/delete anywhere.
export async function writeAudit(
  ctx: MutationCtx,
  entry: { actor: string; action: string; target: string; meta?: unknown; onchainRef?: string }
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    meta: entry.meta,
    onchainRef: entry.onchainRef,
    timestamp: Date.now(),
  });
}

// logDenial — the DURABLE record of a denied OPERATIONAL action (INV2). An internalMutation invoked ONLY
// via ctx.runMutation(internal.audit.logDenial, ...) from an ACTION entry point whose permission check
// threw "Not permitted:" (see rbac.ts:logOperationalDenial). Because an action is NOT transactional, this
// mutation COMMITS immediately and SURVIVES the action's later re-throw — the durable trace the aborted
// operation would otherwise leave behind (same guarantee as sod.ts:logBlockedAttempt for SoD blocks). A
// denial on a plain query/mutation cannot produce such a durable row: any write it makes rolls back with
// the mutation's own throw (Convex's transaction model — see rbac.ts). Absent from the public `api`, so
// no browser can forge a denial row. Writes an immutable `rbac.denied.durable` auditLog entry naming the
// actor (or "unknown" if the caller resolved to no staff), the attempted permission, and the target.
export const logDenial = internalMutation({
  args: {
    actor: v.string(),
    permission: v.string(),
    target: v.string(),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await writeAudit(ctx, {
      actor: args.actor,
      action: "rbac.denied.durable",
      target: args.target,
      meta: { permission: args.permission, ...(args.meta ? { detail: args.meta } : {}) },
    });
  },
});
