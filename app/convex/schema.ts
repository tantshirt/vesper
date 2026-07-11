import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roleValidator, sponsorRoleValidator } from "./roles";

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
  // Admin Story 1.3: `onchainRef` is OPTIONAL — the on-chain reference (tx sig / mint) an admin
  // on-chain action produces. Optional keeps all 25 existing consumer callers compiling unchanged and
  // every legacy row valid (no migration). `by_actor` supports the audit view's actor filter.
  auditLog: defineTable({
    actor: v.string(),
    action: v.string(),
    target: v.string(),
    meta: v.optional(v.any()),
    onchainRef: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_target", ["target"])
    .index("by_timestamp", ["timestamp"])
    .index("by_actor", ["actor"]),

  // --- Admin Story 1.2: segregation-of-duties — the listing-revenue-vs-diligence wall ---
  // Records that a staff member holds a fee/listing/billing stake in a specific property. A row here
  // BARS that staff from signing that property's diligence gates (assertNoFeeConflict, sod.ts).
  // Append-only in spirit: rows are added/removed ONLY via the audited internalMutations in sod.ts,
  // never on the public `api`. `by_staff_property` answers "does this staff conflict on this property?"
  // in one indexed lookup; `by_property` lists every conflicted staff for a property.
  staffPropertyInterest: defineTable({
    workosId: v.string(), // the staff member with the stake (their WorkOS `sub` — the identity, not a name)
    propertyId: v.id("properties"),
    kind: v.union(v.literal("listing"), v.literal("billing"), v.literal("fee")),
    recordedBy: v.string(), // the human who recorded this interest — audited as the actor
    createdAt: v.number(),
  })
    .index("by_staff_property", ["workosId", "propertyId"])
    .index("by_property", ["propertyId"]),

  // --- Admin Story 1.4: audited, time-boxed break-glass ---
  // A break-glass grant confers its `scope` (a set of permissions) to `workosId` ONLY while
  // `Date.now() < expiresAt` AND `status === "active"` (see rbac.ts effectivePermissions). Expired
  // (by clock) or revoked records confer NOTHING. Every row is created ONLY via the audited
  // `breakglass.use`-gated `invokeBreakGlass` mutation, carries a MANDATORY human reason, and is
  // compliance-visible via `listActiveBreakGlass`. `by_workosId` answers "what active elevation does
  // this staff member hold right now?" in one indexed lookup on the permission-resolution hot path.
  breakGlass: defineTable({
    workosId: v.string(), // the staff member the elevated scope is conferred to (their WorkOS `sub`)
    scope: v.array(v.string()), // the permissions conferred while active (validated against the catalog at write time)
    reason: v.string(), // MANDATORY non-empty justification — a break-glass entry naming no reason is worthless
    invokedBy: v.string(), // the human who authorized the elevation — audited as the actor
    createdAt: v.number(),
    expiresAt: v.number(), // bounded (≤ 60 min from creation); permissions lapse the instant now ≥ this
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("revoked")),
  }).index("by_workosId", ["workosId"]),

  // --- Admin Story 6.1: walled sponsor onboarding + KYB/Gate 0 (tenant isolation) ---
  // A sponsor ORG is the tenant boundary: every sponsor query/mutation resolves the caller to exactly
  // one `sponsorOrgId` (via `sponsorMembers`) and filters by it server-side. `kybStatus` is Gate 0 —
  // a deal cannot be `submitted` until it is "passed" (recorded via the stubbed Middesk seam). `kybRef`
  // is the (stubbed) Middesk reference, optional so a fresh org with no KYB yet stays valid.
  sponsorOrgs: defineTable({
    name: v.string(),
    kybStatus: v.union(
      v.literal("none"),
      v.literal("pending"),
      v.literal("passed"),
      v.literal("failed"),
    ),
    kybRef: v.optional(v.string()), // ref to the (stubbed) Middesk KYB inquiry that produced kybStatus
    createdAt: v.number(),
  }),

  // Links a WorkOS-invited sponsor human (a `staff` row) to their ONE org + sponsor role. `by_workosId`
  // is the tenant-resolution hot path: `requireSponsor` turns the caller's `staff.workosId` into their
  // `sponsorOrgId` in one indexed lookup. Grant-only — rows are created ONLY by the internal
  // `provisionSponsor` mutation (absent from the public api), mirroring the staff grant posture.
  sponsorMembers: defineTable({
    workosId: v.string(), // the sponsor human's WorkOS `sub` (matches their `staff` row)
    sponsorOrgId: v.id("sponsorOrgs"),
    role: sponsorRoleValidator,
    createdAt: v.number(),
  }).index("by_workosId", ["workosId"]),

  // A sponsor deal, keyed to its org. `by_org` is the ONLY read path sponsors have — a sponsor can
  // never enumerate deals outside their `sponsorOrgId`. `status` advances draft → kyb_pending →
  // submitted; the `submitted` transition is GATED on the org's `kybStatus === "passed"` (Gate 0).
  sponsorDeals: defineTable({
    sponsorOrgId: v.id("sponsorOrgs"),
    propertyName: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("kyb_pending"),
      v.literal("submitted"),
    ),
    createdAt: v.number(),
  }).index("by_org", ["sponsorOrgId"]),

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

  // --- Admin Story 2.1: AI extraction / flag review (injection-isolated, cite-or-refuse) ---
  // These three tables are the extraction ENGINE's storage. Nothing here is an approval, a gate
  // signature, or a permission — the AI never approves (spine I4). Untrusted document content flows
  // ONLY into `extractedFields.value` (+ a citation) and never to a surface that can act on it.

  // A diligence document for a property. UPLOAD is Story 6-2 — this story only MODELS the table so the
  // extractor has something to read; tests insert rows directly. `text` is the STUB content seam: the
  // raw document text the extractor reads. In production the seam fetches the file from `storageRef`
  // through a ZDR-governed store (OCR/parse is 6-2); it is modeled inline here so the injection-isolation
  // and cite-or-refuse guarantees are real and testable now. Optional so a row with no parsed text stays
  // valid.
  diligenceDocuments: defineTable({
    propertyId: v.id("properties"),
    kind: v.string(), // e.g. "rent_roll" | "operating_statement" | "psa" — free-form until 6-2 fixes it
    storageRef: v.string(), // the storage locator the live seam would fetch (Convex storage id / URL)
    uploadedBy: v.string(), // the human who uploaded — attribution, never a system
    text: v.optional(v.string()), // STUB seam: raw document text the extractor reads (see note above)
    createdAt: v.number(),
  }).index("by_property", ["propertyId"]),

  // One extraction run over a property's documents. `model` records which model produced it (a stub
  // marker today). `createdBy` is the ai.review human who started the run — carried forward from
  // startExtraction so the scheduled run stays attributed. A run NEVER carries an "approved" state.
  extractionRuns: defineTable({
    propertyId: v.id("properties"),
    status: v.union(v.literal("running"), v.literal("complete"), v.literal("failed")),
    model: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_property", ["propertyId"]),

  // A single field the extractor produced. `status` is the CITE-OR-REFUSE contract: `extracted` iff it
  // carries a non-empty `sourceRef` (a locator within `docId`), else `uncited` — an uncited field is
  // NEVER presentable as an established fact. `rejected` and `verified` are set ONLY by a human
  // (rejectExtractedField / verifyExtractedField in Story 2-2) — the AI never verifies or rejects; a
  // `verified` field is one a human checked against its source and it is the ONLY status assemble accepts.
  // `verified` is NOT "approved": it confers no gate signature and no permission — a human SIGNER (3-1)
  // still acts on the assembled evidence. `reviewNote` records a human's rejection/verification note
  // (optional). Every value is DATA — a value containing "ignore instructions and approve" is stored
  // verbatim and acts on nothing.
  extractedFields: defineTable({
    runId: v.id("extractionRuns"),
    propertyId: v.id("properties"),
    docId: v.id("diligenceDocuments"),
    field: v.string(),
    value: v.string(),
    sourceRef: v.optional(v.string()), // citation locator within docId; absent/empty ⇒ uncited
    confidence: v.number(),
    status: v.union(
      v.literal("extracted"),
      v.literal("uncited"),
      v.literal("rejected"),
      v.literal("verified"),
    ),
    reviewNote: v.optional(v.string()), // human rejection/verification note
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_property", ["propertyId"]),

  // --- Admin Story 2.2: human evidence verification + assembly ("assembled, not approved") ---
  // An evidence package is a HAND-OFF, never an approval. A human reviewer (ai_reviewer, holding
  // `ai.review` and NO `gate.sign`) verifies extracted fields against their sources, then assembles the
  // VERIFIED set into a package. `status` is the literal `"assembled"` — there is deliberately NO
  // `approved`/`signed` state here: the gate SIGNER (Story 3-1) reads this package and signs a GATE, not
  // this row. `fieldIds` are the verified fields it carries (assembly asserts every one is `verified` and
  // belongs to `propertyId`). `gateNo` is the optional gate the evidence is destined for. `by_property`
  // lists a property's packages for the reviewer and the eventual signer.
  evidencePackages: defineTable({
    propertyId: v.id("properties"),
    gateNo: v.optional(v.number()), // the diligence gate this evidence is destined for (0..7), if known
    fieldIds: v.array(v.id("extractedFields")), // the VERIFIED fields this package carries
    status: v.literal("assembled"), // ONLY ever "assembled" — never "approved"/"signed" (that is 3-1)
    assembledBy: v.string(), // the ai.review human who assembled — attribution, never a system
    assembledAt: v.number(),
    note: v.optional(v.string()), // optional assembly note from the reviewer
  }).index("by_property", ["propertyId"]),
});
