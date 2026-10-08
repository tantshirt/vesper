import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// INV2 — durable logging of denied OPERATIONAL actions. A denial on an ACTION entry point must leave a
// DURABLE trace even though the operation aborts. The action catches the "Not permitted:" throw and
// ctx.runMutation(internal.audit.logDenial, ...) writes an immutable `rbac.denied.durable` row; because
// an action is not transactional, that mutation COMMITS and SURVIVES the action's re-throw — so we can
// query auditLog AFTER the rejection and see the row. (Contrast: a denial on a plain query/mutation
// cannot leave a durable row — its write rolls back with the throw, a principled Convex constraint.)

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
  s: { workosId: string; roles: string[]; email?: string; name?: string },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId: s.workosId,
      email: s.email ?? `${s.workosId}@vesper.co`,
      name: s.name ?? "Sam Lee",
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
      status: "gating",
      spvName: "The Monroe LLC",
      minInvestment: 50,
    }),
  );
}

async function evidenceFor(t: ReturnType<typeof convexTest>, propertyId: Id<"properties">) {
  return await t.run(async (ctx) =>
    ctx.db.insert("evidencePackages", {
      propertyId,
      gateNo: 0,
      fieldIds: [],
      status: "assembled",
      assembledBy: "reviewer@vesper.co",
      assembledAt: Date.now(),
    }),
  );
}

describe("INV2 — denied OPERATIONAL actions leave a durable rbac.denied.durable audit row", () => {
  test("a non-gate.sign staff calling signGate throws AND durably logs the denial", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    // A single pending gate so signGate reaches requireGateSigner (the permission wall) — the gate must
    // EXIST or signGate throws "Gate not found" before any permission check.
    await t.run(async (ctx) =>
      ctx.db.insert("diligenceGates", {
        propertyId,
        gateNo: 0,
        label: "Sponsor vetting (KYB & UBO)",
        status: "pending",
        multiParty: false,
        signerWorkosIds: [],
      }),
    );
    // platform_admin holds NO gate.sign — denied at the 1-1 wall.
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], email: "sam@vesper.co" });
    const evidencePackageId = await evidenceFor(t, propertyId);

    await expect(
      t.withIdentity(workos("user_pa")).action(api.gates.signGate, { propertyId, gateNo: 0, evidencePackageId }),
    ).rejects.toThrow("Not permitted: gate.sign");

    const durable = (await auditRows(t)).filter((a) => a.action === "rbac.denied.durable");
    expect(durable).toHaveLength(1);
    expect(durable[0].actor).toBe("sam@vesper.co"); // names the human, not "system"
    expect(durable[0].target).toBe(propertyId);
    expect((durable[0].meta as { permission: string }).permission).toBe("gate.sign");
  });

  test("a non-mint.execute staff calling mintOffering throws AND durably logs the denial", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    // compliance holds NO mint.execute — denied at the 1-1 wall (resolveMinter throws before any gate work).
    await seedStaff(t, { workosId: "user_comp", roles: ["compliance"], email: "marcus@vesper.co" });

    await expect(
      t.withIdentity(workos("user_comp")).action(api.mint.mintOffering, { propertyId }),
    ).rejects.toThrow("Not permitted: mint.execute");

    const durable = (await auditRows(t)).filter((a) => a.action === "rbac.denied.durable");
    expect(durable).toHaveLength(1);
    expect(durable[0].actor).toBe("marcus@vesper.co");
    expect(durable[0].target).toBe(propertyId);
    expect((durable[0].meta as { permission: string }).permission).toBe("mint.execute");
  });

  test("a permitted gate.sign signer leaves NO denial row (the log fires only on denial)", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await t.run(async (ctx) =>
      ctx.db.insert("diligenceGates", {
        propertyId,
        gateNo: 0,
        label: "Sponsor vetting (KYB & UBO)",
        status: "pending",
        multiParty: false,
        signerWorkosIds: [],
      }),
    );
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    const evidencePackageId = await evidenceFor(t, propertyId);

    await t.withIdentity(workos("user_ops")).action(api.gates.signGate, { propertyId, gateNo: 0, evidencePackageId });

    const durable = (await auditRows(t)).filter((a) => a.action === "rbac.denied.durable");
    expect(durable).toHaveLength(0);
  });
});
