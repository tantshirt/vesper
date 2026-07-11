import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { isLikelySolanaSignature, requireSeedWrites } from "./security";

// E2.2 read path — a property plus its diligence gates (public; no auth).
export const getWithGates = query({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    const property = await ctx.db.get(id);
    if (!property) return null;
    const gates = await ctx.db
      .query("diligenceGates")
      .withIndex("by_property", (q) => q.eq("propertyId", id))
      .collect();
    gates.sort((a, b) => a.gateNo - b.gateNo);
    return { property, gates };
  },
});

// E2.4 — the demo Token-2022 mint for The Monroe. A disclosed base58 PLACEHOLDER (part of the
// same fixture layer as the fictional property), NOT a live-deployed asset. base58 excludes
// 0/O/I/l. The frontend renders `mint` only when present; holder/receipt data stays honest-empty
// until real settlement flows through the reconcile harness — so nothing here is fabricated.
export const DEMO_MONROE_MINT = "6MonRoeSeedM1ntDemo11111111111111111111111";

// E4.5 — generic first-distribution date for the seeded Monroe (YYYY-MM-DD, parsed UTC by the
// confirmation view). A placeholder offering date, NOT a compliance-mandated payout policy. Editing
// this constant sets the date on a FRESH seed and backfills a Monroe that has none — but the backfill
// below is fill-only (never overwrites), so correcting an already-seeded date needs a manual patch, not
// just a reseed.
export const MONROE_FIRST_DISTRIBUTION_DATE = "2026-08-31";

// E2.4 on-chain proof read path (public; no auth). Returns ONLY real chain-mirrored facts:
// the property mint, live holder count, and settled-order DvP receipts. `null` when missing.
export const getOnChainProof = query({
  args: { id: v.id("properties") },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      mint: v.optional(v.string()),
      spvName: v.string(),
      status: v.union(
        v.literal("gating"),
        v.literal("open"),
        v.literal("funded"),
        v.literal("closed"),
      ),
      holderCount: v.number(),
      receipts: v.array(v.object({ dvpTxSig: v.string() })),
    }),
  ),
  handler: async (ctx, { id }) => {
    const property = await ctx.db.get(id);
    if (!property) return null;

    const holdings = await ctx.db
      .query("holdings")
      .withIndex("by_property", (q) => q.eq("propertyId", id))
      .collect();

    // Count distinct on-chain owners (a user may hold multiple rows / a zeroed-out
    // position), not holding rows — the label says "owners" and this is a chain fact.
    const holderCount = new Set(
      holdings.filter((h) => h.tokenAmount > 0).map((h) => h.userId),
    ).size;

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_property", (q) => q.eq("propertyId", id))
      .collect();

    // Honest receipts only: settled DvP orders that carry a real on-chain signature,
    // deduped by signature (a batched DvP settlement can back multiple orders in one tx).
    const seen = new Set<string>();
    const receipts: Array<{ dvpTxSig: string }> = [];
    for (const o of orders) {
      if (
        o.status === "settled" &&
        o.dvpTxSig &&
        isLikelySolanaSignature(o.dvpTxSig) &&
        !seen.has(o.dvpTxSig)
      ) {
        seen.add(o.dvpTxSig);
        receipts.push({ dvpTxSig: o.dvpTxSig });
      }
    }

    return {
      name: property.name,
      mint: property.mint,
      spvName: property.spvName,
      status: property.status,
      holderCount,
      receipts,
    };
  },
});

// E2.1 read path (public — no auth required to browse).
export const listOpen = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
  },
});

// E1.4 seed — The Monroe with 8 signed diligence gates, matching the design prototypes.
// Run: `npm run seed` (convex run properties:seedTheMonroe).
export const seedTheMonroe = mutation({
  args: {},
  handler: async (ctx) => {
    requireSeedWrites("Property seed");

    const existing = await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    const monroe = existing.find((p) => p.name === "The Monroe");
    if (monroe) {
      // Idempotent backfill: patch any missing fields onto an already-seeded Monroe so a running
      // deployment gets them without a full reseed. Mirrors the mint backfill for E4.5's date.
      const patch: { mint?: string; firstDistributionDate?: string } = {};
      if (!monroe.mint) patch.mint = DEMO_MONROE_MINT;
      if (!monroe.firstDistributionDate) patch.firstDistributionDate = MONROE_FIRST_DISTRIBUTION_DATE;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(monroe._id, patch);
        return "backfilled " + Object.keys(patch).join(", ");
      }
      return "already seeded";
    }

    const propertyId = await ctx.db.insert("properties", {
      name: "The Monroe",
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: 0.062,
      offeringSize: 1_240_000, // NOTE: B2 open decision — basis for ownership %
      fundedPct: 0.74,
      status: "open",
      spvName: "The Monroe LLC",
      minInvestment: 50,
      mint: DEMO_MONROE_MINT, // E2.4 disclosed demo Token-2022 mint (fixture, not a live asset)
      firstDistributionDate: MONROE_FIRST_DISTRIBUTION_DATE, // E4.5 generic offering date for the confirmation
    });

    const gates: Array<[number, string, string]> = [
      [0, "Sponsor vetting (KYB & UBO)", "A. Okafor"],
      [1, "Property existence & ownership", "R. Mendes"],
      [2, "Independent valuation & condition", "J. Park"],
      [3, "Legal, tax & regulatory", "R. Mendes"],
      [4, "Financial integrity", "D. Ruiz"],
      [5, "On-chain binding", "A. Okafor"],
      [6, "Multi-party approval", "D. Ruiz"],
      [7, "Continuous monitoring", "A. Okafor"],
    ];
    for (const [gateNo, label, human] of gates) {
      await ctx.db.insert("diligenceGates", {
        propertyId,
        gateNo,
        label,
        status: "passed",
        signedByHuman: human, // spine I4 — never an AI
        signedAt: Date.now(),
      });
    }

    await writeAudit(ctx, { actor: "seed", action: "property.seeded", target: propertyId });
    return propertyId;
  },
});
