import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { writeAudit } from "./audit";
import type { Id } from "./_generated/dataModel";

const LEASE_MS = 60_000;

function distributionStubEnabled(): boolean {
  return process.env.NODE_ENV === "test" ||
    (process.env.VESPER_RUNTIME_ENV === "development" &&
      process.env.VESPER_ENABLE_DISTRIBUTION_STUB === "true");
}

function toUsdcBaseUnits(amountDollars: number): string {
  const cents = Math.round(amountDollars * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amountDollars * 100 - cents) > 1e-6 || cents <= 0) {
    throw new Error("Distribution amount must be a positive exact cent amount");
  }
  return (BigInt(cents) * 10_000n).toString();
}

function requireDistributionProvider(): void {
  if (!distributionStubEnabled()) {
    throw new Error("Distribution payout is disabled until a server-attested provider is configured");
  }
}

function payoutKey(propertyId: string, period: string, userId: string): string {
  return `distribution:${propertyId}:${period}:${userId}`;
}

function leaseToken(key: string, attempt: number, now: number): string {
  return `${key}:${attempt}:${now}`;
}

// Provider seam. The real implementation must pass `idempotencyKey` to the custody/signer provider.
// The amount is already an exact USDC base-unit integer string, so no floating-point conversion occurs
// at the provider boundary.
export function pushUsdcToHolder(
  walletAddress: string,
  amountBaseUnits: string,
  idempotencyKey: string,
): { signature: string; providerReference: string } {
  requireDistributionProvider();
  if (process.env.VESPER_STUB_DIST_PROVIDER_THROW === "true") {
    throw new Error("Distribution provider call failed after dispatch");
  }
  return {
    signature: `STUB-DIST-${walletAddress}-${amountBaseUnits}`,
    providerReference: `STUB-DIST-REF-${idempotencyKey}`,
  };
}

// Transactionally creates one durable operation per scheduled recipient. Existing operations are
// returned unchanged, which makes concurrent and repeated requests converge on the same consequence.
export const preparePayoutOperations = internalMutation({
  args: {
    propertyId: v.id("properties"),
    period: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, { propertyId, period, actor }) => {
    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .collect();

    const scheduled = rows.filter((row) => row.status === "scheduled" && row.netPaid > 0);
    let scheduledAmount = 0n;
    for (const row of scheduled) scheduledAmount += BigInt(toUsdcBaseUnits(row.netPaid));

    const escrow = await ctx.db
      .query("distributionEscrow")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .unique();
    const fundingOperation = await ctx.db
      .query("externalOperations")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", `escrow:${propertyId}:${period}`))
      .unique();
    const scheduledAmountBaseUnits = scheduledAmount.toString();
    if (!escrow || !fundingOperation || fundingOperation.kind !== "escrow_funding" ||
      (fundingOperation.status !== "submitted" && fundingOperation.status !== "reconciled") ||
      fundingOperation.providerReference !== escrow.custodyRef ||
      toUsdcBaseUnits(escrow.fundedAmount) !== scheduledAmountBaseUnits ||
      fundingOperation.amountBaseUnits !== scheduledAmountBaseUnits) {
      throw new Error("Funded escrow does not match the locked distribution draft");
    }

    const prepared: Array<{ operationId: Id<"externalOperations">; userId: Id<"users"> }> = [];
    const unresolved: Array<{ userId: Id<"users">; reason: string }> = [];
    for (const row of rows) {
      if (row.status !== "scheduled" || row.netPaid <= 0) continue;
      const user = await ctx.db.get(row.userId);
      if (!user?.walletAddress) {
        unresolved.push({ userId: row.userId, reason: "missing_wallet" });
        continue;
      }

      let amountBaseUnits: string;
      try {
        amountBaseUnits = toUsdcBaseUnits(row.netPaid);
      } catch {
        unresolved.push({ userId: row.userId, reason: "invalid_amount" });
        continue;
      }
      const idempotencyKey = payoutKey(propertyId, period, row.userId);
      let operation = await ctx.db
        .query("externalOperations")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (!operation) {
        const now = Date.now();
        const operationId = await ctx.db.insert("externalOperations", {
          kind: "distribution_payout",
          idempotencyKey,
          status: "reserved",
          actor,
          subject: `${propertyId}:${period}:${row.userId}`,
          propertyId,
          period,
          recipientUserId: row.userId,
          recipientAddress: user.walletAddress,
          amountBaseUnits,
          desiredConsequence: "transfer_usdc_to_holder",
          attemptCount: 0,
          lastCheckpoint: "reserved_before_provider_effect",
          retrySafe: true,
          createdAt: now,
          updatedAt: now,
        });
        operation = await ctx.db.get(operationId);
      }
      if (!operation) throw new Error("Failed to reserve payout operation");
      if (
        operation.amountBaseUnits !== amountBaseUnits ||
        operation.recipientAddress !== user.walletAddress ||
        operation.recipientUserId !== row.userId
      ) {
        await ctx.db.patch(operation._id, {
          status: "unknown",
          retrySafe: false,
          lastCheckpoint: "reserved_intent_mismatch_requires_reconciliation",
          lastError: "Payout subject or amount changed after reservation",
          updatedAt: Date.now(),
        });
        unresolved.push({ userId: row.userId, reason: "intent_mismatch" });
        continue;
      }
      prepared.push({ operationId: operation._id, userId: row.userId });
    }
    return { prepared, unresolved };
  },
});

export const claimPayoutOperation = internalMutation({
  args: { operationId: v.id("externalOperations") },
  handler: async (ctx, { operationId }) => {
    const operation = await ctx.db.get(operationId);
    if (!operation || operation.kind !== "distribution_payout") {
      return { execute: false as const, status: "missing" as const };
    }
    const now = Date.now();
    if (operation.status === "leased" && (operation.leaseExpiresAt ?? 0) <= now) {
      await ctx.db.patch(operationId, {
        status: "unknown",
        retrySafe: false,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        lastCheckpoint: "lease_expired_after_possible_provider_effect",
        lastError: "Worker lease expired; provider outcome requires reconciliation",
        updatedAt: now,
      });
      return { execute: false as const, status: "unknown" as const };
    }
    if (operation.status !== "reserved" && !(operation.status === "failed" && operation.retrySafe)) {
      return { execute: false as const, status: operation.status };
    }
    const attemptCount = operation.attemptCount + 1;
    const token = leaseToken(operation.idempotencyKey, attemptCount, now);
    await ctx.db.patch(operationId, {
      status: "leased",
      attemptCount,
      leaseToken: token,
      leaseExpiresAt: now + LEASE_MS,
      lastCheckpoint: "provider_call_leased",
      lastError: undefined,
      retrySafe: false,
      updatedAt: now,
    });
    return {
      execute: true as const,
      leaseToken: token,
      walletAddress: operation.recipientAddress!,
      amountBaseUnits: operation.amountBaseUnits,
      idempotencyKey: operation.idempotencyKey,
    };
  },
});

export const recordPayoutSubmitted = internalMutation({
  args: {
    operationId: v.id("externalOperations"),
    leaseToken: v.string(),
    signature: v.string(),
    providerReference: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation || operation.status !== "leased" || operation.leaseToken !== args.leaseToken) {
      throw new Error("Payout lease is no longer current");
    }
    const now = Date.now();
    await ctx.db.patch(args.operationId, {
      status: "submitted",
      submittedSignature: args.signature,
      providerReference: args.providerReference,
      submittedAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastCheckpoint: "provider_accepted_awaiting_chain_confirmation",
      retrySafe: false,
      updatedAt: now,
    });
    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) =>
        q.eq("propertyId", operation.propertyId).eq("period", operation.period!),
      )
      .collect();
    const row = rows.find((candidate) => candidate.userId === operation.recipientUserId);
    if (row && row.status !== "paid") await ctx.db.patch(row._id, { txSig: args.signature });
  },
});

export const markPayoutUnknown = internalMutation({
  args: { operationId: v.id("externalOperations"), leaseToken: v.string(), message: v.string() },
  handler: async (ctx, { operationId, leaseToken: token, message }) => {
    const operation = await ctx.db.get(operationId);
    if (!operation || operation.status !== "leased" || operation.leaseToken !== token) return;
    await ctx.db.patch(operationId, {
      status: "unknown",
      retrySafe: false,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastCheckpoint: "provider_outcome_unknown_requires_reconciliation",
      lastError: message,
      updatedAt: Date.now(),
    });
  },
});

export const applyVerifiedPayoutProviderLookup = internalMutation({
  args: {
    operationId: v.id("externalOperations"),
    recipientAddress: v.string(),
    amountBaseUnits: v.string(),
    signature: v.string(),
    providerReference: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation || operation.kind !== "distribution_payout") throw new Error("Payout operation not found");
    if (
      operation.recipientAddress !== args.recipientAddress ||
      operation.amountBaseUnits !== args.amountBaseUnits
    ) {
      throw new Error("Verified payout lookup does not match the reserved recipient and amount");
    }
    if (operation.status === "reconciled") return { status: "reconciled" as const };
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "submitted",
      submittedSignature: args.signature,
      providerReference: args.providerReference,
      submittedAt: operation.submittedAt ?? now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastCheckpoint: "verified_provider_lookup_restored_submission",
      lastError: undefined,
      retrySafe: false,
      updatedAt: now,
    });
    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) =>
        q.eq("propertyId", operation.propertyId).eq("period", operation.period!),
      )
      .collect();
    const row = rows.find((candidate) => candidate.userId === operation.recipientUserId);
    if (row && row.status !== "paid") await ctx.db.patch(row._id, { txSig: args.signature });
    return { status: "submitted" as const, signature: args.signature };
  },
});

export const runDistributionPush = internalAction({
  args: {
    propertyId: v.id("properties"),
    period: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, { propertyId, period, actor }): Promise<{
    period: string;
    pushed: number;
    alreadyHandled: number;
    unresolved: Array<{ userId: Id<"users">; reason: string }>;
  }> => {
    const batch: {
      prepared: Array<{ operationId: Id<"externalOperations">; userId: Id<"users"> }>;
      unresolved: Array<{ userId: Id<"users">; reason: string }>;
    } = await ctx.runMutation(internal.distributionPush.preparePayoutOperations, {
      propertyId,
      period,
      actor,
    });
    let pushed = 0;
    let alreadyHandled = 0;
    const unresolved: Array<{ userId: Id<"users">; reason: string }> = [...batch.unresolved];
    for (const item of batch.prepared) {
      const claim = await ctx.runMutation(internal.distributionPush.claimPayoutOperation, {
        operationId: item.operationId,
      });
      if (!claim.execute) {
        alreadyHandled += 1;
        if (claim.status === "unknown" || claim.status === "failed" || claim.status === "missing") {
          unresolved.push({ userId: item.userId, reason: `operation_${claim.status}` });
        }
        continue;
      }
      try {
        const result = pushUsdcToHolder(
          claim.walletAddress,
          claim.amountBaseUnits,
          claim.idempotencyKey,
        );
        await ctx.runMutation(internal.distributionPush.recordPayoutSubmitted, {
          operationId: item.operationId,
          leaseToken: claim.leaseToken,
          ...result,
        });
        pushed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.runMutation(internal.distributionPush.markPayoutUnknown, {
          operationId: item.operationId,
          leaseToken: claim.leaseToken,
          message,
        });
        unresolved.push({ userId: item.userId, reason: "provider_outcome_unknown" });
      }
    }
    await ctx.runMutation(internal.distributionPush.auditPushBatch, {
      propertyId,
      period,
      actor,
      pushed,
      alreadyHandled,
      unresolved: unresolved.length,
    });
    return { period, pushed, alreadyHandled, unresolved };
  },
});

export const auditPushBatch = internalMutation({
  args: {
    propertyId: v.id("properties"),
    period: v.string(),
    actor: v.string(),
    pushed: v.number(),
    alreadyHandled: v.number(),
    unresolved: v.number(),
  },
  handler: async (ctx, args) => {
    await writeAudit(ctx, {
      actor: args.actor,
      action: "distribution.pushed",
      target: args.propertyId,
      meta: {
        period: args.period,
        pushed: args.pushed,
        alreadyHandled: args.alreadyHandled,
        unresolved: args.unresolved,
      },
    });
  },
});
