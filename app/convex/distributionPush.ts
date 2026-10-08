import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { writeAudit } from "./audit";
import { computeShares } from "./distribution";
import type { Id } from "./_generated/dataModel";

// Slice 5 — Distribution PUSH orchestration (platform treasury → each holder).
//
// The real payout is a PUSH: the platform's Privy server wallet signs and submits one USDC SPL transfer
// per holder, from the treasury to the holder's wallet. Live Privy server-wallet creds are NOT available
// here, so the actual transfer sits behind the clearly-named `pushUsdcToHolder` STUB seam (mirroring
// settlement.ts `dvpSettle`): it returns a `STUB-DIST-...` signature synchronously, with a comment
// describing the real Privy call. Everything AROUND the seam is real: ensure the pending ledger rows,
// resolve holders + wallets, compute each pro-rata share, push per holder, and record the resulting
// signature for reconcile.
//
// The paid flip stays with `reconcile.applyChainEvent(distribution)` — this action never marks a row
// paid; it records the on-chain signature that the Helius webhook path later confirms (scheduled → paid).
// Consumer copy stays fiat-native (dollars); "USDC" lives only inside this internal seam.

// The Privy server-wallet push seam (STUB — B1 / on-chain stand-in). In the stub it "confirms"
// synchronously and returns a clearly-marked stub signature. The real call:
//
//   const { hash } = await privy.walletApi.solana.signAndSendTransaction({
//     walletId: TREASURY_WALLET_ID,
//     transaction: buildSplTransfer({           // USDC SPL transfer, treasury ATA → holder ATA
//       mint: USDC_MINT,
//       from: treasuryAta,
//       to: getAssociatedTokenAddress(USDC_MINT, walletAddress),
//       amount: BigInt(Math.round(amountDollars * 1e6)), // USDC has 6 decimals
//     }),
//   });
//   return { signature: hash };
//
// It swaps in here with NO change to the orchestration (or to the reconcile handoff).
export function pushUsdcToHolder(
  walletAddress: string,
  amountDollars: number,
): { signature: string } {
  const cents = Math.round((Number.isFinite(amountDollars) ? amountDollars : 0) * 100);
  return { signature: `STUB-DIST-${walletAddress}-${cents}` };
}

// Orchestrate the push for one property + period against a net pool.
//   1. Ensure the PENDING (`scheduled`) ledger rows exist — server-authoritative, audited, never paid.
//   2. Resolve holders (+ wallet + weight).
//   3. Compute each holder's share (the SAME pure math as the ledger) and push per holder via the seam.
//   4. Record each resulting signature on the pending row for reconcile to confirm.
// A holder with no wallet, or a $0 rounded share, is skipped (never a push to nowhere / a $0 transfer).
export const runDistributionPush = internalAction({
  args: {
    propertyId: v.id("properties"),
    period: v.string(),
    poolNet: v.number(),
  },
  handler: async (ctx, { propertyId, period, poolNet }) => {
    // 1. Pending rows (idempotent). Never marks paid — reconcile owns that.
    await ctx.runMutation(internal.distribution.runDistribution, { propertyId, period, poolNet });

    // 2. Push targets.
    const targets = await ctx.runQuery(internal.distribution.distributionTargets, { propertyId });

    // 3. Shares (identical apportionment to the ledger) → push per holder.
    const shares = computeShares(
      poolNet,
      targets.holders.map((h) => ({ id: h.userId, weight: h.weight })),
    );
    const amountByUser = new Map(shares.map((s) => [s.id, s.amount]));

    const results: { userId: Id<"users">; signature: string; amount: number }[] = [];
    let pushed = 0;
    let skippedNoWallet = 0;
    let skippedZero = 0;
    for (const h of targets.holders) {
      const amount = amountByUser.get(h.userId) ?? 0;
      if (amount <= 0) {
        skippedZero += 1; // zero-token / sub-cent share → nothing to send
        continue;
      }
      if (!h.walletAddress) {
        skippedNoWallet += 1; // no destination wallet on the user row → cannot push (never invented)
        continue;
      }
      const { signature } = pushUsdcToHolder(h.walletAddress, amount);
      // Scope the per-holder signature to the period so the same holder's payouts stay distinct.
      results.push({ userId: h.userId, signature: `${signature}-${period}`, amount });
      pushed += 1;
    }

    // 4. Record the on-chain signatures for reconcile to confirm (scheduled → paid stays reconcile's job).
    await ctx.runMutation(internal.distributionPush.recordPushSignatures, {
      propertyId,
      period,
      results,
    });

    return { period, pushed, skippedNoWallet, skippedZero, signatures: results };
  },
});

// Record each holder's push signature on their PENDING (`scheduled`) incomeLedger row — the on-chain
// reference reconcile will confirm. Status is NOT changed (reconcile alone flips scheduled → paid from
// chain truth); a row already `paid` is never touched. Audited.
export const recordPushSignatures = internalMutation({
  args: {
    propertyId: v.id("properties"),
    period: v.string(),
    results: v.array(
      v.object({ userId: v.id("users"), signature: v.string(), amount: v.number() }),
    ),
  },
  handler: async (ctx, { propertyId, period, results }) => {
    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .collect();
    const rowByUser = new Map(rows.map((r) => [r.userId, r]));

    let stamped = 0;
    for (const r of results) {
      const row = rowByUser.get(r.userId);
      if (!row || row.status === "paid") continue; // never touch a chain-confirmed row
      await ctx.db.patch(row._id, { txSig: r.signature }); // record signature; status stays scheduled
      stamped += 1;
    }

    await writeAudit(ctx, {
      actor: "distribution",
      action: "distribution.pushed",
      target: propertyId,
      meta: { period, pushed: results.length, stamped },
    });

    return { stamped };
  },
});
