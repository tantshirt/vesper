import { MutationCtx } from "./_generated/server";

// FR16 / spine I3: every money/ownership/eligibility/diligence mutation writes an immutable audit entry.
// There is no update/delete on auditLog — append only.
export async function writeAudit(
  ctx: MutationCtx,
  entry: { actor: string; action: string; target: string; meta?: unknown }
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    meta: entry.meta,
    timestamp: Date.now(),
  });
}
