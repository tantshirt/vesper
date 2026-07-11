import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { requirePermission } from "./rbac";

// Admin Story 1.3 — the READ side of the append-only audit trail. Both surfaces are permission-gated
// server-side on every request (audit.read / audit.export) and are strictly read-only: they never
// insert, patch, or delete an auditLog row. Append-only holds because nothing here writes.
//
// Filters are shared by listAudit and exportAudit: newest-first over the `by_timestamp` index, an
// optional [timeStart, timeEnd] range applied on that index, and optional actor (exact) / target
// (exact) / action (PREFIX, e.g. "acl" → "acl.thawed" + "acl.frozen") applied as server-side filters
// so pagination and export caps both stay correct.

// Upper bound on the timestamp scan. Convex string ordering places any real dotted action strictly
// below this sentinel, giving an exclusive upper bound for the action prefix range.
const PREFIX_MAX = "￿";

type AuditFilters = {
  actor?: string;
  action?: string;
  target?: string;
  timeStart?: number;
  timeEnd?: number;
};

const filtersValidator = {
  actor: v.optional(v.string()),
  action: v.optional(v.string()),
  target: v.optional(v.string()),
  timeStart: v.optional(v.number()),
  timeEnd: v.optional(v.number()),
};

// One place that turns the filter args into a newest-first, filtered query over auditLog. Time range
// rides the by_timestamp index; actor/target/action ride an in-query `.filter` (action as a prefix
// range) so both consumers get identical semantics.
function buildAuditQuery(ctx: QueryCtx, f: AuditFilters) {
  const ordered = ctx.db
    .query("auditLog")
    .withIndex("by_timestamp", (ix) => {
      // Chain bounds inline: each call narrows the builder type, so a lower + upper bound must be
      // expressed as a single expression per branch rather than reassigned.
      if (f.timeStart !== undefined && f.timeEnd !== undefined)
        return ix.gte("timestamp", f.timeStart).lte("timestamp", f.timeEnd);
      if (f.timeStart !== undefined) return ix.gte("timestamp", f.timeStart);
      if (f.timeEnd !== undefined) return ix.lte("timestamp", f.timeEnd);
      return ix;
    })
    .order("desc");

  const hasFieldFilter =
    f.actor !== undefined || f.target !== undefined || f.action !== undefined;
  if (!hasFieldFilter) return ordered;

  return ordered.filter((q) => {
    const conds = [];
    if (f.actor !== undefined) conds.push(q.eq(q.field("actor"), f.actor));
    if (f.target !== undefined) conds.push(q.eq(q.field("target"), f.target));
    if (f.action !== undefined) {
      conds.push(q.gte(q.field("action"), f.action));
      conds.push(q.lt(q.field("action"), f.action + PREFIX_MAX));
    }
    return conds.length === 1 ? conds[0] : q.and(...conds);
  });
}

function toRow(doc: {
  _id: string;
  actor: string;
  action: string;
  target: string;
  onchainRef?: string;
  meta?: unknown;
  timestamp: number;
}) {
  return {
    id: doc._id,
    actor: doc.actor,
    action: doc.action,
    target: doc.target,
    onchainRef: doc.onchainRef ?? null,
    meta: doc.meta ?? null,
    timestamp: doc.timestamp,
  };
}

// listAudit — permission-gated (audit.read), paginated, newest-first, filterable. The console renders
// this page-by-page; enforcement is here, not in the UI that hides the nav.
export const listAudit = query({
  args: { paginationOpts: paginationOptsValidator, ...filtersValidator },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "audit.read");
    const { paginationOpts, ...filters } = args;
    const result = await buildAuditQuery(ctx, filters).paginate(paginationOpts);
    return { ...result, page: result.page.map(toRow) };
  },
});

// Hard cap on a single export batch. A regulator-ready export must be BOUNDED — never an unbounded
// scan of the whole trail — so we take at most EXPORT_CAP rows and report truncation instead of
// silently returning a partial set. A follow-up story can add cursored full export if needed.
export const EXPORT_CAP = 1000;

// exportAudit — permission-gated (audit.export), bounded batch, truncation reported. Read-only.
export const exportAudit = query({
  args: filtersValidator,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "audit.export");
    // take(CAP + 1): the extra row, if present, is the signal that more exists beyond the cap.
    const docs = await buildAuditQuery(ctx, args).take(EXPORT_CAP + 1);
    const truncated = docs.length > EXPORT_CAP;
    const rows = docs.slice(0, EXPORT_CAP).map(toRow);
    return {
      rows,
      count: rows.length,
      truncated,
      cap: EXPORT_CAP,
      exportedAt: Date.now(),
    };
  },
});
