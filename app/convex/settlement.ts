import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { availableBalance } from "./funding";
import type { Doc, Id } from "./_generated/dataModel";

// Story 4.4 — Atomic Delivery-versus-Payment (DvP) settlement.
//
// This module is the settlement atomicity boundary (FR10 / spine I2). A Convex mutation is already
// all-or-nothing, so the settled order (the debit that reduces spendable balance) and the token
// delivery (the holding) commit together or not at all. The `settled` status is authorized SOLELY by
// the `dvpSettle` seam's confirmation — "Convex never self-settles". `dvpSettle` is a synchronous
// STUB standing in for the deferred Anchor DvP program / on-chain reconcile (blocker B1); the real
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
    .filter((o) => o.status === "settled")
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
// count, so a crafted `["x","x","x"]` cannot satisfy the three-distinct-ack gate. (Membership
// validation against the canonical RIGHTS_ACKS ids is deferred — see the deferred-work ledger.)
export function distinctAckCount(acknowledgedRiskIds: readonly string[]): number {
  return new Set(acknowledgedRiskIds).size;
}

// The reasons a settlement can fail — exactly the four business gates. Consent (short acks) folds into
// `ineligible`: without active consent the caller is not cleared to receive the token.
export type SettlementReason =
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
// the seam — so the real Anchor DvP program swaps in behind `dvpSettle` with no risk of settling for
// an ineligible/over-cap/underfunded caller ("Convex never self-settles", enforced structurally).
export function businessGateDecision(input: {
  eligible: boolean;
  tokenAclState: "frozen" | "thawed" | null | undefined;
  acknowledgedRiskCount: number;
  regAAnnualLimit: number | null | undefined;
  regAInvestedThisYear: number | null | undefined;
  amount: number;
  total: number;
  spendable: number;
}): SettlementResult {
  // 1. Eligibility + active consent. An ineligible/frozen account gets no token; likewise a request
  //    that arrives without all three acknowledgements (UI-gated, but enforced server-side too).
  if (
    input.eligible !== true ||
    input.tokenAclState !== "thawed" ||
    input.acknowledgedRiskCount < REQUIRED_RISK_ACK_COUNT
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
  eligible: boolean;
  tokenAclState: "frozen" | "thawed" | null | undefined;
  acknowledgedRiskCount: number;
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
// marked stub signature; when B1 lands this becomes the real Anchor DvP call (or the Helius reconcile
// path flips pending → settled from chain truth) with NO change to the settle-authorization structure.
// The order is inserted `pending` first, so the async-confirm future needs no structural change.
export function dvpSettle(orderId: Id<"orders">): { confirmed: boolean; dvpTxSig: string } {
  return { confirmed: true, dvpTxSig: `STUB-DVP-${orderId}` };
}

// --- Mutation ---------------------------------------------------------------------------------

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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", identity.subject))
      .unique();
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

    // Business gates FIRST — eligibility/consent (distinct acks), Reg A+ cap, spendable balance. The
    // DvP seam is invoked ONLY once these pass, so a real on-chain DvP program never settles for a
    // blocked caller (the settle-authorization structure holds when the stub is swapped out).
    const gate = businessGateDecision({
      eligible: eligibility?.eligible === true,
      tokenAclState: eligibility?.tokenAclState,
      acknowledgedRiskCount: distinctAckCount(acknowledgedRiskIds),
      regAAnnualLimit: user.regAAnnualLimit,
      regAInvestedThisYear: user.regAInvestedThisYear,
      amount,
      total,
      spendable,
    });

    // Route the DvP seam only after the business gates pass; its confirmation is the sole authority
    // for a `settled` write. A non-confirm is a committed `dvp-failed` failure (nothing charged).
    const dvp = gate.ok ? dvpSettle(orderId) : null;
    const reason: SettlementReason | null = !gate.ok
      ? gate.reason
      : dvp!.confirmed
        ? null
        : "dvp-failed";

    // Committed failure: patch `failed`, audit, return the reason. Nothing charged — no holding, no
    // Reg A+ increment. NEVER a throw (a throw would roll back the mandated audit).
    if (reason !== null) {
      await ctx.db.patch(orderId, { status: "failed" });
      await writeAudit(ctx, {
        actor: identity.subject,
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
    const existingHolding = (
      await ctx.db
        .query("holdings")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()
    ).find((h) => h.propertyId === propertyId);

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
      actor: identity.subject,
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
