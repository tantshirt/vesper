import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

// The httpAction reads process.env.HELIUS_WEBHOOK_SECRET at request time; set it before any request.
const SECRET = "test-secret";
process.env.HELIUS_WEBHOOK_SECRET = SECRET;

// Passing the glob explicitly makes convex-test's module discovery deterministic. `import.meta.glob`
// is a vitest/Vite construct; cast since the Convex tsconfig has no vite/client types.
const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const MINT = "MintAddr111111111111111111111111111111111111";
const WALLET = "Wa11etAddr1111111111111111111111111111111111";

async function seedPropertyAndUser(t: ReturnType<typeof convexTest>) {
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
      mint: MINT,
    });
    const userId = await ctx.db.insert("users", {
      privyId: "did:privy:test",
      kycStatus: "verified",
      walletAddress: WALLET,
      createdAt: Date.now(),
    });
    return { propertyId, userId };
  });
}

describe("E1.3 reconciliation", () => {
  // ROW: Mint event — known property + user → holding upserted, holding.reconciled audit, applied row.
  test("mint event applies chain balance and audits", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seedPropertyAndUser(t);

    const res = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint",
      signature: "sig-mint-1",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 100,
    });
    expect(res.status).toBe("applied");

    const holding = await t.run(async (ctx) =>
      (await ctx.db.query("holdings").collect()).find((h) => h.userId === userId)
    );
    expect(holding?.tokenAmount).toBe(100);
    expect(holding?.propertyId).toBe(propertyId);

    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(audits.some((a) => a.actor === "helius" && a.action === "holding.reconciled")).toBe(true);

    const recon = await t.run(async (ctx) =>
      ctx.db
        .query("reconciliations")
        .withIndex("by_signature", (q) => q.eq("signature", "sig-mint-1"))
        .unique()
    );
    expect(recon?.status).toBe("applied");
    expect(recon?.discrepancy).toBeUndefined();
  });

  // ROW: Transfer w/ conflict — post-transfer balance differs from Convex → overwrite + discrepancy.
  test("transfer with conflict overwrites Convex and records {before,after}", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seedPropertyAndUser(t);
    await t.run(async (ctx) =>
      ctx.db.insert("holdings", {
        userId,
        propertyId,
        tokenAmount: 100,
        ownershipPct: 0.01,
        costBasis: 1000,
      })
    );

    const res = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-transfer-1",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 60, // chain says 60, Convex had 100
    });
    expect(res.status).toBe("applied");
    expect((res as { discrepancy?: unknown }).discrepancy).toEqual({ before: 100, after: 60 });

    const holding = await t.run(async (ctx) =>
      (await ctx.db.query("holdings").collect()).find((h) => h.userId === userId)
    );
    expect(holding?.tokenAmount).toBe(60); // chain won
    expect(holding?.costBasis).toBe(1000); // Convex intent untouched

    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(audits.some((a) => a.actor === "helius" && a.action === "chain.discrepancy")).toBe(true);

    const recon = await t.run(async (ctx) =>
      ctx.db
        .query("reconciliations")
        .withIndex("by_signature", (q) => q.eq("signature", "sig-transfer-1"))
        .unique()
    );
    expect(recon?.discrepancy).toEqual({ before: 100, after: 60 });
  });

  // ROW: Distribution event — matching incomeLedger rows → status paid + txSig, income.reconciled.
  test("distribution marks matching incomeLedger rows paid", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seedPropertyAndUser(t);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("incomeLedger", {
        userId,
        propertyId,
        period: "2026-07",
        grossShare: 100,
        costs: 20,
        mgmtFee: 5,
        reserve: 5,
        netPaid: 70,
        status: "scheduled",
      })
    );

    const res = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "distribution",
      signature: "sig-dist-1",
      mint: MINT,
      period: "2026-07",
      txSig: "onchain-dist-tx",
    });
    expect(res.status).toBe("applied");

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.status).toBe("paid");
    expect(row?.txSig).toBe("onchain-dist-tx");

    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(audits.some((a) => a.actor === "helius" && a.action === "income.reconciled")).toBe(true);
  });

  // ROW: Duplicate delivery — signature already in reconciliations → no-op, mirror unchanged.
  test("duplicate signature is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedPropertyAndUser(t);

    const args = {
      type: "mint" as const,
      signature: "sig-dupe-1",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 100,
    };
    await t.mutation(internal.reconcile.applyChainEvent, args);
    const second = await t.mutation(internal.reconcile.applyChainEvent, {
      ...args,
      tokenAmount: 999, // would change the balance if re-applied
    });
    expect(second.status).toBe("duplicate");

    const holding = await t.run(async (ctx) =>
      (await ctx.db.query("holdings").collect()).find((h) => h.userId === userId)
    );
    expect(holding?.tokenAmount).toBe(100); // unchanged — not re-applied

    const recons = await t.run(async (ctx) =>
      ctx.db
        .query("reconciliations")
        .withIndex("by_signature", (q) => q.eq("signature", "sig-dupe-1"))
        .collect()
    );
    expect(recons.length).toBe(1); // no second row, no double audit
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(audits.filter((a) => a.action === "holding.reconciled").length).toBe(1);
  });

  // ROW: Unknown mint/wallet → unresolved, no throw.
  test("unknown mint/wallet is logged unresolved, not thrown", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);

    const res = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint",
      signature: "sig-unknown-1",
      mint: "UnknownMint000000000000000000000000000000000",
      owner: "UnknownWallet00000000000000000000000000000000",
      tokenAmount: 10,
    });
    expect(res.status).toBe("unresolved");

    const recon = await t.run(async (ctx) =>
      ctx.db
        .query("reconciliations")
        .withIndex("by_signature", (q) => q.eq("signature", "sig-unknown-1"))
        .unique()
    );
    expect(recon?.status).toBe("unresolved");
  });

  // ROW: Ordering race — an event that first resolves `unresolved` (target not yet in Convex) must
  // re-drive to `applied` when redelivered after the property/user exist. `unresolved` is not terminal.
  test("unresolved event re-drives to applied on redelivery after entities exist", async () => {
    const t = convexTest(schema, modules);
    const args = {
      type: "mint" as const,
      signature: "sig-race-1",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 100,
    };

    // Arrives before the property/user exist → unresolved (idempotency slot NOT permanently consumed).
    const first = await t.mutation(internal.reconcile.applyChainEvent, args);
    expect(first.status).toBe("unresolved");

    await seedPropertyAndUser(t);

    // Same signature redelivered (Helius at-least-once) → now applies for real.
    const second = await t.mutation(internal.reconcile.applyChainEvent, args);
    expect(second.status).toBe("applied");

    const holding = await t.run(async (ctx) => (await ctx.db.query("holdings").collect())[0]);
    expect(holding?.tokenAmount).toBe(100);

    // The stale unresolved row was replaced — exactly one row remains, status applied.
    const recons = await t.run(async (ctx) =>
      ctx.db
        .query("reconciliations")
        .withIndex("by_signature", (q) => q.eq("signature", "sig-race-1"))
        .collect()
    );
    expect(recons.length).toBe(1);
    expect(recons[0].status).toBe("applied");
  });

  // A mint/transfer with no (or negative) token amount can't reconcile a balance → unresolved, no holding.
  test("mint event with missing tokenAmount is unresolved, writes no holding", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);

    const res = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "mint",
      signature: "sig-noamount-1",
      mint: MINT,
      owner: WALLET,
    });
    expect(res.status).toBe("unresolved");

    const holdings = await t.run(async (ctx) => ctx.db.query("holdings").collect());
    expect(holdings.length).toBe(0);
  });
});

describe("E1.3 webhook (HTTP layer)", () => {
  // ROW: Bad / missing auth — POST without the valid secret → 401, nothing processed.
  test("missing auth → 401", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      body: JSON.stringify([{ type: "mint", signature: "x" }]),
    });
    expect(res.status).toBe(401);
  });

  test("wrong auth → 401", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      headers: { Authorization: "nope" },
      body: JSON.stringify([{ type: "mint", signature: "x" }]),
    });
    expect(res.status).toBe(401);
  });

  // ROW: Malformed payload — non-JSON body → 400, no partial writes.
  test("malformed body → 400", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      headers: { Authorization: SECRET },
      body: "not json{",
    });
    expect(res.status).toBe(400);
  });

  // Missing required fields (nothing normalizes) → 400.
  test("payload with no recognizable events → 400", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      headers: { Authorization: SECRET },
      body: JSON.stringify([{ foo: "bar" }]),
    });
    expect(res.status).toBe(400);
  });

  // Happy path through the full HTTP route → 200 and the mirror updates.
  test("authed mint webhook → 200 and holding applied", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);

    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      headers: { Authorization: SECRET },
      body: JSON.stringify([
        { type: "mint", signature: "sig-http-1", mint: MINT, owner: WALLET, tokenAmount: 42 },
      ]),
    });
    expect(res.status).toBe(200);

    const holding = await t.run(async (ctx) => (await ctx.db.query("holdings").collect())[0]);
    expect(holding?.tokenAmount).toBe(42);
  });
});
