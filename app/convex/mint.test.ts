import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Admin Story 3.2 — the MINT & LISTING console. These prove the story's core walls, not asserted:
//   • the GATE WALL (3-1): a property with ANY unsigned gate cannot be minted (allGatesSigned false);
//   • a fully-gated property mints through the step-up stub — properties.mint + mintStatus:"minting" set,
//     mint.executed audits the NAMED human — and a second attempt refuses (idempotent, no double-mint);
//   • the requireStepUp stub GATES the mint (disabled ⇒ refused);
//   • LIST-ONLY-AFTER-CONFIRM: listOffering refuses until mintStatus:"confirmed", then flips gating→open
//     and audits offering.listed;
//   • platform_admin is DENIED mint.execute (no operational power — 1-1's wall).

afterEach(() => vi.unstubAllEnvs());

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
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

async function seedProperty(t: ReturnType<typeof convexTest>): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: "The Monroe",
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: 0.062,
      offeringSize: 1_240_000,
      fundedPct: 0,
      status: "open",
      spvName: "The Monroe LLC",
      minInvestment: 50,
    }),
  );
}

// A fresh property moved into gating with its 8 pending gates, plus two distinct ops_diligence signers.
async function seedGatingProperty(t: ReturnType<typeof convexTest>): Promise<Id<"properties">> {
  const propertyId = await seedProperty(t);
  await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"], name: "Priya Desai" });
  await seedStaff(t, { workosId: "user_ops2", roles: ["ops_diligence"], name: "Rahul Mendes" });
  await t.withIdentity(workos("user_ops1")).mutation(api.gates.beginGating, { propertyId });
  return propertyId;
}

// Sign all 8 gates: 0..5,7 single-party (ops1); gate 6 multi-party needs two DISTINCT humans.
async function signAllGates(t: ReturnType<typeof convexTest>, propertyId: Id<"properties">) {
  for (const gateNo of [0, 1, 2, 3, 4, 5, 7]) {
    await t.withIdentity(workos("user_ops1")).action(api.gates.signGate, { propertyId, gateNo });
  }
  await t.withIdentity(workos("user_ops1")).action(api.gates.signGate, { propertyId, gateNo: 6 });
  await t.withIdentity(workos("user_ops2")).action(api.gates.signGate, { propertyId, gateNo: 6 });
}

async function fullyGatedProperty(t: ReturnType<typeof convexTest>): Promise<Id<"properties">> {
  const propertyId = await seedGatingProperty(t);
  await signAllGates(t, propertyId);
  return propertyId;
}

async function property(t: ReturnType<typeof convexTest>, propertyId: Id<"properties">) {
  return await t.run(async (ctx) => ctx.db.get(propertyId));
}

describe("mintOffering — the GATE WALL (3-1): an unsigned gate refuses the mint", () => {
  test("a property with any unsigned gate cannot be minted (allGatesSigned false)", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t); // 8 pending gates, none signed

    await expect(
      t.withIdentity(workos("user_ops1")).action(api.mint.mintOffering, { propertyId }),
    ).rejects.toThrow("Cannot mint: every diligence gate must be signed first");

    // Nothing minted — no mint address, no mint-intent status.
    const p = await property(t, propertyId);
    expect(p?.mint).toBeUndefined();
    expect(p?.mintStatus ?? "none").toBe("none");
  });

  test("signing all but ONE gate still refuses (the wall is all-or-nothing)", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedGatingProperty(t);
    // Sign every single-party gate but leave the multi-party gate 6 unsigned.
    for (const gateNo of [0, 1, 2, 3, 4, 5, 7]) {
      await t.withIdentity(workos("user_ops1")).action(api.gates.signGate, { propertyId, gateNo });
    }
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.mint.mintOffering, { propertyId }),
    ).rejects.toThrow("Cannot mint: every diligence gate must be signed first");
  });
});

describe("mintOffering — a fully-gated property mints, and re-mint is refused (idempotent)", () => {
  test("records properties.mint + mintStatus:minting, audits mint.executed to the human", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await fullyGatedProperty(t);

    const res = await t
      .withIdentity(workos("user_ops1"))
      .action(api.mint.mintOffering, { propertyId });
    expect(res.minted).toBe(true);
    expect(res.mintStatus).toBe("minting");
    expect(res.mint).toContain("STUB-MINT-");

    const p = await property(t, propertyId);
    expect(p?.mint).toBe(res.mint);
    expect(p?.mintStatus).toBe("minting");
    // The mint does NOT list — status stays gating until a distinct confirm→list.
    expect(p?.status).toBe("gating");

    const executed = (await auditRows(t)).filter((a) => a.action === "mint.executed");
    expect(executed).toHaveLength(1);
    expect(executed[0].actor).toBe("user_ops1@vesper.co"); // the named human
    expect(executed[0].target).toBe(propertyId);
    expect(executed[0].onchainRef).toContain("STUB-MINTSIG-"); // the on-chain signature reference
    expect((executed[0].meta as { mint: string }).mint).toBe(res.mint);
  });

  test("a second mint attempt refuses — no double-mint", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await fullyGatedProperty(t);

    await t.withIdentity(workos("user_ops1")).action(api.mint.mintOffering, { propertyId });
    await expect(
      t.withIdentity(workos("user_ops1")).action(api.mint.mintOffering, { propertyId }),
    ).rejects.toThrow("Property already minted");

    // Exactly ONE mint.executed audit — the second attempt wrote nothing.
    const executed = (await auditRows(t)).filter((a) => a.action === "mint.executed");
    expect(executed).toHaveLength(1);
  });

  test("recordMint itself refuses a double-mint (the mutation backstop)", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await fullyGatedProperty(t);
    await t.withIdentity(workos("user_ops1")).action(api.mint.mintOffering, { propertyId });

    await expect(
      t.mutation(internal.mint.recordMint, {
        propertyId,
        actor: "user_ops1@vesper.co",
        mint: "STUB-MINT-again",
        signature: "STUB-MINTSIG-again",
        supply: 1_240_000,
      }),
    ).rejects.toThrow("Property already minted");
  });
});

describe("mintOffering — the requireStepUp stub gates the irreversible act", () => {
  test("with step-up disabled (no flag, non-test env), a fully-gated mint is refused", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await fullyGatedProperty(t);

    // Disable the step-up stub the same way settlement/compliance tests disable their stubs — via
    // vi.stubEnv (avoids TS2540 on read-only NODE_ENV, and auto-restores in afterEach).
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VESPER_ENABLE_UNSAFE_STUBS", "");

    await expect(
      t.withIdentity(workos("user_ops1")).action(api.mint.mintOffering, { propertyId }),
    ).rejects.toThrow("Step-up authentication is required");

    // The step-up wall fires BEFORE the mint seam — nothing minted.
    const p = await property(t, propertyId);
    expect(p?.mint).toBeUndefined();
    expect(p?.mintStatus ?? "none").toBe("none");
  });
});

describe("listOffering — list ONLY after the mint is confirmed on-chain (3-3)", () => {
  test("refuses while mintStatus is minting; confirms; then flips gating→open + audits offering.listed", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await fullyGatedProperty(t);
    await t.withIdentity(workos("user_ops1")).action(api.mint.mintOffering, { propertyId });

    // Minted-but-unconfirmed → listing refuses.
    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.mint.listOffering, { propertyId }),
    ).rejects.toThrow("Cannot list: the mint must be confirmed on-chain first");
    expect((await property(t, propertyId))?.status).toBe("gating");

    // The distinct confirm step (3-3 stub) flips minting → confirmed.
    await t.withIdentity(workos("user_ops1")).mutation(api.mint.confirmMintStub, { propertyId });
    expect((await property(t, propertyId))?.mintStatus).toBe("confirmed");

    // Now listing flips gating → open and audits offering.listed.
    const res = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.mint.listOffering, { propertyId });
    expect(res.status).toBe("open");
    expect((await property(t, propertyId))?.status).toBe("open");

    const listed = (await auditRows(t)).filter((a) => a.action === "offering.listed");
    expect(listed).toHaveLength(1);
    expect(listed[0].actor).toBe("user_ops1@vesper.co");
    expect(listed[0].target).toBe(propertyId);

    // Idempotent: re-listing an already-open property is a no-op (no second audit).
    const again = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.mint.listOffering, { propertyId });
    expect(again.alreadyListed).toBe(true);
    expect((await auditRows(t)).filter((a) => a.action === "offering.listed")).toHaveLength(1);
  });

  test("confirmMintStub refuses to confirm a mint that was never executed", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await fullyGatedProperty(t);
    await expect(
      t.withIdentity(workos("user_ops1")).mutation(api.mint.confirmMintStub, { propertyId }),
    ).rejects.toThrow("Cannot confirm a mint that has not been executed");
  });
});

describe("mint.execute wall — platform_admin holds no operational power", () => {
  test("platform_admin is denied mintOffering, confirmMintStub, and listOffering", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await fullyGatedProperty(t);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Lee" });

    await expect(
      t.withIdentity(workos("user_pa")).action(api.mint.mintOffering, { propertyId }),
    ).rejects.toThrow("Not permitted: mint.execute");

    // Mint as ops so there is a minting property to attempt to confirm/list.
    await t.withIdentity(workos("user_ops1")).action(api.mint.mintOffering, { propertyId });

    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.mint.confirmMintStub, { propertyId }),
    ).rejects.toThrow("Not permitted: mint.execute");
    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.mint.listOffering, { propertyId }),
    ).rejects.toThrow("Not permitted: mint.execute");
  });

  test("mintConsole is mint.execute-gated (platform_admin denied)", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Lee" });
    await expect(
      t.withIdentity(workos("user_pa")).query(api.mint.mintConsole, {}),
    ).rejects.toThrow("Not permitted: mint.execute");
  });
});
