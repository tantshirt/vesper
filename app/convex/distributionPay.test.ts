import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Admin Story 4.2 — FUND ESCROW + PUSH DISTRIBUTION (no self-settle). These prove the story's
// money-safety spine, not asserted:
//   • FUND BEFORE PUSH — a built draft with no escrow refuses the push; once funded + step-up, the push
//     records each holder's `txSig` but leaves every row `scheduled` — Convex does NOT self-settle;
//   • CHAIN OWNS THE PAID FLIP — the reconcile/confirm stub routes through `income.reconciled` and flips
//     the pushed rows `scheduled`→`paid`;
//   • FAILURE IS SAFE + AUDITED + RETRYABLE — a push-seam failure marks NO row paid, audits
//     `distribution.push.failed`, and a retry does not double-pay;
//   • distribution.execute-gated (platform_admin denied); the step-up stub gates the push.

afterEach(() => vi.unstubAllEnvs());

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

const PERIOD = "2026-07";

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

type StaffSeed = { workosId: string; roles: string[]; email?: string; name?: string };
async function seedStaff(t: ReturnType<typeof convexTest>, s: StaffSeed) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId: s.workosId,
      email: s.email ?? `${s.workosId}@vesper.co`,
      name: s.name ?? "Priya Desai",
      roles: s.roles as never,
      status: "active",
      createdAt: Date.now(),
    }),
  );
}

// A LISTED (open) + MINTED property — the realistic post-3-3 state a distribution runs against (the mint
// is required so the reconcile/confirm path can route by `by_mint`).
async function seedProperty(t: ReturnType<typeof convexTest>): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: "The Monroe",
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: 0.06,
      offeringSize: 1_240_000,
      fundedPct: 0.5,
      status: "open",
      spvName: "The Monroe LLC",
      minInvestment: 50,
      mint: "MINT_MONROE",
      mintStatus: "confirmed",
    }),
  );
}

// A holder WITH a wallet — the push needs a destination wallet to record a signature against.
async function seedHolder(
  t: ReturnType<typeof convexTest>,
  propertyId: Id<"properties">,
  privyId: string,
  wallet: string,
  ownershipPct: number,
  costBasis: number,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      privyId,
      kycStatus: "verified",
      walletAddress: wallet,
      createdAt: Date.now(),
    });
    await ctx.db.insert("holdings", { userId, propertyId, tokenAmount: costBasis, ownershipPct, costBasis });
    return userId;
  });
}

// A listed+minted property with two equal wallet-bearing holders, and the 4-1 draft already built
// ($900 gross − $300 costs = $600 net pool). Returns ids for assertions.
async function seedBuiltDraft(t: ReturnType<typeof convexTest>): Promise<{
  propertyId: Id<"properties">;
  u1: Id<"users">;
  u2: Id<"users">;
}> {
  await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"], name: "Priya Desai" });
  const propertyId = await seedProperty(t);
  const u1 = await seedHolder(t, propertyId, "privy_1", "WALLET_1", 0.5, 60_000);
  const u2 = await seedHolder(t, propertyId, "privy_2", "WALLET_2", 0.5, 60_000);
  await t.withIdentity(workos("user_ops1")).mutation(api.distributionBuild.buildDistribution, {
    propertyId,
    period: PERIOD,
    grossRentDollars: 900,
    costsDollars: 300,
  });
  return { propertyId, u1, u2 };
}

async function ledgerRows(t: ReturnType<typeof convexTest>, propertyId: Id<"properties">, period: string) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("incomeLedger").collect()).filter(
      (r) => r.propertyId === propertyId && r.period === period,
    ),
  );
}

describe("pushDistribution — FUND BEFORE PUSH", () => {
  test("a built draft with NO escrow refuses the push — nothing is pushed", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);

    await expect(
      t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Cannot push: fund the distribution escrow first");

    // No signature recorded, every row still scheduled.
    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "scheduled" && r.txSig === undefined)).toBe(true);
  });

  test("fundDistributionEscrow refuses when no scheduled draft was built", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"] });
    const propertyId = await seedProperty(t);

    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.fundDistributionEscrow, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("No scheduled distribution draft to fund");
  });
});

describe("pushDistribution — NO self-settle (push records txSig, leaves rows scheduled)", () => {
  test("funded + step-up push records each holder's txSig but NO row becomes paid", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);

    // Fund the escrow (B1 stub), audited.
    const funded = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });
    expect(funded.funded).toBe(true);
    expect(funded.fundedAmount).toBe(600); // the full built net pool
    const escrowAudit = (await auditRows(t)).filter((a) => a.action === "distribution.escrow.funded");
    expect(escrowAudit).toHaveLength(1);
    expect(escrowAudit[0].actor).toBe("user_ops1@vesper.co"); // the named human

    // Push — records signatures, audits distribution.pushed.
    const res = await t
      .withIdentity(workos("user_ops1"))
      .action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });
    expect(res.pushed).toBe(2);

    const rows = await ledgerRows(t, propertyId, PERIOD);
    // CRITICAL: every row carries a push signature but STAYS scheduled — Convex never self-settles.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
    expect(rows.every((r) => r.status === "paid")).toBe(false);
    expect(rows.every((r) => typeof r.txSig === "string" && r.txSig!.includes("STUB-DIST-"))).toBe(true);
    expect(rows.every((r) => r.paidAt === undefined)).toBe(true);

    const pushedAudit = (await auditRows(t)).filter((a) => a.action === "distribution.pushed");
    expect(pushedAudit).toHaveLength(1);
  });
});

describe("confirmDistributionStub — CHAIN owns the paid flip (scheduled → paid)", () => {
  test("after push, the reconcile/confirm stub flips the pushed rows to paid via income.reconciled", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });
    await t
      .withIdentity(workos("user_ops1"))
      .action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });

    // Pre-confirm: pushed but not paid.
    let rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);

    // Confirm — routes through reconcile; chain owns the flip.
    const confirm = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionPay.confirmDistributionStub, { propertyId, period: PERIOD });
    expect(confirm.confirmed).toBe(true);

    rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "paid")).toBe(true);
    expect(rows.every((r) => typeof r.paidAt === "number")).toBe(true);

    // The paid flip is owned by reconcile — audited as income.reconciled (actor "helius"), NOT the operator.
    const reconciled = (await auditRows(t)).filter((a) => a.action === "income.reconciled");
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].actor).toBe("helius");

    // Status view reflects the paid state.
    const status = await t
      .withIdentity(workos("user_ops1"))
      .query(api.distributionPay.distributionPayStatus, { propertyId, period: PERIOD });
    expect(status?.paidCount).toBe(2);
    expect(status?.pushedCount).toBe(0); // all moved past pushed → paid
    expect(status?.escrow.funded).toBe(true);
  });

  test("confirmDistributionStub refuses when nothing was pushed", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.confirmDistributionStub, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("No pushed distribution to confirm");
  });
});

describe("pushDistribution — failure is safe + audited + retryable, no double-pay", () => {
  test("a push-seam failure marks NO row paid, audits distribution.push.failed, and a retry succeeds", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });

    // Inject a seam failure (the real Privy signAndSend rejecting).
    vi.stubEnv("VESPER_STUB_DIST_PUSH_FAIL", "true");
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Distribution push seam failed");

    // No row paid, no signature recorded — the draft is untouched and retryable.
    let rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "scheduled" && r.txSig === undefined)).toBe(true);
    const failed = (await auditRows(t)).filter((a) => a.action === "distribution.push.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].actor).toBe("user_ops1@vesper.co");

    // Clear the fault and RETRY — the push now succeeds, no double-pay (rows still just scheduled+txSig).
    vi.stubEnv("VESPER_STUB_DIST_PUSH_FAIL", "");
    const res = await t
      .withIdentity(workos("user_ops1"))
      .action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });
    expect(res.pushed).toBe(2);
    rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "scheduled" && !!r.txSig)).toBe(true);
  });

  test("a re-push does NOT double-pay: rows stay scheduled, and a chain-confirmed row is never re-pushed", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });

    // First push, then a redundant second push BEFORE confirm — idempotent (same deterministic sigs).
    await t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });
    await t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });
    let rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows).toHaveLength(2); // never duplicated
    expect(rows.every((r) => r.status === "scheduled")).toBe(true); // still not self-settled

    // Confirm (chain flips paid), then a LATE push must never re-touch the paid rows.
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.confirmDistributionStub, { propertyId, period: PERIOD });
    rows = await ledgerRows(t, propertyId, PERIOD);
    const paidSigs = rows.map((r) => r.txSig);
    expect(rows.every((r) => r.status === "paid")).toBe(true);

    // With every row now chain-`paid` (nothing left scheduled), a late push refuses — it can never
    // re-pay a confirmed distribution.
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD }),
    ).rejects.toThrow("No scheduled distribution draft to push");
    rows = await ledgerRows(t, propertyId, PERIOD);
    // Paid rows are chain truth — unchanged by the late push attempt.
    expect(rows.every((r) => r.status === "paid")).toBe(true);
    expect(rows.map((r) => r.txSig)).toEqual(paidSigs);
  });
});

describe("pushDistribution — the step-up stub gates the irreversible push", () => {
  test("with step-up disabled (no flag, non-test env), a funded push is refused — nothing pushed", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });

    // Disable step-up AND stubs the way the mint tests do — via vi.stubEnv (auto-restored in afterEach).
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VESPER_ENABLE_UNSAFE_STUBS", "");

    await expect(
      t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Step-up authentication is required");

    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "scheduled" && r.txSig === undefined)).toBe(true);
  });
});

describe("distribution.execute wall — platform_admin holds no operational power", () => {
  test("platform_admin is denied fund, push, confirm, and pay-status", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Lee" });

    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.distributionPay.fundDistributionEscrow, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Not permitted: distribution.execute");

    await expect(
      t.withIdentity(workos("user_pa")).action(api.distributionPay.pushDistribution, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Not permitted: distribution.execute");

    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.distributionPay.confirmDistributionStub, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Not permitted: distribution.execute");

    await expect(
      t.withIdentity(workos("user_pa")).query(api.distributionPay.distributionPayStatus, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Not permitted: distribution.execute");
  });
});
