import { query } from "./_generated/server";
import { periodFor } from "./home";
import { findUserByIdentity } from "./security";
import type { Doc, Id } from "./_generated/dataModel";

// Story 5.2 — Portfolio + concentration honesty (FR13).
//
// Portfolio is a PURE READ SURFACE over the reconciled mirror — it adds no authoritative state and
// never writes ownership/money. The whole model is derived from data already owned by the read model:
//   • per-holding value  = holding.costBasis            (cost basis — no live NAV; same model as Home 5.1)
//   • this-month income  = Σ netPaid over PAID rows whose `period` is the current period, per property
//   • market             = property.location            (the ONLY geographic field, e.g. "Tampa, FL")
//   • allocation-by-market = holdings' cost basis grouped by resolved market; share = value / total
//   • concentration      = the top market whose share STRICTLY exceeds 0.35 (CONCENTRATION_THRESHOLD)
//
// The caller is always resolved server-side from the JWT (getUserIdentity() → by_privyId); the query
// returns `null` when unauthenticated or unprovisioned — the client-supplied identity is never trusted.
// Nothing here surfaces a raw distribution `txSig`; only the net dollar figure per property is emitted.

// --- Pure helpers (exported for unit tests; no ctx/db access) ---------------------------------

// The concentration warning fires when a single market's allocation share STRICTLY exceeds this
// fraction. Boundary (exactly 0.35) shows no nudge — honesty over alarm, matching FR13.
export const CONCENTRATION_THRESHOLD = 0.35;

// Group positions by market, summing cost basis, and compute each market's share of the total. Share
// is guarded to 0 when the total is ≤ 0 (or non-finite) so a zero-cost-basis account never yields
// Infinity/NaN. Non-finite per-position values degrade to 0. Sorted by value descending (largest
// market first) so the view and the concentration pick read top-down. Empty input → [].
export function buildAllocations<T extends { market: string; value: number }>(
  positions: T[],
): { market: string; value: number; pct: number }[] {
  const byMarket = new Map<string, number>();
  for (const p of positions) {
    const v = Number.isFinite(p.value) ? p.value : 0;
    byMarket.set(p.market, (byMarket.get(p.market) ?? 0) + v);
  }
  const total = [...byMarket.values()].reduce((sum, v) => sum + v, 0);
  const allocations = [...byMarket.entries()].map(([market, value]) => ({
    market,
    value,
    pct: Number.isFinite(total) && total > 0 ? value / total : 0,
  }));
  allocations.sort((a, b) => b.value - a.value);
  return allocations;
}

// The single market whose allocation share strictly exceeds `threshold`, else null. Uses strictly
// greater-than (boundary at exactly the threshold → no nudge). Independent of input ordering: it picks
// the highest-share market above the line (there can be at most one market above 0.5, but a threshold
// below 0.5 could in principle admit more than one — we surface the largest).
export function selectConcentration(
  allocations: { market: string; value: number; pct: number }[],
  threshold: number,
): { market: string; value: number; pct: number } | null {
  let top: { market: string; value: number; pct: number } | null = null;
  for (const a of allocations) {
    if (a.pct > threshold && (top === null || a.pct > top.pct)) top = a;
  }
  return top;
}

// Σ `netPaid` over PAID rows matching `period`, keyed by propertyId. Scheduled/missed rows and rows
// from other periods never count. Non-finite `netPaid` degrades to 0. Empty → {}.
export function monthIncomeByProperty<
  T extends { propertyId: string; netPaid: number; status: string; period: string },
>(rows: T[], period: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== "paid" || r.period !== period) continue;
    const v = Number.isFinite(r.netPaid) ? r.netPaid : 0;
    out[r.propertyId] = (out[r.propertyId] ?? 0) + v;
  }
  return out;
}

// --- Query ------------------------------------------------------------------------------------

// The reactive Portfolio model for the authenticated caller. Resolves the caller from the JWT and
// derives the entire model from data in hand (holdings cost basis / paid incomeLedger rows for the
// current period / held properties' location). Returns `null` when unauthenticated or unprovisioned.
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

    // No by_user_period index exists — collect by_user, then filter to the current period in JS.
    const income = await ctx.db
      .query("incomeLedger")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // The distinct properties the caller holds — the only ones whose location (market) is relevant.
    const heldPropertyIds = [...new Set(holdings.map((h) => h.propertyId))];
    const properties = (
      await Promise.all(heldPropertyIds.map((id) => ctx.db.get(id)))
    ).filter((p): p is Doc<"properties"> => p !== null);
    const propertyById = new Map<Id<"properties">, Doc<"properties">>(
      properties.map((p) => [p._id, p]),
    );

    const period = periodFor(Date.now());
    const incomeByProperty = monthIncomeByProperty(income, period);

    // Collapse to one row per property. costBasis already accumulates on repeat buys (settlement +
    // reconcile both upsert by (user, property)), but the schema enforces no unique index — grouping
    // here keeps per-holding rows and market allocation correct, and adds this-month income exactly
    // once per property, even if a stray duplicate holding row ever appears. A held property whose doc
    // failed to load degrades to a calm placeholder market.
    const byProperty = new Map<
      Id<"properties">,
      { propertyId: Id<"properties">; name: string; market: string; value: number; monthIncome: number }
    >();
    for (const h of holdings) {
      const value = Number.isFinite(h.costBasis) ? h.costBasis : 0;
      const existing = byProperty.get(h.propertyId);
      if (existing) {
        existing.value += value;
        continue;
      }
      const property = propertyById.get(h.propertyId);
      byProperty.set(h.propertyId, {
        propertyId: h.propertyId,
        name: property?.name ?? "Your property",
        market: property?.location ?? "Unknown market",
        value,
        monthIncome: incomeByProperty[h.propertyId] ?? 0,
      });
    }
    const rows = [...byProperty.values()];

    const allocations = buildAllocations(rows.map((r) => ({ market: r.market, value: r.value })));
    const concentration = selectConcentration(allocations, CONCENTRATION_THRESHOLD);

    return {
      hasHoldings: holdings.length > 0,
      holdings: rows,
      allocations,
      totalValue: rows.reduce((sum, r) => sum + r.value, 0),
      totalMonthIncome: rows.reduce((sum, r) => sum + r.monthIncome, 0),
      // Consumer-safe: only the market name + its share surface — never a raw txSig or period internals.
      concentration: concentration
        ? { market: concentration.market, pct: concentration.pct }
        : null,
    };
  },
});
