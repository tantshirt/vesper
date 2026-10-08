/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  CONCENTRATION_THRESHOLD,
  buildAllocations,
  selectConcentration,
  monthIncomeByProperty,
} from "./portfolio";
import { periodFor } from "./home";

// Story 5.2 — covers the Portfolio read surface end-to-end: the pure derivation helpers (DOM-less, the
// repo's helper convention) AND the `summary` query across every I/O-matrix state via convex-test
// (concentrated, diversified, this-month income, empty, unauth→null, zero-value, threshold boundary).
// Mirrors home.test.ts.

const modules = import.meta.glob("./**/*.ts");

const PRIVY_ID = "did:privy:test-5-2";
const asUser = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: PRIVY_ID });

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", { privyId: PRIVY_ID, kycStatus: "verified", createdAt: Date.now() }),
  );
}

async function seedProperty(
  t: ReturnType<typeof convexTest>,
  over: Partial<{ name: string; location: string; targetNetYield: number }> = {},
): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: over.name ?? "The Monroe",
      location: over.location ?? "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: over.targetNetYield ?? 0.062,
      offeringSize: 1_240_000,
      fundedPct: 0.74,
      status: "open",
      spvName: "The Monroe LLC",
      minInvestment: 50,
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

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe("buildAllocations — group by market, share = value/total, sorted desc", () => {
  test("empty → []", () => {
    expect(buildAllocations([])).toEqual([]);
  });

  test("groups by market, sums value, computes share, sorts by value desc", () => {
    const allocs = buildAllocations([
      { market: "Tampa, FL", value: 300 },
      { market: "Austin, TX", value: 600 },
      { market: "Tampa, FL", value: 100 },
    ]);
    // Tampa 300+100=400, Austin 600; total 1000; sorted by value desc → Austin first.
    expect(allocs).toEqual([
      { market: "Austin, TX", value: 600, pct: 0.6 },
      { market: "Tampa, FL", value: 400, pct: 0.4 },
    ]);
  });

  test("zero total → pct 0 (never Infinity/NaN)", () => {
    const allocs = buildAllocations([{ market: "Tampa, FL", value: 0 }]);
    expect(allocs[0].pct).toBe(0);
    expect(Number.isFinite(allocs[0].pct)).toBe(true);
  });

  test("non-finite per-position value degrades to 0", () => {
    const allocs = buildAllocations([
      { market: "Tampa, FL", value: NaN },
      { market: "Austin, TX", value: 100 },
    ]);
    const tampa = allocs.find((a) => a.market === "Tampa, FL")!;
    expect(tampa.value).toBe(0);
  });
});

describe("selectConcentration — top market strictly above the threshold, else null", () => {
  test("boundary: top share exactly 0.35 → no nudge (strictly-greater-than)", () => {
    const allocs = buildAllocations([
      { market: "A", value: 350 },
      { market: "B", value: 350 },
      { market: "C", value: 300 },
    ]);
    // top share is exactly 0.35 → not > 0.35 → null
    expect(allocs[0].pct).toBe(0.35);
    expect(selectConcentration(allocs, CONCENTRATION_THRESHOLD)).toBeNull();
  });

  test("just over: top share > 0.35 → the top market fires", () => {
    const allocs = buildAllocations([
      { market: "A", value: 360 },
      { market: "B", value: 340 },
      { market: "C", value: 300 },
    ]);
    const conc = selectConcentration(allocs, CONCENTRATION_THRESHOLD);
    expect(conc?.market).toBe("A");
    expect(conc?.pct).toBeCloseTo(0.36);
  });

  test("single market → 100% → fires", () => {
    const allocs = buildAllocations([{ market: "Tampa, FL", value: 1000 }]);
    expect(selectConcentration(allocs, CONCENTRATION_THRESHOLD)?.market).toBe("Tampa, FL");
  });

  test("two markets both over 0.35 → names the larger (single diversify nudge)", () => {
    const allocs = buildAllocations([
      { market: "A", value: 400 }, // 0.40 — over
      { market: "B", value: 360 }, // 0.36 — also over
      { market: "C", value: 240 }, // 0.24
    ]);
    const conc = selectConcentration(allocs, CONCENTRATION_THRESHOLD);
    expect(conc?.market).toBe("A");
    expect(conc?.pct).toBeCloseTo(0.4);
  });

  test("diversified: three equal markets (~33%) → null", () => {
    const allocs = buildAllocations([
      { market: "A", value: 100 },
      { market: "B", value: 100 },
      { market: "C", value: 100 },
    ]);
    expect(selectConcentration(allocs, CONCENTRATION_THRESHOLD)).toBeNull();
  });
});

describe("monthIncomeByProperty — Σ netPaid over PAID rows matching the period, keyed by property", () => {
  test("only paid + matching period count; keyed by propertyId", () => {
    const out = monthIncomeByProperty(
      [
        { propertyId: "p1", netPaid: 60, status: "paid", period: "2026-07" },
        { propertyId: "p1", netPaid: 5, status: "paid", period: "2026-07" },
        { propertyId: "p1", netPaid: 99, status: "scheduled", period: "2026-07" }, // not paid
        { propertyId: "p1", netPaid: 40, status: "paid", period: "2026-06" }, // wrong period
        { propertyId: "p2", netPaid: 30, status: "paid", period: "2026-07" },
      ],
      "2026-07",
    );
    expect(out).toEqual({ p1: 65, p2: 30 });
  });

  test("no matching rows → {}", () => {
    expect(monthIncomeByProperty([], "2026-07")).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
// summary query — the I/O matrix
// ---------------------------------------------------------------------------------------------

describe("portfolio.summary — auth-scoped reactive model", () => {
  test("unauthenticated → null (never someone else's holdings)", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.portfolio.summary, {})).toBeNull();
  });

  test("authenticated but unprovisioned → null", async () => {
    const t = convexTest(schema, modules);
    expect(await asUser(t).query(api.portfolio.summary, {})).toBeNull();
  });

  test("empty: provisioned, no holdings → calm start (no bars, no nudge)", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    const res = await asUser(t).query(api.portfolio.summary, {});
    expect(res).not.toBeNull();
    expect(res!.hasHoldings).toBe(false);
    expect(res!.holdings).toEqual([]);
    expect(res!.allocations).toEqual([]);
    expect(res!.totalValue).toBe(0);
    expect(res!.totalMonthIncome).toBe(0);
    expect(res!.concentration).toBeNull();
  });

  test("concentrated: single market → per-holding row, allocation bar, calm nudge", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { name: "The Monroe", location: "Tampa, FL" });
    await seedHolding(t, userId, propertyId, 1000);

    const res = await asUser(t).query(api.portfolio.summary, {});
    expect(res!.hasHoldings).toBe(true);
    expect(res!.holdings).toHaveLength(1);
    expect(res!.holdings[0]).toMatchObject({ name: "The Monroe", market: "Tampa, FL", value: 1000 });
    expect(res!.allocations).toEqual([{ market: "Tampa, FL", value: 1000, pct: 1 }]);
    expect(res!.concentration).toEqual({ market: "Tampa, FL", pct: 1 });
  });

  test("diversified: three markets (~33% each) → holdings + bars, NO nudge", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const pA = await seedProperty(t, { name: "A", location: "Tampa, FL" });
    const pB = await seedProperty(t, { name: "B", location: "Austin, TX" });
    const pC = await seedProperty(t, { name: "C", location: "Denver, CO" });
    await seedHolding(t, userId, pA, 1000);
    await seedHolding(t, userId, pB, 1000);
    await seedHolding(t, userId, pC, 1000);

    const res = await asUser(t).query(api.portfolio.summary, {});
    expect(res!.holdings).toHaveLength(3);
    expect(res!.allocations).toHaveLength(3);
    expect(res!.concentration).toBeNull();
  });

  test("this-month income: a paid current-period row attributes to that holding only", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const pA = await seedProperty(t, { name: "A", location: "Tampa, FL" });
    const pB = await seedProperty(t, { name: "B", location: "Austin, TX" });
    await seedHolding(t, userId, pA, 1000);
    await seedHolding(t, userId, pB, 1000);

    const period = periodFor(Date.now());
    await t.run(async (ctx) => {
      // Paid, current period, on property A → counts for A.
      await ctx.db.insert("incomeLedger", {
        userId,
        propertyId: pA,
        period,
        grossShare: 62,
        costs: 0,
        mgmtFee: 0,
        reserve: 0,
        netPaid: 62,
        status: "paid",
        paidAt: Date.now(),
      });
      // Paid but a prior period → excluded.
      await ctx.db.insert("incomeLedger", {
        userId,
        propertyId: pA,
        period: "2020-01",
        grossShare: 500,
        costs: 0,
        mgmtFee: 0,
        reserve: 0,
        netPaid: 500,
        status: "paid",
        paidAt: Date.now(),
      });
      // Current period but scheduled (not paid) on B → excluded.
      await ctx.db.insert("incomeLedger", {
        userId,
        propertyId: pB,
        period,
        grossShare: 40,
        costs: 0,
        mgmtFee: 0,
        reserve: 0,
        netPaid: 40,
        status: "scheduled",
      });
    });

    const res = await asUser(t).query(api.portfolio.summary, {});
    const rowA = res!.holdings.find((h) => h.name === "A")!;
    const rowB = res!.holdings.find((h) => h.name === "B")!;
    expect(rowA.monthIncome).toBe(62);
    expect(rowB.monthIncome).toBe(0);
    expect(res!.totalMonthIncome).toBe(62);
  });

  test("duplicate holdings for one property → one row, summed value, income counted once", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { name: "The Monroe", location: "Tampa, FL" });
    // Two holding docs for the SAME (user, property) — the schema enforces no unique index.
    await seedHolding(t, userId, propertyId, 600);
    await seedHolding(t, userId, propertyId, 400);

    const period = periodFor(Date.now());
    await t.run(async (ctx) => {
      await ctx.db.insert("incomeLedger", {
        userId,
        propertyId,
        period,
        grossShare: 50,
        costs: 0,
        mgmtFee: 0,
        reserve: 0,
        netPaid: 50,
        status: "paid",
        paidAt: Date.now(),
      });
    });

    const res = await asUser(t).query(api.portfolio.summary, {});
    // Collapsed to a single per-property row: value summed (600+400), income added exactly once.
    expect(res!.holdings).toHaveLength(1);
    expect(res!.holdings[0]).toMatchObject({ market: "Tampa, FL", value: 1000, monthIncome: 50 });
    expect(res!.totalValue).toBe(1000);
    expect(res!.totalMonthIncome).toBe(50);
    expect(res!.allocations).toEqual([{ market: "Tampa, FL", value: 1000, pct: 1 }]);
  });

  test("zero total value: Σ costBasis = 0 → pct 0, no nudge (never Infinity/NaN)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId, 0);

    const res = await asUser(t).query(api.portfolio.summary, {});
    expect(res!.hasHoldings).toBe(true);
    expect(res!.totalValue).toBe(0);
    expect(res!.allocations[0].pct).toBe(0);
    expect(Number.isFinite(res!.allocations[0].pct)).toBe(true);
    expect(res!.concentration).toBeNull();
  });
});
