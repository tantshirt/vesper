import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Admin Story 4.1 — the DISTRIBUTION BUILDER + matches-target. These prove the story's core claims, not
// asserted:
//   • building creates `scheduled` incomeLedger rows carrying the internally-consistent gross→net
//     waterfall (grossShare = costs+mgmtFee+reserve+netPaid) — the mgmt fee is INSIDE net, never
//     re-charged (the distributed pool == grossRent − costs, the fee is NOT subtracted again);
//   • rebuilding the same period UPDATES the draft in place (never duplicates / double-counts);
//   • matchesTarget is true when the implied net yield ≈ target, false + a variance+reason otherwise —
//     and a variance SURFACES (returned), it never throws;
//   • a chain-`paid` row is authoritative — a rebuild leaves it untouched;
//   • an unlisted (gating) property refuses; a property with no holders refuses;
//   • platform_admin is DENIED distribution.execute (no operational power — 1-1's wall);
//   • NO row is ever `paid` — the builder is DRAFT-only (payment is 4-2).

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

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

async function seedProperty(
  t: ReturnType<typeof convexTest>,
  over: Partial<{ status: "gating" | "open" | "funded" | "closed"; targetNetYield: number; units: number }> = {},
): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: "The Monroe",
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: over.units ?? 8,
      targetNetYield: over.targetNetYield ?? 0.06,
      offeringSize: 1_240_000,
      fundedPct: 0.5,
      status: over.status ?? "open",
      spvName: "The Monroe LLC",
      minInvestment: 50,
    }),
  );
}

async function seedHolder(
  t: ReturnType<typeof convexTest>,
  propertyId: Id<"properties">,
  privyId: string,
  ownershipPct: number,
  costBasis: number,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      privyId,
      kycStatus: "verified",
      createdAt: Date.now(),
    });
    await ctx.db.insert("holdings", {
      userId,
      propertyId,
      tokenAmount: costBasis,
      ownershipPct,
      costBasis,
    });
    return userId;
  });
}

// A listed (open) property with TWO equal holders whose total invested basis is $120,000 and a 6.0%
// target — so a $600 monthly net pool (basis × target ÷ 12) matches the target EXACTLY.
async function seedDistributable(t: ReturnType<typeof convexTest>): Promise<{
  propertyId: Id<"properties">;
  u1: Id<"users">;
  u2: Id<"users">;
}> {
  await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"], name: "Priya Desai" });
  const propertyId = await seedProperty(t, { targetNetYield: 0.06 });
  const u1 = await seedHolder(t, propertyId, "privy_1", 0.5, 60_000);
  const u2 = await seedHolder(t, propertyId, "privy_2", 0.5, 60_000);
  return { propertyId, u1, u2 };
}

async function ledgerRows(t: ReturnType<typeof convexTest>, propertyId: Id<"properties">, period: string) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("incomeLedger").collect()).filter(
      (r) => r.propertyId === propertyId && r.period === period,
    ),
  );
}

const PERIOD = "2026-07";

describe("buildDistribution — the gross→net waterfall (mgmt fee inside net, not re-charged)", () => {
  test("writes scheduled rows whose components sum to gross, and does NOT re-charge the mgmt fee", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t);

    // Gross rent $900, operating costs $300 → net pool $600 to distribute.
    const res = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 900,
        costsDollars: 300,
      });

    expect(res.written).toBe(2);
    expect(res.updated).toBe(0);
    expect(res.poolNet).toBe(600);
    // The mgmt fee is INSIDE each holder's net waterfall — it is NOT subtracted from the pool again. So
    // the distributed net total equals grossRent − costs exactly (never grossRent − costs − mgmtFee).
    expect(res.netTotal).toBe(600);
    expect(res.netTotal).toBe(900 - 300);

    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      // Internally-consistent waterfall: grossShare = costs + mgmtFee + reserve + netPaid.
      expect(r.grossShare).toBe(r.costs + r.mgmtFee + r.reserve + r.netPaid);
      // Gross is strictly greater than net (the fee/costs/reserve live inside gross), fee is non-zero.
      expect(r.grossShare).toBeGreaterThan(r.netPaid);
      expect(r.mgmtFee).toBeGreaterThan(0);
      // DRAFT — never paid.
      expect(r.status).toBe("scheduled");
    }
    // The two equal holders split the $600 net pool evenly.
    expect(rows.reduce((s, r) => s + r.netPaid, 0)).toBe(600);
  });

  test("NO row is ever paid — the builder is draft-only (payment is 4-2)", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t);
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionBuild.buildDistribution, {
      propertyId,
      period: PERIOD,
      grossRentDollars: 900,
      costsDollars: 300,
    });
    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
    expect(rows.some((r) => r.status === "paid")).toBe(false);
    expect(rows.every((r) => r.txSig === undefined && r.paidAt === undefined)).toBe(true);
  });
});

describe("buildDistribution — idempotent rebuild (updates in place, never duplicates)", () => {
  test("rebuilding the same period updates the rows, keeping the row count constant", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t);

    const first = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 900,
        costsDollars: 300,
      });
    expect(first.written).toBe(2);
    expect(first.updated).toBe(0);
    expect(await ledgerRows(t, propertyId, PERIOD)).toHaveLength(2);

    // Rebuild with a DIFFERENT pool ($1,200 net) — same period → the two rows are UPDATED, not duplicated.
    const second = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 1200,
        costsDollars: 0,
      });
    expect(second.written).toBe(0);
    expect(second.updated).toBe(2);
    expect(second.netTotal).toBe(1200);

    const rows = await ledgerRows(t, propertyId, PERIOD);
    expect(rows).toHaveLength(2); // NEVER 4 — no duplication / double-count
    expect(rows.reduce((s, r) => s + r.netPaid, 0)).toBe(1200); // reflects the rebuilt pool
  });

  test("a chain-`paid` row is authoritative — a rebuild leaves it untouched (reconcile owns paid)", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, u1 } = await seedDistributable(t);

    // Simulate reconcile having flipped u1's row to paid at a fixed net.
    await t.run(async (ctx) =>
      ctx.db.insert("incomeLedger", {
        userId: u1,
        propertyId,
        period: PERIOD,
        grossShare: 484,
        costs: 116,
        mgmtFee: 39,
        reserve: 29,
        netPaid: 300,
        status: "paid",
        txSig: "sig_paid_u1",
        paidAt: 1_700_000_000_000,
      }),
    );

    const res = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 900,
        costsDollars: 300,
      });
    expect(res.skippedPaid).toBe(1); // u1's paid row was left untouched
    expect(res.written).toBe(1); // only u2 got a fresh scheduled row

    const rows = await ledgerRows(t, propertyId, PERIOD);
    const paid = rows.find((r) => r.status === "paid");
    expect(paid?.txSig).toBe("sig_paid_u1"); // unchanged — chain truth preserved
    expect(paid?.netPaid).toBe(300);
  });

  test("rebuild is rejected immediately once escrow funding is reserved", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t);
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionBuild.buildDistribution, {
      propertyId,
      period: PERIOD,
      grossRentDollars: 900,
      costsDollars: 300,
    });
    const before = await ledgerRows(t, propertyId, PERIOD);

    const reservation = await t.mutation(internal.distributionPay.reserveEscrowFunding, {
      propertyId,
      period: PERIOD,
      actor: "user_ops1@vesper.co",
    });
    expect(reservation.execute).toBe(true);

    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 1200,
        costsDollars: 0,
      }),
    ).rejects.toThrow("Cannot rebuild a distribution draft after escrow funding has been reserved");

    const after = await ledgerRows(t, propertyId, PERIOD);
    expect(after.map((row) => ({ id: row._id, netPaid: row.netPaid, status: row.status }))).toEqual(
      before.map((row) => ({ id: row._id, netPaid: row.netPaid, status: row.status })),
    );
    const buildAudits = await t.run(async (ctx) =>
      (await ctx.db.query("auditLog").collect()).filter((row) => row.action === "distribution.built"),
    );
    expect(buildAudits).toHaveLength(1);
  });
});

describe("buildDistribution — matches-target check", () => {
  test("matchesTarget true (+ null reason) when the implied net yield ≈ target", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t); // basis $120k, target 6.0%

    // $600 net pool = $120k × 6.0% ÷ 12 → implied annual net yield 6.0% == target.
    const res = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 900,
        costsDollars: 300,
      });
    expect(res.impliedNetYield).toBeCloseTo(0.06, 6);
    expect(res.variance).toBeCloseTo(0, 6);
    expect(res.matchesTarget).toBe(true);
    expect(res.reason).toBeNull();
  });

  test("matchesTarget false (+ a variance and reason) when net diverges — and it does NOT throw", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t); // basis $120k, target 6.0%

    // $6,000 net pool → implied annual net yield 60% — far above the 6% target.
    const res = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 6000,
        costsDollars: 0,
      });
    expect(res.matchesTarget).toBe(false);
    expect(res.variance).toBeGreaterThan(0);
    expect(res.impliedNetYield).toBeCloseTo(0.6, 6);
    expect(typeof res.reason).toBe("string");
    expect(res.reason).toContain("exceeds");
    // The variance SURFACED (no throw) and the draft was still written.
    expect(await ledgerRows(t, propertyId, PERIOD)).toHaveLength(2);
  });
});

describe("buildDistribution — gating walls", () => {
  test("an unlisted (gating) property refuses — no draft is written", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"] });
    const propertyId = await seedProperty(t, { status: "gating" });
    await seedHolder(t, propertyId, "privy_1", 1, 60_000);

    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 900,
        costsDollars: 300,
      }),
    ).rejects.toThrow(/only a listed \(open\) property/);
    expect(await ledgerRows(t, propertyId, PERIOD)).toHaveLength(0);
  });

  test("a listed property with no holders refuses", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"] });
    const propertyId = await seedProperty(t, { status: "open" });

    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 900,
      }),
    ).rejects.toThrow(/no holders/);
  });
});

describe("distribution.execute wall — platform_admin holds no operational power", () => {
  test("platform_admin is denied buildDistribution, distributionDraft, and listDistributableProperties", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Lee" });

    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.distributionBuild.buildDistribution, {
        propertyId,
        period: PERIOD,
        grossRentDollars: 900,
        costsDollars: 300,
      }),
    ).rejects.toThrow("Not permitted: distribution.execute");

    await expect(
      t.withIdentity(workos("user_pa")).query(api.distributionBuild.distributionDraft, {
        propertyId,
        period: PERIOD,
      }),
    ).rejects.toThrow("Not permitted: distribution.execute");

    await expect(
      t.withIdentity(workos("user_pa")).query(api.distributionBuild.listDistributableProperties, {}),
    ).rejects.toThrow("Not permitted: distribution.execute");
  });
});

describe("distributionDraft + listDistributableProperties — the gated read surface", () => {
  test("distributionDraft returns the built waterfall totals, net-per-unit, and matches-target", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t);
    await t.withIdentity(workos("user_ops1")).mutation(api.distributionBuild.buildDistribution, {
      propertyId,
      period: PERIOD,
      grossRentDollars: 900,
      costsDollars: 300,
    });

    const draft = await t
      .withIdentity(workos("user_ops1"))
      .query(api.distributionBuild.distributionDraft, { propertyId, period: PERIOD });
    expect(draft).not.toBeNull();
    expect(draft!.rowCount).toBe(2);
    expect(draft!.scheduledCount).toBe(2);
    expect(draft!.paidCount).toBe(0);
    expect(draft!.totals.netPaid).toBe(600);
    // Aggregate waterfall stays internally consistent across the summed rows.
    expect(draft!.totals.grossShare).toBe(
      draft!.totals.costs + draft!.totals.mgmtFee + draft!.totals.reserve + draft!.totals.netPaid,
    );
    expect(draft!.matchesTarget).toBe(true);
    expect(draft!.netPerUnit).toBeCloseTo(600 / 8, 6);
  });

  test("listDistributableProperties lists only open properties WITH holders", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedDistributable(t); // open, 2 holders

    // Noise: an open property with NO holders, and a gating property with a holder — neither qualifies.
    await seedProperty(t, { status: "open" });
    const gating = await seedProperty(t, { status: "gating" });
    await seedHolder(t, gating, "privy_g", 1, 10_000);

    const list = await t
      .withIdentity(workos("user_ops1"))
      .query(api.distributionBuild.listDistributableProperties, {});
    expect(list.map((p) => p.id)).toEqual([propertyId]);
    expect(list[0].holders).toBe(2);
  });
});
