import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { Keypair } from "@solana/web3.js";
import { regulatoryYear } from "./eligibility";

// recordEligibility schedules attestEligibilityOnChain via scheduler.runAfter(0) (a setTimeout under
// convex-test). Fake timers let finishAllScheduledFunctions(vi.runAllTimers) drain that job inside the
// test, instead of it firing after teardown and rejecting.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function drainScheduled(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

// Story 3.2 — mutation-level coverage for the eligibility surface (the story's real risk surface:
// the eligibility→Token-ACL mirror, idempotent upsert, and audit writes). DOM-less; uses convex-test
// exactly like reconcile.test.ts. The pure limit/jurisdiction helpers are covered in eligibility.test.ts.

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const PRIVY_ID = "did:privy:test-3-2";

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert("properties", {
      name: "The Monroe",
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: 0.062,
      offeringSize: 1_240_000,
      fundedPct: 0.74,
      status: "open",
      spvName: "The Monroe LLC",
      minInvestment: 50,
    });
    const userId = await ctx.db.insert("users", {
      privyId: PRIVY_ID,
      kycStatus: "none",
      createdAt: Date.now(),
    });
    return { propertyId, userId };
  });
}

const asUser = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: PRIVY_ID });

async function auditActions(t: ReturnType<typeof convexTest>): Promise<string[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("auditLog").collect()).map((a) => a.action),
  );
}

describe("recordEligibility — eligibility→ACL mirror + audit", () => {
  test("US applicant → eligible + thawed, cap stored, verification + ACL audited", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);

    const res = await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "United States",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    });
    expect(res).toEqual({ verified: true, eligible: true, regAAnnualLimit: 10_000 });
    await drainScheduled(t);

    const { user, elig } = await t.run(async (ctx) => ({
      user: await ctx.db.get(userId),
      elig: await ctx.db
        .query("eligibility")
        .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
        .unique(),
    }));
    expect(user?.kycStatus).toBe("verified");
    expect(user?.regAAnnualLimit).toBe(10_000);
    expect(elig?.eligible).toBe(true);
    expect(elig?.tokenAclState).toBe("thawed");

    const actions = await auditActions(t);
    expect(actions).toContain("kyc.verified");
    expect(actions).toContain("eligibility.recorded");
    expect(actions).toContain("acl.thawed");
  });

  test("restricted jurisdiction → not eligible + frozen (never eligible/thawed)", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);

    const res = await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "Somewhere else",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    });
    expect(res.eligible).toBe(false);
    await drainScheduled(t);

    const elig = await t.run(async (ctx) =>
      ctx.db
        .query("eligibility")
        .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
        .unique(),
    );
    expect(elig?.eligible).toBe(false);
    expect(elig?.tokenAclState).toBe("frozen");
    expect(await auditActions(t)).toContain("acl.frozen");
  });

  test("identity failure → kycStatus failed, no eligibility row, no thaw", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);

    const res = await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "United States",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: false,
    });
    expect(res).toEqual({ verified: false });

    const { user, elig, actions } = await t.run(async (ctx) => ({
      user: await ctx.db.get(userId),
      elig: await ctx.db
        .query("eligibility")
        .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
        .unique(),
      actions: (await ctx.db.query("auditLog").collect()).map((a) => a.action),
    }));
    expect(user?.kycStatus).toBe("failed");
    expect(elig).toBeNull();
    expect(actions).toContain("kyc.failed");
    expect(actions).not.toContain("acl.thawed");
  });

  test("failed recheck freezes every prior entitlement and versions durable revocations", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    const secondPropertyId = await t.run((ctx) =>
      ctx.db.insert("properties", {
        name: "Second",
        location: "Austin, TX",
        propertyType: "Multifamily",
        units: 2,
        targetNetYield: 0.05,
        offeringSize: 100_000,
        fundedPct: 0,
        status: "open",
        spvName: "Second LLC",
        minInvestment: 50,
      }),
    );
    await t.run(async (ctx) => {
      for (const id of [propertyId, secondPropertyId]) {
        await ctx.db.insert("eligibility", {
          userId,
          propertyId: id,
          eligible: true,
          jurisdiction: "US",
          tokenAclState: "thawed",
        });
      }
    });

    await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "US",
      annualIncome: 100_000,
      netWorth: 100_000,
      verified: false,
    });
    await drainScheduled(t);

    const result = await t.run(async (ctx) => ({
      rows: await ctx.db.query("eligibility").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      outbox: await ctx.db.query("eligibilityAttestations").collect(),
    }));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => !row.eligible && row.tokenAclState === "frozen")).toBe(true);
    expect(result.outbox).toHaveLength(2);
    expect(result.outbox.every((row) => !row.desiredEligible)).toBe(true);
  });

  test("Reg A accumulators reset only across a known UTC regulatory-year boundary", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(userId, {
        regAAnnualLimit: 9_000,
        regAInvestedThisYear: 7_000,
        regARegulatoryYear: regulatoryYear() - 1,
      }),
    );
    await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "US",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.regARegulatoryYear).toBe(regulatoryYear());
    expect(user?.regAInvestedThisYear).toBe(0);
  });

  test("legacy Reg A accumulator with no year is conservatively retained and assigned current year", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await t.run((ctx) => ctx.db.patch(userId, { regAInvestedThisYear: 7_000 }));
    await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "US",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.regARegulatoryYear).toBe(regulatoryYear());
    expect(user?.regAInvestedThisYear).toBe(7_000);
  });

  test("re-submitting identical data is idempotent — one row, no repeat eligibility/ACL audit", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    const args = {
      propertyId,
      jurisdiction: "United States",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    } as const;

    await asUser(t).mutation(api.eligibility.recordEligibility, args);
    await asUser(t).mutation(api.eligibility.recordEligibility, args);
    await drainScheduled(t);

    const { rows, recorded, thawed } = await t.run(async (ctx) => {
      const all = await ctx.db.query("auditLog").collect();
      return {
        rows: await ctx.db
          .query("eligibility")
          .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
          .collect(),
        recorded: all.filter((a) => a.action === "eligibility.recorded").length,
        thawed: all.filter((a) => a.action === "acl.thawed").length,
      };
    });
    expect(rows).toHaveLength(1);
    expect(recorded).toBe(1);
    expect(thawed).toBe(1);
  });

  test("unauthenticated caller is rejected", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seed(t);
    await expect(
      t.mutation(api.eligibility.recordEligibility, {
        propertyId,
        jurisdiction: "United States",
        annualIncome: 1,
        netWorth: 1,
        verified: true,
      }),
    ).rejects.toThrow();
  });
});

describe("eligibility attestation outbox", () => {
  test("missing wallet remains pending and wallet linking retriggers the same version", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await t.run((ctx) => ctx.db.patch(propertyId, { mint: Keypair.generate().publicKey.toBase58() }));
    await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "US",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    });
    await drainScheduled(t);
    let row = await t.run((ctx) =>
      ctx.db.query("eligibilityAttestations").withIndex("by_user_property", (q) =>
        q.eq("userId", userId).eq("propertyId", propertyId),
      ).unique(),
    );
    expect(row?.status).toBe("waiting_dependencies");
    expect(row?.desiredVersion).toBe(1);

    await asUser(t).mutation(api.users.setWalletAddress, {
      walletAddress: Keypair.generate().publicKey.toBase58(),
    });
    await drainScheduled(t);
    row = await t.run((ctx) =>
      ctx.db.query("eligibilityAttestations").withIndex("by_user_property", (q) =>
        q.eq("userId", userId).eq("propertyId", propertyId),
      ).unique(),
    );
    expect(row?.status).toBe("applied");
    expect(row?.desiredVersion).toBe(1);
    expect(row?.attemptCount).toBe(1);
    expect(row?.signature).toMatch(/^STUB-ELIG-on-/);
  });

  test("stale completion cannot overwrite a newer desired state", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    const attestationId = await t.run((ctx) =>
      ctx.db.insert("eligibilityAttestations", {
        userId,
        propertyId,
        desiredEligible: false,
        desiredVersion: 2,
        idempotencyKey: "v2",
        status: "pending",
        attemptCount: 1,
        retryEligible: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const result = await t.mutation(internal.eligibilityAttest.completeAttestation, {
      attestationId,
      expectedVersion: 1,
      expectedAttempt: 1,
      outcome: "applied",
      signature: "stale-signature",
      retryEligible: false,
    });
    expect(result).toEqual({ status: "stale" });
    const row = await t.run((ctx) =>
      ctx.db
        .query("eligibilityAttestations")
        .withIndex("by_user_property", (q) =>
          q.eq("userId", userId).eq("propertyId", propertyId),
        )
        .unique(),
    );
    expect(row?.desiredEligible).toBe(false);
    expect(row?.status).toBe("pending");
    expect(row?.signature).toBeUndefined();
  });

  test("stale same-version attempt cannot overwrite a newer lease", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    const attestationId = await t.run((ctx) =>
      ctx.db.insert("eligibilityAttestations", {
        userId,
        propertyId,
        desiredEligible: true,
        desiredVersion: 1,
        idempotencyKey: "v1",
        status: "leased",
        attemptCount: 2,
        leaseUntil: Date.now() + 60_000,
        retryEligible: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const result = await t.mutation(internal.eligibilityAttest.completeAttestation, {
      attestationId,
      expectedVersion: 1,
      expectedAttempt: 1,
      outcome: "applied",
      signature: "attempt-one",
      retryEligible: false,
    });
    expect(result).toEqual({ status: "stale" });
    const row = await t.run((ctx) => ctx.db.get(attestationId));
    expect(row?.status).toBe("leased");
    expect(row?.attemptCount).toBe(2);
  });

  test("a newer desired version waits for an older leased effect to resolve", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    const attestationId = await t.run((ctx) =>
      ctx.db.insert("eligibilityAttestations", {
        userId,
        propertyId,
        desiredEligible: true,
        desiredVersion: 1,
        idempotencyKey: `${userId}:${propertyId}:1`,
        status: "leased",
        attemptCount: 1,
        leaseUntil: Date.now() + 60_000,
        retryEligible: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    await t.mutation(internal.eligibilityAttest.enqueueAttestation, {
      userId,
      propertyId,
      eligible: false,
    });
    let row = await t.run((ctx) => ctx.db.get(attestationId));
    expect(row).toMatchObject({
      desiredEligible: false,
      desiredVersion: 2,
      status: "leased",
      idempotencyKey: `${userId}:${propertyId}:1`,
    });
    expect(
      await t.mutation(internal.eligibilityAttest.claimAttestation, {
        attestationId,
        expectedVersion: 2,
      }),
    ).toEqual({ status: "waiting_prior_effect" });

    expect(
      await t.mutation(internal.eligibilityAttest.completeAttestation, {
        attestationId,
        expectedVersion: 1,
        expectedAttempt: 1,
        outcome: "applied",
        signature: "version-one-signature",
        retryEligible: false,
      }),
    ).toEqual({ status: "superseded", outcome: "applied" });
    row = await t.run((ctx) => ctx.db.get(attestationId));
    expect(row).toMatchObject({
      desiredEligible: false,
      desiredVersion: 2,
      appliedVersion: 1,
      status: "pending",
      idempotencyKey: `${userId}:${propertyId}:2`,
    });
  });

  test("an unknown prior effect blocks a newer desired version and cannot be force-retried", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    const attestationId = await t.run((ctx) =>
      ctx.db.insert("eligibilityAttestations", {
        userId,
        propertyId,
        desiredEligible: true,
        desiredVersion: 1,
        idempotencyKey: `${userId}:${propertyId}:1`,
        status: "unknown",
        attemptCount: 1,
        signature: "possibly-submitted",
        retryEligible: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    await t.mutation(internal.eligibilityAttest.enqueueAttestation, {
      userId,
      propertyId,
      eligible: false,
      forceRetry: true,
    });
    await t.mutation(internal.eligibilityAttest.enqueueAttestation, {
      userId,
      propertyId,
      eligible: false,
      forceRetry: true,
    });
    const row = await t.run((ctx) => ctx.db.get(attestationId));
    expect(row).toMatchObject({
      desiredEligible: false,
      desiredVersion: 2,
      status: "unknown",
      idempotencyKey: `${userId}:${propertyId}:1`,
      signature: "possibly-submitted",
    });
    expect(
      await t.mutation(internal.eligibilityAttest.claimAttestation, {
        attestationId,
        expectedVersion: 2,
      }),
    ).toEqual({ status: "waiting_prior_effect" });
  });

  test("repeated identical decisions coalesce into one row and one desired version", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seed(t);
    const args = {
      propertyId,
      jurisdiction: "US",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    } as const;
    await asUser(t).mutation(api.eligibility.recordEligibility, args);
    await asUser(t).mutation(api.eligibility.recordEligibility, args);
    await drainScheduled(t);
    const rows = await t.run((ctx) => ctx.db.query("eligibilityAttestations").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].desiredVersion).toBe(1);
  });

  test("the synthetic signer fails closed outside tests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { walletAddress: Keypair.generate().publicKey.toBase58() });
      await ctx.db.patch(propertyId, { mint: Keypair.generate().publicKey.toBase58() });
    });
    await t.mutation(internal.eligibilityAttest.enqueueAttestation, {
      userId,
      propertyId,
      eligible: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const row = await t.run((ctx) =>
      ctx.db
        .query("eligibilityAttestations")
        .withIndex("by_user_property", (q) =>
          q.eq("userId", userId).eq("propertyId", propertyId),
        )
        .unique(),
    );
    expect(row?.status).toBe("failed");
    expect(row?.retryEligible).toBe(false);
    expect(row?.lastError).toBe("Eligibility signer is not configured");
  });

  test("the synthetic signer requires the development runtime and its dedicated flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_RUNTIME_ENV", "development");
    vi.stubEnv("VESPER_ENABLE_ELIGIBILITY_ATTEST_STUB", "true");
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { walletAddress: Keypair.generate().publicKey.toBase58() });
      await ctx.db.patch(propertyId, { mint: Keypair.generate().publicKey.toBase58() });
    });
    await t.mutation(internal.eligibilityAttest.enqueueAttestation, {
      userId,
      propertyId,
      eligible: true,
    });
    await drainScheduled(t);
    const row = await t.run((ctx) =>
      ctx.db
        .query("eligibilityAttestations")
        .withIndex("by_user_property", (q) =>
          q.eq("userId", userId).eq("propertyId", propertyId),
        )
        .unique(),
    );
    expect(row?.status).toBe("applied");
    expect(row?.signature).toMatch(/^STUB-ELIG-on-/);
  });
});

describe("joinWaitlist — idempotent, audited", () => {
  test("first join writes one row + audit; a repeat join is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);

    const first = await asUser(t).mutation(api.eligibility.joinWaitlist, {
      propertyId,
      jurisdiction: "Somewhere else",
    });
    const second = await asUser(t).mutation(api.eligibility.joinWaitlist, {
      propertyId,
      jurisdiction: "Somewhere else",
    });
    expect(second).toEqual(first);

    const { rows, joins } = await t.run(async (ctx) => ({
      rows: await ctx.db
        .query("waitlist")
        .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
        .collect(),
      joins: (await ctx.db.query("auditLog").collect()).filter(
        (a) => a.action === "waitlist.joined",
      ).length,
    }));
    expect(rows).toHaveLength(1);
    expect(joins).toBe(1);
  });
});
