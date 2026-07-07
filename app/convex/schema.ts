import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Core entities (E1.1 users + auditLog; E1.4 the rest). Shape is seed — owned by code from here.
// Data-ownership per architecture spine: on-chain owns token truth; Convex owns intent,
// eligibility, orders(pending), income ledger, diligence records, and the append-only audit log.

export default defineSchema({
  // --- E1.1: identity + audit (the backbone) ---
  users: defineTable({
    privyId: v.string(), // did:privy:... = JWT `sub`
    kycStatus: v.union(v.literal("none"), v.literal("pending"), v.literal("verified"), v.literal("failed")),
    walletAddress: v.optional(v.string()), // Privy embedded Solana wallet
    regAInvestedThisYear: v.optional(v.number()), // for Reg A+ cap (I5)
    createdAt: v.number(),
  }).index("by_privyId", ["privyId"]),

  // Append-only. Every money/ownership/eligibility/diligence mutation writes here (FR16 / spine I3).
  auditLog: defineTable({
    actor: v.string(),
    action: v.string(),
    target: v.string(),
    meta: v.optional(v.any()),
    timestamp: v.number(),
  }).index("by_target", ["target"]).index("by_timestamp", ["timestamp"]),

  // --- E1.4: the rest of the core (seed shape; refined by their owning stories) ---
  properties: defineTable({
    name: v.string(),
    location: v.string(),
    propertyType: v.string(),
    units: v.number(),
    targetNetYield: v.number(), // e.g. 0.062
    offeringSize: v.number(), // USD basis for ownership % (B2 open decision)
    fundedPct: v.number(),
    status: v.union(v.literal("open"), v.literal("funded"), v.literal("closed")),
    spvName: v.string(),
    minInvestment: v.number(),
  }).index("by_status", ["status"]),

  diligenceGates: defineTable({
    propertyId: v.id("properties"),
    gateNo: v.number(), // 0..7
    label: v.string(),
    status: v.union(v.literal("pending"), v.literal("passed"), v.literal("failed")),
    signedByHuman: v.optional(v.string()), // NEVER an AI (spine I4)
    signedAt: v.optional(v.number()),
    evidenceRef: v.optional(v.string()),
  }).index("by_property", ["propertyId"]),

  orders: defineTable({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    amount: v.number(),
    platformFee: v.number(),
    status: v.union(v.literal("pending"), v.literal("settled"), v.literal("failed")),
    dvpTxSig: v.optional(v.string()), // Convex never self-settles; set only on on-chain DvP confirm (I2)
    createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_property", ["propertyId"]),

  holdings: defineTable({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    tokenAmount: v.number(),
    ownershipPct: v.number(),
    costBasis: v.number(),
  }).index("by_user", ["userId"]),

  eligibility: defineTable({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    eligible: v.boolean(),
    jurisdiction: v.string(),
    tokenAclState: v.union(v.literal("frozen"), v.literal("thawed")),
  }).index("by_user_property", ["userId", "propertyId"]),

  incomeLedger: defineTable({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    period: v.string(), // "2026-07"
    grossShare: v.number(),
    costs: v.number(),
    mgmtFee: v.number(),
    reserve: v.number(),
    netPaid: v.number(),
    txSig: v.optional(v.string()),
    status: v.union(v.literal("scheduled"), v.literal("paid"), v.literal("missed")),
  }).index("by_user", ["userId"]).index("by_property_period", ["propertyId", "period"]),

  propertyUpdates: defineTable({
    propertyId: v.id("properties"),
    period: v.string(),
    occupancy: v.number(),
    reservesMonths: v.number(),
    rentOnTime: v.boolean(),
    note: v.string(),
    operator: v.string(),
    publishedAt: v.number(),
  }).index("by_property", ["propertyId"]),
});
