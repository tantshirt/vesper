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

async function seedPayoutOperation(
  t: ReturnType<typeof convexTest>,
  args: {
    propertyId: string;
    userId: string;
    period: string;
    signature: string;
    amountBaseUnits: string;
    recipientAddress?: string;
  },
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("externalOperations", {
      kind: "distribution_payout",
      idempotencyKey: `distribution:${args.propertyId}:${args.period}:${args.userId}`,
      status: "submitted",
      actor: "test-operator",
      subject: `${args.propertyId}:${args.period}:${args.userId}`,
      propertyId: args.propertyId as never,
      period: args.period,
      recipientUserId: args.userId as never,
      recipientAddress: args.recipientAddress ?? WALLET,
      amountBaseUnits: args.amountBaseUnits,
      desiredConsequence: "transfer_usdc_to_holder",
      attemptCount: 1,
      submittedSignature: args.signature,
      lastCheckpoint: "provider_accepted_awaiting_chain_confirmation",
      retrySafe: false,
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
    });
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
      slot: 10,
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
      slot: 11,
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
    await seedPayoutOperation(t, {
      propertyId,
      userId,
      period: "2026-07",
      signature: "onchain-dist-tx",
      amountBaseUnits: "70000000",
    });

    const res = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "distribution",
      signature: "sig-dist-1",
      mint: MINT,
      owner: WALLET,
      tokenAmountRaw: "70000000",
      tokenDecimals: 6,
      period: "2026-07",
      txSig: "onchain-dist-tx",
      slot: 12,
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
      slot: 13,
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
      slot: 14,
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
      slot: 15,
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
      slot: 16,
    });
    expect(res.status).toBe("unresolved");

    const holdings = await t.run(async (ctx) => ctx.db.query("holdings").collect());
    expect(holdings.length).toBe(0);
  });

  test("distinct events in one signature each apply", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);
    const secondWallet = "Wa11etAddr2222222222222222222222222222222222";
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        privyId: "did:privy:second",
        kycStatus: "verified",
        walletAddress: secondWallet,
        createdAt: Date.now(),
      });
    });

    const first = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-multi",
      eventIndex: 0,
      mint: MINT,
      owner: WALLET,
      tokenAmount: 10,
      slot: 50,
    });
    const second = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-multi",
      eventIndex: 1,
      mint: MINT,
      owner: secondWallet,
      tokenAmount: 20,
      slot: 50,
    });

    expect(first.status).toBe("applied");
    expect(second.status).toBe("applied");
    const holdings = await t.run(async (ctx) => ctx.db.query("holdings").collect());
    expect(holdings.map((holding) => holding.tokenAmount).sort((a, b) => a - b)).toEqual([10, 20]);
  });

  test("stale ownership slots are quarantined without rolling back the mirror", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);
    await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-new",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 80,
      slot: 200,
    });
    const stale = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-old",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 10,
      slot: 199,
    });

    expect(stale.status).toBe("quarantined");
    const holding = await t.run(async (ctx) => (await ctx.db.query("holdings").collect())[0]);
    expect(holding.tokenAmount).toBe(80);
    const quarantine = await t.run(async (ctx) =>
      ctx.db.query("reconciliations").withIndex("by_signature", (q) => q.eq("signature", "sig-old")).unique(),
    );
    expect(quarantine?.reason).toContain("stale slot");
  });

  test("conflicting same-target events at the same slot are quarantined", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);
    await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-slot-a",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 40,
      tokenAmountRaw: "40",
      tokenDecimals: 0,
      slot: 250,
    });
    const conflict = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-slot-b",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 41,
      tokenAmountRaw: "41",
      tokenDecimals: 0,
      slot: 250,
    });

    expect(conflict.status).toBe("quarantined");
    const holding = await t.run(async (ctx) => (await ctx.db.query("holdings").collect())[0]);
    expect(holding.tokenAmount).toBe(40);
    const row = await t.run(async (ctx) =>
      ctx.db.query("reconciliations").withIndex("by_signature", (q) => q.eq("signature", "sig-slot-b")).unique(),
    );
    expect(row?.reason).toContain("conflicting event");
  });

  test("one recipient payout marks only that recipient paid", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seedPropertyAndUser(t);
    const secondWallet = "Wa11etAddr3333333333333333333333333333333333";
    const secondUser = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        privyId: "did:privy:payout-two",
        kycStatus: "verified",
        walletAddress: secondWallet,
        createdAt: Date.now(),
      }),
    );
    await t.run(async (ctx) => {
      const firstUser = (await ctx.db.query("users").withIndex("by_wallet", (q) => q.eq("walletAddress", WALLET)).unique())!;
      await ctx.db.insert("incomeLedger", {
        userId: firstUser._id,
        propertyId,
        period: "2026-08",
        grossShare: 80,
        costs: 5,
        mgmtFee: 3,
        reserve: 2,
        netPaid: 70,
        status: "scheduled",
      });
      await ctx.db.insert("incomeLedger", {
        userId: secondUser,
        propertyId,
        period: "2026-08",
        grossShare: 45,
        costs: 3,
        mgmtFee: 1,
        reserve: 1,
        netPaid: 40,
        status: "scheduled",
      });
    });
    const firstUser = await t.run(async (ctx) =>
      ctx.db.query("users").withIndex("by_wallet", (q) => q.eq("walletAddress", WALLET)).unique(),
    );
    await seedPayoutOperation(t, {
      propertyId,
      userId: String(firstUser!._id),
      period: "2026-08",
      signature: "sig-one-payout",
      amountBaseUnits: "70000000",
    });

    const result = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "distribution",
      signature: "sig-one-payout",
      eventIndex: 0,
      mint: MINT,
      owner: WALLET,
      tokenAmountRaw: "70000000",
      tokenDecimals: 6,
      period: "2026-08",
      slot: 300,
    });
    expect(result.status).toBe("applied");
    const rows = await t.run(async (ctx) =>
      ctx.db.query("incomeLedger").withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", "2026-08")).collect(),
    );
    expect(rows.find((row) => row.userId === secondUser)?.status).toBe("scheduled");
    expect(rows.find((row) => row.userId !== secondUser)?.status).toBe("paid");
  });

  test("a recipient payout with the wrong amount is quarantined", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seedPropertyAndUser(t);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("incomeLedger", {
        userId,
        propertyId,
        period: "2026-09",
        grossShare: 80,
        costs: 5,
        mgmtFee: 3,
        reserve: 2,
        netPaid: 70,
        status: "scheduled",
      }),
    );
    const result = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "distribution",
      signature: "sig-wrong-payout",
      mint: MINT,
      owner: WALLET,
      tokenAmountRaw: "69999999",
      tokenDecimals: 6,
      period: "2026-09",
      slot: 301,
    });

    expect(result.status).toBe("quarantined");
    expect((await t.run(async (ctx) => ctx.db.get(rowId)))?.status).toBe("scheduled");
  });

  test("a newer unresolved row cannot hide a later applied slot", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seedPropertyAndUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("holdings", {
        userId,
        propertyId,
        tokenAmount: 80,
        ownershipPct: 0,
        costBasis: 0,
        chainSlot: 200,
      });
      const targetKey = `holding:${MINT}:${WALLET}`;
      const base = {
        eventType: "transfer",
        mint: MINT,
        targetKey,
        processedAt: Date.now(),
      };
      await ctx.db.insert("reconciliations", {
        ...base,
        signature: "sig-unresolved-150",
        eventKey: "sig-unresolved-150:transfer:0",
        slot: 150,
        status: "unresolved",
      });
      await ctx.db.insert("reconciliations", {
        ...base,
        signature: "sig-applied-200",
        eventKey: "sig-applied-200:transfer:0",
        slot: 200,
        status: "applied",
        projectionValue: "80:ui",
      });
    });

    const result = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-stale-100",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 10,
      slot: 100,
    });
    expect(result.status).toBe("quarantined");
    const holding = await t.run(async (ctx) => ctx.db.query("holdings").first());
    expect(holding?.tokenAmount).toBe(80);
  });

  test("exact RPC evidence supersedes a quarantined webhook for the same event", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);
    const event = {
      type: "transfer" as const,
      signature: "sig-rpc-redrive",
      eventIndex: 0,
      mint: MINT,
      owner: WALLET,
      tokenAmount: 25,
      tokenAmountRaw: "25",
      tokenDecimals: 0,
      slot: 500,
    };
    const webhook = await t.mutation(internal.reconcile.applyChainEvent, {
      ...event,
      evidenceSource: "webhook",
      quarantineReason: "webhook requires exact RPC post-balance evidence",
    });
    expect(webhook.status).toBe("quarantined");

    const rpc = await t.mutation(internal.reconcile.applyChainEvent, {
      ...event,
      evidenceSource: "rpc",
    });
    expect(rpc.status).toBe("applied");
    const rows = await t.run(async (ctx) =>
      ctx.db.query("reconciliations").withIndex("by_signature", (q) => q.eq("signature", event.signature)).collect(),
    );
    expect(rows.map((row) => row.status).sort()).toEqual(["applied", "quarantined"]);
  });

  test("missing chain slots are quarantined", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);
    const result = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "transfer",
      signature: "sig-missing-slot",
      mint: MINT,
      owner: WALLET,
      tokenAmount: 10,
    });
    expect(result.status).toBe("quarantined");
  });

  test("a matching payout amount with the wrong operation signature stays scheduled", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seedPropertyAndUser(t);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("incomeLedger", {
        userId,
        propertyId,
        period: "2026-10",
        grossShare: 75,
        costs: 2,
        mgmtFee: 2,
        reserve: 1,
        netPaid: 70,
        status: "scheduled",
      }),
    );
    await seedPayoutOperation(t, {
      propertyId,
      userId,
      period: "2026-10",
      signature: "expected-payout-signature",
      amountBaseUnits: "70000000",
    });
    const result = await t.mutation(internal.reconcile.applyChainEvent, {
      type: "distribution",
      signature: "unrelated-transfer-signature",
      mint: MINT,
      owner: WALLET,
      tokenAmountRaw: "70000000",
      tokenDecimals: 6,
      period: "2026-10",
      slot: 600,
    });
    expect(result.status).toBe("quarantined");
    expect((await t.run(async (ctx) => ctx.db.get(rowId)))?.status).toBe("scheduled");
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

  test("arbitrary webhook transfer deltas are quarantined, never treated as balances", async () => {
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

    expect(await t.run(async (ctx) => ctx.db.query("holdings").collect())).toHaveLength(0);
    const row = await t.run(async (ctx) =>
      ctx.db.query("reconciliations").withIndex("by_signature", (q) => q.eq("signature", "sig-http-1")).unique(),
    );
    expect(row?.status).toBe("quarantined");
    expect(row?.reason).toContain("post-balance");
  });

  test("normalizes every transfer in one signature but quarantines ownership deltas", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);
    const secondWallet = "Wa11etAddr4444444444444444444444444444444444";
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        privyId: "did:privy:http-second",
        kycStatus: "verified",
        walletAddress: secondWallet,
        createdAt: Date.now(),
      });
    });
    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      headers: { Authorization: SECRET },
      body: JSON.stringify([{
        type: "transfer",
        signature: "sig-http-multi",
        slot: 400,
        tokenTransfers: [
          { mint: MINT, toUserAccount: WALLET, tokenAmount: 11 },
          { mint: MINT, toUserAccount: secondWallet, tokenAmount: 22 },
        ],
      }]),
    });
    expect(res.status).toBe(200);
    expect(await t.run(async (ctx) => ctx.db.query("holdings").collect())).toHaveLength(0);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("reconciliations").withIndex("by_signature", (q) => q.eq("signature", "sig-http-multi")).collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "quarantined")).toBe(true);
  });

  test("explicit webhook post-balance is retained but still requires exact settle refetch", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);
    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      headers: { Authorization: SECRET },
      body: JSON.stringify([{
        type: "transfer",
        signature: "sig-http-post-balance",
        slot: 401,
        tokenTransfers: [{
          mint: MINT,
          toUserAccount: WALLET,
          tokenAmount: 11,
          postTokenBalance: { mint: MINT, owner: WALLET, amount: "111", decimals: 0 },
        }],
      }]),
    });
    expect(res.status).toBe(200);
    expect(await t.run(async (ctx) => ctx.db.query("holdings").collect())).toHaveLength(0);
    const row = await t.run(async (ctx) =>
      ctx.db.query("reconciliations").withIndex("by_signature", (q) => q.eq("signature", "sig-http-post-balance")).unique(),
    );
    expect(row?.status).toBe("quarantined");
    expect(row?.projectionValue).toBe("111:0");
    expect(row?.reason).toContain("exact settlePurchase");
  });

  test("failed transaction events are quarantined", async () => {
    const t = convexTest(schema, modules);
    await seedPropertyAndUser(t);
    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      headers: { Authorization: SECRET },
      body: JSON.stringify([{ type: "transfer", signature: "sig-failed", meta: { err: { custom: 1 } }, mint: MINT, owner: WALLET, tokenAmount: 99 }]),
    });
    expect(res.status).toBe(200);
    expect(await t.run(async (ctx) => ctx.db.query("holdings").collect())).toHaveLength(0);
    const row = await t.run(async (ctx) =>
      ctx.db.query("reconciliations").withIndex("by_signature", (q) => q.eq("signature", "sig-failed")).unique(),
    );
    expect(row?.status).toBe("quarantined");
  });

  test("streaming body limit rejects oversized payloads", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/helius/webhook", {
      method: "POST",
      headers: { Authorization: SECRET },
      body: JSON.stringify({ padding: "x".repeat(1_000_001) }),
    });
    expect(res.status).toBe(413);
  });
});
