import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { developmentStubEnabled } from "./security";

const LEASE_MS = 60_000;
const DEPENDENCY_RETRY_MS = 5 * 60_000;

type EnqueueArgs = {
  userId: Id<"users">;
  propertyId: Id<"properties">;
  eligible: boolean;
  forceRetry?: boolean;
};

const UNRESOLVED_EFFECT_STATUSES = new Set(["leased", "submitted", "confirmed", "unknown"]);

function idempotencyKey(
  userId: Id<"users">,
  propertyId: Id<"properties">,
  version: number,
): string {
  return `${userId}:${propertyId}:${version}`;
}

function effectVersion(row: { idempotencyKey: string; desiredVersion: number }): number {
  const parsed = Number(row.idempotencyKey.slice(row.idempotencyKey.lastIndexOf(":") + 1));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : row.desiredVersion;
}

/** Atomically coalesce the desired on-chain ACL state and schedule its versioned worker. */
export async function enqueueEligibilityAttestation(
  ctx: MutationCtx,
  { userId, propertyId, eligible, forceRetry = false }: EnqueueArgs,
): Promise<Id<"eligibilityAttestations">> {
  const now = Date.now();
  const existing = await ctx.db
    .query("eligibilityAttestations")
    .withIndex("by_user_property", (q) =>
      q.eq("userId", userId).eq("propertyId", propertyId),
    )
    .unique();

  if (existing && existing.desiredEligible === eligible) {
    const terminalAndCurrent =
      existing.status === "applied" && existing.appliedVersion === existing.desiredVersion;
    const activelyLeased = existing.status === "leased" && (existing.leaseUntil ?? 0) > now;
    const unresolvedEffect = UNRESOLVED_EFFECT_STATUSES.has(existing.status);
    if (
      !terminalAndCurrent &&
      !activelyLeased &&
      !unresolvedEffect &&
      existing.retryEligible &&
      forceRetry
    ) {
      await ctx.db.patch(existing._id, {
        status: "pending",
        retryEligible: true,
        nextAttemptAt: now,
        leaseUntil: undefined,
        lastError: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.eligibilityAttest.processEligibilityAttestation, {
        attestationId: existing._id,
        expectedVersion: existing.desiredVersion,
      });
    }
    return existing._id;
  }

  const desiredVersion = (existing?.desiredVersion ?? 0) + 1;
  const desiredIdempotencyKey = idempotencyKey(userId, propertyId, desiredVersion);
  let attestationId: Id<"eligibilityAttestations">;

  if (existing) {
    attestationId = existing._id;
    if (UNRESOLVED_EFFECT_STATUSES.has(existing.status)) {
      // Keep the prior effect's status, lease, signature and idempotency key intact. Its completion
      // is allowed to advance observed chain state, but never to replace these newer desired fields.
      await ctx.db.patch(existing._id, {
        desiredEligible: eligible,
        desiredVersion,
        retryEligible: false,
        nextAttemptAt: undefined,
        updatedAt: now,
      });
      return attestationId;
    }
    await ctx.db.patch(existing._id, {
      desiredEligible: eligible,
      desiredVersion,
      idempotencyKey: desiredIdempotencyKey,
      status: "pending",
      retryEligible: true,
      nextAttemptAt: now,
      leaseUntil: undefined,
      walletAddress: undefined,
      mint: undefined,
      signature: undefined,
      lastError: undefined,
      updatedAt: now,
      submittedAt: undefined,
      confirmedAt: undefined,
      appliedAt: undefined,
    });
  } else {
    attestationId = await ctx.db.insert("eligibilityAttestations", {
      userId,
      propertyId,
      desiredEligible: eligible,
      desiredVersion,
      idempotencyKey: desiredIdempotencyKey,
      status: "pending",
      attemptCount: 0,
      retryEligible: true,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  await ctx.scheduler.runAfter(0, internal.eligibilityAttest.processEligibilityAttestation, {
    attestationId,
    expectedVersion: desiredVersion,
  });
  return attestationId;
}

export const resolveAttestTargets = internalQuery({
  args: { userId: v.id("users"), propertyId: v.id("properties") },
  handler: async (ctx, { userId, propertyId }) => {
    const user = await ctx.db.get(userId);
    const property = await ctx.db.get(propertyId);
    return { walletAddress: user?.walletAddress, mint: property?.mint };
  },
});

export const enqueueAttestation = internalMutation({
  args: {
    userId: v.id("users"),
    propertyId: v.id("properties"),
    eligible: v.boolean(),
    forceRetry: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => await enqueueEligibilityAttestation(ctx, args),
});

export const claimAttestation = internalMutation({
  args: {
    attestationId: v.id("eligibilityAttestations"),
    expectedVersion: v.number(),
  },
  handler: async (ctx, { attestationId, expectedVersion }) => {
    const row = await ctx.db.get(attestationId);
    if (!row || row.desiredVersion !== expectedVersion) return { status: "stale" as const };

    const now = Date.now();
    if (row.status === "applied" && row.appliedVersion === expectedVersion) {
      return { status: "complete" as const };
    }
    if (effectVersion(row) !== expectedVersion) {
      return { status: "waiting_prior_effect" as const };
    }
    if (row.status === "leased" && (row.leaseUntil ?? 0) > now) {
      return { status: "busy" as const };
    }
    if (UNRESOLVED_EFFECT_STATUSES.has(row.status)) {
      return { status: "waiting_prior_effect" as const };
    }

    const user = await ctx.db.get(row.userId);
    const property = await ctx.db.get(row.propertyId);
    if (!user?.walletAddress || !property?.mint) {
      const missing = !user?.walletAddress ? "wallet" : "mint";
      await ctx.db.patch(row._id, {
        status: "waiting_dependencies",
        retryEligible: true,
        nextAttemptAt: now + DEPENDENCY_RETRY_MS,
        leaseUntil: undefined,
        lastError: `Missing ${missing}`,
        updatedAt: now,
      });
      return { status: "waiting" as const, missing };
    }

    await ctx.db.patch(row._id, {
      status: "leased",
      attemptCount: row.attemptCount + 1,
      leaseUntil: now + LEASE_MS,
      nextAttemptAt: undefined,
      walletAddress: user.walletAddress,
      mint: property.mint,
      lastError: undefined,
      updatedAt: now,
    });
    return {
      status: "claimed" as const,
      userId: row.userId,
      propertyId: row.propertyId,
      eligible: row.desiredEligible,
      walletAddress: user.walletAddress,
      mint: property.mint,
      idempotencyKey: row.idempotencyKey,
      attemptNumber: row.attemptCount + 1,
    };
  },
});

export const completeAttestation = internalMutation({
  args: {
    attestationId: v.id("eligibilityAttestations"),
    expectedVersion: v.number(),
    expectedAttempt: v.number(),
    outcome: v.union(v.literal("applied"), v.literal("failed"), v.literal("unknown")),
    signature: v.optional(v.string()),
    error: v.optional(v.string()),
    retryEligible: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.attestationId);
    const completingEffectVersion = row ? effectVersion(row) : undefined;
    if (
      !row ||
      completingEffectVersion !== args.expectedVersion ||
      row.attemptCount !== args.expectedAttempt ||
      !UNRESOLVED_EFFECT_STATUSES.has(row.status)
    ) {
      return { status: "stale" as const };
    }
    const now = Date.now();
    const superseded = row.desiredVersion !== args.expectedVersion;
    const priorEffectResolved = args.outcome !== "unknown";
    const dispatchDesired = superseded && priorEffectResolved;
    await ctx.db.patch(row._id, {
      status: dispatchDesired ? "pending" : args.outcome,
      idempotencyKey: dispatchDesired
        ? idempotencyKey(row.userId, row.propertyId, row.desiredVersion)
        : row.idempotencyKey,
      signature: dispatchDesired ? undefined : args.signature,
      appliedVersion: args.outcome === "applied" ? args.expectedVersion : row.appliedVersion,
      retryEligible: dispatchDesired ? true : args.retryEligible,
      lastError: args.error,
      leaseUntil: undefined,
      nextAttemptAt: dispatchDesired
        ? now
        : args.retryEligible
          ? now + DEPENDENCY_RETRY_MS
          : undefined,
      submittedAt: args.signature ? now : row.submittedAt,
      confirmedAt: args.outcome === "applied" ? now : row.confirmedAt,
      appliedAt: args.outcome === "applied" ? now : row.appliedAt,
      updatedAt: now,
    });
    if (dispatchDesired) {
      await ctx.scheduler.runAfter(0, internal.eligibilityAttest.processEligibilityAttestation, {
        attestationId: row._id,
        expectedVersion: row.desiredVersion,
      });
      return { status: "superseded" as const, outcome: args.outcome };
    }
    return { status: args.outcome };
  },
});

function signSetEligibilityForDevelopment(
  wallet: string,
  _mint: string,
  eligible: boolean,
  idempotencyKey: string,
): string {
  if (!developmentStubEnabled("eligibilityAttestation")) {
    throw new Error("Eligibility signer is not configured");
  }
  return `STUB-ELIG-${eligible ? "on" : "off"}-${wallet.slice(0, 8)}-${idempotencyKey.slice(-8)}`;
}

export const processEligibilityAttestation = internalAction({
  args: {
    attestationId: v.id("eligibilityAttestations"),
    expectedVersion: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const claim = await ctx.runMutation(internal.eligibilityAttest.claimAttestation, args);
    if (claim.status === "waiting" && process.env.NODE_ENV !== "test") {
      await ctx.scheduler.runAfter(
        DEPENDENCY_RETRY_MS,
        internal.eligibilityAttest.processEligibilityAttestation,
        args,
      );
    }
    if (claim.status !== "claimed") return claim;

    try {
      const signature = signSetEligibilityForDevelopment(
        claim.walletAddress,
        claim.mint,
        claim.eligible,
        claim.idempotencyKey,
      );
      return await ctx.runMutation(internal.eligibilityAttest.completeAttestation, {
        ...args,
        expectedAttempt: claim.attemptNumber,
        outcome: "applied",
        signature,
        retryEligible: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Eligibility attestation failed";
      return await ctx.runMutation(internal.eligibilityAttest.completeAttestation, {
        ...args,
        expectedAttempt: claim.attemptNumber,
        outcome: "failed",
        error: message,
        retryEligible: false,
      });
    }
  },
});

// Backward-compatible scheduling entry point for existing compliance mutations. It first persists
// the desired state, then lets the durable worker own all retries and completion.
export const attestEligibilityOnChain = internalAction({
  args: {
    userId: v.id("users"),
    propertyId: v.id("properties"),
    eligible: v.boolean(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    return await ctx.runMutation(internal.eligibilityAttest.enqueueAttestation, {
      ...args,
      forceRetry: true,
    });
  },
});
