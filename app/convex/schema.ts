import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roleValidator } from "./roles";

// Core entities (E1.1 users + auditLog; E1.4 the rest). Shape is seed — owned by code from here.
// Data-ownership per architecture spine: on-chain owns token truth; Convex owns intent,
// eligibility, orders(pending), income ledger, diligence records, and the append-only audit log.

export default defineSchema({
  // --- E1.1: identity + audit (the backbone) ---
  users: defineTable({
    privyId: v.string(), // stable Privy identity key = JWT tokenIdentifier
    kycStatus: v.union(v.literal("none"), v.literal("pending"), v.literal("verified"), v.literal("failed")),
    walletAddress: v.optional(v.string()), // Privy embedded Solana wallet
    regAInvestedThisYear: v.optional(v.number()), // for Reg A+ cap (I5)
    regAAnnualLimit: v.optional(v.number()), // E3.2: computed Reg A+ per-investor cap (10% of greater of income/net worth)
    createdAt: v.number(),
  }).index("by_privyId", ["privyId"]).index("by_wallet", ["walletAddress"]), // by_wallet: E1.3 chain-event routing

  // --- Admin Story 1.1: staff identity, kept STRICTLY separate from consumer `users` ---
  // Staff sign in via WorkOS SSO and are keyed on `workosId` (the WorkOS token `sub`); consumers are
  // keyed on `privyId`. The scope wall (security.ts) enforces that these never cross-resolve. Staff
  // access is grant-only: a valid WorkOS JWT with no row here is NOT staff. Permissions are DERIVED
  // from `roles` on every request (roles.ts) — never stored — so a role edit takes effect at once.
  staff: defineTable({
    workosId: v.string(),
    email: v.string(),
    name: v.string(), // the named human — every admin action attributes to this, never to a system
    roles: v.array(roleValidator),
    status: v.union(v.literal("active"), v.literal("revoked")),
    createdAt: v.number(),
  }).index("by_workosId", ["workosId"]),

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
    mint: v.optional(v.string()), // E1.3: on-chain token address → routes chain events to this property
    firstDistributionDate: v.optional(v.string()), // E4.5: YYYY-MM-DD; optional so existing docs stay valid (no migration)
  }).index("by_status", ["status"]).index("by_mint", ["mint"]), // by_mint: E1.3 chain-event routing

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
  })
    .index("by_user", ["userId"])
    .index("by_property", ["propertyId"]) // by_property: E2.4 count holders per property without a scan
    .index("by_user_property", ["userId", "propertyId"]), // settle/reconcile fetch one holding by (user, property)

  eligibility: defineTable({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    eligible: v.boolean(),
    jurisdiction: v.string(),
    tokenAclState: v.union(v.literal("frozen"), v.literal("thawed")),
    personaInquiryId: v.optional(v.string()), // E3.2: ref to the (stubbed) Persona KYC inquiry that produced this result
  }).index("by_user_property", ["userId", "propertyId"]),

  // E3.2: restricted-jurisdiction waitlist — never a dead-end. One row per (user, property);
  // idempotent join via by_user_property. Fed only by joinWaitlist (audited).
  waitlist: defineTable({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    jurisdiction: v.string(),
    createdAt: v.number(),
  }).index("by_user_property", ["userId", "propertyId"]),

  // E3.3: append-only funding ledger (fiat→USDC on-ramp deposits). Balance is DERIVED from the
  // sum of `status:"settled"` rows (never a denormalized field). Account-level (per-user, not
  // per-property) → `by_user`. Additive only — no destructive migration of existing rows.
  fundings: defineTable({
    userId: v.id("users"),
    amountUsd: v.number(), // whole-dollar deposit amount (1:1 USDC behind the scenes)
    method: v.union(v.literal("card"), v.literal("ach")),
    status: v.union(v.literal("pending"), v.literal("settled"), v.literal("failed")),
    providerRef: v.optional(v.string()), // ref to the (stubbed) on-ramp/settlement provider
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

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
    paidAt: v.optional(v.number()), // E5.1: epoch ms a distribution row was observed paid — gives "fresh" a recency signal. Optional → no migration; pre-existing rows degrade to not-fresh.
    status: v.union(v.literal("scheduled"), v.literal("paid"), v.literal("missed")),
  }).index("by_user", ["userId"]).index("by_property_period", ["propertyId", "period"]),

  // --- E1.3: on-chain reconciliation (chain-wins mirror sync) ---
  // Append-only record of every processed on-chain event. `by_signature` is the idempotency key
  // (a tx signature is applied at most once) and the store for any Convex↔chain discrepancy.
  reconciliations: defineTable({
    signature: v.string(), // on-chain tx signature — unique per processed event
    eventType: v.string(), // "mint" | "transfer" | "distribution"
    mint: v.optional(v.string()),
    slot: v.optional(v.number()),
    status: v.union(v.literal("applied"), v.literal("unresolved")),
    discrepancy: v.optional(v.any()), // {before, after} when chain overwrote a divergent Convex value
    raw: v.optional(v.any()), // the normalized/enriched source event, for audit
    processedAt: v.number(),
  }).index("by_signature", ["signature"]),

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
