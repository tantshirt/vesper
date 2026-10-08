import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { GATE_DEFINITIONS } from "./gates";
import type { Id } from "./_generated/dataModel";

// FIX 1 — the SPONSOR-DEAL → GATING-PROPERTY chain. This proves the integration gap is closed: a
// submitted, KYB-cleared sponsor deal is PROMOTED (via gates.createPropertyFromDeal, gate.sign-gated)
// into a real `properties` row whose `operatorSponsorOrgId` equals the deal's sponsor org — the tenant
// key the 6-3/6-4 sponsor reads scope on — with 8 pending gates so it is immediately gateable. The
// sponsor of that org then SEES the property through the existing 6-3/6-4 read surfaces, and a gate
// signer can sign it. A non-submitted deal is refused; a re-promote is guarded.

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

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

// Provision a sponsor org + principal through the real internal path, then seed a SUBMITTED deal in
// that org (submitted = it has cleared Gate 0 / the intake checklist; seeded directly to keep this test
// focused on the promotion chain, exactly as other suites seed their preconditions).
async function seedSubmittedDeal(
  t: ReturnType<typeof convexTest>,
  propertyName = "The Beacon",
): Promise<{ orgId: Id<"sponsorOrgs">; dealId: Id<"sponsorDeals"> }> {
  const orgId = await t.mutation(internal.sponsor.provisionSponsor, {
    workosId: "user_sponsor",
    email: "sofia@beacon.co",
    name: "Sofia Reyes",
    role: "sponsor_principal",
    orgName: "Beacon Capital",
    provisionedBy: "Priya Desai",
  });
  const dealId = await t.run(async (ctx) =>
    ctx.db.insert("sponsorDeals", {
      sponsorOrgId: orgId,
      propertyName,
      status: "submitted",
      createdAt: Date.now(),
    }),
  );
  return { orgId, dealId };
}

const TERMS = {
  location: "Austin, TX",
  propertyType: "Multifamily",
  units: 12,
  spvName: "The Beacon LLC",
  offeringSize: 2_000_000,
  targetNetYield: 0.06,
  minInvestment: 100,
};

describe("createPropertyFromDeal — the sponsor-deal → gating-property chain connects", () => {
  test("a submitted deal becomes a gating property linked to the sponsor org, with 8 pending gates", async () => {
    const t = convexTest(schema, modules);
    const { orgId, dealId } = await seedSubmittedDeal(t);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"], name: "Priya Desai" });

    const res = await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.gates.createPropertyFromDeal, { dealId, ...TERMS });

    // The property carries the tenant link, is in gating, and inherits the deal's name + the terms.
    const property = await t.run(async (ctx) => ctx.db.get(res.propertyId));
    expect(property?.name).toBe("The Beacon");
    expect(property?.status).toBe("gating");
    expect(property?.operatorSponsorOrgId).toBe(orgId);
    expect(property?.fundedPct).toBe(0);
    expect(property?.offeringSize).toBe(2_000_000);
    expect(property?.units).toBe(12);

    // 8 pending gates were seeded — the property is immediately gateable.
    const gates = await t.run(async (ctx) =>
      ctx.db
        .query("diligenceGates")
        .withIndex("by_property", (q) => q.eq("propertyId", res.propertyId))
        .collect(),
    );
    expect(gates).toHaveLength(GATE_DEFINITIONS.length);
    expect(gates.every((g) => g.status === "pending")).toBe(true);
    expect(res.created).toBe(GATE_DEFINITIONS.length);

    // The deal is burned to its terminal promoted state with the property linked back.
    const deal = await t.run(async (ctx) => ctx.db.get(dealId));
    expect(deal?.status).toBe("promoted");
    expect(deal?.propertyId).toBe(res.propertyId);

    // The SPONSOR of that org now sees the property via the 6-3 / 6-4 read surfaces (tenant chain).
    const operated = await t
      .withIdentity(workos("user_sponsor"))
      .query(api.sponsorUpdates.myOperatedProperties, {});
    expect(operated.map((p) => p.id)).toContain(res.propertyId);

    const funding = await t
      .withIdentity(workos("user_sponsor"))
      .query(api.sponsorFunding.myOfferingFunding, {});
    expect(funding.map((r) => r.propertyId)).toContain(res.propertyId);

    // And a gate signer can sign the freshly-created property's gates (the ceremony works on it).
    const evidencePackageId = await t.run(async (ctx) =>
      ctx.db.insert("evidencePackages", {
        propertyId: res.propertyId,
        gateNo: 0,
        fieldIds: [],
        status: "assembled",
        assembledBy: "reviewer@vesper.co",
        assembledAt: Date.now(),
      }),
    );
    const signed = await t
      .withIdentity(workos("user_ops1"))
      .action(api.gates.signGate, { propertyId: res.propertyId, gateNo: 0, evidencePackageId });
    expect(signed.passed).toBe(true);
  });

  test("a NON-submitted (draft) deal is refused", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"] });
    const orgId = await t.mutation(internal.sponsor.provisionSponsor, {
      workosId: "user_sponsor",
      email: "sofia@beacon.co",
      name: "Sofia Reyes",
      role: "sponsor_principal",
      orgName: "Beacon Capital",
      provisionedBy: "Priya Desai",
    });
    const draftId = await t.run(async (ctx) =>
      ctx.db.insert("sponsorDeals", {
        sponsorOrgId: orgId,
        propertyName: "Not Ready",
        status: "draft",
        createdAt: Date.now(),
      }),
    );

    await expect(
      t
        .withIdentity(workos("user_ops1"))
        .mutation(api.gates.createPropertyFromDeal, { dealId: draftId, ...TERMS }),
    ).rejects.toThrow("Cannot promote a draft deal");
  });

  test("a re-promote of an already-promoted deal is guarded (a deal becomes at most one property)", async () => {
    const t = convexTest(schema, modules);
    const { dealId } = await seedSubmittedDeal(t);
    await seedStaff(t, { workosId: "user_ops1", roles: ["ops_diligence"] });

    await t
      .withIdentity(workos("user_ops1"))
      .mutation(api.gates.createPropertyFromDeal, { dealId, ...TERMS });

    // Second attempt on the now-`promoted` deal is refused (its status is no longer submitted).
    await expect(
      t
        .withIdentity(workos("user_ops1"))
        .mutation(api.gates.createPropertyFromDeal, { dealId, ...TERMS }),
    ).rejects.toThrow("Cannot promote a promoted deal");
  });

  test("createPropertyFromDeal requires gate.sign — a non-signer is denied", async () => {
    const t = convexTest(schema, modules);
    const { dealId } = await seedSubmittedDeal(t);
    await seedStaff(t, { workosId: "user_ai", roles: ["ai_reviewer"], name: "Ana Lopez" });

    await expect(
      t
        .withIdentity(workos("user_ai"))
        .mutation(api.gates.createPropertyFromDeal, { dealId, ...TERMS }),
    ).rejects.toThrow("Not permitted: gate.sign");
  });
});
