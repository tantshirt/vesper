import { action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Slice 6 — the Convex → chain bridge for Token-ACL eligibility.
//
// Convex is the entitlement authority: `eligibility.recordEligibility` decides who is cleared and flips
// `tokenAclState` to "thawed". This action projects that decision onto the chain by writing the on-chain
// Eligibility attestation (`set_eligibility`), which is what lets the wallet's frozen-by-default property
// token account be thawed (and thus receive/hold the token). It is meant to be invoked whenever
// recordEligibility flips a (user, property) to thawed/frozen.
//
// Live Privy server-wallet credentials aren't available in this environment, so the actual signing is a
// STUB seam (mirrors dvpSettle / pushUsdcToHolder) — the orchestration (resolve wallet + mint, guard,
// return a signature) is real; only the signature is synthetic.

// Real impl: the platform (offering.authority) signs a `set_eligibility(eligible)` transaction via a
// Privy server wallet — authority = platform, owner = `wallet`, property_mint = `mint` — submits it, and
// returns the tx signature. Here it returns a clearly-marked stub.
function signSetEligibility(wallet: string, _mint: string, eligible: boolean): string {
  return `STUB-ELIG-${eligible ? "on" : "off"}-${wallet.slice(0, 8)}`;
}

export const resolveAttestTargets = internalQuery({
  args: { userId: v.id("users"), propertyId: v.id("properties") },
  handler: async (
    ctx,
    { userId, propertyId },
  ): Promise<{ walletAddress?: string; mint?: string }> => {
    const user = await ctx.db.get(userId);
    const property = await ctx.db.get(propertyId);
    return { walletAddress: user?.walletAddress, mint: property?.mint };
  },
});

type AttestResult =
  | { status: "attested"; signature: string; wallet: string; mint: string }
  | { status: "skipped"; reason: "no-wallet" | "no-mint" };

export const attestEligibilityOnChain = action({
  args: {
    userId: v.id("users"),
    propertyId: v.id("properties"),
    eligible: v.boolean(),
  },
  handler: async (ctx, { userId, propertyId, eligible }): Promise<AttestResult> => {
    const { walletAddress, mint } = await ctx.runQuery(
      internal.eligibilityAttest.resolveAttestTargets,
      { userId, propertyId },
    );

    // Nothing to attest without both a destination wallet and an on-chain mint. Not an error —
    // eligibility can be recorded off-chain before either exists (the mint/wallet arrive later).
    if (!walletAddress) return { status: "skipped", reason: "no-wallet" };
    if (!mint) return { status: "skipped", reason: "no-mint" };

    const signature = signSetEligibility(walletAddress, mint, eligible);
    // The real path would hand `signature` to the reconcile/confirm layer so the mirror records that
    // the attestation landed on chain; here it is a documented stub.
    return { status: "attested", signature, wallet: walletAddress, mint };
  },
});
