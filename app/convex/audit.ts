import { MutationCtx } from "./_generated/server";

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
