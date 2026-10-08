import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { Keypair } from "@solana/web3.js";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { regulatoryYear } from "./eligibility";

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const SUBJECT = "did:privy:purchase-user";
const signature = "2".repeat(88);
const claimId = "claim-1234567890-abcdef";
const transaction = "A".repeat(64);
const blockhash = "B".repeat(44);

async function seed(t: ReturnType<typeof convexTest>, options?: { cap?: number; funding?: number }) {
  return await t.run(async (ctx) => {
    const walletAddress = Keypair.generate().publicKey.toBase58();
    const mint = Keypair.generate().publicKey.toBase58();
    const propertyId = await ctx.db.insert("properties", {
      name: "The Monroe",
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: 0.062,
      offeringSize: 1_240_000,
      fundedPct: 0,
      status: "open",
      spvName: "The Monroe LLC",
      minInvestment: 50,
      mint,
      mintStatus: "confirmed",
    });
    const userId = await ctx.db.insert("users", {
      privyId: SUBJECT,
      kycStatus: "verified",
      walletAddress,
      regAInvestedThisYear: 0,
      regAAnnualLimit: options?.cap ?? 10_000,
      regARegulatoryYear: regulatoryYear(),
      createdAt: Date.now(),
    });
    await ctx.db.insert("eligibility", {
      userId,
      propertyId,
      eligible: true,
      jurisdiction: "United States",
      tokenAclState: "thawed",
    });
    await ctx.db.insert("eligibilityAttestations", {
      userId,
      propertyId,
      desiredEligible: true,
      desiredVersion: 1,
      idempotencyKey: `eligibility:${userId}:${propertyId}:1`,
      status: "applied",
      attemptCount: 1,
      walletAddress,
      mint,
      appliedVersion: 1,
      retryEligible: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      appliedAt: Date.now(),
    });
    await ctx.db.insert("fundings", {
      userId,
      amountUsd: options?.funding ?? 1_000,
      method: "ach",
      status: "settled",
      createdAt: Date.now(),
    });
    return { propertyId, userId, walletAddress, mint };
  });
}

function verifiedArgs(propertyId: Awaited<ReturnType<typeof seed>>["propertyId"]) {
  return {
    propertyId,
    amountUsd: 100,
    acknowledgedRiskIds: ["illiquidity", "loss", "not-insured"],
    teachBackOwnership: "spv-ownership",
    teachBackLiquidity: "buyer-dependent-resale",
    subject: SUBJECT,
    propertyMint: "",
    tokenAmountRaw: "2",
    principalBaseUnits: "100000000",
    platformFeeBaseUnits: "900000",
    totalBaseUnits: "100900000",
  };
}

async function issueAuthorization(
  t: ReturnType<typeof convexTest>,
  operationId: Id<"orders">,
) {
  const user = t.withIdentity({ subject: SUBJECT });
  const claimed = await user.mutation(api.settlement.claimPurchaseAuthorization, {
    operationId,
    claimId,
  });
  expect(claimed.status).toBe("claimed");
  return await user.mutation(api.settlement.finalizePurchaseAuthorization, {
    operationId,
    claimId,
    transaction,
    blockhash,
    lastValidBlockHeight: 500,
    chain: "solana:devnet",
  });
}

describe("durable purchase operations", () => {
  test("stores the exact live quote and deduplicates prepare clicks", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const args = { ...verifiedArgs(seeded.propertyId), propertyMint: seeded.mint };
    const first = await t.mutation(internal.settlement.preparePurchaseVerified, args);
    const second = await t.mutation(internal.settlement.preparePurchaseVerified, args);
    expect(second.operationId).toBe(first.operationId);
    expect(first).toMatchObject({
      amountUsd: 100,
      platformFeeUsd: 0.9,
      tokenAmountRaw: "2",
      principalBaseUnits: "100000000",
      platformFeeBaseUnits: "900000",
      totalBaseUnits: "100900000",
      status: "prepared",
    });
  });

  test("rejects consent and cap bypasses before creating an order", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, { cap: 99 });
    const args = { ...verifiedArgs(seeded.propertyId), propertyMint: seeded.mint };
    await expect(t.mutation(internal.settlement.preparePurchaseVerified, args)).rejects.toThrow(
      "Annual investment limit exceeded",
    );
    await expect(t.mutation(internal.settlement.preparePurchaseVerified, {
      ...args,
      acknowledgedRiskIds: ["illiquidity", "loss"],
    })).rejects.toThrow("Risk consent required");
    expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(0);
  });

  test("submission is idempotent, conflicting references fail, and reload restores unknown outcome", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const operation = await t.mutation(internal.settlement.preparePurchaseVerified, {
      ...verifiedArgs(seeded.propertyId),
      propertyMint: seeded.mint,
    });
    const user = t.withIdentity({ subject: SUBJECT });
    await issueAuthorization(t, operation.operationId);
    await user.mutation(api.settlement.recordPurchaseSubmitted, { operationId: operation.operationId, signature });
    await user.mutation(api.settlement.recordPurchaseSubmitted, { operationId: operation.operationId, signature });
    await expect(user.mutation(api.settlement.recordPurchaseSubmitted, {
      operationId: operation.operationId,
      signature: "3".repeat(88),
    })).rejects.toThrow("another signature");
    await user.mutation(api.settlement.markPurchaseOutcomeUnknown, {
      operationId: operation.operationId,
      signature,
      reason: "rpc timeout",
    });
    const restored = await user.query(api.settlement.getActivePurchase, { propertyId: seeded.propertyId });
    expect(restored).toMatchObject({ operationId: operation.operationId, status: "outcome_unknown", signature });
    await expect(
      user.mutation(api.settlement.acknowledgeCompletedPurchase, {
        operationId: operation.operationId,
      }),
    ).rejects.toThrow("Only a completed purchase");
  });

  test("verified evidence completes once and never double-counts the annual cap", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const operation = await t.mutation(internal.settlement.preparePurchaseVerified, {
      ...verifiedArgs(seeded.propertyId),
      propertyMint: seeded.mint,
    });
    const user = t.withIdentity({ subject: SUBJECT });
    await issueAuthorization(t, operation.operationId);
    await user.mutation(api.settlement.recordPurchaseSubmitted, { operationId: operation.operationId, signature });
    const evidence = {
      operationId: operation.operationId,
      signature,
      slot: 42,
      mirrorComplete: true,
    };
    await t.mutation(internal.settlement.recordVerifiedPurchaseEvidence, evidence);
    await t.mutation(internal.settlement.recordVerifiedPurchaseEvidence, evidence);
    const result = await t.run(async (ctx) => ({
      user: await ctx.db.get(seeded.userId),
      order: await ctx.db.get(operation.operationId),
    }));
    expect(result.user?.regAInvestedThisYear).toBe(100);
    expect(result.order).toMatchObject({ status: "complete", chainSlot: 42, dvpTxSig: signature });

    await user.mutation(api.settlement.acknowledgeCompletedPurchase, {
      operationId: operation.operationId,
    });
    expect(
      await user.query(api.settlement.getActivePurchase, { propertyId: seeded.propertyId }),
    ).toBeNull();
    const repeat = await t.mutation(internal.settlement.preparePurchaseVerified, {
      ...verifiedArgs(seeded.propertyId),
      propertyMint: seeded.mint,
    });
    expect(repeat.operationId).not.toBe(operation.operationId);
    expect(repeat.status).toBe("prepared");
  });

  test("issues one immutable authorization and reuses it on later requests", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const operation = await t.mutation(internal.settlement.preparePurchaseVerified, {
      ...verifiedArgs(seeded.propertyId),
      propertyMint: seeded.mint,
    });
    const user = t.withIdentity({ subject: SUBJECT });
    const firstClaim = await user.mutation(api.settlement.claimPurchaseAuthorization, {
      operationId: operation.operationId,
      claimId,
    });
    expect(firstClaim.status).toBe("claimed");
    const concurrent = await user.mutation(api.settlement.claimPurchaseAuthorization, {
      operationId: operation.operationId,
      claimId: "claim-concurrent-123456",
    });
    expect(concurrent.status).toBe("in_progress");
    const issued = await user.mutation(api.settlement.finalizePurchaseAuthorization, {
      operationId: operation.operationId,
      claimId,
      transaction,
      blockhash,
      lastValidBlockHeight: 500,
      chain: "solana:devnet",
    });
    const replay = await user.mutation(api.settlement.claimPurchaseAuthorization, {
      operationId: operation.operationId,
      claimId: "claim-later-1234567890",
    });
    expect(replay).toMatchObject(issued);
    await expect(user.mutation(api.settlement.markPurchaseFailedSafe, {
      operationId: operation.operationId,
      reason: "buyer cancelled",
    })).rejects.toThrow("cannot be marked safe to retry");
  });

  test("active same-year orders reserve regulatory headroom across properties", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t, { cap: 150, funding: 1_000 });
    const second = await t.run(async (ctx) => {
      const mint = Keypair.generate().publicKey.toBase58();
      const propertyId = await ctx.db.insert("properties", {
        name: "The Franklin",
        location: "Austin, TX",
        propertyType: "Multifamily",
        units: 10,
        targetNetYield: 0.06,
        offeringSize: 1_000_000,
        fundedPct: 0,
        status: "open",
        spvName: "The Franklin LLC",
        minInvestment: 50,
        mint,
        mintStatus: "confirmed",
      });
      await ctx.db.insert("eligibility", {
        userId: seeded.userId,
        propertyId,
        eligible: true,
        jurisdiction: "United States",
        tokenAclState: "thawed",
      });
      await ctx.db.insert("eligibilityAttestations", {
        userId: seeded.userId,
        propertyId,
        desiredEligible: true,
        desiredVersion: 1,
        idempotencyKey: `eligibility:${seeded.userId}:${propertyId}:1`,
        status: "applied",
        attemptCount: 1,
        walletAddress: seeded.walletAddress,
        mint,
        appliedVersion: 1,
        retryEligible: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        appliedAt: Date.now(),
      });
      return { propertyId, mint };
    });
    await t.mutation(internal.settlement.preparePurchaseVerified, {
      ...verifiedArgs(seeded.propertyId),
      propertyMint: seeded.mint,
    });
    await expect(t.mutation(internal.settlement.preparePurchaseVerified, {
      ...verifiedArgs(second.propertyId),
      propertyMint: second.mint,
    })).rejects.toThrow("Annual investment limit exceeded");
  });

  test("verified expiry requires height beyond the stored validity window", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const operation = await t.mutation(internal.settlement.preparePurchaseVerified, {
      ...verifiedArgs(seeded.propertyId),
      propertyMint: seeded.mint,
    });
    await issueAuthorization(t, operation.operationId);
    const user = t.withIdentity({ subject: SUBJECT });
    await user.mutation(api.settlement.recordPurchaseSubmitted, {
      operationId: operation.operationId,
      signature,
    });
    await expect(t.mutation(internal.settlement.recordVerifiedPurchaseExpiry, {
      operationId: operation.operationId,
      signature,
      observedBlockHeight: 500,
    })).rejects.toThrow("not proven");
    await t.mutation(internal.settlement.recordVerifiedPurchaseExpiry, {
      operationId: operation.operationId,
      signature,
      observedBlockHeight: 501,
    });
    const order = await t.run((ctx) => ctx.db.get(operation.operationId));
    expect(order).toMatchObject({ status: "expired", failureCode: "blockhash_expired" });
  });

  test("late prior-year confirmation does not overwrite the current-year accumulator", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const operation = await t.mutation(internal.settlement.preparePurchaseVerified, {
      ...verifiedArgs(seeded.propertyId),
      propertyMint: seeded.mint,
    });
    const currentYear = regulatoryYear();
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.userId, {
        regAInvestedThisYear: 200,
        regARegulatoryYear: currentYear,
        regAInvestedByYear: [{ year: currentYear, amount: 200 }],
      });
      await ctx.db.patch(operation.operationId, { regulatoryYear: currentYear - 1 });
    });
    await issueAuthorization(t, operation.operationId);
    const user = t.withIdentity({ subject: SUBJECT });
    await user.mutation(api.settlement.recordPurchaseSubmitted, { operationId: operation.operationId, signature });
    await t.mutation(internal.settlement.recordVerifiedPurchaseEvidence, {
      operationId: operation.operationId,
      signature,
      slot: 99,
      mirrorComplete: true,
    });
    const updated = await t.run((ctx) => ctx.db.get(seeded.userId));
    expect(updated?.regARegulatoryYear).toBe(currentYear);
    expect(updated?.regAInvestedThisYear).toBe(200);
    expect(updated?.regAInvestedByYear).toEqual([
      { year: currentYear - 1, amount: 100 },
      { year: currentYear, amount: 200 },
    ]);
  });
});
