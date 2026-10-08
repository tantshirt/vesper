/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Story 6.3 — the sponsor monthly-update composer. The story's core claims are proven here, not
// asserted: (1) a sponsor may author an update ONLY for a property their org OPERATES (the
// operatorSponsorOrgId link is the tenant wall — a foreign property is not-found); (2) every field is
// required, so even a quiet month is a full report and a partial/empty submission throws; (3) BOTH
// sponsor roles (principal + ops/Sofia) may author; a non-sponsor cannot; (4) the reused
// updates.flagOverdueUpdates still flags an operated property overdue (unchanged behavior).
const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

// Provision a sponsor org + member through the internal (grant-only) path — the same path production
// uses — so each test starts from a real, audited tenant.
async function provision(
  t: ReturnType<typeof convexTest>,
  args: {
    workosId: string;
    role: "sponsor_principal" | "sponsor_ops";
    orgName?: string;
    sponsorOrgId?: Id<"sponsorOrgs">;
    email?: string;
    name?: string;
  },
): Promise<Id<"sponsorOrgs">> {
  return await t.mutation(internal.sponsor.provisionSponsor, {
    workosId: args.workosId,
    email: args.email ?? `${args.workosId}@sponsor.co`,
    name: args.name ?? "Sponsor Human",
    role: args.role,
    orgName: args.orgName,
    sponsorOrgId: args.sponsorOrgId,
    provisionedBy: "Owner (deployment)",
  });
}

// Seed a property, optionally linked to a sponsor org as its operator (the link Epic 3 populates at
// listing; here tests seed it directly).
async function seedProperty(
  t: ReturnType<typeof convexTest>,
  args: { name: string; operatorSponsorOrgId?: Id<"sponsorOrgs"> },
): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: args.name,
      location: "Austin, TX",
      propertyType: "multifamily",
      units: 24,
      targetNetYield: 0.062,
      offeringSize: 5_000_000,
      fundedPct: 0,
      status: "open",
      spvName: `${args.name} SPV LLC`,
      minInvestment: 500,
      operatorSponsorOrgId: args.operatorSponsorOrgId,
    }),
  );
}

// A complete, valid monthly-update payload for a quiet month — every field present.
const QUIET_MONTH = {
  period: "2026-06",
  occupancy: 0.96,
  reservesMonths: 4,
  rentOnTime: true,
  operator: "Maria Alvarez, Property Manager",
  note: "A quiet, steady month. Every home stayed occupied and rent came in on time.",
};

describe("publishUpdate — an operated property, all fields required", () => {
  test("a sponsor publishes a complete update (a quiet month) → row created + audited to the human", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const propertyId = await seedProperty(t, { name: "A Tower", operatorSponsorOrgId: orgId });

    const updateId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsorUpdates.publishUpdate, { propertyId, ...QUIET_MONTH });

    // The propertyUpdates row exists with exactly the authored values.
    const row = await t.run(async (ctx) => ctx.db.get(updateId));
    expect(row?.propertyId).toBe(propertyId);
    expect(row?.period).toBe("2026-06");
    expect(row?.occupancy).toBe(0.96);
    expect(row?.reservesMonths).toBe(4);
    expect(row?.rentOnTime).toBe(true);
    expect(row?.operator).toBe(QUIET_MONTH.operator);

    // Audited to the named sponsor human (never a system label).
    const audit = await auditRows(t);
    const pub = audit.find((a) => a.action === "sponsor.update.published");
    expect(pub?.actor).toBe("sp_a@sponsor.co");
    expect(pub?.target).toBe(updateId);

    // It surfaces in the org-scoped list.
    const list = await t.withIdentity(workos("sp_a")).query(api.sponsorUpdates.listMyUpdates, {});
    expect(list).toHaveLength(1);
    expect(list[0].propertyName).toBe("A Tower");
    expect(list[0].period).toBe("2026-06");
  });

  test("a partial/empty submission throws before any write (an empty note; a blank period; a bad occupancy)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const propertyId = await seedProperty(t, { name: "A Tower", operatorSponsorOrgId: orgId });

    // Empty note — a "nothing happened" publish is refused.
    await expect(
      t
        .withIdentity(workos("sp_a"))
        .mutation(api.sponsorUpdates.publishUpdate, { propertyId, ...QUIET_MONTH, note: "   " }),
    ).rejects.toThrow("note is required");

    // Blank period.
    await expect(
      t
        .withIdentity(workos("sp_a"))
        .mutation(api.sponsorUpdates.publishUpdate, { propertyId, ...QUIET_MONTH, period: "" }),
    ).rejects.toThrow("period is required");

    // Out-of-range occupancy.
    await expect(
      t
        .withIdentity(workos("sp_a"))
        .mutation(api.sponsorUpdates.publishUpdate, { propertyId, ...QUIET_MONTH, occupancy: 1.5 }),
    ).rejects.toThrow("occupancy");

    // Empty operator.
    await expect(
      t
        .withIdentity(workos("sp_a"))
        .mutation(api.sponsorUpdates.publishUpdate, { propertyId, ...QUIET_MONTH, operator: "  " }),
    ).rejects.toThrow("operator is required");

    // Nothing was written for any of the rejected attempts.
    const rows = await t.run(async (ctx) => ctx.db.query("propertyUpdates").collect());
    expect(rows).toHaveLength(0);
  });
});

describe("tenant isolation — only an OPERATED property may be authored", () => {
  test("a sponsor cannot publish for a property their org does NOT operate (not-found)", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const orgB = await provision(t, { workosId: "sp_b", role: "sponsor_principal", orgName: "Org B" });

    // A property operated by ORG B.
    const bProperty = await seedProperty(t, { name: "B Plaza", operatorSponsorOrgId: orgB });

    // Sponsor A crafts B's real property id → not-found (never confirmed), no row written.
    await expect(
      t
        .withIdentity(workos("sp_a"))
        .mutation(api.sponsorUpdates.publishUpdate, { propertyId: bProperty, ...QUIET_MONTH }),
    ).rejects.toThrow("Property not found");

    // A property with NO operator link is likewise not-found for any sponsor.
    const unlinked = await seedProperty(t, { name: "Orphan" });
    await expect(
      t
        .withIdentity(workos("sp_a"))
        .mutation(api.sponsorUpdates.publishUpdate, { propertyId: unlinked, ...QUIET_MONTH }),
    ).rejects.toThrow("Property not found");

    const rows = await t.run(async (ctx) => ctx.db.query("propertyUpdates").collect());
    expect(rows).toHaveLength(0);
  });

  test("myOperatedProperties returns ONLY the caller's operated properties, never another org's", async () => {
    const t = convexTest(schema, modules);
    const orgA = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const orgB = await provision(t, { workosId: "sp_b", role: "sponsor_principal", orgName: "Org B" });
    await seedProperty(t, { name: "A Tower", operatorSponsorOrgId: orgA });
    await seedProperty(t, { name: "B Plaza", operatorSponsorOrgId: orgB });
    await seedProperty(t, { name: "Orphan" }); // no operator — belongs to no one

    const aProps = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsorUpdates.myOperatedProperties, {});
    expect(aProps).toHaveLength(1);
    expect(aProps[0].name).toBe("A Tower");

    const bProps = await t
      .withIdentity(workos("sp_b"))
      .query(api.sponsorUpdates.myOperatedProperties, {});
    expect(bProps).toHaveLength(1);
    expect(bProps[0].name).toBe("B Plaza");
  });
});

describe("role wall — both sponsor roles author; a non-sponsor cannot", () => {
  test("sponsor_ops (Sofia) CAN publish an update", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_ops", role: "sponsor_ops", orgName: "Org Ops" });
    const propertyId = await seedProperty(t, { name: "Ops Tower", operatorSponsorOrgId: orgId });

    const updateId = await t
      .withIdentity(workos("sp_ops"))
      .mutation(api.sponsorUpdates.publishUpdate, { propertyId, ...QUIET_MONTH });

    const row = await t.run(async (ctx) => ctx.db.get(updateId));
    expect(row?.propertyId).toBe(propertyId);

    const audit = await auditRows(t);
    expect(audit.find((a) => a.action === "sponsor.update.published")?.actor).toBe("sp_ops@sponsor.co");
  });

  test("an internal (non-sponsor) staff member cannot publish", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const propertyId = await seedProperty(t, { name: "A Tower", operatorSponsorOrgId: orgId });

    // A pure internal staff row — ops_diligence, no sponsor membership / role.
    await t.run(async (ctx) =>
      ctx.db.insert("staff", {
        workosId: "user_ops",
        email: "ops@vesper.co",
        name: "Ops Human",
        roles: ["ops_diligence"],
        status: "active",
        createdAt: Date.now(),
      }),
    );

    await expect(
      t
        .withIdentity(workos("user_ops"))
        .mutation(api.sponsorUpdates.publishUpdate, { propertyId, ...QUIET_MONTH }),
    ).rejects.toThrow("Not authorized as a sponsor");
  });
});

describe("reused overdue-flagging — flagOverdueUpdates still flags an operated property (unchanged)", () => {
  test("an operated property with no current-period update is flagged overdue by the reused cron", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    // Operated property, but NO propertyUpdates row for the current period → overdue.
    const propertyId = await seedProperty(t, { name: "A Tower", operatorSponsorOrgId: orgId });

    const result = await t.mutation(internal.updates.flagOverdueUpdates, {});
    expect(result).toContain("flagged 1");

    // The reused internalMutation wrote its append-only overdue flag against the property (behavior
    // intact — this module did not touch it).
    const audit = await auditRows(t);
    const flag = audit.find(
      (a) => a.action === "propertyUpdate.overdue" && a.target === propertyId,
    );
    expect(flag).toBeDefined();
    expect(flag?.actor).toBe("system");
  });
});
