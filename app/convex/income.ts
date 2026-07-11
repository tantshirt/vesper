import { query } from "./_generated/server";
import { selectNextDistributionDate } from "./home";
import { findUserByIdentity } from "./security";
import type { Doc, Id } from "./_generated/dataModel";

// Story 5.3 — Income: itemized breakdown + matches-target (FR14).
//
// Income is a PURE READ SURFACE over the reconciled mirror — it adds no authoritative state and never
// writes ownership/money. The whole model is derived from data already owned by the read model:
//   • the latest distribution's waterfall = the caller's most recent incomeLedger row's itemized fields
//     (grossShare → costs → mgmtFee → reserve → netPaid), shown in the DD-002 order
//   • matches-target = the month's ANNUALIZED realized net yield (netPaid × 12 / property costBasis)
//     compared to property.targetNetYield within a small percentage-point tolerance
//   • history = the caller's distributions most-recent-first (month + net + status only — no per-row
//     itemization; the detailed waterfall is the latest distribution alone)
//   • nextDistributionDate = home's selectNextDistributionDate (soonest held firstDistributionDate ≥ today)
//
// The caller is always resolved server-side from the JWT (getUserIdentity() → by_privyId); the query
// returns `null` when unauthenticated or unprovisioned — the client-supplied identity is never trusted.
// Nothing here surfaces a raw distribution `txSig` or any chain internal; only dollar figures + the
// (route-safe) propertyId for the interim missed-distribution onward link.

// --- Pure helpers (exported for unit tests; no ctx/db access) ---------------------------------

// The matches-target tolerance in yield FRACTION terms (0.005 = 0.5 percentage points). A distribution
// "matches" when its annualized realized net yield is within this band BELOW the property's target —
// generous enough to absorb the seed's monthly Math.round (which is at most a fraction of a cent's worth
// of annualized yield), so a correctly-sized payout never reads as "below target" on rounding alone.
export const TARGET_MATCH_TOLERANCE = 0.005;

// Annualized realized net yield for a single month's payout: netPaid × 12 / costBasis. Guarded to 0
// when costBasis ≤ 0 (or either input is non-finite) so a zero-cost-basis holding never yields
// Infinity/NaN — it degrades to a calm below-target 0%.
export function annualizedYield(netPaid: number, costBasis: number): number {
  if (!Number.isFinite(costBasis) || costBasis <= 0) return 0;
  if (!Number.isFinite(netPaid)) return 0;
  return (netPaid * 12) / costBasis;
}

// Compare a month's realized net yield against the property's target. `matchesTarget` is true when the
// realized yield meets or exceeds the target LESS the tolerance (so the boundary — realized exactly at
// `target − tolerance` — matches). Never a "guaranteed"/"earns" framing; this is a factual comparison.
export function evaluateTarget(
  netPaid: number,
  costBasis: number,
  targetNetYield: number,
): { targetYield: number; realizedYield: number; matchesTarget: boolean } {
  const targetYield = Number.isFinite(targetNetYield) ? targetNetYield : 0;
  const realizedYield = annualizedYield(netPaid, costBasis);
  return {
    targetYield,
    realizedYield,
    matchesTarget: realizedYield >= targetYield - TARGET_MATCH_TOLERANCE,
  };
}

// Order two distributions most-recent-first key: by `period` (lexicographic — a zero-padded "YYYY-MM"
// sorts identically to chronological order), then by `paidAt` (a missing/non-finite paidAt sorts oldest,
// so a paid row beats a same-period unpaid one). Returns >0 when `a` is more recent than `b`.
function recencyOf(row: { period: string; paidAt?: number }): [string, number] {
  const paidAt = typeof row.paidAt === "number" && Number.isFinite(row.paidAt) ? row.paidAt : -Infinity;
  return [row.period, paidAt];
}

function compareRecency(a: { period: string; paidAt?: number }, b: { period: string; paidAt?: number }): number {
  const [ap, apAt] = recencyOf(a);
  const [bp, bpAt] = recencyOf(b);
  if (ap !== bp) return ap < bp ? -1 : 1;
  return apAt - bpAt;
}

// The caller's most recent distribution (by period, then paidAt), or null when there are none.
export function selectLatestDistribution<T extends { period: string; paidAt?: number }>(
  rows: T[],
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (best === null || compareRecency(row, best) > 0) best = row;
  }
  return best;
}

// The caller's distributions, most-recent-first (does not mutate the input).
export function buildHistory<T extends { period: string; paidAt?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compareRecency(b, a));
}

// Whether a distribution is worth surfacing as the itemized "latest" waterfall. A PAID row that rounded
// to $0 net (a sub-dollar monthly payout on a very small holding — e.g. the $50 minimum at a single-digit
// yield, where round(costBasis × targetNetYield / 12) = 0) is not a real payout: surfacing it renders an
// all-zeros gross→net waterfall AND a misleading "came in around 0.0%, a little under your target" note.
// Mirrors home.selectFreshDistribution's `netPaid > 0` guard. A non-paid row (missed/scheduled) stays
// eligible — its honest banner, not a dollar figure, is the point, so the owner is never left in silence.
export function isSurfaceableDistribution<T extends { status: string; netPaid: number }>(row: T): boolean {
  if (row.status !== "paid") return true;
  return Number.isFinite(row.netPaid) && row.netPaid > 0;
}

// --- Query ------------------------------------------------------------------------------------

// The reactive Income model for the authenticated caller. Resolves the caller from the JWT and derives
// the entire model from data in hand (the caller's incomeLedger rows + held properties' targetNetYield /
// cost basis). Returns `null` when unauthenticated or unprovisioned — never someone else's income.
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await findUserByIdentity(ctx, identity);
    if (!user) return null;

    const holdings = await ctx.db
      .query("holdings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // No by_user_period index exists — collect the caller's full income history by_user (same scan the
    // Home/Portfolio reads perform; a shared by_user_period index is deferred — see deferred-work.md).
    const income = await ctx.db
      .query("incomeLedger")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Fetch the distinct properties referenced by either the caller's holdings OR their distributions,
    // so the latest distribution's target/cost-basis resolves even if the holding was later reduced.
    const propertyIds = [
      ...new Set<Id<"properties">>([
        ...holdings.map((h) => h.propertyId),
        ...income.map((r) => r.propertyId),
      ]),
    ];
    const properties = (
      await Promise.all(propertyIds.map((id) => ctx.db.get(id)))
    ).filter((p): p is Doc<"properties"> => p !== null);
    const propertyById = new Map<Id<"properties">, Doc<"properties">>(
      properties.map((p) => [p._id, p]),
    );

    // Total cost basis the caller holds per property — the denominator of the annualized realized yield.
    const costBasisByProperty = new Map<Id<"properties">, number>();
    for (const h of holdings) {
      const v = Number.isFinite(h.costBasis) ? h.costBasis : 0;
      costBasisByProperty.set(h.propertyId, (costBasisByProperty.get(h.propertyId) ?? 0) + v);
    }

    const heldPropertyIds = new Set(holdings.map((h) => h.propertyId));
    const heldProperties = properties.filter((p) => heldPropertyIds.has(p._id));
    const todayIso = new Date(Date.now()).toISOString().slice(0, 10);

    // The next-distribution date (soonest held firstDistributionDate ≥ today). `firstDistributionDate`
    // is the soonest held first date IRRESPECTIVE of today, so the empty state can still name a date
    // that has already passed on/near the seed's first-distribution day.
    const nextDistributionDate = selectNextDistributionDate(heldProperties, todayIso);
    let firstDistributionDate: string | null = null;
    for (const p of heldProperties) {
      const d = p.firstDistributionDate;
      if (typeof d !== "string") continue;
      if (firstDistributionDate === null || d < firstDistributionDate) firstDistributionDate = d;
    }

    // A paid distribution that rounded to $0 is not a real payout (see isSurfaceableDistribution): drop
    // it from the "latest" selection so a sub-dollar holder sees the calm "first income on the way" empty
    // state, not an all-zeros waterfall + a false below-target note. Missed rows stay eligible.
    const latestRow = selectLatestDistribution(income.filter(isSurfaceableDistribution));
    const latest = latestRow
      ? {
          // propertyId is route-safe (already used in /property/[id] URLs) — the interim missed-
          // distribution onward link target. Never the raw txSig or any chain internal.
          propertyId: latestRow.propertyId,
          period: latestRow.period,
          status: latestRow.status,
          grossShare: latestRow.grossShare,
          costs: latestRow.costs,
          mgmtFee: latestRow.mgmtFee,
          reserve: latestRow.reserve,
          netPaid: latestRow.netPaid,
          // Admin Story 4.3 (ADDITIVE) — surface the "why paused" reason on the latest row. When the
          // latest distribution is a `missed` row that an operator PAUSED, it carries a structured
          // pauseReason (+ optional note); the consumer's existing missed banner now explains WHY, never
          // silent. Undefined for any non-paused row (paid/scheduled, or a legacy missed with no reason)
          // → omitted from the wire, so nothing about the existing shape changes.
          pauseReason: latestRow.pauseReason,
          pauseNote: latestRow.pauseNote,
          target: evaluateTarget(
            latestRow.netPaid,
            costBasisByProperty.get(latestRow.propertyId) ?? 0,
            propertyById.get(latestRow.propertyId)?.targetNetYield ?? 0,
          ),
        }
      : null;

    return {
      hasHoldings: holdings.length > 0,
      latest,
      // History rows carry month + net + status only — the detailed waterfall is the latest alone.
      history: buildHistory(income).map((r) => ({
        period: r.period,
        netPaid: r.netPaid,
        status: r.status,
      })),
      nextDistributionDate,
      firstDistributionDate,
    };
  },
});
