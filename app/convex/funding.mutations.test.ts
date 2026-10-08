import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Story 3.3 — mutation-level coverage for the funding surface (the story's real risk surface: the
// append-only ledger write, the funding.added audit, JWT auth, and balance summation across
// deposits). DOM-less; uses convex-test exactly like eligibility.mutations.test.ts. The pure amount /
// conversion / summation helpers are covered in funding.test.ts.

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const PRIVY_ID = "did:privy:test-3-3";

async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      privyId: PRIVY_ID,
      kycStatus: "verified",
      createdAt: Date.now(),
    }),
  );
}

const asUser = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: PRIVY_ID });

async function settledFundingRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("fundings").collect()).filter((f) => f.status === "settled"),
  );
}

async function auditActions(t: ReturnType<typeof convexTest>): Promise<string[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("auditLog").collect()).map((a) => a.action),
  );
}

describe("addMoney — append-only settled deposit + audit + balance", () => {
  test("valid deposit writes one settled row, audits funding.added, balance reflects it", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);

    const res = await asUser(t).mutation(api.funding.addMoney, {
      amountUsd: 500,
      method: "card",
    });
    expect(res.balance).toBe(500);
    expect(res.fundingId).toBeDefined();

    const rows = await settledFundingRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountUsd).toBe(500);
    expect(rows[0].method).toBe("card");
    expect(rows[0].status).toBe("settled");

    expect(await auditActions(t)).toContain("funding.added");

    const balance = await asUser(t).query(api.funding.getFundedBalance, {});
    expect(balance).toBe(500);
  });

  test("two deposits accumulate — balance is the running sum, two audits", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);

    await asUser(t).mutation(api.funding.addMoney, { amountUsd: 500, method: "card" });
    const second = await asUser(t).mutation(api.funding.addMoney, { amountUsd: 250, method: "ach" });
    expect(second.balance).toBe(750);

    const rows = await settledFundingRows(t);
    expect(rows).toHaveLength(2);

    const added = (await auditActions(t)).filter((a) => a === "funding.added");
    expect(added).toHaveLength(2);

    const balance = await asUser(t).query(api.funding.getFundedBalance, {});
    expect(balance).toBe(750);
  });

  test("invalid amount rejects — no row, no audit", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);

    await expect(
      asUser(t).mutation(api.funding.addMoney, { amountUsd: 49, method: "card" }),
    ).rejects.toThrow();

    expect(await settledFundingRows(t)).toHaveLength(0);
    expect(await auditActions(t)).not.toContain("funding.added");
  });

  test("non-whole-dollar amount rejects — no row, no audit", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);

    await expect(
      asUser(t).mutation(api.funding.addMoney, { amountUsd: 100.5, method: "card" }),
    ).rejects.toThrow();

    expect(await settledFundingRows(t)).toHaveLength(0);
    expect(await auditActions(t)).not.toContain("funding.added");
  });

  test("unauthenticated caller is rejected", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);

    await expect(
      t.mutation(api.funding.addMoney, { amountUsd: 500, method: "card" }),
    ).rejects.toThrow();
    expect(await settledFundingRows(t)).toHaveLength(0);
  });
});

describe("getFundedBalance — derived, 0 for a fresh user", () => {
  test("new authenticated user with no deposits → 0 (never null)", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);

    const balance = await asUser(t).query(api.funding.getFundedBalance, {});
    expect(balance).toBe(0);
  });

  test("unauthenticated → 0", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);

    const balance = await t.query(api.funding.getFundedBalance, {});
    expect(balance).toBe(0);
  });
});
