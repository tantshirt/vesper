import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  FRESH_WINDOW_MS,
  sumCostBasis,
  sumNetPaid,
  returnPct,
  selectFreshDistribution,
  selectNextDistributionDate,
  buildBalanceSeries,
  periodFor,
  splitDistribution,
} from "./home";

// Story 5.1 — covers the Home read surface end-to-end: the pure derivation helpers (DOM-less, the
// repo's helper convention) AND the `summary` query across every I/O-matrix state via convex-test
// (fresh, no-fresh+date, no-date fallback, empty, unauth→null, zero-value pct, paidAt window boundary),
// plus the `devSeedDistribution` CLI seed's idempotency + audit. Mirrors funding.mutations.test.ts.

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const PRIVY_ID = "did:privy:test-5-1";
const asUser = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: PRIVY_ID });

const DAY = 24 * 60 * 60 * 1000;

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

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe("sumCostBasis / sumNetPaid", () => {
  test("sumCostBasis sums costBasis, empty → 0", () => {
    expect(sumCostBasis([])).toBe(0);
    expect(sumCostBasis([{ costBasis: 1000 }, { costBasis: 250 }])).toBe(1250);
  });

  test("sumNetPaid counts PAID rows only", () => {
    expect(
      sumNetPaid([
        { netPaid: 70, status: "paid" },
        { netPaid: 30, status: "scheduled" },
        { netPaid: 5, status: "missed" },
        { netPaid: 20, status: "paid" },
      ]),
    ).toBe(90);
  });
});

describe("returnPct — guarded to 0 when value ≤ 0", () => {
  test("normal ratio", () => {
    expect(returnPct(50, 1000)).toBeCloseTo(0.05);
  });
  test.each([0, -100, NaN, Infinity])("value %d → 0 (never Infinity/NaN)", (value) => {
    const r = returnPct(100, value);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(0);
  });
});

describe("selectFreshDistribution — max paidAt within the window, else null", () => {
  const now = 1_000 * DAY;

  test("picks the most recent paid row inside the window", () => {
    const rows = [
      { status: "paid", paidAt: now - 6 * DAY, netPaid: 10 },
      { status: "paid", paidAt: now - 1 * DAY, netPaid: 20 },
    ];
    expect(selectFreshDistribution(rows, now)?.netPaid).toBe(20);
  });

  test("boundary: age exactly FRESH_WINDOW_MS still qualifies", () => {
    const rows = [{ status: "paid", paidAt: now - FRESH_WINDOW_MS, netPaid: 15 }];
    expect(selectFreshDistribution(rows, now)?.netPaid).toBe(15);
  });

  test("just past the window → null", () => {
    const rows = [{ status: "paid", paidAt: now - FRESH_WINDOW_MS - 1, netPaid: 15 }];
    expect(selectFreshDistribution(rows, now)).toBeNull();
  });

  test("rows without paidAt never qualify", () => {
    const rows = [{ status: "paid" as const, netPaid: 99 }];
    expect(selectFreshDistribution(rows, now)).toBeNull();
  });

  test("a NaN paidAt never qualifies (corrupt timestamp can't age-in forever)", () => {
    const rows = [{ status: "paid", paidAt: NaN, netPaid: 99 }];
    expect(selectFreshDistribution(rows, now)).toBeNull();
  });

  test("a zero/negative payout is never promoted to the hero", () => {
    const rows = [
      { status: "paid", paidAt: now - DAY, netPaid: 0 },
      { status: "paid", paidAt: now - DAY, netPaid: -5 },
    ];
    expect(selectFreshDistribution(rows, now)).toBeNull();
  });

  test("non-paid rows ignored", () => {
    const rows = [{ status: "scheduled", paidAt: now, netPaid: 50 }];
    expect(selectFreshDistribution(rows, now)).toBeNull();
  });
});

describe("selectNextDistributionDate — soonest date on/after today, else null", () => {
  test("soonest future date wins", () => {
    const props = [
      { firstDistributionDate: "2026-12-01" },
      { firstDistributionDate: "2026-09-15" },
    ];
    expect(selectNextDistributionDate(props, "2026-07-08")).toBe("2026-09-15");
  });
  test("a date equal to today qualifies", () => {
    expect(selectNextDistributionDate([{ firstDistributionDate: "2026-07-08" }], "2026-07-08")).toBe(
      "2026-07-08",
    );
  });
  test("all past → null", () => {
    expect(selectNextDistributionDate([{ firstDistributionDate: "2020-01-01" }], "2026-07-08")).toBeNull();
  });
  test("missing dates → null", () => {
    expect(selectNextDistributionDate([{ firstDistributionDate: undefined }], "2026-07-08")).toBeNull();
  });
});

describe("splitDistribution — internally-consistent gross→net waterfall (Story 5.3)", () => {
  test("components sum to gross EXACTLY, gross > net, for a range of net values", () => {
    for (const net of [1, 2, 3, 5, 30, 62, 100, 251, 4321]) {
      const w = splitDistribution(net);
      expect(w.netPaid).toBe(net);
      // The load-bearing invariant: grossShare === costs + mgmtFee + reserve + netPaid.
      expect(w.costs + w.mgmtFee + w.reserve + w.netPaid).toBe(w.grossShare);
      // Non-degenerate: gross exceeds net, and every deduction is non-negative.
      expect(w.grossShare).toBeGreaterThan(w.netPaid);
      expect(w.costs).toBeGreaterThanOrEqual(0);
      expect(w.mgmtFee).toBeGreaterThanOrEqual(0);
      expect(w.reserve).toBeGreaterThanOrEqual(0);
    }
  });

  test("the seed's canonical $62 payout → gross 100 / costs 24 / mgmt 8 / reserve 6", () => {
    expect(splitDistribution(62)).toEqual({
      grossShare: 100,
      costs: 24,
      mgmtFee: 8,
      reserve: 6,
      netPaid: 62,
    });
  });

  test.each([0, -5, NaN, Infinity])("non-positive/non-finite net %s → all-zero waterfall", (net) => {
    expect(splitDistribution(net)).toEqual({
      grossShare: 0,
      costs: 0,
      mgmtFee: 0,
      reserve: 0,
      netPaid: 0,
    });
  });
});

describe("buildBalanceSeries — cumulative cost basis over settled orders", () => {
  test("empty → []", () => {
    expect(buildBalanceSeries([])).toEqual([]);
  });
  test("sorts ascending by createdAt, accumulates settled only", () => {
    expect(
      buildBalanceSeries([
        { amount: 300, status: "settled", createdAt: 30 },
        { amount: 100, status: "settled", createdAt: 10 },
        { amount: 999, status: "pending", createdAt: 20 },
        { amount: 50, status: "failed", createdAt: 25 },
        { amount: 200, status: "settled", createdAt: 20 },
      ]),
    ).toEqual([100, 300, 600]);
  });
});

// ---------------------------------------------------------------------------------------------
// summary query — the I/O matrix
// ---------------------------------------------------------------------------------------------

describe("home.summary — auth-scoped reactive model", () => {
  test("unauthenticated → null (never someone else's data)", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.home.summary, {})).toBeNull();
  });

  test("authenticated but unprovisioned → null", async () => {
    const t = convexTest(schema, modules);
    expect(await asUser(t).query(api.home.summary, {})).toBeNull();
  });

  test("empty: provisioned, no holdings → calm start (income 0, no hero)", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    const res = await asUser(t).query(api.home.summary, {});
    expect(res).not.toBeNull();
    expect(res!.hasHoldings).toBe(false);
    expect(res!.portfolioValue).toBe(0);
    expect(res!.incomeToDate).toBe(0);
    expect(res!.freshDistribution).toBeNull();
    expect(res!.nextDistributionDate).toBeNull();
    expect(res!.balanceSeries).toEqual([]);
  });

  test("fresh distribution: recent paid row → hero amount + balance stats", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("holdings", {
        userId,
        propertyId,
        tokenAmount: 1000,
        ownershipPct: 0.001,
        costBasis: 1000,
      });
      await ctx.db.insert("orders", {
        userId,
        propertyId,
        amount: 1000,
        platformFee: 9,
        status: "settled",
        createdAt: Date.now() - DAY,
      });
      await ctx.db.insert("incomeLedger", {
        userId,
        propertyId,
        period: "2026-07",
        grossShare: 60,
        costs: 0,
        mgmtFee: 0,
        reserve: 0,
        netPaid: 60,
        status: "paid",
        paidAt: Date.now() - DAY,
      });
    });

    const res = await asUser(t).query(api.home.summary, {});
    expect(res!.freshDistribution).toEqual({ amount: 60 });
    expect(res!.portfolioValue).toBe(1000);
    expect(res!.incomeToDate).toBe(60);
    expect(res!.allTimeReturn).toBe(60);
    expect(res!.allTimeReturnPct).toBeCloseTo(0.06);
    expect(res!.balanceSeries).toEqual([1000]);
  });

  test("no fresh, has holdings + future date → next-distribution date, no hero", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { firstDistributionDate: "2999-12-31" });
    await t.run(async (ctx) => {
      await ctx.db.insert("holdings", {
        userId,
        propertyId,
        tokenAmount: 500,
        ownershipPct: 0.0005,
        costBasis: 500,
      });
      // A paid row OUTSIDE the freshness window — counts to income-to-date but never leads the hero.
      await ctx.db.insert("incomeLedger", {
        userId,
        propertyId,
        period: "2026-05",
        grossShare: 30,
        costs: 0,
        mgmtFee: 0,
        reserve: 0,
        netPaid: 30,
        status: "paid",
        paidAt: Date.now() - (FRESH_WINDOW_MS + DAY),
      });
    });

    const res = await asUser(t).query(api.home.summary, {});
    expect(res!.freshDistribution).toBeNull();
    expect(res!.incomeToDate).toBe(30);
    expect(res!.nextDistributionDate).toBe("2999-12-31");
  });

  test("no fresh, no upcoming date → honest fallback (nextDistributionDate null)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { firstDistributionDate: "2000-01-01" });
    await t.run(async (ctx) =>
      ctx.db.insert("holdings", {
        userId,
        propertyId,
        tokenAmount: 500,
        ownershipPct: 0.0005,
        costBasis: 500,
      }),
    );

    const res = await asUser(t).query(api.home.summary, {});
    expect(res!.hasHoldings).toBe(true);
    expect(res!.freshDistribution).toBeNull();
    expect(res!.nextDistributionDate).toBeNull();
  });

  test("zero portfolio value with income → pct 0 (never Infinity/NaN)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("holdings", {
        userId,
        propertyId,
        tokenAmount: 0,
        ownershipPct: 0,
        costBasis: 0,
      });
      await ctx.db.insert("incomeLedger", {
        userId,
        propertyId,
        period: "2026-07",
        grossShare: 100,
        costs: 0,
        mgmtFee: 0,
        reserve: 0,
        netPaid: 100,
        status: "paid",
        paidAt: Date.now(),
      });
    });

    const res = await asUser(t).query(api.home.summary, {});
    expect(res!.portfolioValue).toBe(0);
    expect(res!.incomeToDate).toBe(100);
    expect(res!.allTimeReturnPct).toBe(0);
    expect(Number.isFinite(res!.allTimeReturnPct)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// devSeedDistribution — CLI seed idempotency + audit
// ---------------------------------------------------------------------------------------------

describe("home.devSeedDistribution — idempotent per (user, property, period) + audited", () => {
  test("seeds a paid distribution for each holding, then is a no-op on re-run", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t, { targetNetYield: 0.062 });
    await t.run(async (ctx) =>
      ctx.db.insert("holdings", {
        userId,
        propertyId,
        tokenAmount: 12_000,
        ownershipPct: 0.01,
        costBasis: 12_000,
      }),
    );

    const first = await t.mutation(internal.home.devSeedDistribution, {});
    expect(first).toContain("seeded 1");

    const rows = await t.run(async (ctx) => ctx.db.query("incomeLedger").collect());
    expect(rows).toHaveLength(1);
    // netPaid = round(costBasis × targetNetYield / 12) = round(12000 × 0.062 / 12) = round(62) = 62.
    expect(rows[0].netPaid).toBe(62);
    // Story 5.3: a real itemized waterfall (gross > net; components sum to gross exactly).
    // splitDistribution(62) → gross round(62/0.62)=100, costs round(24)=24, mgmt round(8)=8, reserve rem=6.
    expect(rows[0].grossShare).toBe(100);
    expect(rows[0].costs).toBe(24);
    expect(rows[0].mgmtFee).toBe(8);
    expect(rows[0].reserve).toBe(6);
    expect(rows[0].grossShare).toBeGreaterThan(rows[0].netPaid); // non-degenerate: gross > net
    expect(rows[0].costs + rows[0].mgmtFee + rows[0].reserve + rows[0].netPaid).toBe(rows[0].grossShare);
    expect(rows[0].status).toBe("paid");
    expect(typeof rows[0].paidAt).toBe("number");
    expect(rows[0].period).toBe(periodFor(Date.now()));

    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(audits.some((a) => a.actor === "seed" && a.action === "income.seeded")).toBe(true);

    // Idempotent: a second run inserts no new row and skips the existing one.
    const second = await t.mutation(internal.home.devSeedDistribution, {});
    expect(second).toContain("skipped 1");
    const after = await t.run(async (ctx) => ctx.db.query("incomeLedger").collect());
    expect(after).toHaveLength(1);
  });

  test("the seeded distribution is picked up as fresh by summary", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await t.run(async (ctx) =>
      ctx.db.insert("holdings", {
        userId,
        propertyId,
        tokenAmount: 12_000,
        ownershipPct: 0.01,
        costBasis: 12_000,
      }),
    );

    await t.mutation(internal.home.devSeedDistribution, {});
    const res = await asUser(t).query(api.home.summary, {});
    expect(res!.freshDistribution).toEqual({ amount: 62 });
  });
});
