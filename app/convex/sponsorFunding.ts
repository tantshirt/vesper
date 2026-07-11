import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { requireSponsor } from "./sponsor";

// Admin Story 6.4 — the sponsor FUNDING / HOLDER dashboard (tenant-isolated). The LAST of the 20 admin
// stories. A sponsor sees, for THEIR OWN operated offering only, its funding progress and the SHAPE of
// its cap table — never another sponsor's, never internal data, and never an individual investor.
//
// Two walls, both reused verbatim — nothing new is invented here:
//   1. Tenant isolation is the sponsor↔property OPERATOR link (`properties.operatorSponsorOrgId`, 6.3).
//      `requireSponsor` (6.1) resolves the caller's org server-side; every read is scoped to properties
//      whose `operatorSponsorOrgId` equals it. A property they do not operate reads as not-found — never
//      a client-supplied org, never a confirmed existence of another tenant's property.
//   2. NO investor PII to the sponsor. `holdings` carries a `userId` (a consumer identity) plus per-row
//      amounts — NONE of that leaves this module. Every returned payload is an AGGREGATE: funding
//      progress, a holder COUNT, total tokens, and ownership-concentration figures. A sponsor sees how
//      many investors hold their offering and how concentrated the cap table is, never WHO is in it.
//
// Read-only: there is no mutation here. Both sponsor roles hold `sponsor.read`; an internal staff role
// holds no sponsor role and is barred at `requireSponsor`.

// --- Aggregation (the ONLY place holdings are read for a sponsor) -----------------------------

// The holder AGGREGATE for one property — a COUNT + distribution figures, derived from `holdings` but
// carrying NO `userId`, wallet, name, or per-investor amount. This is the single function that touches
// the consumer `holdings` table on the sponsor surface, so the "aggregates only" guarantee has one
// definition every read shares. `topHoldingPct` is the largest single ownership fraction (the cap-table
// concentration signal); the buckets partition holders by ownership band WITHOUT naming any of them.
async function holderAggregates(ctx: QueryCtx, propertyId: Id<"properties">) {
  const holdings = await ctx.db
    .query("holdings")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();

  let totalTokens = 0;
  let topHoldingPct = 0;
  // Ownership-concentration buckets (fractions): the SHAPE of the cap table, never its members.
  const concentration = { under1Pct: 0, oneToFivePct: 0, fiveToTenPct: 0, overTenPct: 0 };

  for (const h of holdings) {
    totalTokens += Number.isFinite(h.tokenAmount) ? h.tokenAmount : 0;
    const pct = Number.isFinite(h.ownershipPct) ? h.ownershipPct : 0;
    if (pct > topHoldingPct) topHoldingPct = pct;
    if (pct < 0.01) concentration.under1Pct += 1;
    else if (pct < 0.05) concentration.oneToFivePct += 1;
    else if (pct < 0.1) concentration.fiveToTenPct += 1;
    else concentration.overTenPct += 1;
  }

  return {
    holderCount: holdings.length,
    totalTokens,
    topHoldingPct,
    concentration,
  };
}

// --- Queries ----------------------------------------------------------------------------------

// myOfferingFunding — the dashboard row per property the caller's org OPERATES, org-scoped via the
// `by_operator` index (the SAME 6.3 `myOperatedProperties` pattern). `requireSponsor` resolves the org
// server-side and bars a non-sponsor; there is no client-supplied filter, so a sponsor sees EXACTLY
// their operated offerings. Each row is AGGREGATES ONLY — funding progress plus a holder count and
// concentration figures; there is no per-investor row anywhere in the payload.
export const myOfferingFunding = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sponsor.read");
    const { orgId } = await requireSponsor(ctx);

    const properties = await ctx.db
      .query("properties")
      .withIndex("by_operator", (q) => q.eq("operatorSponsorOrgId", orgId))
      .collect();

    const rows = [];
    for (const p of properties) {
      const agg = await holderAggregates(ctx, p._id);
      rows.push({
        propertyId: p._id,
        name: p.name,
        status: p.status,
        offeringSize: p.offeringSize,
        fundedPct: p.fundedPct,
        // amountRaised is DERIVED from the offering's own funding progress (offeringSize × fundedPct),
        // never summed from per-investor amounts — so no investor's contribution is ever exposed.
        amountRaised: Math.round(p.offeringSize * p.fundedPct),
        holderCount: agg.holderCount,
        totalTokens: agg.totalTokens,
        topHoldingPct: agg.topHoldingPct,
      });
    }

    // Deterministic order so a reactive re-read never reshuffles the dashboard.
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  },
});

// myOfferingDetail — a SINGLE operated property's funding + holder aggregates, including the
// ownership-concentration buckets. Tenant wall: the property is returned ONLY if its
// `operatorSponsorOrgId` equals the caller's org — a property they do not operate (or a crafted id for
// another tenant's, or a non-existent one) reads as null, never confirmed. Still aggregates only: no
// investor identity, wallet, name, or per-investor amount.
export const myOfferingDetail = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    await requirePermission(ctx, "sponsor.read");
    const { orgId } = await requireSponsor(ctx);

    const property = await ctx.db.get(propertyId);
    // Not-operated (or absent) reads as not-found — never confirm another tenant's property.
    if (!property || property.operatorSponsorOrgId !== orgId) return null;

    const agg = await holderAggregates(ctx, property._id);
    return {
      propertyId: property._id,
      name: property.name,
      status: property.status,
      offeringSize: property.offeringSize,
      fundedPct: property.fundedPct,
      amountRaised: Math.round(property.offeringSize * property.fundedPct),
      holderCount: agg.holderCount,
      totalTokens: agg.totalTokens,
      topHoldingPct: agg.topHoldingPct,
      concentration: agg.concentration,
    };
  },
});
