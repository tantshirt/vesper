import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";

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
    const existing = await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    if (existing.some((p) => p.name === "The Monroe")) return "already seeded";

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
