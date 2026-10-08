import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { availableBalance } from "./funding";
import {
  findUserByIdentity,
  identityKey,
  isLikelySolanaSignature,
  unsafeStubsEnabled,
} from "./security";
import type { Doc, Id } from "./_generated/dataModel";
import { regulatoryYear } from "./eligibility";

// Story 4.4 — Atomic Delivery-versus-Payment (DvP) settlement.
//
// This module is the settlement atomicity boundary (FR10 / spine I2). A Convex mutation is already
// all-or-nothing, so the settled order (the debit that reduces spendable balance) and the token
// delivery (the holding) commit together or not at all. The `settled` status is authorized SOLELY by
// the `dvpSettle` seam's confirmation — "Convex never self-settles". `dvpSettle` is a synchronous
// STUB standing in for the deferred Quasar DvP program / on-chain reconcile (blocker B1); the real
// program swaps in behind this seam with no change to the settle-authorization structure.
//
// Failures are COMMITTED, not thrown (the audit-survival rule): a thrown Convex mutation rolls back
// its own writeAudit, but the AC mandates a durable audit on every business failure. So each business
// gate (ineligible/ACL-frozen, over Reg A+ cap, insufficient balance, DvP non-confirm) patches the
// order to `failed`, writes `order.failed`, and returns `{status:"failed", reason}` — all committed,
// nothing charged. Only true client/auth/arg bugs (UI-prevented) throw. The caller is always resolved
// server-side from the JWT (getUserIdentity() → by_privyId); client-supplied identity is never trusted.
//
// Consumer-facing copy stays crypto-vocabulary-clean; the on-chain DvP receipt (`dvpTxSig`) lives only
// in the pull-only proof view, never in settlement copy.

// --- Pure helpers (exported for unit tests; no ctx/db access) ---------------------------------

// The one-time platform fee rate (FR8) — the ONLY charge on top of the investment. Kept identical to
// order.helpers.PLATFORM_FEE_RATE so the server-authoritative charge equals the previewed charge.
export const PLATFORM_FEE_RATE = 0.009;

// Sanity cap guarding the purchase amount against overflow/absurd input (mirrors funding's MAX_FUNDING).
export const MAX_PURCHASE = 1_000_000;

// The number of distinct risk acknowledgements active consent requires (FR9 / RIGHTS_ACKS.length).
// Kept as a constant here (the settlement gate) mirroring the UI's REQUIRED_ACK_COUNT.
export const REQUIRED_RISK_ACK_COUNT = 3;
export const REQUIRED_RISK_ACK_IDS = ["illiquidity", "loss", "not-insured"] as const;
export const PURCHASE_OPERATION_TTL_MS = 10 * 60 * 1000;
export const PURCHASE_AUTHORIZATION_CLAIM_TTL_MS = 30 * 1000;
export const PAYMENT_DECIMALS = 6;
export const PAYMENT_BASE_UNITS_PER_USD = 1_000_000n;
export const TEACH_BACK_OWNERSHIP = "spv-ownership";
export const TEACH_BACK_LIQUIDITY = "buyer-dependent-resale";

const ACTIVE_OPERATION_STATES = new Set([
  "prepared",
  "awaiting_authorization",
  "submitted",
  "confirmed_on_chain",
  "reconciling",
  "outcome_unknown",
]);

export function deriveWholeTokenPurchaseQuote(
  amountUsd: number,
  pricePerTokenBaseUnits: bigint,
  availableTokens: bigint,
) {
  if (!Number.isSafeInteger(amountUsd) || amountUsd <= 0 || pricePerTokenBaseUnits <= 0n) {
    throw new Error("Invalid purchase quote request");
  }
  const requestedPrincipal = BigInt(amountUsd) * PAYMENT_BASE_UNITS_PER_USD;
  if (requestedPrincipal % pricePerTokenBaseUnits !== 0n) {
    const priceUsd = Number(pricePerTokenBaseUnits) / Number(PAYMENT_BASE_UNITS_PER_USD);
    throw new Error(`Investment amount must be a whole-token multiple of $${priceUsd.toFixed(2)}`);
  }
  const tokenAmount = requestedPrincipal / pricePerTokenBaseUnits;
  if (tokenAmount <= 0n || tokenAmount > availableTokens) throw new Error("Offering inventory unavailable");
  const feeCents =
    (requestedPrincipal * 90n + 50_000_000n) / 100_000_000n;
  const platformFeeUsdcAmount = feeCents * 10_000n;
  return {
    tokenAmount,
    quote: {
      principalUsdcAmount: requestedPrincipal,
      platformFeeUsdcAmount,
      totalUsdcAmount: requestedPrincipal + platformFeeUsdcAmount,
    },
  };
}


// Coerce any input to a finite number, else 0 — the shared finite guard. `+ 0` normalizes `-0` → `+0`.
function finite(n: number): number {
  return Number.isFinite(n) ? n + 0 : 0;
}

// Round to whole cents. Built the SAME way as order.helpers so the previewed and charged figures
// reconcile to the penny (half-up for positives).
function roundCents(n: number): number {
  return Math.round(finite(n) * 100) / 100;
}

// The one-time platform fee = round(max(0, amount) × 0.9%) to cents. Finite-guarded and
// negative-clamped. MUST produce values identical to order.helpers.platformFee (parity-tested).
export function platformFeeCents(amount: number): number {
  return finite(roundCents(Math.max(0, finite(amount)) * PLATFORM_FEE_RATE));
}

// Total charged today = round(max(0, amount)) to cents + the (cents-rounded) platform fee. MUST equal
// order.helpers.totalChargedToday (parity-tested) — the server is authoritative for this charge.
export function totalChargedCents(amount: number): number {
  return finite(roundCents(Math.max(0, finite(amount))) + platformFeeCents(amount));
}

// The total of all SETTLED orders (each order's amount + its platform fee) — the account's cumulative
// debit. Pending/failed orders never count (a failed order carries no charge; balance nets only
// settled orders). This is the "nothing charged on failure" invariant expressed as summation.
export function settledOrdersTotal(
  orders: Pick<Doc<"orders">, "amount" | "platformFee" | "status">[],
): number {
  return orders
    .filter((o) => o.status === "settled" || o.status === "complete")
    .reduce((sum, o) => sum + finite(o.amount) + finite(o.platformFee), 0);
}

// Spendable balance (dollars) = settled deposits − settled-order totals. This is the server's
// authoritative "funds available to charge" figure; a purchase requires total <= this. Balance stays
// fully derived (no balance/escrow table) — a settled order IS the debit.
export function spendableBalance(
  fundings: Pick<Doc<"fundings">, "amountUsd" | "status">[],
  orders: Pick<Doc<"orders">, "amount" | "platformFee" | "status">[],
): number {
  return availableBalance(fundings) - settledOrdersTotal(orders);
}

// Ownership basis = amount / offeringSize, clamped to [0, 1]. Mirrors calculator.ownershipFraction
// (B2 / DW-2 basis) so the settled ownership % matches the projection the investor saw. 0 when
// offeringSize is non-positive/non-finite (no basis → no fabricated fraction).
export function ownershipBasis(amount: number, offeringSize: number): number {
  const a = finite(amount);
  const size = finite(offeringSize);
  if (size <= 0) return 0;
  return finite(Math.max(0, Math.min(1, a / size)));
}

// Purchase amount rule: finite, at or above the property minimum, at or below the sanity cap. A
// malformed amount is a UI-prevented client bug → the mutation throws (not a settlement attempt).
export function isValidPurchaseAmount(amount: number, minInvestment: number): boolean {
  return (
    Number.isFinite(amount) &&
    Number.isFinite(minInvestment) &&
    amount >= minInvestment &&
    amount <= MAX_PURCHASE
  );
}

// Count the DISTINCT acknowledgement ids in a consent submission — duplicates never inflate the
// count, so a crafted `["x","x","x"]` cannot satisfy the three-distinct-ack gate.
export function distinctAckCount(acknowledgedRiskIds: readonly string[]): number {
  return new Set(acknowledgedRiskIds).size;
}

export function hasRequiredRiskAcks(acknowledgedRiskIds: readonly string[]): boolean {
  const submitted = new Set(acknowledgedRiskIds);
  return REQUIRED_RISK_ACK_IDS.every((id) => submitted.has(id));
}

export function settledPropertyAmount(
  orders: Pick<Doc<"orders">, "amount" | "status">[],
): number {
  return orders
    .filter((o) => o.status === "settled" || o.status === "complete")
    .reduce((sum, o) => sum + finite(o.amount), 0);
}

// The reasons a settlement can fail. Consent folds into `ineligible`: without active consent the
// caller is not cleared to receive the token.
export type SettlementReason =
  | "offering-unavailable"
  | "ineligible"
  | "reg-a-cap"
  | "insufficient-funds"
  | "dvp-failed";

export type SettlementResult = { ok: true } | { ok: false; reason: SettlementReason };

// The business gates that must ALL pass BEFORE the DvP seam is ever invoked. Order matches the I/O
// matrix — the first failing gate wins:
//   1. eligible+thawed AND all three risks acknowledged  → else `ineligible` (Token-ACL / consent block)
//   2. within the Reg A+ per-investor cap (limit must be set) → else `reg-a-cap`
//   3. total <= spendable balance                         → else `insufficient-funds`
// Keeping these separate from the DvP check is what lets the mutation gate FIRST and only THEN call
// the seam — so the real Quasar DvP program swaps in behind `dvpSettle` with no risk of settling for
// an ineligible/over-cap/underfunded caller ("Convex never self-settles", enforced structurally).
export function businessGateDecision(input: {
  propertyStatus?: "gating" | "open" | "funded" | "closed";
  offeringSize?: number;
  offeringSettledAmount?: number;
  eligible: boolean;
  tokenAclState: "frozen" | "thawed" | null | undefined;
  acknowledgedRiskCount: number;
  hasRequiredRiskAcks?: boolean;
  regAAnnualLimit: number | null | undefined;
  regAInvestedThisYear: number | null | undefined;
  amount: number;
  total: number;
  spendable: number;
}): SettlementResult {
  const status = input.propertyStatus ?? "open";
  const offeringSize = input.offeringSize;
  const offeringSettledAmount = finite(input.offeringSettledAmount ?? 0);
  if (
    status !== "open" ||
    (typeof offeringSize === "number" &&
      Number.isFinite(offeringSize) &&
      offeringSettledAmount + input.amount > offeringSize)
  ) {
    return { ok: false, reason: "offering-unavailable" };
  }

  // 1. Eligibility + active consent. An ineligible/frozen account gets no token; likewise a request
  //    that arrives without all three acknowledgements (UI-gated, but enforced server-side too).
  if (
    input.eligible !== true ||
    input.tokenAclState !== "thawed" ||
    input.acknowledgedRiskCount < REQUIRED_RISK_ACK_COUNT ||
    input.hasRequiredRiskAcks === false
  ) {
    return { ok: false, reason: "ineligible" };
  }

  // 2. Reg A+ per-investor cap: cumulative invested + this amount must stay within the limit. An
  //    unset/non-finite limit blocks (no cap → no purchase), matching the matrix.
  const limit = input.regAAnnualLimit;
  const invested =
    typeof input.regAInvestedThisYear === "number" && Number.isFinite(input.regAInvestedThisYear)
      ? input.regAInvestedThisYear
      : 0;
  if (typeof limit !== "number" || !Number.isFinite(limit) || invested + input.amount > limit) {
    return { ok: false, reason: "reg-a-cap" };
  }

  // 3. Spendable balance must cover the full charge (amount + fee).
  if (input.total > input.spendable) {
    return { ok: false, reason: "insufficient-funds" };
  }

  return { ok: true };
}

// The full pure settlement decision (business gates + the DvP confirmation, checked LAST). Retained
// as the single source of truth for the I/O matrix in tests; the mutation runs `businessGateDecision`
// first and only invokes the DvP seam once it passes, then applies the DvP result. DvP never surfaces
// unless every business gate already passed.
export function settlementDecision(input: {
  propertyStatus?: "gating" | "open" | "funded" | "closed";
  offeringSize?: number;
  offeringSettledAmount?: number;
  eligible: boolean;
  tokenAclState: "frozen" | "thawed" | null | undefined;
  acknowledgedRiskCount: number;
  hasRequiredRiskAcks?: boolean;
  regAAnnualLimit: number | null | undefined;
  regAInvestedThisYear: number | null | undefined;
  amount: number;
  total: number;
  spendable: number;
  dvpConfirmed: boolean;
}): SettlementResult {
  const gate = businessGateDecision(input);
  if (!gate.ok) return gate;
  // 4. The DvP seam must confirm — the sole authority for a `settled` write.
  if (!input.dvpConfirmed) return { ok: false, reason: "dvp-failed" };
  return { ok: true };
}

// The DvP seam (B1 / on-chain stand-in). In the stub it confirms synchronously and returns a clearly
// marked stub signature; when B1 lands this becomes the real Quasar DvP call (or the Helius reconcile
// path flips pending → settled from chain truth) with NO change to the settle-authorization structure.
// The order is inserted `pending` first, so the async-confirm future needs no structural change.
export function dvpSettle(orderId: Id<"orders">): { confirmed: boolean; dvpTxSig: string } {
  if (!unsafeStubsEnabled()) {
    return { confirmed: false, dvpTxSig: "" };
  }
  return { confirmed: true, dvpTxSig: `STUB-DVP-${orderId}` };
}

// --- Durable production purchase operations ---------------------------------------------------

function isActiveOperation(status: Doc<"orders">["status"]): boolean {
  return ACTIVE_OPERATION_STATES.has(status);
}

export type PublicPurchaseOperation = {
  operationId: Id<"orders">;
  propertyId: Id<"properties">;
  status: Doc<"orders">["status"];
  amountUsd: number;
  platformFeeUsd: number;
  principalBaseUnits?: string;
  platformFeeBaseUnits?: string;
  totalBaseUnits?: string;
  tokenAmountRaw?: string;
  paymentDecimals?: number;
  signature?: string;
  expiresAt?: number;
  failureCode?: string;
  lastCheckpoint?: string;
  createdAt: number;
  updatedAt?: number;
};

type PurchaseChain = "solana:devnet" | "solana:testnet" | "solana:mainnet";

function buildIntent(order: Doc<"orders">) {
  if (
    !order.walletAddress ||
    !order.propertyMint ||
    !order.tokenAmountRaw ||
    !order.principalBaseUnits ||
    !order.platformFeeBaseUnits ||
    !order.totalBaseUnits ||
    !order.expiresAt
  ) {
    throw new Error("Purchase operation is incomplete");
  }
  return {
    operationId: order._id,
    walletAddress: order.walletAddress,
    propertyMint: order.propertyMint,
    tokenAmountRaw: order.tokenAmountRaw,
    principalBaseUnits: order.principalBaseUnits,
    platformFeeBaseUnits: order.platformFeeBaseUnits,
    totalBaseUnits: order.totalBaseUnits,
    expiresAt: order.expiresAt,
  };
}

function investedForYear(user: Doc<"users">, year: number): number {
  const bucket = user.regAInvestedByYear?.find((entry) => entry.year === year);
  if (bucket) return bucket.amount;
  return user.regARegulatoryYear === year ? (user.regAInvestedThisYear ?? 0) : 0;
}

function incrementInvestmentYear(user: Doc<"users">, year: number, amount: number) {
  const byYear = [...(user.regAInvestedByYear ?? [])];
  const existingIndex = byYear.findIndex((entry) => entry.year === year);
  const legacyAmount = investedForYear(user, year);
  if (existingIndex >= 0) {
    byYear[existingIndex] = { year, amount: byYear[existingIndex].amount + amount };
  } else {
    byYear.push({ year, amount: legacyAmount + amount });
  }
  byYear.sort((left, right) => left.year - right.year);
  return byYear;
}

function publicOperation(order: Doc<"orders">): PublicPurchaseOperation {
  return {
    operationId: order._id,
    propertyId: order.propertyId,
    status: order.status,
    amountUsd: order.amount,
    platformFeeUsd: order.platformFee,
    principalBaseUnits: order.principalBaseUnits,
    platformFeeBaseUnits: order.platformFeeBaseUnits,
    totalBaseUnits: order.totalBaseUnits,
    tokenAmountRaw: order.tokenAmountRaw,
    paymentDecimals: order.paymentDecimals,
    signature: order.dvpTxSig,
    expiresAt: order.expiresAt,
    failureCode: order.failureCode,
    lastCheckpoint: order.lastCheckpoint,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** Restore the latest nonterminal operation so reload/back can never re-arm a submitted purchase. */
export const getActivePurchase = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await findUserByIdentity(ctx, identity);
    if (!user) return null;
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_user_property", (q) => q.eq("userId", user._id).eq("propertyId", propertyId))
      .order("desc")
      .collect();
    const active = orders.find((order) => isActiveOperation(order.status));
    const latestDurable = orders.find(
      (order) =>
        [
          "complete",
          "reconciling",
          "confirmed_on_chain",
          "submitted",
          "outcome_unknown",
          "prepared",
          "awaiting_authorization",
        ].includes(order.status) &&
        !(order.status === "complete" && order.consumerAcknowledgedAt !== undefined),
    );
    return active ? publicOperation(active) : latestDurable ? publicOperation(latestDurable) : null;
  },
});

export const acknowledgeCompletedPurchase = mutation({
  args: { operationId: v.id("orders") },
  handler: async (ctx, { operationId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await findUserByIdentity(ctx, identity);
    const order = await ctx.db.get(operationId);
    if (!user || !order || order.userId !== user._id) {
      throw new Error("Purchase operation not found");
    }
    if (order.status !== "complete") {
      throw new Error("Only a completed purchase can be acknowledged");
    }
    if (order.consumerAcknowledgedAt === undefined) {
      await ctx.db.patch(order._id, {
        consumerAcknowledgedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return { acknowledged: true as const };
  },
});

/** Server-only transaction builders consume this through an authenticated Convex JWT. */
export const getPurchaseBuildIntent = query({
  args: { operationId: v.id("orders") },
  handler: async (ctx, { operationId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");
    const order = await ctx.db.get(operationId);
    if (!order || order.userId !== user._id) throw new Error("Purchase operation not found");
    if (order.status !== "prepared" && order.status !== "awaiting_authorization") {
      throw new Error("Purchase operation cannot be authorized");
    }
    if (!order.expiresAt || Date.now() >= order.expiresAt) throw new Error("Purchase operation expired");
    return buildIntent(order);
  },
});

export type PurchasePreparationContext = { propertyMint: string };

export const purchasePreparationContext = internalQuery({
  args: {
    propertyId: v.id("properties"),
    subject: v.string(),
    tokenIdentifier: v.optional(v.string()),
    issuer: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PurchasePreparationContext> => {
    const user = await findUserByIdentity(ctx, args);
    if (!user?.walletAddress) throw new Error("Verified wallet required");
    const property = await ctx.db.get(args.propertyId);
    if (
      !property ||
      property.status !== "open" ||
      property.mintStatus !== "confirmed" ||
      !property.mint
    ) {
      throw new Error("Offering unavailable");
    }
    return { propertyMint: property.mint };
  },
});

export const preparePurchaseVerified = internalMutation({
  args: {
    propertyId: v.id("properties"),
    amountUsd: v.number(),
    acknowledgedRiskIds: v.array(v.string()),
    teachBackOwnership: v.string(),
    teachBackLiquidity: v.string(),
    subject: v.string(),
    tokenIdentifier: v.optional(v.string()),
    issuer: v.optional(v.string()),
    propertyMint: v.string(),
    tokenAmountRaw: v.string(),
    principalBaseUnits: v.string(),
    platformFeeBaseUnits: v.string(),
    totalBaseUnits: v.string(),
  },
  handler: async (ctx, args): Promise<PublicPurchaseOperation> => {
    const identity = {
      subject: args.subject,
      tokenIdentifier: args.tokenIdentifier,
      issuer: args.issuer,
    };
    const actor = identityKey(identity);
    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");
    if (!user.walletAddress) throw new Error("Verified wallet required");
    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new Error("Property not found");
    if (!isValidPurchaseAmount(args.amountUsd, property.minInvestment) || !Number.isSafeInteger(args.amountUsd)) {
      throw new Error("Invalid amount");
    }
    if (property.mint !== args.propertyMint) throw new Error("Property mint changed");
    for (const value of [args.tokenAmountRaw, args.principalBaseUnits, args.platformFeeBaseUnits, args.totalBaseUnits]) {
      if (!/^\d+$/.test(value)) throw new Error("Invalid exact quote");
    }
    const principalBaseUnits = BigInt(args.principalBaseUnits);
    const platformFeeBaseUnits = BigInt(args.platformFeeBaseUnits);
    const totalBaseUnits = BigInt(args.totalBaseUnits);
    if (
      principalBaseUnits !== BigInt(args.amountUsd) * PAYMENT_BASE_UNITS_PER_USD ||
      totalBaseUnits !== principalBaseUnits + platformFeeBaseUnits
    ) {
      throw new Error("Exact quote does not match requested investment");
    }
    const principalUsd = Number(principalBaseUnits) / Number(PAYMENT_BASE_UNITS_PER_USD);
    const feeUsd = Number(platformFeeBaseUnits) / Number(PAYMENT_BASE_UNITS_PER_USD);
    const exactTotalUsd = Number(totalBaseUnits) / Number(PAYMENT_BASE_UNITS_PER_USD);

    const existing = await ctx.db
      .query("orders")
      .withIndex("by_user_property", (q) =>
        q.eq("userId", user._id).eq("propertyId", args.propertyId),
      )
      .order("desc")
      .collect();
    const active = existing.find((order) => isActiveOperation(order.status));
    if (active) return publicOperation(active);

    if (
      property.status !== "open" ||
      property.mintStatus !== "confirmed" ||
      typeof property.mint !== "string" ||
      property.mint.length === 0
    ) {
      throw new Error("Offering unavailable");
    }
    if (!hasRequiredRiskAcks(args.acknowledgedRiskIds)) throw new Error("Risk consent required");
    if (
      args.teachBackOwnership !== TEACH_BACK_OWNERSHIP ||
      args.teachBackLiquidity !== TEACH_BACK_LIQUIDITY
    ) {
      throw new Error("Understanding check incomplete");
    }

    const eligibility = await ctx.db
      .query("eligibility")
      .withIndex("by_user_property", (q) =>
        q.eq("userId", user._id).eq("propertyId", args.propertyId),
      )
      .unique();
    const attestation = await ctx.db
      .query("eligibilityAttestations")
      .withIndex("by_user_property", (q) =>
        q.eq("userId", user._id).eq("propertyId", args.propertyId),
      )
      .unique();
    if (
      eligibility?.eligible !== true ||
      eligibility.tokenAclState !== "thawed" ||
      attestation?.desiredEligible !== true ||
      attestation.status !== "applied"
    ) {
      throw new Error("Eligibility is not ready");
    }

    const year = regulatoryYear();
    const invested = investedForYear(user, year);
    const allUserOrders = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const regulatoryReserved = allUserOrders
      .filter(
        (order) =>
          isActiveOperation(order.status) &&
          order.regulatoryYear === year,
      )
      .reduce((sum, order) => sum + order.amount, 0);
    if (
      typeof user.regAAnnualLimit !== "number" ||
      !Number.isFinite(user.regAAnnualLimit) ||
      invested + regulatoryReserved + principalUsd > user.regAAnnualLimit
    ) {
      throw new Error("Annual investment limit exceeded");
    }

    const fundings = await ctx.db
      .query("fundings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const reserved = allUserOrders
      .filter((order) => isActiveOperation(order.status))
      .reduce((sum, order) => sum + totalChargedCents(order.amount), 0);
    if (exactTotalUsd > spendableBalance(fundings, allUserOrders) - reserved) {
      throw new Error("Insufficient available funds");
    }

    const propertyOrders = await ctx.db
      .query("orders")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const reservedInventory = propertyOrders
      .filter((order) => isActiveOperation(order.status))
      .reduce((sum, order) => sum + order.amount, 0);
    if (settledPropertyAmount(propertyOrders) + reservedInventory + principalUsd > property.offeringSize) {
      throw new Error("Offering inventory unavailable");
    }

    const now = Date.now();
    const operationId = await ctx.db.insert("orders", {
      userId: user._id,
      propertyId: args.propertyId,
      amount: principalUsd,
      platformFee: feeUsd,
      status: "prepared",
      walletAddress: user.walletAddress,
      propertyMint: args.propertyMint,
      tokenAmountRaw: args.tokenAmountRaw,
      principalBaseUnits: args.principalBaseUnits,
      platformFeeBaseUnits: args.platformFeeBaseUnits,
      totalBaseUnits: args.totalBaseUnits,
      paymentDecimals: PAYMENT_DECIMALS,
      regulatoryYear: year,
      acknowledgedRiskIds: [...new Set(args.acknowledgedRiskIds)],
      teachBackOwnership: args.teachBackOwnership,
      teachBackLiquidity: args.teachBackLiquidity,
      expiresAt: now + PURCHASE_OPERATION_TTL_MS,
      lastCheckpoint: "Order prepared; no money moved.",
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      actor,
      action: "order.prepared",
      target: operationId,
      meta: {
        propertyId: args.propertyId,
        amountUsd: principalUsd,
        tokenAmountRaw: args.tokenAmountRaw,
        principalBaseUnits: args.principalBaseUnits,
        platformFeeBaseUnits: args.platformFeeBaseUnits,
        totalBaseUnits: args.totalBaseUnits,
        regulatoryYear: year,
      },
    });
    const order = await ctx.db.get(operationId);
    if (!order) throw new Error("Purchase operation was not created");
    return publicOperation(order);
  },
});

export const markAwaitingAuthorization = mutation({
  args: { operationId: v.id("orders") },
  handler: async (ctx, { operationId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await findUserByIdentity(ctx, identity);
    const order = await ctx.db.get(operationId);
    if (!user || !order || order.userId !== user._id) throw new Error("Purchase operation not found");
    if (order.status !== "prepared" && order.status !== "awaiting_authorization") {
      throw new Error("Purchase operation cannot be authorized");
    }
    if (!order.expiresAt || Date.now() >= order.expiresAt) {
      await ctx.db.patch(operationId, {
        status: "expired",
        failureCode: "quote_expired",
        lastCheckpoint: "The unsigned order expired; no money moved.",
        updatedAt: Date.now(),
      });
      return { status: "expired" as const };
    }
    if (order.status === "prepared") {
      await ctx.db.patch(operationId, {
        status: "awaiting_authorization",
        lastCheckpoint: "Waiting for your authorization; no money moved.",
        updatedAt: Date.now(),
      });
    }
    return { status: "awaiting_authorization" as const };
  },
});

/**
 * Atomically reserves the one authorization issuance permitted for an order. Convex retries
 * conflicting mutations serially, so concurrent HTTP requests cannot both receive a build lease.
 */
export const claimPurchaseAuthorization = mutation({
  args: { operationId: v.id("orders"), claimId: v.string() },
  handler: async (ctx, { operationId, claimId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (claimId.length < 16 || claimId.length > 160) throw new Error("Invalid authorization claim");
    const user = await findUserByIdentity(ctx, identity);
    const order = await ctx.db.get(operationId);
    if (!user || !order || order.userId !== user._id) throw new Error("Purchase operation not found");

    if (
      order.authorizedTransaction &&
      order.authorizedBlockhash &&
      order.authorizedLastValidBlockHeight !== undefined &&
      order.authorizedChain
    ) {
      return {
        status: "issued" as const,
        intent: buildIntent(order),
        transaction: order.authorizedTransaction,
        blockhash: order.authorizedBlockhash,
        lastValidBlockHeight: order.authorizedLastValidBlockHeight,
        chain: order.authorizedChain,
      };
    }
    if (order.status !== "prepared" && order.status !== "awaiting_authorization") {
      throw new Error("Purchase operation cannot be authorized");
    }
    const now = Date.now();
    if (!order.expiresAt || now >= order.expiresAt) {
      await ctx.db.patch(operationId, {
        status: "expired",
        failureCode: "quote_expired",
        lastCheckpoint: "The unsigned order expired; no money moved.",
        updatedAt: now,
      });
      return { status: "expired" as const };
    }
    if (
      order.authorizationClaimId &&
      order.authorizationClaimId !== claimId &&
      (order.authorizationClaimExpiresAt ?? 0) > now
    ) {
      return { status: "in_progress" as const };
    }
    await ctx.db.patch(operationId, {
      status: "awaiting_authorization",
      authorizationClaimId: claimId,
      authorizationClaimExpiresAt: now + PURCHASE_AUTHORIZATION_CLAIM_TTL_MS,
      lastCheckpoint: "Preparing one reusable authorization; no money moved.",
      updatedAt: now,
    });
    return { status: "claimed" as const, intent: buildIntent(order) };
  },
});

/** Persist the canonical authority-signed payload exactly once. */
export const finalizePurchaseAuthorization = mutation({
  args: {
    operationId: v.id("orders"),
    claimId: v.string(),
    transaction: v.string(),
    blockhash: v.string(),
    lastValidBlockHeight: v.number(),
    chain: v.union(v.literal("solana:devnet"), v.literal("solana:testnet"), v.literal("solana:mainnet")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await findUserByIdentity(ctx, identity);
    const order = await ctx.db.get(args.operationId);
    if (!user || !order || order.userId !== user._id) throw new Error("Purchase operation not found");
    if (
      order.authorizedTransaction &&
      order.authorizedBlockhash &&
      order.authorizedLastValidBlockHeight !== undefined &&
      order.authorizedChain
    ) {
      return {
        status: "issued" as const,
        transaction: order.authorizedTransaction,
        blockhash: order.authorizedBlockhash,
        lastValidBlockHeight: order.authorizedLastValidBlockHeight,
        chain: order.authorizedChain,
      };
    }
    if (
      order.status !== "awaiting_authorization" ||
      order.authorizationClaimId !== args.claimId ||
      (order.authorizationClaimExpiresAt ?? 0) <= Date.now()
    ) {
      throw new Error("Authorization claim is no longer valid");
    }
    if (
      args.transaction.length < 32 ||
      args.blockhash.length < 32 ||
      !Number.isSafeInteger(args.lastValidBlockHeight) ||
      args.lastValidBlockHeight < 0
    ) {
      throw new Error("Invalid authorization payload");
    }
    const now = Date.now();
    await ctx.db.patch(order._id, {
      authorizedTransaction: args.transaction,
      authorizedBlockhash: args.blockhash,
      authorizedLastValidBlockHeight: args.lastValidBlockHeight,
      authorizedChain: args.chain as PurchaseChain,
      authorizationIssuedAt: now,
      authorizationClaimId: undefined,
      authorizationClaimExpiresAt: undefined,
      lastCheckpoint: "One authorization is ready for your signature; no money moved.",
      updatedAt: now,
    });
    return {
      status: "issued" as const,
      transaction: args.transaction,
      blockhash: args.blockhash,
      lastValidBlockHeight: args.lastValidBlockHeight,
      chain: args.chain,
    };
  },
});

export const recordPurchaseSubmitted = mutation({
  args: { operationId: v.id("orders"), signature: v.string() },
  handler: async (ctx, { operationId, signature }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!isLikelySolanaSignature(signature)) throw new Error("Invalid transaction signature");
    const user = await findUserByIdentity(ctx, identity);
    const order = await ctx.db.get(operationId);
    if (!user || !order || order.userId !== user._id) throw new Error("Purchase operation not found");
    if (order.dvpTxSig) {
      if (order.dvpTxSig !== signature) throw new Error("Purchase operation already has another signature");
      return publicOperation(order);
    }
    if (order.status !== "awaiting_authorization") throw new Error("Purchase operation is not signable");
    if (
      !order.authorizedTransaction ||
      !order.authorizedBlockhash ||
      order.authorizedLastValidBlockHeight === undefined ||
      !order.authorizedChain ||
      order.authorizationIssuedAt === undefined
    ) {
      throw new Error("Purchase authorization was not durably issued");
    }
    const duplicate = await ctx.db
      .query("orders")
      .withIndex("by_signature", (q) => q.eq("dvpTxSig", signature))
      .first();
    if (duplicate && duplicate._id !== order._id) throw new Error("Transaction already belongs to another order");
    const now = Date.now();
    await ctx.db.patch(operationId, {
      status: "submitted",
      dvpTxSig: signature,
      submittedAt: now,
      lastCheckpoint: "Authorization submitted; payment may have moved.",
      updatedAt: now,
    });
    return { ...publicOperation(order), status: "submitted" as const, signature };
  },
});

export const markPurchaseFailedSafe = mutation({
  args: { operationId: v.id("orders"), reason: v.string() },
  handler: async (ctx, { operationId, reason }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await findUserByIdentity(ctx, identity);
    const order = await ctx.db.get(operationId);
    if (!user || !order || order.userId !== user._id) throw new Error("Purchase operation not found");
    if (
      order.dvpTxSig ||
      order.authorizationIssuedAt !== undefined ||
      order.authorizedTransaction ||
      !["prepared", "awaiting_authorization"].includes(order.status)
    ) {
      throw new Error("Submitted purchases cannot be marked safe to retry");
    }
    await ctx.db.patch(operationId, {
      status: "failed_safe",
      failureCode: reason.slice(0, 160),
      lastCheckpoint: "Authorization did not submit; no payment moved.",
      updatedAt: Date.now(),
    });
    return { status: "failed_safe" as const };
  },
});

export const markPurchaseOutcomeUnknown = mutation({
  args: { operationId: v.id("orders"), signature: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { operationId, signature, reason }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await findUserByIdentity(ctx, identity);
    const order = await ctx.db.get(operationId);
    if (!user || !order || order.userId !== user._id || order.dvpTxSig !== signature) {
      throw new Error("Purchase operation not found");
    }
    if (["complete", "confirmed_on_chain", "reconciling"].includes(order.status)) {
      return publicOperation(order);
    }
    if (order.status !== "submitted" && order.status !== "outcome_unknown") {
      throw new Error("Purchase outcome cannot be marked unknown");
    }
    await ctx.db.patch(operationId, {
      status: "outcome_unknown",
      failureCode: reason?.slice(0, 160) || "confirmation_unavailable",
      lastCheckpoint: "Payment may have completed; checking the submitted reference is required.",
      updatedAt: Date.now(),
    });
    return { status: "outcome_unknown" as const };
  },
});

/** Called only after onchainConfirm validates the exact successful settle transaction. */
export const recordVerifiedPurchaseEvidence = internalMutation({
  args: {
    operationId: v.id("orders"),
    signature: v.string(),
    slot: v.number(),
    mirrorComplete: v.boolean(),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.operationId);
    if (!order || order.dvpTxSig !== args.signature) throw new Error("Verified order not found");
    if (!["submitted", "outcome_unknown", "confirmed_on_chain", "reconciling", "complete"].includes(order.status)) {
      throw new Error("Order is not awaiting chain evidence");
    }
    const firstConfirmation = !["confirmed_on_chain", "reconciling", "complete"].includes(order.status);
    if (firstConfirmation) {
      const user = await ctx.db.get(order.userId);
      if (!user) throw new Error("Order user not found");
      const orderYear = order.regulatoryYear ?? regulatoryYear();
      const currentYear = regulatoryYear();
      await ctx.db.patch(user._id, {
        regAInvestedByYear: incrementInvestmentYear(user, orderYear, order.amount),
        ...(orderYear === currentYear
          ? {
              regAInvestedThisYear: investedForYear(user, currentYear) + order.amount,
              regARegulatoryYear: currentYear,
            }
          : {}),
      });
    }
    const now = Date.now();
    await ctx.db.patch(order._id, {
      status: args.mirrorComplete ? "complete" : "reconciling",
      chainSlot: args.slot,
      confirmedAt: order.confirmedAt ?? now,
      ...(args.mirrorComplete ? { reconciledAt: now } : {}),
      lastCheckpoint: args.mirrorComplete
        ? "Ownership records updated from verified payment evidence."
        : "Payment confirmed; ownership records are updating.",
      updatedAt: now,
    });
    return { status: args.mirrorComplete ? ("complete" as const) : ("reconciling" as const) };
  },
});

export const recordVerifiedPurchaseFailure = internalMutation({
  args: { operationId: v.id("orders"), signature: v.string(), slot: v.number() },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.operationId);
    if (!order || order.dvpTxSig !== args.signature)
      throw new Error("Verified order not found");
    if (!["submitted", "outcome_unknown", "failed_safe"].includes(order.status)) {
      throw new Error("Order is not awaiting failure evidence");
    }
    await ctx.db.patch(order._id, {
      status: "failed_safe",
      chainSlot: args.slot,
      failureCode: "transaction_rejected",
      lastCheckpoint:
        "The submitted authorization was rejected; no payment or ownership changed.",
      updatedAt: Date.now(),
    });
    return { status: "failed_safe" as const };
  },
});

/** Only finalized block-height evidence may release an issued transaction for a fresh purchase. */
export const recordVerifiedPurchaseExpiry = internalMutation({
  args: {
    operationId: v.id("orders"),
    signature: v.string(),
    observedBlockHeight: v.number(),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.operationId);
    if (!order || order.dvpTxSig !== args.signature) throw new Error("Verified order not found");
    if (
      order.authorizedLastValidBlockHeight === undefined ||
      args.observedBlockHeight <= order.authorizedLastValidBlockHeight
    ) {
      throw new Error("Transaction expiry is not proven");
    }
    if (!["submitted", "outcome_unknown"].includes(order.status)) {
      return publicOperation(order);
    }
    await ctx.db.patch(order._id, {
      status: "expired",
      failureCode: "blockhash_expired",
      lastCheckpoint: "Finalized chain height proves the authorization expired without landing.",
      updatedAt: Date.now(),
    });
    return { status: "expired" as const };
  },
});

// --- Legacy test/demo mutation ---------------------------------------------------------------

// The atomic settlement mutation. Resolve the caller from the JWT (throw if unauthenticated / no user
// row), load the property (throw if missing), validate the amount (throw on malformed — UI-prevented),
// then insert a `pending` order and route the settle decision through settlementDecision + dvpSettle.
// On ok: patch the order `settled` + `dvpTxSig`, upsert the holding (accumulate cost basis on repeat
// buy), increment the Reg A+ accumulator, and audit `order.settled` — all committed together. On a
// business failure: patch the order `failed`, audit `order.failed`, and return the reason — committed,
// nothing charged (no holding, no Reg A+ increment). Never throws on a business failure.
export const confirmPurchase = mutation({
  args: {
    propertyId: v.id("properties"),
    amountUsd: v.number(),
    acknowledgedRiskIds: v.array(v.string()),
  },
  handler: async (ctx, { propertyId, amountUsd, acknowledgedRiskIds }) => {
    if (
      process.env.NODE_ENV === "production" ||
      (process.env.NODE_ENV !== "test" && process.env.VESPER_ENABLE_DEMO_PURCHASE !== "true")
    ) {
      throw new Error("Synthetic purchase settlement is disabled");
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const actor = identityKey(identity);

    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");

    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");

    // Validate the amount before ANY write — a malformed amount throws and rolls back cleanly (no
    // order, no audit): it is a UI-prevented client bug, not a settlement attempt.
    if (!isValidPurchaseAmount(amountUsd, property.minInvestment)) {
      throw new Error("Invalid amount");
    }

    // Server-authoritative charge, from the cents-rounded amount so the persisted order (amount + fee)
    // equals the returned total to the penny and the derived balance debit never drifts.
    const amount = roundCents(amountUsd);
    const platformFee = platformFeeCents(amount);
    const total = totalChargedCents(amount);

    // Insert the order as `pending` first, so the async-confirm future (real DvP) needs no restructure.
    const orderId = await ctx.db.insert("orders", {
      userId: user._id,
      propertyId,
      amount,
      platformFee,
      status: "pending",
      createdAt: Date.now(),
    });

    // The per-property eligibility (Token-ACL mirror) and the derived spendable balance.
    const eligibility = await ctx.db
      .query("eligibility")
      .withIndex("by_user_property", (q) =>
        q.eq("userId", user._id).eq("propertyId", propertyId),
      )
      .unique();

    const fundings = await ctx.db
      .query("fundings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    // All of the caller's orders. The just-inserted `pending` order is excluded from the spendable
    // math automatically (settledOrdersTotal sums only `settled` rows), so no self-debit here.
    const priorOrders = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const spendable = spendableBalance(fundings, priorOrders);
    const propertyOrders = await ctx.db
      .query("orders")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .collect();

    // Business gates FIRST — eligibility/consent (distinct acks), Reg A+ cap, spendable balance. The
    // DvP seam is invoked ONLY once these pass, so a real on-chain DvP program never settles for a
    // blocked caller (the settle-authorization structure holds when the stub is swapped out).
    const gateInput = {
      propertyStatus: property.status,
      offeringSize: property.offeringSize,
      offeringSettledAmount: settledPropertyAmount(propertyOrders),
      eligible: eligibility?.eligible === true,
      tokenAclState: eligibility?.tokenAclState,
      acknowledgedRiskCount: distinctAckCount(acknowledgedRiskIds),
      hasRequiredRiskAcks: hasRequiredRiskAcks(acknowledgedRiskIds),
      regAAnnualLimit: user.regAAnnualLimit,
      regAInvestedThisYear: user.regAInvestedThisYear,
      amount,
      total,
      spendable,
    };
    const gate = businessGateDecision(gateInput);

    // Route the DvP seam only after the business gates pass; its confirmation is the sole authority
    // for a `settled` write. A non-confirm is a committed `dvp-failed` failure (nothing charged). The
    // authoritative reason comes from settlementDecision — the single documented source of truth for
    // the full settle I/O matrix (gates + DvP) — so the mutation has ONE decision path, not a second
    // one that could drift from the pure decision the tests assert against.
    const dvp = gate.ok ? dvpSettle(orderId) : null;
    const decision: SettlementResult = gate.ok
      ? settlementDecision({ ...gateInput, dvpConfirmed: dvp!.confirmed })
      : gate;
    const reason: SettlementReason | null = decision.ok ? null : decision.reason;

    // Committed failure: patch `failed`, audit, return the reason. Nothing charged — no holding, no
    // Reg A+ increment. NEVER a throw (a throw would roll back the mandated audit).
    if (reason !== null) {
      await ctx.db.patch(orderId, { status: "failed" });
      await writeAudit(ctx, {
        actor,
        action: "order.failed",
        target: user._id,
        meta: { propertyId, amount, reason },
      });
      return { status: "failed" as const, reason };
    }

    // Settled: DvP confirmed and every gate passed. The full settled set commits together.
    await ctx.db.patch(orderId, { status: "settled", dvpTxSig: dvp!.dvpTxSig });

    // Upsert the intent holding (chain-corrected later by reconcile). tokenAmount = amount as a
    // documented 1:1 stub; costBasis accumulates on a repeat buy; ownershipPct = cost / offeringSize.
    const existingHolding = await ctx.db
      .query("holdings")
      .withIndex("by_user_property", (q) =>
        q.eq("userId", user._id).eq("propertyId", propertyId),
      )
      .unique();

    const newCostBasis = (existingHolding?.costBasis ?? 0) + amount;
    const ownershipPct = ownershipBasis(newCostBasis, property.offeringSize);

    if (existingHolding) {
      await ctx.db.patch(existingHolding._id, {
        tokenAmount: existingHolding.tokenAmount + amount,
        costBasis: newCostBasis,
        ownershipPct,
      });
    } else {
      await ctx.db.insert("holdings", {
        userId: user._id,
        propertyId,
        tokenAmount: amount,
        ownershipPct,
        costBasis: newCostBasis,
      });
    }

    // Increment the Reg A+ accumulator (the cumulative per-investor cap tracker).
    await ctx.db.patch(user._id, {
      regAInvestedThisYear: (user.regAInvestedThisYear ?? 0) + amount,
    });

    // Durable consent capture: acknowledgedRiskIds live in the settled audit meta (the atomic consent
    // record Story 4.3 deferred), alongside the DvP receipt reference.
    await writeAudit(ctx, {
      actor,
      action: "order.settled",
      target: user._id,
      meta: {
        propertyId,
        amount,
        platformFee,
        dvpTxSig: dvp!.dvpTxSig,
        acknowledgedRiskIds,
      },
    });

    return {
      status: "settled" as const,
      orderId,
      dvpTxSig: dvp!.dvpTxSig,
      ownershipPct,
      amount,
      platformFee,
      total,
    };
  },
});
