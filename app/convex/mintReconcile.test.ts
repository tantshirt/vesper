import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeHeliusEvent } from "./reconcile";

// Admin Story 3.3 — mint reconciliation (Helius; CHAIN WINS) — completes the gate→mint→confirm→list
// spine. These prove:
//   • a mint-confirmation event flips mintStatus minting→confirmed and audits mint.confirmed;
//   • a duplicate signature is a no-op (idempotent — no second flip/audit/row);
//   • the demo confirmMintStub routes through the real reconcile path, and after it listOffering opens;
//   • a divergent Convex value is overwritten with a logged chain.discrepancy (chain wins);
//   • reconciliationStatus surfaces unresolved/discrepancy rows, and denies a non-permitted caller;
//   • the demo confirm is mint.execute-gated (platform_admin denied).

afterEach(() => vi.unstubAllEnvs());

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

async function seedStaff(
  t: ReturnType<typeof convexTest>,
  s: { workosId: string; roles: string[]; name?: string },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId: s.workosId,
      email: `${s.workosId}@vesper.co`,
      name: s.name ?? "Priya Desai",
      roles: s.roles as never,
      status: "active",
      createdAt: Date.now(),
    }),
  );
}

// A minted property in a chosen state — seeded directly so the reconcile path can be exercised without
// re-running the whole gate ceremony (which mint.test.ts already covers end-to-end).
async function seedProperty(
  t: ReturnType<typeof convexTest>,
  opts: {
    status?: "gating" | "open";
    mint?: string | null;
    mintStatus?: "none" | "minting" | "confirmed";
  } = {},
): Promise<Id<"properties">> {
  const { status = "gating", mint = "MintMonroe111", mintStatus = "minting" } = opts;
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: "The Monroe",
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: 0.062,
      offeringSize: 1_240_000,
      fundedPct: 0,
      status,
      spvName: "The Monroe LLC",
      minInvestment: 50,
      ...(mint ? { mint } : {}),
      mintStatus,
    }),
  );
}

async function property(t: ReturnType<typeof convexTest>, propertyId: Id<"properties">) {
  return await t.run(async (ctx) => ctx.db.get(propertyId));
}

async function reconciliations(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("reconciliations").collect());
}

describe("mint_confirmed reconcile — flips minting→confirmed, audits mint.confirmed", () => {
  test("a mint-confirmation event confirms the property and writes an applied reconciliation", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t, { mint: "MintMonroe111", mintStatus: "minting" });

    const res = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint_confirmed",
      signature: "SIG-CONFIRM-1",
      mint: "MintMonroe111",
    });
    expect(res.status).toBe("applied");

    expect((await property(t, propertyId))?.mintStatus).toBe("confirmed");

    const confirmed = (await auditRows(t)).filter((a) => a.action === "mint.confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].target).toBe(propertyId);
    expect(confirmed[0].onchainRef).toBe("SIG-CONFIRM-1");

    // A normal minting→confirmed flip is NOT a divergence — no chain.discrepancy, clean reconciliation.
    expect((await auditRows(t)).filter((a) => a.action === "chain.discrepancy")).toHaveLength(0);
    const rows = await reconciliations(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("applied");
    expect(rows[0].discrepancy ?? null).toBeNull();
  });

  test("a duplicate signature is a no-op (idempotent — no second flip, audit, or row)", async () => {
    const t = convexTest(schema, modules);
    await seedProperty(t, { mint: "MintMonroe111", mintStatus: "minting" });

    await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint_confirmed",
      signature: "SIG-CONFIRM-1",
      mint: "MintMonroe111",
    });
    const again = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint_confirmed",
      signature: "SIG-CONFIRM-1",
      mint: "MintMonroe111",
    });
    expect(again.status).toBe("duplicate");

    expect((await auditRows(t)).filter((a) => a.action === "mint.confirmed")).toHaveLength(1);
    expect(await reconciliations(t)).toHaveLength(1);
  });
});

describe("confirmMintStub — routes through the real reconcile path, then listOffering opens", () => {
  test("the demo confirm flips minting→confirmed via reconcile, and the property then lists", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"] });
    const propertyId = await seedProperty(t, {
      status: "gating",
      mint: "MintMonroe111",
      mintStatus: "minting",
    });

    // Listing refuses while unconfirmed (3-2's rule, unchanged).
    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.mint.listOffering, { propertyId }),
    ).rejects.toThrow("Cannot list: the mint must be confirmed on-chain first");

    await t.withIdentity(workos("user_ops1")).mutation(api.mint.confirmMintStub, { propertyId });
    expect((await property(t, propertyId))?.mintStatus).toBe("confirmed");

    // The demo confirm went through reconcile — an applied reconciliations row + mint.confirmed audit exist.
    const rows = await reconciliations(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("applied");
    expect((await auditRows(t)).filter((a) => a.action === "mint.confirmed")).toHaveLength(1);

    // Now listing flips gating→open.
    const res = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.mint.listOffering, { propertyId });
    expect(res.status).toBe("open");
    expect((await property(t, propertyId))?.status).toBe("open");
  });

  test("confirmMintStub is idempotent — a re-run confirms once, no second reconciliation row", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"] });
    const propertyId = await seedProperty(t, { mint: "MintMonroe111", mintStatus: "minting" });

    await t.withIdentity(workos("user_ops1")).mutation(api.mint.confirmMintStub, { propertyId });
    const again = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.mint.confirmMintStub, { propertyId });
    expect(again.alreadyConfirmed).toBe(true);
    expect(await reconciliations(t)).toHaveLength(1);
    expect((await auditRows(t)).filter((a) => a.action === "mint.confirmed")).toHaveLength(1);
  });
});

describe("chain wins — a divergent Convex value is overwritten with a logged discrepancy", () => {
  test("Convex still 'none' while chain confirms → confirmed + chain.discrepancy + stamped row", async () => {
    const t = convexTest(schema, modules);
    // Convex diverged: the property carries the mint but never advanced past "none" (e.g. a rolled-back
    // recordMint), while the chain reports the mint confirmed.
    const propertyId = await seedProperty(t, { mint: "MintMonroe111", mintStatus: "none" });

    const res = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint_confirmed",
      signature: "SIG-CONFIRM-DRIFT",
      mint: "MintMonroe111",
    });
    expect(res.status).toBe("applied");
    expect((res as { discrepancy?: unknown }).discrepancy).toEqual({
      before: "none",
      after: "confirmed",
    });

    // Chain wins — the value is overwritten.
    expect((await property(t, propertyId))?.mintStatus).toBe("confirmed");

    // Both the confirmation AND the discrepancy are audited.
    const audits = await auditRows(t);
    expect(audits.filter((a) => a.action === "mint.confirmed")).toHaveLength(1);
    const drift = audits.filter((a) => a.action === "chain.discrepancy");
    expect(drift).toHaveLength(1);
    expect(drift[0].onchainRef).toBe("SIG-CONFIRM-DRIFT");

    // The reconciliations row stamps the discrepancy.
    const rows = await reconciliations(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].discrepancy).toEqual({ before: "none", after: "confirmed" });
  });
});

describe("reconciliationStatus — surfaces unresolved/discrepancy; gated read", () => {
  test("surfaces an unresolved row and a discrepancy row for a permitted caller", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"] });
    await seedProperty(t, { mint: "MintMonroe111", mintStatus: "none" });

    // A discrepancy (drift) row.
    await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint_confirmed",
      signature: "SIG-DRIFT",
      mint: "MintMonroe111",
    });
    // An unresolved row — a confirmation for a mint no property carries.
    await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint_confirmed",
      signature: "SIG-UNRESOLVED",
      mint: "MintUnknown999",
    });

    const status = await t
      .withIdentity(workos("user_ops1"))
      .query(api.mint.reconciliationStatus, {});
    expect(status.hasUnresolved).toBe(true);
    expect(status.hasDiscrepancy).toBe(true);
    expect(status.unresolvedCount).toBe(1);
    expect(status.discrepancyCount).toBe(1);
    expect(status.recent).toHaveLength(2);
  });

  test("compliance.review may read; a non-permitted caller (platform_admin) is denied", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_comp", roles: ["compliance"] });
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });

    // compliance.review is allowed.
    const status = await t
      .withIdentity(workos("user_comp"))
      .query(api.mint.reconciliationStatus, {});
    expect(status.recent).toEqual([]);

    // platform_admin holds neither mint.execute nor compliance.review → denied.
    await expect(
      t.withIdentity(workos("user_pa")).query(api.mint.reconciliationStatus, {}),
    ).rejects.toThrow("Not permitted: mint.execute or compliance.review");
  });
});

describe("real Helius path (INV3) — an ownerless property-mint event normalizes to mint_confirmed", () => {
  test("normalizeHeliusEvent promotes an ownerless mint event, and applyChainEvent confirms the mint", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t, { mint: "MintMonroe111", mintStatus: "minting" });

    // A property-mint CREATION event as Helius would deliver it: a mint-ish type naming the property mint,
    // but with NO holder (no owner, no tokenAmount) — i.e. NOT a user token transfer.
    const events = normalizeHeliusEvent([
      { type: "TOKEN_MINT", signature: "HELIUS-MINT-CREATE-1", mint: "MintMonroe111" },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("mint_confirmed"); // promoted by the ownerless-mint rule
    expect(events[0].owner).toBeUndefined();
    expect(events[0].tokenAmount).toBeUndefined();

    // Feed the normalized event through the REAL entry (applyChainEvent), not the stub.
    const res = await t.mutation(internal.reconcile.applyChainEvent, events[0]);
    expect(res.status).toBe("applied");
    expect((await property(t, propertyId))?.mintStatus).toBe("confirmed");

    const confirmed = (await auditRows(t)).filter((a) => a.action === "mint.confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].onchainRef).toBe("HELIUS-MINT-CREATE-1");

    // Idempotent by signature — re-delivering the same normalized event is a no-op (no second flip/row).
    const again = await t.mutation(internal.reconcile.applyChainEvent, events[0]);
    expect(again.status).toBe("duplicate");
    expect((await auditRows(t)).filter((a) => a.action === "mint.confirmed")).toHaveLength(1);
    expect(await reconciliations(t)).toHaveLength(1);
  });

  test("a mint event WITH a holder stays 'mint' (a user-holding reconcile), never mint_confirmed", async () => {
    // A mint event carrying an owner + tokenAmount is a holding transfer — it must NOT be promoted.
    const events = normalizeHeliusEvent([
      {
        type: "mint",
        signature: "HELIUS-HOLDING-1",
        mint: "MintMonroe111",
        owner: "Wa11etOwner1111111111111111111111111111111",
        tokenAmount: 42,
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("mint");
    expect(events[0].tokenAmount).toBe(42);
  });
});

describe("mint.execute wall — the demo confirm is operator-only", () => {
  test("platform_admin is denied confirmMintStub", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });
    const propertyId = await seedProperty(t, { mint: "MintMonroe111", mintStatus: "minting" });

    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.mint.confirmMintStub, { propertyId }),
    ).rejects.toThrow("Not permitted: mint.execute");
  });
});
