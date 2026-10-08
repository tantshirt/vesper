import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  allGatesSigned,
  GATE_DEFINITIONS,
  signGate,
} from "./gates";
import type { Id } from "./_generated/dataModel";

// Admin Story 3.1 — the gate SIGNATURE CEREMONY. THE SPINE. These prove the story's core claims, they
// are not asserted: a single-party gate passes at ONE named human; a multi-party gate (6) passes only at
// TWO DISTINCT humans and blocks the same human signing twice (self-approval, via 1-2) with a DURABLE
// sod.blocked; a fee-conflicted signer is blocked (1-2); platform_admin is denied at the permission step;
// allGatesSigned stays false until all 8 pass; and there is NO non-human/AI signing path.
//
// signGate is an ACTION calling 1-2's SoD engine, whose durable blocked-attempt log is scheduled from the
// action and survives its throw — so, exactly as in sod.test.ts, we use fake timers +
// finishAllScheduledFunctions to drain that log and query auditLog AFTER the throw.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

async function drainScheduled(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

async function blockedRows(t: ReturnType<typeof convexTest>) {
  return (await auditRows(t)).filter((a) => a.action === "sod.blocked");
}

async function seedProperty(t: ReturnType<typeof convexTest>): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
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
    }),
  );
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

// Seed a fresh property + two distinct ops_diligence signers, then run beginGating (gate.sign-gated) to
// create the 8 pending gates and move the property to "gating".
async function seedGatingProperty(t: ReturnType<typeof convexTest>): Promise<Id<"properties">> {
  const propertyId = await seedProperty(t);
  await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"], name: "Priya Desai" });
  await seedStaff(t, { workosId: "user_ops2", roles: ["ops_diligence"], name: "Rahul Mendes" });
  await t.withIdentity(workos("user_ops1")).mutation(api.gates.beginGating, { propertyId });
  return propertyId;
}

async function gateRow(t: ReturnType<typeof convexTest>, propertyId: Id<"properties">, gateNo: number) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("diligenceGates").collect();
    return rows.find((g) => g.propertyId === propertyId && g.gateNo === gateNo) ?? null;
  });
}

async function evidenceFor(
  t: ReturnType<typeof convexTest>,
  propertyId: Id<"properties">,
  gateNo: number,
  assembledAt = Date.now(),
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("evidencePackages", {
      propertyId,
      gateNo,
      fieldIds: [],
      status: "assembled",
      assembledBy: "reviewer@vesper.co",
      assembledAt,
    }),
  );
}

describe("beginGating — creates the 8 gates + moves the property to gating (idempotent)", () => {
  test("creates 8 pending gates from GATE_DEFINITIONS and sets status gating; re-run is a no-op", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);

    const property = await t.run(async (ctx) => ctx.db.get(propertyId));
    expect(property?.status).toBe("gating");

    const gates = await t.run(async (ctx) =>
      ctx.db
        .query("diligenceGates")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect(),
    );
    expect(gates).toHaveLength(GATE_DEFINITIONS.length);
    expect(gates.every((g) => g.status === "pending")).toBe(true);
    // Gate 6 is the multi-party placeholder; every other gate is single-party.
    expect(gates.find((g) => g.gateNo === 6)?.multiParty).toBe(true);
    expect(gates.filter((g) => g.multiParty).map((g) => g.gateNo)).toEqual([6]);

    // Idempotent: a second beginGating creates nothing new.
    const res = await t.withIdentity(workos("user_ops1")).mutation(api.gates.beginGating, { propertyId });
    expect(res.created).toBe(0);
    const after = await t.run(async (ctx) =>
      ctx.db
        .query("diligenceGates")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect(),
    );
    expect(after).toHaveLength(GATE_DEFINITIONS.length);
  });

  test("beginGating requires gate.sign — a non-signer is denied", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ai", roles: ["ai_reviewer"], name: "Ana Lopez" });
    await expect(
      t.withIdentity(workos("user_ai")).mutation(api.gates.beginGating, { propertyId }),
    ).rejects.toThrow("Not permitted: gate.sign");
  });
});

describe("signGate — single-party gate passes at ONE named human", () => {
  test("signing a single-party gate makes it passed, attributed to the human, and audited", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    const evidencePackageId = await evidenceFor(t, propertyId, 0);

    const res = await t
      .withIdentity(workos("user_ops1"))
      .action(api.gates.signGate, { propertyId, gateNo: 0, evidencePackageId });
    expect(res.passed).toBe(true);
    expect(res.signerCount).toBe(1);

    const gate = await gateRow(t, propertyId, 0);
    expect(gate?.status).toBe("passed");
    expect(gate?.signedByHuman).toBe("Priya Desai"); // the named human, never a system
    expect(gate?.signedAt).toBeTruthy();
    expect(gate?.signerWorkosIds).toEqual(["user_ops1"]);

    await drainScheduled(t);
    const signed = (await auditRows(t)).filter((a) => a.action === "gate.signed");
    expect(signed).toHaveLength(1);
    expect(signed[0].actor).toBe("user_ops1@vesper.co");
    expect((signed[0].meta as { gateNo: number }).gateNo).toBe(0);
    expect((signed[0].meta as { passed: boolean }).passed).toBe(true);
    // No SoD block on a clean single-party sign.
    expect(await blockedRows(t)).toHaveLength(0);
  });

  test("an assembled 2-2 evidence package is attached to the signed gate (evidence, not approval)", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    // A bare evidence package row (2-2 shape) to attach — its presence is evidence, it grants nothing.
    const pkgId = await t.run(async (ctx) =>
      ctx.db.insert("evidencePackages", {
        propertyId,
        gateNo: 1,
        fieldIds: [],
        status: "assembled",
        assembledBy: "reviewer@vesper.co",
        assembledAt: Date.now(),
      }),
    );
    await t
      .withIdentity(workos("user_ops1"))
      .action(api.gates.signGate, { propertyId, gateNo: 1, evidencePackageId: pkgId });
    const gate = await gateRow(t, propertyId, 1);
    expect(gate?.evidencePackageId).toBe(pkgId);
  });

  test("rejects missing, future, superseded, cross-property, and wrong-gate evidence", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    const otherPropertyId = await seedProperty(t);
    const wrongProperty = await evidenceFor(t, otherPropertyId, 0);
    const wrongGate = await evidenceFor(t, propertyId, 1);
    const future = await evidenceFor(t, propertyId, 0, Date.now() + 1);

    await expect(
      t.withIdentity(workos("user_ops1")).action(
        api.gates.signGate,
        { propertyId, gateNo: 0 } as never,
      ),
    ).rejects.toThrow("Missing required field `evidencePackageId`");

    await expect(
      t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
        propertyId,
        gateNo: 0,
        evidencePackageId: wrongProperty,
      }),
    ).rejects.toThrow("is not current for this property and gate");
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
        propertyId,
        gateNo: 0,
        evidencePackageId: wrongGate,
      }),
    ).rejects.toThrow("is not current for this property and gate");
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
        propertyId,
        gateNo: 0,
        evidencePackageId: future,
      }),
    ).rejects.toThrow("is not current for this property and gate");

    const older = await evidenceFor(t, propertyId, 0, Date.now() - 1);
    await evidenceFor(t, propertyId, 0, Date.now());
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
        propertyId,
        gateNo: 0,
        evidencePackageId: older,
      }),
    ).rejects.toThrow("is not current for this property and gate");
  });
});

describe("signGate — multi-party gate 6 needs TWO DISTINCT humans + blocks self-approval", () => {
  test("one signer leaves gate 6 pending; a DISTINCT second signer passes it", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    const evidencePackageId = await evidenceFor(t, propertyId, 6);

    // First distinct signer → still pending (needs 2).
    const first = await t
      .withIdentity(workos("user_ops1"))
      .action(api.gates.signGate, { propertyId, gateNo: 6, evidencePackageId });
    expect(first.passed).toBe(false);
    expect(first.signerCount).toBe(1);
    expect((await gateRow(t, propertyId, 6))?.status).toBe("pending");

    // Second DISTINCT signer → passes with both names attributed.
    const second = await t
      .withIdentity(workos("user_ops2"))
      .action(api.gates.signGate, { propertyId, gateNo: 6, evidencePackageId });
    expect(second.passed).toBe(true);
    expect(second.signerCount).toBe(2);

    const gate = await gateRow(t, propertyId, 6);
    expect(gate?.status).toBe("passed");
    expect(gate?.signerWorkosIds).toEqual(["user_ops1", "user_ops2"]);
    expect(gate?.signedByHuman).toBe("Priya Desai, Rahul Mendes");
  });

  test("the SAME human signing gate 6 twice is blocked (self-approval) + DURABLY audited sod.blocked", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    const evidencePackageId = await evidenceFor(t, propertyId, 6);

    // First sign leaves it pending at 1 signer.
    await t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
      propertyId,
      gateNo: 6,
      evidencePackageId,
    });
    expect((await gateRow(t, propertyId, 6))?.status).toBe("pending");

    // The SAME human attempting the second signature is blocked by 1-2's distinct-signer wall.
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
        propertyId,
        gateNo: 6,
        evidencePackageId,
      }),
    ).rejects.toThrow("SoD: a distinct second signer is required");

    // The gate never advanced, and the block is DURABLE (scheduled from the action, survives the throw).
    expect((await gateRow(t, propertyId, 6))?.status).toBe("pending");
    expect((await gateRow(t, propertyId, 6))?.signerWorkosIds).toEqual(["user_ops1"]);

    await drainScheduled(t);
    const blocked = await blockedRows(t);
    expect(blocked).toHaveLength(1);
    expect((blocked[0].meta as { reason: string }).reason).toBe("sod.self_approval");
    expect(blocked[0].target).toBe(propertyId);
  });
});

describe("signGate — fee-conflicted signer is blocked (1-2)", () => {
  test("a signer with a recorded property interest is blocked + durably audits sod.fee_conflict", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    const evidencePackageId = await evidenceFor(t, propertyId, 0);
    // Record the conflict through the ONLY recording path (audited internalMutation in 1-2).
    await t.mutation(internal.sod.recordPropertyInterest, {
      workosId: "user_ops1",
      propertyId,
      kind: "fee",
      recordedBy: "Compliance Officer",
    });

    await expect(
      t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
        propertyId,
        gateNo: 0,
        evidencePackageId,
      }),
    ).rejects.toThrow("SoD: fee/listing interest bars signing this property");

    // Gate untouched; durable fee-conflict block present after draining.
    expect((await gateRow(t, propertyId, 0))?.status).toBe("pending");
    await drainScheduled(t);
    const blocked = await blockedRows(t);
    expect(blocked).toHaveLength(1);
    expect((blocked[0].meta as { reason: string }).reason).toBe("sod.fee_conflict");
  });
});

describe("signGate — platform_admin is denied at the PERMISSION step (no operational power)", () => {
  test("platform_admin cannot sign a gate — denied at gate.sign, no SoD leakage", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    const evidencePackageId = await evidenceFor(t, propertyId, 0);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Lee" });

    await expect(
      t.withIdentity(workos("user_pa")).action(api.gates.signGate, {
        propertyId,
        gateNo: 0,
        evidencePackageId,
      }),
    ).rejects.toThrow("Not permitted: gate.sign");

    // Denied before any SoD wall ran → no sod.blocked, and the gate never advanced.
    expect((await gateRow(t, propertyId, 0))?.status).toBe("pending");
    await drainScheduled(t);
    expect(await blockedRows(t)).toHaveLength(0);
  });
});

describe("allGatesSigned — the advancement gate (false until ALL 8 pass)", () => {
  test("stays false while any gate is unsigned; true only once every gate passes", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);

    // Nothing signed yet.
    expect(await t.run(async (ctx) => allGatesSigned(ctx, propertyId))).toBe(false);

    // Sign the 7 single-party gates (0..5, 7).
    for (const gateNo of [0, 1, 2, 3, 4, 5, 7]) {
      const evidencePackageId = await evidenceFor(t, propertyId, gateNo);
      await t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
        propertyId,
        gateNo,
        evidencePackageId,
      });
      // Still false — gate 6 (multi-party) remains unsigned.
      expect(await t.run(async (ctx) => allGatesSigned(ctx, propertyId))).toBe(false);
    }

    // Gate 6 needs two distinct signers. One signer → still false.
    const evidencePackageId = await evidenceFor(t, propertyId, 6);
    await t.withIdentity(workos("user_ops1")).action(api.gates.signGate, {
      propertyId,
      gateNo: 6,
      evidencePackageId,
    });
    expect(await t.run(async (ctx) => allGatesSigned(ctx, propertyId))).toBe(false);

    // Distinct second signer on gate 6 → NOW all 8 pass.
    await t.withIdentity(workos("user_ops2")).action(api.gates.signGate, {
      propertyId,
      gateNo: 6,
      evidencePackageId,
    });
    expect(await t.run(async (ctx) => allGatesSigned(ctx, propertyId))).toBe(true);

    await evidenceFor(t, propertyId, 0, Date.now() + 1);
    vi.advanceTimersByTime(1);
    expect(await t.run(async (ctx) => allGatesSigned(ctx, propertyId))).toBe(false);
  });
});

describe("no non-human / AI signing path — signing structurally requires a WorkOS human", () => {
  test("signGate with NO identity is refused (there is no system/AI signer)", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    const evidencePackageId = await evidenceFor(t, propertyId, 0);
    // No .withIdentity → no authenticated human. requireGateSigner → requireStaff throws.
    await expect(
      t.action(api.gates.signGate, { propertyId, gateNo: 0, evidencePackageId }),
    ).rejects.toThrow("Not authenticated");
    expect((await gateRow(t, propertyId, 0))?.status).toBe("pending");
  });

  test("signGate is a registered ACTION (the durable-SoD seam), not a plain mutation", () => {
    expect((signGate as unknown as { isAction?: boolean }).isAction).toBe(true);
  });
});
