import { query, internalMutation } from "./_generated/server";
import { writeAudit } from "./audit";
import { findUserByIdentity, requireSeedWrites } from "./security";
import type { Doc, Id } from "./_generated/dataModel";

// Story 5.1 — Home: the payout is the hero (FR12).
//
// Home is a PURE READ SURFACE over the reconciled mirror — it adds no authoritative state and never
// writes ownership/money. The whole Home model is derived from data already owned by the read model:
//   • portfolioValue = Σ holdings.costBasis      (cost basis — no live NAV; Pyth is market-context only)
//   • incomeToDate   = Σ netPaid over paid rows  (the only realized return)
//   • allTimeReturn  = incomeToDate              (honest given the cost-basis model)
//   • freshDistribution = the most recent PAID incomeLedger row whose `paidAt` is inside a 7-day window
//   • nextDistributionDate = the soonest held-property `firstDistributionDate` on/after today
//   • balanceSeries  = cumulative cost basis over settled orders (what you own, growing as you invest)
//
// The caller is always resolved server-side from the JWT (getUserIdentity() → by_privyId); the query
// returns `null` when unauthenticated or unprovisioned — the client-supplied identity is never trusted.
//
// `devSeedDistribution` is a CLI-only seed (sibling to properties:seedTheMonroe) that pays out existing
// holdings so the fresh hero is drivable without a live chain — NEVER wired to any consumer UI. As of
// Story 5.3 it writes a real itemized gross→net waterfall (via `splitDistribution`); the real
// distribution scheduler / recurring cadence is still deferred (see deferred-work.md DW-4).

// --- Pure helpers (exported for unit tests; no ctx/db access) ---------------------------------

// A distribution is "fresh" only if it landed within the last 7 days. Rows without `paidAt`
// (pre-migration) never qualify — they degrade to not-fresh rather than falsely leading the hero.
export const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Portfolio value = Σ cost basis across the caller's holdings. Empty → 0.
export function sumCostBasis(holdings: Pick<Doc<"holdings">, "costBasis">[]): number {
  return holdings.reduce((sum, h) => sum + (Number.isFinite(h.costBasis) ? h.costBasis : 0), 0);
}

// Income-to-date = Σ netPaid over PAID rows only (scheduled/missed rows never count). Empty → 0.
export function sumNetPaid(rows: Pick<Doc<"incomeLedger">, "netPaid" | "status">[]): number {
  return rows
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + (Number.isFinite(r.netPaid) ? r.netPaid : 0), 0);
}

// All-time return as a fraction of portfolio value (income / value). Guarded to 0 when value ≤ 0 (or
// non-finite) so a zero-cost-basis account never yields Infinity/NaN.
export function returnPct(income: number, value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const i = Number.isFinite(income) ? income : 0;
  return i / value;
}

// The most recent PAID distribution that landed within FRESH_WINDOW_MS of `now`, else null. A row
// qualifies only when it is `paid`, carries a FINITE `paidAt` inside the window (0 ≤ age ≤ window),
// and actually paid out (`netPaid > 0`) — so a corrupt NaN timestamp can't age-in forever, and a $0
// payout never gets promoted to the celebratory hero. Among qualifiers, the newest `paidAt` wins.
export function selectFreshDistribution<
  T extends { status: string; paidAt?: number; netPaid?: number },
>(paidRows: T[], now: number): T | null {
  let best: T | null = null;
  for (const row of paidRows) {
    if (row.status !== "paid" || !Number.isFinite(row.paidAt)) continue;
    if (!(typeof row.netPaid === "number" && row.netPaid > 0)) continue;
    const age = now - row.paidAt!;
    if (age < 0 || age > FRESH_WINDOW_MS) continue;
    if (best === null || row.paidAt! > best.paidAt!) best = row;
  }
  return best;
}

// The soonest held-property first-distribution date on/after today, else null. Dates are "YYYY-MM-DD"
// strings compared LEXICOGRAPHICALLY — a fixed-width zero-padded ISO date sorts identically to its
// chronological order, so no Date parsing is needed (and no timezone drift can creep in).
export function selectNextDistributionDate(
  props: Pick<Doc<"properties">, "firstDistributionDate">[],
  todayIso: string,
): string | null {
  let soonest: string | null = null;
  for (const p of props) {
    const d = p.firstDistributionDate;
    if (typeof d !== "string" || d < todayIso) continue;
    if (soonest === null || d < soonest) soonest = d;
  }
  return soonest;
}

// The balance sparkline series: cumulative cost basis over SETTLED orders, in `createdAt` order — what
// you own, growing as you invest (no fabricated appreciation). Non-settled orders never count. Empty → [].
export function buildBalanceSeries(
  orders: Pick<Doc<"orders">, "amount" | "status" | "createdAt">[],
): number[] {
  const settled = orders
    .filter((o) => o.status === "settled")
    .sort((a, b) => a.createdAt - b.createdAt);
  const series: number[] = [];
  let running = 0;
  for (const o of settled) {
    running += Number.isFinite(o.amount) ? o.amount : 0;
    series.push(running);
  }
  return series;
}

// The current distribution period ("YYYY-MM") for a given epoch-ms instant, in UTC (matches the
// confirmation view's UTC date handling — no timezone drift on the period key).
export function periodFor(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

// Split a net payout into an internally-consistent gross→net waterfall for the dev seed (Story 5.3).
// Given the cash the owner receives (`netPaid`), it back-fills the gross rent share and the three
// deductions so the invariant `grossShare = costs + mgmtFee + reserve + netPaid` holds EXACTLY (integer
// dollars; deductions derive from gross and the net is the remainder, so rounding can never break the
// sum). The proportions are illustrative dev-seed values — real per-line figures will come from the
// operator/reconciliation (deferred). A non-positive/non-finite net yields an all-zero waterfall (no
// fabricated gross for a $0 payout).
export function splitDistribution(netPaid: number): {
  grossShare: number;
  costs: number;
  mgmtFee: number;
  reserve: number;
  netPaid: number;
} {
  if (!Number.isFinite(netPaid) || netPaid <= 0) {
    return { grossShare: 0, costs: 0, mgmtFee: 0, reserve: 0, netPaid: 0 };
  }
  const net = Math.round(netPaid);
  // Net is ~62% of gross after operating costs (~24%), management fee (~8%), and reserve (~6%).
  const grossShare = Math.round(net / 0.62);
  const costs = Math.round(grossShare * 0.24);
  const mgmtFee = Math.round(grossShare * 0.08);
  // Reserve is the remainder so the four components sum to gross EXACTLY (absorbs all rounding drift).
  const reserve = grossShare - costs - mgmtFee - net;
  return { grossShare, costs, mgmtFee, reserve, netPaid: net };
}

// --- Query ------------------------------------------------------------------------------------

// The reactive Home model for the authenticated caller. Resolves the caller from the JWT and derives
// the entire model from data in hand (holdings / paid incomeLedger rows / settled orders / held
// properties). Returns `null` when unauthenticated or unprovisioned (never someone else's data).
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

    const income = await ctx.db
      .query("incomeLedger")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // The distinct properties the caller holds — the only ones whose first-distribution date is
    // relevant to this owner's "next distribution" line.
    const heldPropertyIds = [...new Set(holdings.map((h) => h.propertyId))];
    const properties = (
      await Promise.all(heldPropertyIds.map((id) => ctx.db.get(id)))
    ).filter((p): p is Doc<"properties"> => p !== null);

    const now = Date.now();
    const portfolioValue = sumCostBasis(holdings);
    const incomeToDate = sumNetPaid(income);
    const fresh = selectFreshDistribution(income, now);
    const todayIso = new Date(now).toISOString().slice(0, 10);

    // This-month paid income per property (current period) — powers Home's "This month" stat and the
    // per-home preview's this-month figure. Same rule as Portfolio's monthIncomeByProperty (paid rows in
    // the current period only), computed inline to avoid a home↔portfolio import cycle.
    const period = periodFor(now);
    const propertyById = new Map<Id<"properties">, Doc<"properties">>(properties.map((p) => [p._id, p]));
    const monthIncomeByProperty = new Map<Id<"properties">, number>();
    for (const r of income) {
      if (r.status !== "paid" || r.period !== period) continue;
      const v = Number.isFinite(r.netPaid) ? r.netPaid : 0;
      monthIncomeByProperty.set(r.propertyId, (monthIncomeByProperty.get(r.propertyId) ?? 0) + v);
    }

    // Per-holding preview rows (grouped by property, like Portfolio) — Home shows a compact "Your homes"
    // list that links onward to the full Portfolio. Consumer-safe: name + market + cost-basis value + the
    // month's net; never a raw txSig or period internal.
    const holdingByProperty = new Map<
      Id<"properties">,
      { propertyId: Id<"properties">; name: string; market: string; value: number; monthIncome: number }
    >();
    for (const h of holdings) {
      const value = Number.isFinite(h.costBasis) ? h.costBasis : 0;
      const existing = holdingByProperty.get(h.propertyId);
      if (existing) {
        existing.value += value;
        continue;
      }
      const property = propertyById.get(h.propertyId);
      holdingByProperty.set(h.propertyId, {
        propertyId: h.propertyId,
        name: property?.name ?? "Your property",
        market: property?.location ?? "Unknown market",
        value,
        monthIncome: monthIncomeByProperty.get(h.propertyId) ?? 0,
      });
    }
    const holdingRows = [...holdingByProperty.values()];

    return {
      hasHoldings: holdings.length > 0,
      portfolioValue,
      incomeToDate,
      // This month's realized income across all holdings (paid rows in the current period).
      monthIncome: [...monthIncomeByProperty.values()].reduce((sum, v) => sum + v, 0),
      // All-time return equals realized income-to-date (no live NAV/appreciation); pct guarded to 0.
      allTimeReturn: incomeToDate,
      allTimeReturnPct: returnPct(incomeToDate, portfolioValue),
      // Consumer-safe: only the net dollar amount surfaces — never the raw txSig or period internals.
      freshDistribution: fresh ? { amount: fresh.netPaid } : null,
      nextDistributionDate: selectNextDistributionDate(properties, todayIso),
      balanceSeries: buildBalanceSeries(orders),
      // A compact per-home preview (name · market · value · this-month) linking onward to Portfolio.
      holdings: holdingRows,
    };
  },
});

// --- Mutation (CLI seed only — never UI-wired) ------------------------------------------------

// Demo income producer. For every holding, upsert a `status:"paid"` incomeLedger row for the current
// period so Home's fresh hero is drivable without a live chain. Idempotent per (user, property, period)
// and audited. Writes a real itemized gross→net waterfall via `splitDistribution` (Story 5.3) — gross >
// net, components sum to gross exactly; `netPaid`/`status`/`paidAt` unchanged. No args / no JWT: under
// `npx convex run` there is no caller identity, so it iterates ALL holdings. Run:
// `npx convex run home:devSeedDistribution`.
export const devSeedDistribution = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Fail closed outside test / VESPER_ENABLE_DEMO_SEED — parity with its seed siblings
    // (seedDemo.ts, properties.ts) and, since this writes `incomeLedger` rows `status:"paid"`, a guard
    // on a self-settle-shaped path that must never run against a live deployment.
    requireSeedWrites("devSeedDistribution");

    const now = Date.now();
    const period = periodFor(now);
    const holdings = await ctx.db.query("holdings").collect();

    let seeded = 0;
    let skipped = 0;

    for (const holding of holdings) {
      // Idempotent per (user, property, period): a row already present for this owner+property this
      // period is a no-op (re-running the seed never double-pays).
      const existing = (
        await ctx.db
          .query("incomeLedger")
          .withIndex("by_property_period", (q) =>
            q.eq("propertyId", holding.propertyId).eq("period", period),
          )
          .collect()
      ).find((r) => r.userId === holding.userId);
      if (existing) {
        skipped += 1;
        continue;
      }

      // The property carries the target net yield used to size the demo monthly payout.
      const property = await ctx.db.get(holding.propertyId);
      if (!property) {
        skipped += 1;
        continue;
      }

      const netPaid = Math.round((holding.costBasis * property.targetNetYield) / 12);
      // Story 5.3: a real, internally-consistent itemized waterfall (gross > net; components sum to
      // gross exactly). `netPaid`/`status`/`paidAt` are unchanged so Home (5.1) / Portfolio (5.2) are
      // unaffected — only the previously-degenerate gross/costs/mgmtFee/reserve now carry real values.
      const waterfall = splitDistribution(netPaid);

      await ctx.db.insert("incomeLedger", {
        userId: holding.userId,
        propertyId: holding.propertyId,
        period,
        grossShare: waterfall.grossShare,
        costs: waterfall.costs,
        mgmtFee: waterfall.mgmtFee,
        reserve: waterfall.reserve,
        netPaid: waterfall.netPaid,
        status: "paid",
        paidAt: now,
      });

      await writeAudit(ctx, {
        actor: "seed",
        action: "income.seeded",
        target: holding.propertyId,
        meta: { userId: holding.userId, period, netPaid },
      });

      seeded += 1;
    }

    return `devSeedDistribution: seeded ${seeded}, skipped ${skipped} (period ${period})`;
  },
});
