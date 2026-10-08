import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { computeShares, roundCents, holderWeight } from "./distribution";
import { splitDistribution } from "./home";
import type { Id } from "./_generated/dataModel";

// Admin Story 4.1 — the DISTRIBUTION BUILDER + matches-target. A `distribution.execute`-gated operator
// (ops_diligence; platform_admin denied at 1-1's wall) turns a closed month's operator numbers into a
// DRAFT distribution — the gross→net waterfall (gross rent → costs → management fee INSIDE net, never
// re-charged → reserve → net-per-token) — and confirms the net vs the offering's target yield BEFORE any
// money moves (funding + push are 4-2). This module adds NO new math: it REUSES the exact pieces the
// consumer distribution scheduler (runDistribution, distribution.ts) already uses —
//   • `computeShares` (largest-remainder apportionment, Σ never exceeds the pool),
//   • the ownershipPct weight-by-user aggregation (identical to runDistribution/distributionTargets so
//     the built ledger matches what the eventual push pays), and
//   • `splitDistribution` (the per-holder gross→net waterfall; the management fee is a component INSIDE
//     each net share, so it is never re-charged against the pool).
// It writes `incomeLedger` rows `status:"scheduled"` (DRAFT — never `paid`; the paid flip is reconcile's
// alone), IDEMPOTENT per (user, property, period) so a rebuild updates in place and never double-counts,
// and it NEVER funds escrow or pushes on-chain. Audited (`distribution.built`, no PII).

// The management fee lives INSIDE each holder's net waterfall (splitDistribution) — so the pool the
// operator distributes is gross rent minus operating costs only; the mgmt fee is NOT subtracted again.
// Exported so build + draft compute the SAME net pool from the SAME operator numbers.
function netPoolDollars(grossRentDollars: number, costsDollars: number): number {
  const gross = roundCents(grossRentDollars);
  const costs = roundCents(costsDollars);
  return Math.max(0, roundCents(gross - costs));
}

// Round a yield fraction to 4 dp so float noise (e.g. 0.061999999) never flips matchesTarget or leaks
// into the audit/variance. A distribution "matches target" when the implied annual net yield is within
// half a percentage point (0.005) of the property's targetNetYield.
const YIELD_TOLERANCE = 0.005;
function roundYield(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

// Implied ANNUAL net yield of a period's net pool against the invested basis (Σ holder cost basis) — the
// inverse of the seed's `netPaid = costBasis * targetNetYield / 12`: a monthly net pool annualizes ×12
// over the basis. Basis ≤ 0 → 0 (never NaN/Infinity). Same formula in build and draft so they agree.
function impliedAnnualNetYield(netPoolMonthly: number, basisDollars: number): number {
  if (!(basisDollars > 0)) return 0;
  return roundYield((netPoolMonthly * 12) / basisDollars);
}

// matchesTarget + a human-readable variance reason (never thrown — a variance SURFACES so the operator
// acknowledges it; the actual push gate is 4-2). `variance` is impliedYield − targetYield (signed).
function evaluateTarget(
  netPool: number,
  basis: number,
  targetNetYield: number,
): { impliedNetYield: number; variance: number; matchesTarget: boolean; reason: string | null } {
  const impliedNetYield = impliedAnnualNetYield(netPool, basis);
  const variance = roundYield(impliedNetYield - targetNetYield);
  const matchesTarget = basis > 0 && Math.abs(variance) <= YIELD_TOLERANCE;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const reason = matchesTarget
    ? null
    : basis <= 0
      ? "No invested basis to distribute against — the property has no funded holders."
      : `Implied net yield ${pct(impliedNetYield)} ${variance >= 0 ? "exceeds" : "is below"} target ` +
        `${pct(targetNetYield)} by ${(Math.abs(variance) * 100).toFixed(2)}pp.`;
  return { impliedNetYield, variance, matchesTarget, reason };
}

// Aggregate a property's holders by user: the ownershipPct weight (the unit-safe basis both purchase
// paths maintain — IDENTICAL to runDistribution/distributionTargets so the built ledger matches the
// eventual push) and the Σ cost basis (the invested-capital denominator for the matches-target check).
async function holdersByUser(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<"properties">,
): Promise<{ weightByUser: Map<Id<"users">, number>; basis: number }> {
  const holdings = await ctx.db
    .query("holdings")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  const weightByUser = new Map<Id<"users">, number>();
  let basis = 0;
  for (const h of holdings) {
    weightByUser.set(h.userId, (weightByUser.get(h.userId) ?? 0) + holderWeight(h));
    basis += Number.isFinite(h.costBasis) ? h.costBasis : 0;
  }
  return { weightByUser, basis: roundCents(basis) };
}

// ── buildDistribution — the DRAFT builder (mutation, distribution.execute-gated) ──────────────────────
// Refuses unless the property is `open` (a gating/unlisted property cannot be built against); resolves
// holders by the SAME ownershipPct weighting the push uses; apportions the net pool with `computeShares`;
// writes each holder's `splitDistribution` waterfall as a `scheduled` incomeLedger row (idempotent upsert
// per (user, property, period) until escrow funding is reserved; a funded draft is immutable and a
// `paid` row is chain truth); computes matchesTarget vs targetNetYield (a variance surfaces, never
// throws); audits `distribution.built` (aggregate counts only, no PII). NO money moves; no row is `paid`.
export const buildDistribution = mutation({
  args: {
    propertyId: v.id("properties"),
    period: v.string(), // "YYYY-MM"
    grossRentDollars: v.number(),
    costsDollars: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const staff = await requirePermission(ctx, "distribution.execute");
    const actor = staff.email || staff.name || staff.workosId;

    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new Error("Property not found");
    // Gate on a LISTED property — only an open (listed) offering with holders can be distributed
    // against. A gating/funded/closed property refuses (no draft is written).
    if (property.status !== "open") {
      throw new Error(
        `Cannot build a distribution for a ${property.status} property — only a listed (open) property`,
      );
    }

    // Funding reserves an external custody consequence before contacting the provider. From that first
    // durable reservation onward, changing any row could make the scheduled aggregate diverge from the
    // exact base units reserved in escrow. Every operation status therefore locks the draft, including
    // leased/unknown/failed states; only explicit custody reconciliation may resolve that consequence.
    const escrowOperation = await ctx.db
      .query("externalOperations")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", `escrow:${args.propertyId}:${args.period}`),
      )
      .unique();
    if (escrowOperation) {
      throw new Error("Cannot rebuild a distribution draft after escrow funding has been reserved");
    }

    const { weightByUser, basis } = await holdersByUser(ctx, args.propertyId);
    if (weightByUser.size === 0) {
      throw new Error("Property has no holders to distribute to");
    }
    const users = [...weightByUser.entries()];

    // The net pool the operator distributes: gross rent minus operating costs. The management fee is a
    // component INSIDE each holder's net waterfall (splitDistribution) — it is NEVER re-charged here.
    const grossRent = roundCents(args.grossRentDollars);
    const costs = roundCents(args.costsDollars ?? 0);
    const poolNet = netPoolDollars(grossRent, costs);

    const shares = computeShares(
      poolNet,
      users.map(([id, w]) => ({ id, weight: w })),
    );

    // Existing rows for this (property, period) — upsert per user so a rebuild updates in place and never
    // duplicates/double-counts. IDENTICAL discipline to runDistribution.
    const existing = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) =>
        q.eq("propertyId", args.propertyId).eq("period", args.period),
      )
      .collect();
    const existingByUser = new Map(existing.map((r) => [r.userId, r]));

    let written = 0;
    let updated = 0;
    let skippedPaid = 0;
    let skippedZero = 0;
    let netTotal = 0;
    for (let i = 0; i < users.length; i++) {
      const userId = users[i][0];
      const netPaid = shares[i].amount;
      // Zero-token / sub-cent ($0 rounded) shares never get a fabricated all-zero row.
      if (netPaid <= 0) {
        skippedZero += 1;
        continue;
      }
      // The per-holder gross→net waterfall — REUSED verbatim (grossShare = costs+mgmtFee+reserve+netPaid;
      // the mgmt fee is INSIDE net, never re-charged). Same splitter runDistribution/the seed use.
      const waterfall = splitDistribution(netPaid);
      netTotal += waterfall.netPaid;
      const prior = existingByUser.get(userId);
      if (prior) {
        // A chain-confirmed (paid) row is authoritative — never overwrite it (reconcile owns paid).
        if (prior.status === "paid") {
          skippedPaid += 1;
          continue;
        }
        await ctx.db.patch(prior._id, { ...waterfall, status: "scheduled" });
        updated += 1;
      } else {
        await ctx.db.insert("incomeLedger", {
          userId,
          propertyId: args.propertyId,
          period: args.period,
          grossShare: waterfall.grossShare,
          costs: waterfall.costs,
          mgmtFee: waterfall.mgmtFee,
          reserve: waterfall.reserve,
          netPaid: waterfall.netPaid,
          status: "scheduled", // DRAFT — never `paid` (payment is 4-2; reconcile owns the paid flip)
        });
        written += 1;
      }
    }

    // Matches-target — the net the draft actually schedules (netTotal) vs the offering's target yield. A
    // variance SURFACES (it is returned + audited), it does NOT throw — the operator acknowledges it and
    // the actual push gate is 4-2.
    const target = evaluateTarget(netTotal, basis, property.targetNetYield);

    await writeAudit(ctx, {
      actor,
      action: "distribution.built",
      target: args.propertyId,
      meta: {
        period: args.period,
        grossRent,
        costs,
        poolNet,
        netTotal,
        holders: users.length,
        written,
        updated,
        skippedPaid,
        skippedZero,
        targetNetYield: property.targetNetYield,
        impliedNetYield: target.impliedNetYield,
        variance: target.variance,
        matchesTarget: target.matchesTarget,
      },
    });

    return {
      period: args.period,
      grossRent,
      costs,
      poolNet,
      netTotal,
      holders: users.length,
      written,
      updated,
      skippedPaid,
      skippedZero,
      targetNetYield: property.targetNetYield,
      impliedNetYield: target.impliedNetYield,
      variance: target.variance,
      matchesTarget: target.matchesTarget,
      reason: target.reason,
    };
  },
});

// ── distributionDraft — the built draft for a (property, period) (query, distribution.execute) ────────
// Waterfall totals, the per-holder row count, net-per-unit, and matchesTarget/variance — read over the
// scheduled incomeLedger rows this builder wrote. Read-only; returns null for an unknown property.
export const distributionDraft = query({
  args: { propertyId: v.id("properties"), period: v.string() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "distribution.execute");

    const property = await ctx.db.get(args.propertyId);
    if (!property) return null;

    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) =>
        q.eq("propertyId", args.propertyId).eq("period", args.period),
      )
      .collect();

    const totals = rows.reduce(
      (acc, r) => ({
        grossShare: acc.grossShare + (Number.isFinite(r.grossShare) ? r.grossShare : 0),
        costs: acc.costs + (Number.isFinite(r.costs) ? r.costs : 0),
        mgmtFee: acc.mgmtFee + (Number.isFinite(r.mgmtFee) ? r.mgmtFee : 0),
        reserve: acc.reserve + (Number.isFinite(r.reserve) ? r.reserve : 0),
        netPaid: acc.netPaid + (Number.isFinite(r.netPaid) ? r.netPaid : 0),
      }),
      { grossShare: 0, costs: 0, mgmtFee: 0, reserve: 0, netPaid: 0 },
    );

    const { basis } = await holdersByUser(ctx, args.propertyId);
    const target = evaluateTarget(roundCents(totals.netPaid), basis, property.targetNetYield);
    // Net per property unit — the offering's per-unit distribution for this period (units > 0 guarded).
    const netPerUnit = property.units > 0 ? roundCents(totals.netPaid / property.units) : 0;

    return {
      property: {
        id: property._id,
        name: property.name,
        status: property.status,
        units: property.units,
        targetNetYield: property.targetNetYield,
      },
      period: args.period,
      rowCount: rows.length,
      scheduledCount: rows.filter((r) => r.status === "scheduled").length,
      paidCount: rows.filter((r) => r.status === "paid").length,
      totals: {
        grossShare: roundCents(totals.grossShare),
        costs: roundCents(totals.costs),
        mgmtFee: roundCents(totals.mgmtFee),
        reserve: roundCents(totals.reserve),
        netPaid: roundCents(totals.netPaid),
      },
      netPerUnit,
      basis,
      impliedNetYield: target.impliedNetYield,
      variance: target.variance,
      matchesTarget: target.matchesTarget,
      reason: target.reason,
    };
  },
});

// ── listDistributableProperties — the gated picker (query, distribution.execute) ──────────────────────
// Listed (`status:"open"`) properties that have holders — the only properties a distribution can be built
// against. Like 3-1's listGateProperties, the builder needs a `distribution.execute`-gated way to CHOOSE
// a property (reusing an ungated consumer list would leak the choice). Read-only.
export const listDistributableProperties = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "distribution.execute");

    const properties = await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    const out: {
      id: Id<"properties">;
      name: string;
      location: string;
      units: number;
      targetNetYield: number;
      holders: number;
    }[] = [];
    for (const p of properties) {
      const holdings = await ctx.db
        .query("holdings")
        .withIndex("by_property", (q) => q.eq("propertyId", p._id))
        .collect();
      const holders = new Set(holdings.map((h) => h.userId)).size;
      if (holders === 0) continue; // only properties WITH holders can be distributed against
      out.push({
        id: p._id,
        name: p.name,
        location: p.location,
        units: p.units,
        targetNetYield: p.targetNetYield,
        holders,
      });
    }
    return out;
  },
});
