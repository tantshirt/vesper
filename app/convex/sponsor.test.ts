/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { provisionSponsor, requireSponsor, myDeals } from "./sponsor";
import type { Id } from "./_generated/dataModel";

// Story 6.1 — tenant isolation is the story's core claim, so it is PROVEN here, not asserted. The wall
// is two-way: a sponsor is confined to their own org and barred from every internal `/console`
// function; an internal staff role is barred from every sponsor mutation. Identity shapes mirror
// rbac.test.ts: a recognized WorkOS issuer + subject (all staff, sponsors included, are WorkOS).
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

describe("requireSponsor + tenant isolation — a sponsor sees ONLY their own org", () => {
  test("a sponsor sees only their org's deals", async () => {
    const t = convexTest(schema, modules);
    const orgA = await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    await provision(t, { workosId: "sp_b", role: "sponsor_principal", orgName: "Org B" });

    // A starts a deal; B starts a deal.
    await t.withIdentity(workos("sp_a")).mutation(api.sponsor.startDeal, { propertyName: "A Tower" });
    await t.withIdentity(workos("sp_b")).mutation(api.sponsor.startDeal, { propertyName: "B Plaza" });

    const aDeals = await t.withIdentity(workos("sp_a")).query(api.sponsor.myDeals, {});
    expect(aDeals).toHaveLength(1);
    expect(aDeals[0].propertyName).toBe("A Tower");
    expect(aDeals[0].sponsorOrgId).toBe(orgA);

    const bDeals = await t.withIdentity(workos("sp_b")).query(api.sponsor.myDeals, {});
    expect(bDeals).toHaveLength(1);
    expect(bDeals[0].propertyName).toBe("B Plaza");
  });

  test("mySponsorOrg returns only the caller's org and never another's", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });

    const org = await t.withIdentity(workos("sp_a")).query(api.sponsor.mySponsorOrg, {});
    expect(org?.name).toBe("Org A");
    expect(org?.kybStatus).toBe("none");
    expect(org?.canManage).toBe(true); // principal holds sponsor.manage
  });

  test("sponsor A cannot read sponsor B's deal via a crafted id (tenant isolation)", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    await provision(t, { workosId: "sp_b", role: "sponsor_principal", orgName: "Org B" });

    const bDealId = await t
      .withIdentity(workos("sp_b"))
      .mutation(api.sponsor.startDeal, { propertyName: "B Plaza" });

    // A crafts B's real deal id → not-found (never confirmed).
    const leaked = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsor.getDeal, { dealId: bDealId });
    expect(leaked).toBeNull();

    // And A cannot submit B's deal either — the write side of the wall.
    await expect(
      t.withIdentity(workos("sp_a")).mutation(api.sponsor.submitDeal, { dealId: bDealId }),
    ).rejects.toThrow("Deal not found");
  });
});

describe("the two-way wall — sponsors vs internal /console", () => {
  test("a sponsor identity calling an internal /console function is denied", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });

    // listAudit is audit.read-gated; a sponsor holds only sponsor.read/sponsor.manage → denied.
    await expect(
      t.withIdentity(workos("sp_a")).query(api.auditQueries.listAudit, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Not permitted: audit.read");
  });

  test("an internal-only guard rejects a sponsor role (requireStaff admits, requireSponsor bars the inverse)", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });

    // A sponsor IS staff (requireStaff succeeds) but holds no internal operational permission, so any
    // internal function gated on an internal permission denies them.
    await expect(
      t.withIdentity(workos("sp_a")).run(async (ctx) => {
        const { requirePermission } = await import("./rbac");
        return requirePermission(ctx, "property.read");
      }),
    ).rejects.toThrow("Not permitted: property.read");
  });

  test("an internal ops staff calling a sponsor mutation is denied (no sponsor role)", async () => {
    const t = convexTest(schema, modules);
    // A pure internal staff row — ops_diligence, no sponsor membership.
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
      t.withIdentity(workos("user_ops")).mutation(api.sponsor.startDeal, { propertyName: "X" }),
    ).rejects.toThrow("Not authorized as a sponsor");

    // requireSponsor itself is the primitive proving the internal→sponsor direction of the wall.
    await expect(
      t.withIdentity(workos("user_ops")).run(async (ctx) => requireSponsor(ctx)),
    ).rejects.toThrow("Not authorized as a sponsor");
  });

  test("sponsor_ops (sponsor.read only) is denied a sponsor.manage mutation", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_ops", role: "sponsor_ops", orgName: "Org Ops" });

    // sponsor_ops resolves an org (requireSponsor passes) but lacks sponsor.manage → startDeal denied.
    await expect(
      t.withIdentity(workos("sp_ops")).mutation(api.sponsor.startDeal, { propertyName: "Y" }),
    ).rejects.toThrow("Not permitted: sponsor.manage");

    // But they CAN read their own org + deals.
    const org = await t.withIdentity(workos("sp_ops")).query(api.sponsor.mySponsorOrg, {});
    expect(org?.name).toBe("Org Ops");
    expect(org?.canManage).toBe(false);
  });
});

describe("KYB / Gate 0 gates the submitted state", () => {
  test("a deal cannot be submitted until org KYB is passed; recording passed unblocks it", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });

    const dealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    // KYB not passed (starts "none") → submission blocked with a "complete KYB first" reason.
    await expect(
      t.withIdentity(workos("sp_a")).mutation(api.sponsor.submitDeal, { dealId }),
    ).rejects.toThrow("Complete KYB first");

    // Record a FAILED KYB → still blocked.
    await t.withIdentity(workos("sp_a")).mutation(api.sponsor.recordKyb, { result: "failed" });
    await expect(
      t.withIdentity(workos("sp_a")).mutation(api.sponsor.submitDeal, { dealId }),
    ).rejects.toThrow("Complete KYB first");

    // Record PASSED → Gate 0 open; submission succeeds and is audited.
    const kyb = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.recordKyb, { result: "passed" });
    expect(kyb.kybStatus).toBe("passed");

    const submitted = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.submitDeal, { dealId });
    expect(submitted).toBe(dealId);

    const deals = await t.withIdentity(workos("sp_a")).query(api.sponsor.myDeals, {});
    expect(deals[0].status).toBe("submitted");

    // KYB record + submission both audited to the sponsor human.
    const audit = await auditRows(t);
    const kybRow = audit.find((a) => a.action === "sponsor.kyb.recorded");
    expect(kybRow?.actor).toBe("sp_a@sponsor.co");
    const subRow = audit.find((a) => a.action === "sponsor.deal.submitted");
    expect(subRow?.actor).toBe("sp_a@sponsor.co");
  });
});

describe("provisionSponsor — internal-only, grant-only, org-scoped", () => {
  test("provisionSponsor is an internalMutation — ABSENT from the public api surface", () => {
    // Registered internal functions carry isInternal; public ones carry isPublic. This is the
    // structural proof no anonymous browser can reach the provisioning path over api.* (the public
    // api proxy has no `provisionSponsor` key — accessing it throws rather than resolving).
    expect((provisionSponsor as unknown as { isInternal?: boolean }).isInternal).toBe(true);
    expect((provisionSponsor as unknown as { isPublic?: boolean }).isPublic).not.toBe(true);
    // Sanity: a genuinely public sponsor function DOES carry isPublic, so the check above is meaningful.
    expect((myDeals as unknown as { isPublic?: boolean }).isPublic).toBe(true);
  });

  test("provisioning creates the staff row + org + membership and audits the authorizer", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, {
      workosId: "sp_new",
      role: "sponsor_principal",
      orgName: "New Sponsor Co",
    });

    // The sponsor can now resolve — proving the staff row + membership were both created.
    const org = await t.withIdentity(workos("sp_new")).query(api.sponsor.mySponsorOrg, {});
    expect(org?.id).toBe(orgId);
    expect(org?.name).toBe("New Sponsor Co");

    const audit = await auditRows(t);
    const prov = audit.find((a) => a.action === "sponsor.provisioned");
    expect(prov?.actor).toBe("Owner (deployment)"); // the authorizer, not the invitee
    expect(prov?.target).toBe("sp_new");
  });

  test("a second member can be attached to the SAME org (shared tenant)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await provision(t, {
      workosId: "sp_principal",
      role: "sponsor_principal",
      orgName: "Shared Co",
    });
    await provision(t, { workosId: "sp_ops2", role: "sponsor_ops", sponsorOrgId: orgId });

    // The principal starts a deal; the ops member of the SAME org sees it.
    await t
      .withIdentity(workos("sp_principal"))
      .mutation(api.sponsor.startDeal, { propertyName: "Shared Deal" });

    const opsView = await t.withIdentity(workos("sp_ops2")).query(api.sponsor.myDeals, {});
    expect(opsView).toHaveLength(1);
    expect(opsView[0].propertyName).toBe("Shared Deal");
  });
});
