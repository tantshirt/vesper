import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { splitDistribution, periodFor } from "./home";
import { requireSeedWrites } from "./security";
import type { Id } from "./_generated/dataModel";

// Demo seed — populate ONE owner (Maya) with a rich, realistic portfolio so the redesigned dashboard
// renders its populated states (Home / Portfolio / Income / Updates / Explore). CLI-only
// (`internalMutation`), idempotent, and audited.
//
// Every summary query scopes to the `users._id` resolved from the caller's Privy tokenIdentifier, so
// this seed MUST target the real identity key of the account that logs in. It deliberately requires an
// explicit user id and confirmation token because it patches holdings and resets settled demo orders:
//   VESPER_ENABLE_DEMO_SEED=true npx convex run seedDemo:seedMaya \
//     '{"privyId":"<identity tokenIdentifier>","unsafeConfirm":"RESET_DEMO_PORTFOLIO"}'
// Pass '{"fresh":true}' to date the latest distribution inside the 7-day window (drives Home's dusk
// "Rent just landed" hero); by default the latest is 8 days old so the portfolio-value hero shows.

const MONTHS_OF_HISTORY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

// The three homes are NAMED to match the brand artworks (see components/propertyImage.ts:
// the-monroe / cedar-row / alder-court) so each renders distinct dusk art with no repeats. Cost bases
// split ~$48k as 20k / 16k / 12k → Tampa ≈ 42% share, which trips the concentration nudge (a designed,
// honest feature) alongside the allocation donut. Markets differ so allocation-by-market is meaningful.
type PropSpec = {
  name: string;
  location: string;
  propertyType: string;
  units: number;
  targetNetYield: number;
  offeringSize: number;
  fundedPct: number;
  spvName: string;
  minInvestment: number;
  firstDistributionDate: string;
  costBasis: number;
  occupancy: number;
  reservesMonths: number;
  rentOnTime: boolean;
  operator: string;
  note: string;
};

const PROPERTIES: PropSpec[] = [
  {
    name: "The Monroe",
    location: "Tampa, FL",
    propertyType: "Multifamily",
    units: 8,
    targetNetYield: 0.062,
    offeringSize: 1_240_000,
    fundedPct: 0.74,
    spvName: "The Monroe LLC",
    minInvestment: 50,
    firstDistributionDate: "2026-08-31",
    costBasis: 20_000,
    occupancy: 0.96,
    reservesMonths: 5,
    rentOnTime: true,
    operator: "Maria Alvarez, Property Manager",
    note:
      "A quiet, steady month. All eight units stayed occupied, rent came in on time, and the reserve " +
      "fund is fully topped up. Nothing here needs your attention.",
  },
  {
    name: "Cedar Row",
    location: "Austin, TX",
    propertyType: "Townhomes",
    units: 6,
    targetNetYield: 0.058,
    offeringSize: 980_000,
    fundedPct: 0.63,
    spvName: "Cedar Row LLC",
    minInvestment: 50,
    firstDistributionDate: "2026-09-15",
    costBasis: 16_000,
    occupancy: 0.92,
    reservesMonths: 4,
    rentOnTime: true,
    operator: "Devin Cole, Property Manager",
    note:
      "One townhome turned over mid-month and was re-leased within two weeks at a slightly higher rent. " +
      "Reserves are healthy and everything else held steady.",
  },
  {
    name: "Alder Court",
    location: "Charlotte, NC",
    propertyType: "Garden Apartments",
    units: 12,
    targetNetYield: 0.055,
    offeringSize: 1_520_000,
    fundedPct: 0.81,
    spvName: "Alder Court LLC",
    minInvestment: 50,
    firstDistributionDate: "2026-08-20",
    costBasis: 12_000,
    occupancy: 0.94,
    reservesMonths: 4,
    rentOnTime: true,
    operator: "Priya Nair, Property Manager",
    note:
      "Occupancy ticked up as two units leased ahead of schedule. A minor roof repair was covered by " +
      "the reserve fund, which remains in good shape.",
  },
];

// The last `n` monthly periods, oldest → newest. Each carries a representative `paidAt`. The current
// month (last entry) is dated 8 days ago by default so Home's fresh-distribution window (7 days) does
// NOT fire — the redesigned portfolio-value hero is the demo default. `fresh` dates it 1 day ago instead.
function historyMonths(nowMs: number, n: number, fresh: boolean): { period: string; paidAt: number }[] {
  const now = new Date(nowMs);
  const out: { period: string; paidAt: number }[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 15, 12, 0, 0));
    const period = dt.toISOString().slice(0, 7);
    const paidAt = k === 0 ? nowMs - (fresh ? 1 : 8) * DAY_MS : dt.getTime();
    out.push({ period, paidAt });
  }
  return out;
}

export const seedMaya = internalMutation({
  args: {
    privyId: v.optional(v.string()),
    fresh: v.optional(v.boolean()),
    unsafeConfirm: v.optional(v.literal("RESET_DEMO_PORTFOLIO")),
  },
  handler: async (ctx, args) => {
    requireSeedWrites("Demo portfolio seed");
    if (!args.privyId) {
      throw new Error("Pass { privyId } explicitly; single-user fallback is disabled");
    }
    if (args.unsafeConfirm !== "RESET_DEMO_PORTFOLIO") {
      throw new Error('Pass { unsafeConfirm: "RESET_DEMO_PORTFOLIO" } to reset demo rows');
    }

    const now = Date.now();

    // --- Resolve the target user (upsert by explicit privyId) ---
    let userId: Id<"users">;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", args.privyId!))
      .unique();
    if (existing) {
      userId = existing._id;
      if (existing.kycStatus !== "verified") await ctx.db.patch(userId, { kycStatus: "verified" });
    } else {
      userId = await ctx.db.insert("users", {
        privyId: args.privyId,
        kycStatus: "verified",
        createdAt: now,
      });
    }

    // --- Properties (idempotent by name) ---
    const allProps = await ctx.db.query("properties").collect();
    const propIdBySpec = new Map<string, Id<"properties">>();
    let propsCreated = 0;
    for (const spec of PROPERTIES) {
      const found = allProps.find((p) => p.name === spec.name);
      if (found) {
        propIdBySpec.set(spec.name, found._id);
        continue;
      }
      const id = await ctx.db.insert("properties", {
        name: spec.name,
        location: spec.location,
        propertyType: spec.propertyType,
        units: spec.units,
        targetNetYield: spec.targetNetYield,
        offeringSize: spec.offeringSize,
        fundedPct: spec.fundedPct,
        status: "open",
        spvName: spec.spvName,
        minInvestment: spec.minInvestment,
        firstDistributionDate: spec.firstDistributionDate,
      });
      await writeAudit(ctx, { actor: "seed", action: "property.seeded", target: id });
      propIdBySpec.set(spec.name, id);
      propsCreated += 1;
    }

    // --- Holdings (authoritative: patch to the demo spec if present, else insert) ---
    // A demo seed converges to a known state: if Maya already holds a property (e.g. a small real test
    // position in The Monroe), its cost basis is patched UP to the spec so the portfolio is exactly the
    // intended ~$48k and every per-home income figure stays consistent with its basis.
    const userHoldings = await ctx.db
      .query("holdings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const holdingByProperty = new Map(userHoldings.map((h) => [h.propertyId, h]));
    let holdingsCreated = 0;
    let holdingsPatched = 0;
    for (const spec of PROPERTIES) {
      const propertyId = propIdBySpec.get(spec.name)!;
      const fields = {
        tokenAmount: spec.costBasis, // 1 token ≈ $1 basis for the demo
        ownershipPct: spec.costBasis / spec.offeringSize,
        costBasis: spec.costBasis,
      };
      const existing = holdingByProperty.get(propertyId);
      if (existing) {
        if (
          existing.costBasis !== fields.costBasis ||
          existing.tokenAmount !== fields.tokenAmount ||
          existing.ownershipPct !== fields.ownershipPct
        ) {
          await ctx.db.patch(existing._id, fields);
          await writeAudit(ctx, {
            actor: "seed",
            action: "holding.seed_patched",
            target: propertyId,
            meta: { userId, costBasis: spec.costBasis },
          });
          holdingsPatched += 1;
        }
        continue;
      }
      await ctx.db.insert("holdings", { userId, propertyId, ...fields });
      await writeAudit(ctx, {
        actor: "seed",
        action: "holding.seeded",
        target: propertyId,
        meta: { userId, costBasis: spec.costBasis },
      });
      holdingsCreated += 1;
    }

    // --- Income history (idempotent per (user, property, period)) ---
    const months = historyMonths(now, MONTHS_OF_HISTORY, args.fresh ?? false);
    const existingIncome = await ctx.db
      .query("incomeLedger")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const incomeKeys = new Set(existingIncome.map((r) => `${r.propertyId}|${r.period}`));
    let incomeCreated = 0;
    for (const spec of PROPERTIES) {
      const propertyId = propIdBySpec.get(spec.name)!;
      const monthlyNet = Math.round((spec.costBasis * spec.targetNetYield) / 12);
      const waterfall = splitDistribution(monthlyNet);
      for (const m of months) {
        if (incomeKeys.has(`${propertyId}|${m.period}`)) continue;
        await ctx.db.insert("incomeLedger", {
          userId,
          propertyId,
          period: m.period,
          grossShare: waterfall.grossShare,
          costs: waterfall.costs,
          mgmtFee: waterfall.mgmtFee,
          reserve: waterfall.reserve,
          netPaid: waterfall.netPaid,
          status: "paid",
          paidAt: m.paidAt,
        });
        incomeCreated += 1;
      }
      await writeAudit(ctx, {
        actor: "seed",
        action: "income.seeded",
        target: propertyId,
        meta: { userId, months: months.length, monthlyNet },
      });
    }

    // --- Property updates (idempotent per (property, current period)) ---
    const currentPeriod = periodFor(now);
    let updatesCreated = 0;
    for (const spec of PROPERTIES) {
      const propertyId = propIdBySpec.get(spec.name)!;
      const rows = await ctx.db
        .query("propertyUpdates")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect();
      if (rows.some((r) => r.period === currentPeriod)) continue;
      await ctx.db.insert("propertyUpdates", {
        propertyId,
        period: currentPeriod,
        occupancy: spec.occupancy,
        reservesMonths: spec.reservesMonths,
        rentOnTime: spec.rentOnTime,
        note: spec.note,
        operator: spec.operator,
        publishedAt: now,
      });
      await writeAudit(ctx, {
        actor: "seed",
        action: "propertyUpdate.seeded",
        target: propertyId,
        meta: { period: currentPeriod },
      });
      updatesCreated += 1;
    }

    // --- Settled orders for the balance sparkline (authoritative: reset to a clean rising ramp) ---
    // buildBalanceSeries sums SETTLED orders' `amount` cumulatively. To make the sparkline rise smoothly
    // to exactly the portfolio value, reset the user's orders to N equal staggered buys that sum to the
    // total cost basis. Orders are the balance-history source only (holdings carry ownership), so
    // resetting them is safe. No dvpTxSig → no fabricated on-chain receipts (the proof view stays honest).
    const existingOrders = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const o of existingOrders) await ctx.db.delete(o._id);
    const anchorProperty = propIdBySpec.get(PROPERTIES[0].name)!;
    const totalBasis = PROPERTIES.reduce((sum, p) => sum + p.costBasis, 0);
    const perOrder = Math.round(totalBasis / months.length);
    let ordersCreated = 0;
    for (const m of months) {
      await ctx.db.insert("orders", {
        userId,
        propertyId: anchorProperty,
        amount: perOrder,
        platformFee: 0,
        status: "settled",
        createdAt: m.paidAt,
      });
      ordersCreated += 1;
    }

    return (
      `seedMaya → user ${userId}: ` +
      `properties +${propsCreated}, holdings +${holdingsCreated}/~${holdingsPatched}, income +${incomeCreated}, ` +
      `updates +${updatesCreated}, orders =${ordersCreated} (reset) ` +
      `(latest distribution ${args.fresh ? "fresh <7d — dusk hero" : "8d old — value hero"})`
    );
  },
});
