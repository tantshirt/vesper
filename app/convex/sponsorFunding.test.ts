/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Story 6.4 — the sponsor funding / holder dashboard (the LAST admin story). The story's guarantees are
// PROVEN here, not asserted:
//   (1) a sponsor sees funding progress + a holder COUNT/aggregates for a property their org OPERATES;
//   (2) sponsor B cannot see sponsor A's offering — a crafted id / a foreign property is not-found;
//   (3) an internal (non-sponsor) staff member is DENIED (holds no sponsor.read);
//   (4) the payload carries NO investor identity/wallet/name/per-investor amount — the returned keys are
//       an exact aggregate allow-list, asserted structurally;
//   (5) a property the org does NOT operate is not-found.
const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

// Provision a sponsor org + member through the internal (grant-only) path — the same path production
// uses — so each test starts from a real, audited tenant.
async function provision(
  t: ReturnType<typeof convexTest>,
  args: {
    workosId: string;
    role: "sponsor_principal" | "sponsor_ops";
    orgName?: string;
    sponsorOrgId?: Id<"sponsorOrgs">;
  },
): Promise<Id<"sponsorOrgs">> {
  return await t.mutation(internal.sponsor.provisionSponsor, {
    workosId: args.workosId,
    email: `${args.workosId}@sponsor.co`,
    name: "Sponsor Human",
    role: args.role,
    orgName: args.orgName,
    sponsorOrgId: args.sponsorOrgId,
    provisionedBy: "Owner (deployment)",
  });
}

// Seed a property, optionally linked to a sponsor org as its operator (the link Epic 3 populates at
// listing; here tests seed it directly). fundedPct is a [0,1] fraction, offeringSize is USD.
async function seedProperty(
  t: ReturnType<typeof convexTest>,
  args: {
    name: string;
    operatorSponsorOrgId?: Id<"sponsorOrgs">;
    offeringSize?: number;
    fundedPct?: number;
  },
): Promise<Id<"properties">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name: args.name,
      location: "Austin, TX",
      propertyType: "multifamily",
      units: 24,
      targetNetYield: 0.062,
      offeringSize: args.offeringSize ?? 5_000_000,
      fundedPct: args.fundedPct ?? 0,
      status: "open",
      spvName: `${args.name} SPV LLC`,
      minInvestment: 500,
      operatorSponsorOrgId: args.operatorSponsorOrgId,
    }),
  );
}

// Seed a consumer holder (a `users` row + a `holdings` row) against a property. The user is the
// investor PII that must NEVER reach a sponsor; a holding carries the per-investor amount that must
// likewise never leak. Tests seed several to shape a cap table, then assert only aggregates come back.
async function seedHolder(
  t: ReturnType<typeof convexTest>,
  args: { propertyId: Id<"properties">; privyId: string; tokenAmount: number; ownershipPct: number },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      privyId: args.privyId,
      kycStatus: "verified",
      walletAddress: `wallet_${args.privyId}`,
      createdAt: Date.now(),
    });
    await ctx.db.insert("holdings", {
      userId,
      propertyId: args.propertyId,
      tokenAmount: args.tokenAmount,
      ownershipPct: args.ownershipPct,
      costBasis: args.tokenAmount, // 1:1 stub basis
    });
    return userId;
  });
}

// The EXACT aggregate allow-list a funding row may carry. Any key outside this set (userId, wallet,
// name, a per-investor amount) is a PII leak; the test asserts the returned keys equal this set.
const FUNDING_ROW_KEYS = [
  "propertyId",
  "name",
  "status",
  "offeringSize",
  "fundedPct",
  "amountRaised",
  "holderCount",
  "totalTokens",
  "topHoldingPct",
].sort();

describe("myOfferingFunding — funding + holder aggregates for an OPERATED offering", () => {
  test("a sponsor sees funding progress + a holder COUNT for their operated property", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const propertyId = await seedProperty(t, {
      name: "A Tower",
      operatorSponsorOrgId: orgId,
      offeringSize: 4_000_000,
      fundedPct: 0.75,
    });
    // Three distinct investors — the cap table the sponsor sees the SHAPE of, never the members.
    await seedHolder(t, { propertyId, privyId: "inv_1", tokenAmount: 1000, ownershipPct: 0.2 });
    await seedHolder(t, { propertyId, privyId: "inv_2", tokenAmount: 500, ownershipPct: 0.03 });
    await seedHolder(t, { propertyId, privyId: "inv_3", tokenAmount: 250, ownershipPct: 0.005 });

    const rows = await t.withIdentity(workos("sp_a")).query(api.sponsorFunding.myOfferingFunding, {});
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.name).toBe("A Tower");
    expect(row.status).toBe("open");
    expect(row.offeringSize).toBe(4_000_000);
    expect(row.fundedPct).toBe(0.75);
    // amountRaised is derived from the offering's funding progress, not summed per-investor.
    expect(row.amountRaised).toBe(3_000_000);
    // The holder COUNT (aggregate), plus total tokens + top-holding concentration.
    expect(row.holderCount).toBe(3);
    expect(row.totalTokens).toBe(1750);
    expect(row.topHoldingPct).toBeCloseTo(0.2);
  });

  test("sponsor_ops (Sofia) can read the dashboard too (both sponsor roles hold sponsor.read)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_ops", role: "sponsor_ops", orgName: "Org Ops" });
    const propertyId = await seedProperty(t, { name: "Ops Tower", operatorSponsorOrgId: orgId });
    await seedHolder(t, { propertyId, privyId: "inv_x", tokenAmount: 100, ownershipPct: 0.5 });

    const rows = await t
      .withIdentity(workos("sp_ops"))
      .query(api.sponsorFunding.myOfferingFunding, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].holderCount).toBe(1);
  });

  test("NO investor PII — the payload keys are an exact aggregate allow-list (no userId/wallet/name/amount)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const propertyId = await seedProperty(t, { name: "A Tower", operatorSponsorOrgId: orgId });
    await seedHolder(t, { propertyId, privyId: "inv_1", tokenAmount: 1000, ownershipPct: 0.2 });
    await seedHolder(t, { propertyId, privyId: "inv_2", tokenAmount: 500, ownershipPct: 0.03 });

    const rows = await t.withIdentity(workos("sp_a")).query(api.sponsorFunding.myOfferingFunding, {});
    const row = rows[0];

    // The returned keys equal the aggregate allow-list EXACTLY — no extra field can smuggle PII through.
    expect(Object.keys(row).sort()).toEqual(FUNDING_ROW_KEYS);

    // Belt-and-braces: none of the known-PII identifiers appear anywhere in the serialized payload.
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("wallet");
    expect(serialized).not.toContain("privyId");
    expect(serialized).not.toContain("costBasis");
    expect(serialized).not.toContain("inv_1"); // no investor privyId value
    expect(serialized).not.toContain("inv_2");

    // The detail read likewise carries only aggregate keys (adds concentration buckets — still no PII).
    const detail = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsorFunding.myOfferingDetail, { propertyId });
    expect(detail).not.toBeNull();
    expect(Object.keys(detail!).sort()).toEqual(
      [...FUNDING_ROW_KEYS, "concentration"].sort(),
    );
    const detailSerialized = JSON.stringify(detail);
    expect(detailSerialized).not.toContain("userId");
    expect(detailSerialized).not.toContain("wallet");
    expect(detailSerialized).not.toContain("privyId");
  });
});

describe("tenant isolation — a sponsor sees ONLY their own operated offerings", () => {
  test("sponsor B cannot see sponsor A's offering (not-found via detail; absent from B's list)", async () => {
    const t = convexTest(schema, modules);
    const orgA = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    await provision(t, { workosId: "sp_b", role: "sponsor_principal", orgName: "Org B" });

    const aProperty = await seedProperty(t, { name: "A Tower", operatorSponsorOrgId: orgA });
    await seedHolder(t, { propertyId: aProperty, privyId: "inv_1", tokenAmount: 1000, ownershipPct: 0.2 });

    // B's dashboard list is empty — A's offering is not in it.
    const bRows = await t.withIdentity(workos("sp_b")).query(api.sponsorFunding.myOfferingFunding, {});
    expect(bRows).toHaveLength(0);

    // B crafts A's real property id → not-found (never confirmed).
    const bDetail = await t
      .withIdentity(workos("sp_b"))
      .query(api.sponsorFunding.myOfferingDetail, { propertyId: aProperty });
    expect(bDetail).toBeNull();

    // A still sees their own offering + holder count.
    const aRows = await t.withIdentity(workos("sp_a")).query(api.sponsorFunding.myOfferingFunding, {});
    expect(aRows).toHaveLength(1);
    expect(aRows[0].holderCount).toBe(1);
  });

  test("a property the org does NOT operate (no operator link) is not-found", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const unlinked = await seedProperty(t, { name: "Orphan" }); // no operator — belongs to no one

    const detail = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsorFunding.myOfferingDetail, { propertyId: unlinked });
    expect(detail).toBeNull();

    const rows = await t.withIdentity(workos("sp_a")).query(api.sponsorFunding.myOfferingFunding, {});
    expect(rows).toHaveLength(0);
  });
});

describe("role wall — a non-sponsor (internal staff) is denied", () => {
  test("an internal ops staff member cannot read the funding dashboard", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const propertyId = await seedProperty(t, { name: "A Tower", operatorSponsorOrgId: orgId });

    // A pure internal staff row — ops_diligence, no sponsor membership / role (holds no sponsor.read).
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
      t.withIdentity(workos("user_ops")).query(api.sponsorFunding.myOfferingFunding, {}),
    ).rejects.toThrow("Not permitted: sponsor.read");

    await expect(
      t
        .withIdentity(workos("user_ops"))
        .query(api.sponsorFunding.myOfferingDetail, { propertyId }),
    ).rejects.toThrow("Not permitted: sponsor.read");
  });
});
