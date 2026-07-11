import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Admin Story 4.3 — DISTRIBUTION RECONCILIATION + PAUSED-WITH-REASON. These prove the story's guarantees,
// not asserted:
//   • PAUSE IS NEVER SILENT — pauseDistribution requires a STRUCTURED reason (an empty reason is rejected
//     on the wire); it flips the period's `scheduled` rows → `missed` + pauseReason and audits
//     `distribution.paused`; it refuses a period already `paid`;
//   • A PAUSED PERIOD CANNOT BE PUSHED (4-2) until it is resumed;
//   • RESUME flips `missed`→`scheduled` (clearing the reason) and audits `distribution.resumed`;
//   • THE CONSUMER "WHY PAUSED" IS REAL — income.summary surfaces the pauseReason on the latest missed row;
//   • RECONCILE IS UNCHANGED — a pushed + confirmed distribution still reconciles to `paid` via
//     income.reconciled (reuse, not forked);
//   • distribution.execute-gated — platform_admin is denied pause AND resume (the 1-1 wall).

afterEach(() => vi.unstubAllEnvs());

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });
const asConsumer = (t: ReturnType<typeof convexTest>, privyId: string) =>
  t.withIdentity({ subject: privyId });

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

describe("pauseDistribution — never silent (structured reason required)", () => {
  test("an empty/unknown reason is rejected on the wire — nothing paused, no audit", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);

    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.pauseDistribution, {
        propertyId,
        period: PERIOD,
        // reason "" is not one of the closed set → the handler refuses before writing anything.
        reason: "",
      }),
    ).rejects.toThrow("pauseDistribution requires a valid reason");

    // The draft is untouched — every row still scheduled, no pauseReason, and no pause audit written.
    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "scheduled" && r.pauseReason === undefined)).toBe(true);
    const paused = (await auditRows(t)).filter((a) => a.action === "distribution.paused");
    expect(paused).toHaveLength(0);
  });

  test("a valid reason flips the period's scheduled rows → missed + pauseReason, audited (never silent)", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);

    const res = await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.pauseDistribution, {
      propertyId,
      period: PERIOD,
      reason: "insufficient_cash_flow",
      note: "Operator short this month; deferring.",
    });
    expect(res.paused).toBe(2);

    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "missed")).toBe(true);
    expect(rows.every((r) => r.pauseReason === "insufficient_cash_flow")).toBe(true);
    expect(rows.every((r) => r.pauseNote === "Operator short this month; deferring.")).toBe(true);

    // Audited as distribution.paused, naming the human + the structured reason.
    const paused = (await auditRows(t)).filter((a) => a.action === "distribution.paused");
    expect(paused).toHaveLength(1);
    expect(paused[0].actor).toBe("user_ops1@vesper.co");
    expect((paused[0].meta as { reason: string }).reason).toBe("insufficient_cash_flow");
  });

  test("refuses to pause a period already reconciled paid", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    // Fund → push → confirm so the period is chain-paid, then a pause must refuse.
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });
    await t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.confirmDistributionStub, { propertyId, period: PERIOD });

    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.pauseDistribution, {
        propertyId,
        period: PERIOD,
        reason: "other",
      }),
    ).rejects.toThrow("Cannot pause: distribution already paid");
  });
});

describe("a paused period cannot be pushed (4-2) until resumed", () => {
  test("push refuses a paused period; resume flips it back to scheduled and the push proceeds", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });

    // Pause — rows go missed.
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.pauseDistribution, {
      propertyId,
      period: PERIOD,
      reason: "missing_operator_numbers",
    });

    // The push refuses a paused period with the honest reason (not "un-built").
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD }),
    ).rejects.toThrow("Cannot push: distribution is paused — resume it first");
    let rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "missed" && r.txSig === undefined)).toBe(true);

    // Resume — rows flip back to scheduled, pauseReason cleared, audited.
    const resumed = await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.resumeDistribution, { propertyId, period: PERIOD });
    expect(resumed.resumed).toBe(2);
    rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "scheduled" && r.pauseReason === undefined && r.pauseNote === undefined)).toBe(true);
    const resumedAudit = (await auditRows(t)).filter((a) => a.action === "distribution.resumed");
    expect(resumedAudit).toHaveLength(1);

    // With the period resumed, the push now proceeds normally.
    const res = await t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });
    expect(res.pushed).toBe(2);
  });

  test("resumeDistribution refuses when nothing is paused", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.resumeDistribution, { propertyId, period: PERIOD }),
    ).rejects.toThrow("No paused distribution to resume");
  });
});

describe("the consumer 'why paused' income state is real", () => {
  test("after a pause, income.summary surfaces the pauseReason on the latest missed row", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);

    await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.pauseDistribution, {
      propertyId,
      period: PERIOD,
      reason: "insufficient_cash_flow",
      note: "Deferred — operator cash-flow gap.",
    });

    // The consumer (privy_1) opens Income: the latest distribution is the paused (missed) row, now
    // carrying the structured reason — the "why paused" state is real, never silent.
    const res = await asConsumer(t, "privy_1").query(api.income.summary, {});
    expect(res).not.toBeNull();
    expect(res!.latest).not.toBeNull();
    expect(res!.latest!.status).toBe("missed");
    expect(res!.latest!.period).toBe(PERIOD);
    expect(res!.latest!.pauseReason).toBe("insufficient_cash_flow");
    expect(res!.latest!.pauseNote).toBe("Deferred — operator cash-flow gap.");
    // The missed row still appears in history (month + net + status only — the reason lives on `latest`).
    expect(res!.history[0].status).toBe("missed");
    expect(Object.keys(res!.history[0]).sort()).toEqual(["netPaid", "period", "status"]);
  });
});

describe("reconcile is unchanged — a pushed + confirmed distribution still reconciles to paid", () => {
  test("fund → push → confirm flips scheduled → paid via income.reconciled (chain owns the flip)", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });
    await t.withIdentity(workos("user_ops1")).action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });
    const confirm = await t.withIdentity(workos("user_ops1")).mutation(api.distributionPay.confirmDistributionStub, { propertyId, period: PERIOD });
    expect(confirm.confirmed).toBe(true);

    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "paid")).toBe(true);
    // Owned by reconcile — audited as income.reconciled (actor "helius"), NOT the operator.
    const reconciled = (await auditRows(t)).filter((a) => a.action === "income.reconciled");
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].actor).toBe("helius");
  });
});

describe("distribution.execute wall — platform_admin holds no operational power", () => {
  test("platform_admin is denied both pause and resume", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedBuiltDraft(t);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Lee" });

    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.distributionPay.pauseDistribution, {
        propertyId,
        period: PERIOD,
        reason: "other",
      }),
    ).rejects.toThrow("Not permitted: distribution.execute");

    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.distributionPay.resumeDistribution, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Not permitted: distribution.execute");

    // No pause slipped through — every row is still scheduled.
    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
  });
});
