/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  TARGET_MATCH_TOLERANCE,
  annualizedYield,
  evaluateTarget,
  selectLatestDistribution,
  buildHistory,
} from "./income";
import { periodFor } from "./home";

// Story 5.3 — covers the Income read surface end-to-end: the pure derivation helpers (DOM-less, the
// repo's helper convention) AND the `summary` query across every I/O-matrix state via convex-test
// (matches, below-target, missed, history ordering, empty, no-holdings, unauth→null, zero-cost-basis).
// Mirrors home.test.ts / portfolio.test.ts.

const modules = import.meta.glob("./**/*.ts");

const PRIVY_ID = "did:privy:test-5-3";
const asUser = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: PRIVY_ID });

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", { privyId: PRIVY_ID, kycStatus: "verified", createdAt: Date.now() }),
  );
}

async function seedProperty(
  t: ReturnType<typeof convexTest>,
  over: Partial<{ targetNetYield: number; firstDistributionDate: string }> = {},
): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: "The Monroe",
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: over.targetNetYield ?? 0.062,
      offeringSize: 1_240_000,
      fundedPct: 0.74,
      status: "open",
      spvName: "The Monroe LLC",
      minInvestment: 50,
      firstDistributionDate: over.firstDistributionDate,
    }),
  );
}

async function seedHolding(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  propertyId: Id<"properties">,
  costBasis: number,
): Promise<Id<"holdings">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("holdings", {
      userId,
      propertyId,
      tokenAmount: costBasis,
      ownershipPct: 0.001,
      costBasis,
    }),
  );
}

async function seedIncome(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  propertyId: Id<"properties">,
  over: Partial<{
    period: string;
    grossShare: number;
    costs: number;
    mgmtFee: number;
    reserve: number;
    netPaid: number;
    status: "scheduled" | "paid" | "missed";
    paidAt: number;
  }> = {},
): Promise<Id<"incomeLedger">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("incomeLedger", {
      userId,
      propertyId,
      period: over.period ?? "2026-07",
      grossShare: over.grossShare ?? 100,
      costs: over.costs ?? 24,
      mgmtFee: over.mgmtFee ?? 8,
      reserve: over.reserve ?? 6,
      netPaid: over.netPaid ?? 62,
      status: over.status ?? "paid",
      paidAt: over.paidAt,
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe("annualizedYield — netPaid × 12 / costBasis, guarded to 0", () => {
  test("normal case", () => {
    expect(annualizedYield(62, 12_000)).toBeCloseTo(0.062);
  });
  test.each([0, -100, NaN, Infinity])("costBasis %s → 0 (never Infinity/NaN)", (basis) => {
    const y = annualizedYield(62, basis);
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBe(0);
  });
  test("non-finite netPaid → 0", () => {
    expect(annualizedYield(NaN, 12_000)).toBe(0);
  });
});

describe("evaluateTarget — matches at/above target − tolerance", () => {
  test("realized exactly at target → matches", () => {
    const e = evaluateTarget(62, 12_000, 0.062);
    expect(e.realizedYield).toBeCloseTo(0.062);
    expect(e.matchesTarget).toBe(true);
  });

  test("boundary: realized exactly at target − tolerance → matches", () => {
    // Choose costBasis so realized = target − tolerance exactly.
    const target = 0.062;
    const costBasis = 12_000;
    // realized = netPaid*12/costBasis; want realized = target - TOL.
    const netPaid = ((target - TARGET_MATCH_TOLERANCE) * costBasis) / 12;
    const e = evaluateTarget(netPaid, costBasis, target);
    expect(e.realizedYield).toBeCloseTo(target - TARGET_MATCH_TOLERANCE);
    expect(e.matchesTarget).toBe(true);
  });

  test("just below target − tolerance → below-target", () => {
    const target = 0.062;
    const costBasis = 12_000;
    const netPaid = ((target - TARGET_MATCH_TOLERANCE) * costBasis) / 12 - 1;
    expect(evaluateTarget(netPaid, costBasis, target).matchesTarget).toBe(false);
  });

  test("zero cost basis → realized 0 → below-target (never a throw)", () => {
    const e = evaluateTarget(62, 0, 0.062);
    expect(e.realizedYield).toBe(0);
    expect(e.matchesTarget).toBe(false);
  });
});

describe("selectLatestDistribution — most recent by period, then paidAt", () => {
  test("empty → null", () => {
    expect(selectLatestDistribution([])).toBeNull();
  });
  test("later period wins over an earlier one regardless of paidAt", () => {
    const rows = [
      { period: "2026-06", paidAt: 999 },
      { period: "2026-07", paidAt: 1 },
    ];
    expect(selectLatestDistribution(rows)?.period).toBe("2026-07");
  });
  test("same period → higher paidAt wins; a missing paidAt sorts oldest", () => {
    const rows = [
      { period: "2026-07", paidAt: 10 },
      { period: "2026-07", paidAt: 20 },
      { period: "2026-07" }, // no paidAt (e.g. a missed row) → never beats a paid same-period row
    ];
    expect(selectLatestDistribution(rows)?.paidAt).toBe(20);
  });
});

describe("buildHistory — most-recent-first, non-mutating", () => {
  test("orders by period desc then paidAt desc without mutating input", () => {
    const rows = [
      { period: "2026-05", paidAt: 5 },
      { period: "2026-07", paidAt: 10 },
      { period: "2026-06", paidAt: 6 },
    ];
    const snapshot = [...rows];
    const history = buildHistory(rows);
    expect(history.map((r) => r.period)).toEqual(["2026-07", "2026-06", "2026-05"]);
    expect(rows).toEqual(snapshot); // input untouched
  });
});

// ---------------------------------------------------------------------------------------------
// summary query — the I/O matrix
// ---------------------------------------------------------------------------------------------

describe("income.summary — auth-scoped reactive model", () => {
  test("unauthenticated → null (never someone else's income)", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.income.summary, {})).toBeNull();
  });

  test("authenticated but unprovisioned → null", async () => {
    const t = convexTest(schema, modules);
    expect(await asUser(t).query(api.income.summary, {})).toBeNull();
  });

  test("no holdings: provisioned, no holdings → empty, no latest", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    const res = await asUser(t).query(api.income.summary, {});
    expect(res).not.toBeNull();
    expect(res!.hasHoldings).toBe(false);
    expect(res!.latest).toBeNull();
    expect(res!.history).toEqual([]);
  });

  test("empty (no distributions): holdings but zero income → latest null, first-distribution date surfaced", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { firstDistributionDate: "2999-12-31" });
    await seedHolding(t, userId, propertyId, 12_000);

    const res = await asUser(t).query(api.income.summary, {});
    expect(res!.hasHoldings).toBe(true);
    expect(res!.latest).toBeNull();
    expect(res!.nextDistributionDate).toBe("2999-12-31");
    expect(res!.firstDistributionDate).toBe("2999-12-31");
  });

  test("matches target: paid distribution at target → matchesTarget true + full waterfall", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { targetNetYield: 0.062 });
    await seedHolding(t, userId, propertyId, 12_000);
    // netPaid 62 on 12,000 cost basis → realized 0.062 == target → matches.
    await seedIncome(t, userId, propertyId, { netPaid: 62, paidAt: Date.now() });

    const res = await asUser(t).query(api.income.summary, {});
    expect(res!.latest).not.toBeNull();
    const l = res!.latest!;
    expect(l.grossShare).toBe(100);
    expect(l.costs).toBe(24);
    expect(l.mgmtFee).toBe(8);
    expect(l.reserve).toBe(6);
    expect(l.netPaid).toBe(62);
    // waterfall invariant.
    expect(l.grossShare).toBe(l.costs + l.mgmtFee + l.reserve + l.netPaid);
    expect(l.target.matchesTarget).toBe(true);
    expect(l.target.targetYield).toBeCloseTo(0.062);
    expect(l.target.realizedYield).toBeCloseTo(0.062);
    expect(l.status).toBe("paid");
  });

  test("below target: paid distribution under target − tolerance → matchesTarget false", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { targetNetYield: 0.062 });
    await seedHolding(t, userId, propertyId, 12_000);
    // A small payout → realized well below target.
    await seedIncome(t, userId, propertyId, { netPaid: 30, paidAt: Date.now() });

    const res = await asUser(t).query(api.income.summary, {});
    expect(res!.latest!.target.matchesTarget).toBe(false);
    expect(res!.latest!.target.realizedYield).toBeLessThan(0.062);
  });

  test("missed distribution: latest status missed → still returned (banner keys off it), appears in history", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId, 12_000);
    // An earlier paid row, then a later missed row → the missed row is the latest.
    await seedIncome(t, userId, propertyId, { period: "2026-06", netPaid: 62, paidAt: Date.now() - 1 });
    await seedIncome(t, userId, propertyId, {
      period: "2026-07",
      grossShare: 0,
      costs: 0,
      mgmtFee: 0,
      reserve: 0,
      netPaid: 0,
      status: "missed",
    });

    const res = await asUser(t).query(api.income.summary, {});
    expect(res!.latest!.status).toBe("missed");
    expect(res!.latest!.period).toBe("2026-07");
    // The missed distribution still appears in history (never silent).
    expect(res!.history.map((r) => r.period)).toEqual(["2026-07", "2026-06"]);
    expect(res!.history[0].status).toBe("missed");
  });

  test("history ordering: multiple distributions → most-recent-first (month + net + status only)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId, 12_000);
    await seedIncome(t, userId, propertyId, { period: "2026-05", netPaid: 60, paidAt: 5 });
    await seedIncome(t, userId, propertyId, { period: "2026-07", netPaid: 62, paidAt: 7 });
    await seedIncome(t, userId, propertyId, { period: "2026-06", netPaid: 61, paidAt: 6 });

    const res = await asUser(t).query(api.income.summary, {});
    expect(res!.history.map((r) => r.period)).toEqual(["2026-07", "2026-06", "2026-05"]);
    expect(res!.latest!.period).toBe("2026-07");
    // History rows carry only month + net + status — no itemized waterfall fields.
    expect(Object.keys(res!.history[0]).sort()).toEqual(["netPaid", "period", "status"]);
  });

  test("zero cost basis: distribution exists but holding cost basis ≤ 0 → realized 0, below-target (no throw)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { targetNetYield: 0.062 });
    await seedHolding(t, userId, propertyId, 0);
    await seedIncome(t, userId, propertyId, { netPaid: 62, paidAt: Date.now() });

    const res = await asUser(t).query(api.income.summary, {});
    expect(res!.latest!.target.realizedYield).toBe(0);
    expect(Number.isFinite(res!.latest!.target.realizedYield)).toBe(true);
    expect(res!.latest!.target.matchesTarget).toBe(false);
  });

  test("never emits a raw txSig", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId, 12_000);
    await t.run(async (ctx) =>
      ctx.db.insert("incomeLedger", {
        userId,
        propertyId,
        period: "2026-07",
        grossShare: 100,
        costs: 24,
        mgmtFee: 8,
        reserve: 6,
        netPaid: 62,
        status: "paid",
        paidAt: Date.now(),
        txSig: "SIGNATURE_SHOULD_NEVER_LEAK",
      }),
    );

    const res = await asUser(t).query(api.income.summary, {});
    expect(JSON.stringify(res)).not.toContain("SIGNATURE_SHOULD_NEVER_LEAK");
  });
});
