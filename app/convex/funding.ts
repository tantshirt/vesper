import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { settledOrdersTotal } from "./settlement";
import type { Doc } from "./_generated/dataModel";

// Story 3.3 — Add money (fiat → USDC).
//
// This module is the fiat on-ramp + escrow/custody boundary. Blocker B1 (escrow/custody vendor) is
// unresolved, so the live path — card/ACH via the Privy + Bridge hosted on-ramp → funds settle to
// the escrow/custody account as USDC → the provider webhook calls a server-attested internalMutation
// to record the settled deposit — is STUBBED and deferred (see deferred-work.md). `addMoney` *is* the
// on-ramp/settlement boundary here: it records a `status:"settled"` deposit directly (a mock instant
// on-ramp). No real money moves this run. Same "record in Convex, defer live infra" shape as 3.1/3.2.
//
// The balance is DERIVED from an append-only ledger (sum of settled `fundings` rows) — a single
// source of truth that cannot drift, matching the incomeLedger/reconciliations discipline. It is
// account-level (per-user, not per-property). No denormalized balance field. Deposit-only here;
// E4 settlement introduces debits (out of scope). The caller is always resolved server-side from
// the JWT (getUserIdentity() → by_privyId); the client-supplied user id is never trusted.
//
// Consumer surface stays fiat-native: every amount is shown in dollars (formatUsd). The word "USDC"
// never appears in copy; USDC is a 1:1 dollar stablecoin, converted behind the scenes via usdToUsdc.

// --- Pure helpers (exported for unit tests; no ctx/db access) ---------------------------------

// Platform minimum deposit ($50, mirrors the minimum investment) and a sanity cap guarding against
// overflow/absurd input. Kept as small, documented, testable constants (like isEligibleJurisdiction).
export const MIN_FUNDING = 50;
export const MAX_FUNDING = 1_000_000;

// Whole-dollar amount rule: finite integer within [MIN_FUNDING, MAX_FUNDING]. Whole dollars keep the
// displayed balance exact and prevent sub-dollar drift. Rejects 0, negatives, fractional, NaN,
// Infinity, and anything outside the band.
export function isValidFundingAmount(amountUsd: number): boolean {
  return (
    Number.isFinite(amountUsd) &&
    Number.isInteger(amountUsd) &&
    amountUsd >= MIN_FUNDING &&
    amountUsd <= MAX_FUNDING
  );
}

// USDC is a 1:1 dollar stablecoin — this is the explicit, tested conversion seam. A real Bridge
// conversion (with spread/fees) plugs in here; consumers only ever see dollars.
export function usdToUsdc(amountUsd: number): number {
  return amountUsd;
}

// Derive the available balance (in dollars) from the append-only ledger: the sum of `status:"settled"`
// deposits. Pending/failed rows never count. Empty → 0 (never null).
export function availableBalance(
  fundings: Pick<Doc<"fundings">, "amountUsd" | "status">[],
): number {
  return fundings
    .filter((f) => f.status === "settled")
    .reduce((sum, f) => sum + f.amountUsd, 0);
}

// --- Query ------------------------------------------------------------------------------------

// The caller's account-level SPENDABLE balance in dollars (0 if unauthenticated / no user / no
// deposits — never null): settled deposits MINUS the total of prior settled orders (each order's
// amount + platform fee). Story 4.4 settlement is the first debit — netting it here keeps the
// displayed/gated balance honest after a purchase (balance stays fully derived; no balance table).
// Reactive: the invest page holds on `loading` until this resolves so `funding` never flashes for an
// already-funded user.
export const getFundedBalance = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;

    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", identity.subject))
      .unique();
    if (!user) return 0;

    const fundings = await ctx.db
      .query("fundings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return availableBalance(fundings) - settledOrdersTotal(orders);
  },
});

// --- Mutation ---------------------------------------------------------------------------------

// Record a settled deposit through the stubbed on-ramp. Resolve the caller from the JWT (throw if
// unauthenticated / user row missing), validate the whole-dollar amount, compute the 1:1 USDC amount
// (conversion seam), insert an append-only `status:"settled"` row, and audit `funding.added`. Returns
// the new funding id and the updated balance. Additive by design (NOT idempotent) — each deposit is a
// new row; double-submit is guarded only by the form's disabled state (provider idempotency key is
// deferred with the live wiring). Residual: this is a public, client-callable mutation trusting the
// client-supplied amount (mock on-ramp) — it must become server-attested before real money moves.
export const addMoney = mutation({
  args: {
    amountUsd: v.number(),
    method: v.union(v.literal("card"), v.literal("ach")),
  },
  handler: async (ctx, { amountUsd, method }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", identity.subject))
      .unique();
    if (!user) throw new Error("User not provisioned");

    // Validate before any write — an invalid amount throws and rolls back (no row, no audit).
    if (!isValidFundingAmount(amountUsd)) throw new Error("Invalid amount");

    // Conversion seam: USDC computed 1:1 behind the scenes (never surfaced to the consumer).
    void usdToUsdc(amountUsd);

    // Stubbed instant on-ramp: record the deposit as already settled.
    const fundingId = await ctx.db.insert("fundings", {
      userId: user._id,
      amountUsd,
      method,
      status: "settled",
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      actor: identity.subject,
      action: "funding.added",
      target: user._id,
      meta: { amountUsd, method, fundingId },
    });

    // Re-derive the running balance from the ledger (single source of truth).
    const fundings = await ctx.db
      .query("fundings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return { fundingId, balance: availableBalance(fundings) };
  },
});
