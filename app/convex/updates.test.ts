/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { previousPeriod, isUpdateOverdue, selectLatestUpdate } from "./updates";
import { periodFor } from "./home";

// Story 5.4 — covers the Updates read surface end-to-end: the pure derivation helpers (DOM-less, the
// repo's helper convention) AND the `summary` query across every I/O-matrix state via convex-test
// (fresh, quiet, overdue, never-updated, unauth→null, no-holdings), plus `flagOverdueUpdates` (flags,
// idempotent per period, empty-safe). Mirrors income.test.ts.

const modules = import.meta.glob("./**/*.ts");

const PRIVY_ID = "did:privy:test-5-4";
const asUser = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: PRIVY_ID });

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", { privyId: PRIVY_ID, kycStatus: "verified", createdAt: Date.now() }),
  );
}

async function seedProperty(
  t: ReturnType<typeof convexTest>,
  over: Partial<{ name: string; location: string }> = {},
): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: over.name ?? "The Monroe",
      location: over.location ?? "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: 0.062,
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
): Promise<Id<"holdings">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("holdings", {
      userId,
      propertyId,
      tokenAmount: 12_000,
      ownershipPct: 0.001,
      costBasis: 12_000,
    }),
  );
}

async function seedUpdate(
  t: ReturnType<typeof convexTest>,
  propertyId: Id<"properties">,
  over: Partial<{
    period: string;
    occupancy: number;
    reservesMonths: number;
    rentOnTime: boolean;
    note: string;
    operator: string;
    publishedAt: number;
  }> = {},
): Promise<Id<"propertyUpdates">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("propertyUpdates", {
      propertyId,
      period: over.period ?? "2026-07",
      occupancy: over.occupancy ?? 0.96,
      reservesMonths: over.reservesMonths ?? 4,
      rentOnTime: over.rentOnTime ?? true,
      note: over.note ?? "A quiet, steady month. Nothing needs your attention.",
      operator: over.operator ?? "Maria Alvarez, Property Manager",
      publishedAt: over.publishedAt ?? Date.now(),
    }),
  );
}

// The current period, so a seeded update lands as not-overdue in the query tests.
const CURRENT_PERIOD = periodFor(Date.now());

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe("previousPeriod — prior month's YYYY-MM (UTC)", () => {
  test("mid-year → prior month", () => {
    expect(previousPeriod(Date.UTC(2026, 6, 15))).toBe("2026-06"); // July → June
  });
  test("January rolls back to prior December", () => {
    expect(previousPeriod(Date.UTC(2026, 0, 1))).toBe("2025-12");
  });
  test("first-of-month boundary stays in the prior month (no timezone drift)", () => {
    expect(previousPeriod(Date.UTC(2026, 2, 1))).toBe("2026-02"); // March 1 → February
  });
});

describe("isUpdateOverdue — no update for the current period", () => {
  const now = Date.UTC(2026, 6, 15); // period "2026-07"
  test("null latest (never updated) → overdue", () => {
    expect(isUpdateOverdue(null, now)).toBe(true);
  });
  test("boundary: a CURRENT-period update is NOT overdue", () => {
    expect(isUpdateOverdue("2026-07", now)).toBe(false);
  });
  test("an update from the prior period → overdue", () => {
    expect(isUpdateOverdue("2026-06", now)).toBe(true);
  });
  test("a future-dated update is not overdue", () => {
    expect(isUpdateOverdue("2026-08", now)).toBe(false);
  });
});

describe("selectLatestUpdate — most recent by period, then publishedAt", () => {
  test("empty → null", () => {
    expect(selectLatestUpdate([])).toBeNull();
  });
  test("later period wins regardless of publishedAt", () => {
    const rows = [
      { period: "2026-06", publishedAt: 999 },
      { period: "2026-07", publishedAt: 1 },
    ];
    expect(selectLatestUpdate(rows)?.period).toBe("2026-07");
  });
  test("same period → higher publishedAt wins", () => {
    const rows = [
      { period: "2026-07", publishedAt: 10 },
      { period: "2026-07", publishedAt: 30 },
      { period: "2026-07", publishedAt: 20 },
    ];
    expect(selectLatestUpdate(rows)?.publishedAt).toBe(30);
  });
});

// ---------------------------------------------------------------------------------------------
// summary query — the I/O matrix
// ---------------------------------------------------------------------------------------------

describe("updates.summary — auth-scoped reactive model", () => {
  test("unauthenticated → null (never someone else's updates)", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.updates.summary, {})).toBeNull();
  });

  test("authenticated but unprovisioned → null", async () => {
    const t = convexTest(schema, modules);
    expect(await asUser(t).query(api.updates.summary, {})).toBeNull();
  });

  test("no holdings: provisioned, owns nothing → hasHoldings false, no cards", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    const res = await asUser(t).query(api.updates.summary, {});
    expect(res).not.toBeNull();
    expect(res!.hasHoldings).toBe(false);
    expect(res!.updates).toEqual([]);
  });

  test("fresh update: held property with a current-period update → full card, overdue false", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId);
    await seedUpdate(t, propertyId, { period: CURRENT_PERIOD });

    const res = await asUser(t).query(api.updates.summary, {});
    expect(res!.hasHoldings).toBe(true);
    expect(res!.updates).toHaveLength(1);
    const card = res!.updates[0];
    expect(card.name).toBe("The Monroe");
    expect(card.location).toBe("Tampa, FL");
    expect(card.overdue).toBe(false);
    expect(card.latest).not.toBeNull();
    expect(card.latest!.operator).toBe("Maria Alvarez, Property Manager");
    expect(card.latest!.occupancy).toBe(0.96);
    expect(card.latest!.reservesMonths).toBe(4);
    expect(card.latest!.rentOnTime).toBe(true);
  });

  test("quiet month: an uneventful current-period update still renders a card, overdue false", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId);
    await seedUpdate(t, propertyId, {
      period: CURRENT_PERIOD,
      note: "Nothing to report this month — a calm, ordinary month.",
    });

    const res = await asUser(t).query(api.updates.summary, {});
    expect(res!.updates[0].overdue).toBe(false);
    expect(res!.updates[0].latest!.note).toContain("calm");
  });

  test("overdue: latest update predates the current period → overdue true, latest still present", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId);
    // A stale update from the year 2000 — always before the current period.
    await seedUpdate(t, propertyId, { period: "2000-01" });

    const res = await asUser(t).query(api.updates.summary, {});
    expect(res!.updates[0].overdue).toBe(true);
    expect(res!.updates[0].latest).not.toBeNull();
    expect(res!.updates[0].latest!.period).toBe("2000-01");
  });

  test("never updated: held property with zero updates → latest null, overdue true", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId);

    const res = await asUser(t).query(api.updates.summary, {});
    expect(res!.updates).toHaveLength(1);
    expect(res!.updates[0].latest).toBeNull();
    expect(res!.updates[0].overdue).toBe(true);
  });

  test("latest selection: the most recent period's update is the card's latest", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId);
    await seedUpdate(t, propertyId, { period: "2026-05", occupancy: 0.9 });
    await seedUpdate(t, propertyId, { period: CURRENT_PERIOD, occupancy: 0.97 });
    await seedUpdate(t, propertyId, { period: "2026-06", occupancy: 0.95 });

    const res = await asUser(t).query(api.updates.summary, {});
    expect(res!.updates[0].latest!.period).toBe(CURRENT_PERIOD);
    expect(res!.updates[0].latest!.occupancy).toBe(0.97);
  });

  test("every owned property appears (one card each), stable name order", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const a = await seedProperty(t, { name: "Zephyr Court", location: "Austin, TX" });
    const b = await seedProperty(t, { name: "Aster House", location: "Tampa, FL" });
    await seedHolding(t, userId, a);
    await seedHolding(t, userId, b);
    await seedUpdate(t, a, { period: CURRENT_PERIOD });
    // b has no update → still appears (awaiting).

    const res = await asUser(t).query(api.updates.summary, {});
    expect(res!.updates.map((c) => c.name)).toEqual(["Aster House", "Zephyr Court"]);
    expect(res!.updates.find((c) => c.name === "Aster House")!.latest).toBeNull();
  });

  test("never emits an internal-only field beyond the card shape", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const propertyId = await seedProperty(t);
    await seedHolding(t, userId, propertyId);
    await seedUpdate(t, propertyId, { period: CURRENT_PERIOD });

    const res = await asUser(t).query(api.updates.summary, {});
    expect(Object.keys(res!.updates[0]).sort()).toEqual(
      ["latest", "location", "name", "overdue", "propertyId"],
    );
  });
});

// ---------------------------------------------------------------------------------------------
// flagOverdueUpdates — the scheduled overdue flag
// ---------------------------------------------------------------------------------------------

async function overdueAudits(t: ReturnType<typeof convexTest>): Promise<Doc<"auditLog">[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("auditLog").collect()).filter(
      (a) => a.action === "propertyUpdate.overdue",
    ),
  );
}

describe("flagOverdueUpdates — scheduled overdue flag", () => {
  test("empty-safe: no properties → no throw, zero flags", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.updates.flagOverdueUpdates, {});
    expect(await overdueAudits(t)).toHaveLength(0);
  });

  test("flags an overdue (never-updated) property exactly once", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);

    await t.mutation(internal.updates.flagOverdueUpdates, {});
    const audits = await overdueAudits(t);
    expect(audits).toHaveLength(1);
    expect(audits[0].target).toBe(propertyId);
    expect((audits[0].meta as { period: string }).period).toBe(CURRENT_PERIOD);
  });

  test("does NOT flag a property with a current-period update", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedUpdate(t, propertyId, { period: CURRENT_PERIOD });

    await t.mutation(internal.updates.flagOverdueUpdates, {});
    expect(await overdueAudits(t)).toHaveLength(0);
  });

  test("idempotent per period: a second run in the same period writes no new flag", async () => {
    const t = convexTest(schema, modules);
    await seedProperty(t);

    await t.mutation(internal.updates.flagOverdueUpdates, {});
    await t.mutation(internal.updates.flagOverdueUpdates, {});
    expect(await overdueAudits(t)).toHaveLength(1);
  });

  test("flags a stale-update property (latest predates the current period)", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedUpdate(t, propertyId, { period: "2000-01" });

    await t.mutation(internal.updates.flagOverdueUpdates, {});
    const audits = await overdueAudits(t);
    expect(audits).toHaveLength(1);
    expect(audits[0].target).toBe(propertyId);
  });
});
