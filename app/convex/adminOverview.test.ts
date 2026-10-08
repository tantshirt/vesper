import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { developmentStubEnabled } from "./security";

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

afterEach(() => vi.unstubAllEnvs());

async function seedStaff(t: ReturnType<typeof convexTest>, workosId: string, roles: string[]) {
  await t.run(async (ctx) => {
    await ctx.db.insert("staff", {
      workosId,
      email: `${workosId}@vesper.co`,
      name: workosId === "ops" ? "Priya Desai" : "Marcus Lee",
      roles: roles as never,
      status: "active",
      createdAt: Date.now(),
    });
  });
}

async function seedQueueRecords(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert("properties", {
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
      mintStatus: "none",
    });
    await ctx.db.insert("diligenceGates", {
      propertyId,
      gateNo: 0,
      label: "Sponsor vetting",
      status: "pending",
    });
    const userId = await ctx.db.insert("users", {
      privyId: "did:privy:queue-user",
      kycStatus: "failed",
      createdAt: Date.now(),
    });
    await ctx.db.insert("eligibility", {
      userId,
      propertyId,
      eligible: false,
      jurisdiction: "United States",
      tokenAclState: "frozen",
      amlFlag: "flagged",
      reviewedBy: "Marcus Lee",
      reviewReason: "Manual review required",
    });
    await ctx.db.insert("reconciliations", {
      signature: "reconciliation-signature",
      eventType: "mint_confirmed",
      status: "unresolved",
      reason: "Offering account evidence missing",
      processedAt: Date.now(),
    });
  });
}

describe("adminOverview.getActionQueue", () => {
  test("ops sees real gate work but not compliance cases", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "ops", ["ops_diligence"]);
    await seedQueueRecords(t);

    const rows = await t.withIdentity(workos("ops")).query(api.adminOverview.getActionQueue, {});
    expect(rows.some((row) => row.kind === "gate" && row.subject === "The Monroe")).toBe(true);
    expect(rows.find((row) => row.kind === "gate")).toMatchObject({
      propertyName: "The Monroe",
      propertyLocation: "Tampa, FL",
    });
    expect(rows.some((row) => row.kind === "compliance")).toBe(false);
    expect(rows.every((row) => !row.stage.includes("workspace available"))).toBe(true);
  });

  test("compliance sees attributed holds and unresolved reconciliation", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "compliance", ["compliance"]);
    await seedQueueRecords(t);

    const rows = await t.withIdentity(workos("compliance")).query(api.adminOverview.getActionQueue, {});
    const hold = rows.find((row) => row.kind === "compliance");
    expect(hold).toMatchObject({
      lane: "blocked",
      accountability: "Marcus Lee",
      blocker: "AML screening is flagged",
    });
    expect(rows.some((row) => row.kind === "reconciliation" && row.lane === "blocked")).toBe(true);
    expect(rows.some((row) => row.kind === "gate")).toBe(false);
  });
});

describe("adminOverview.getPropertySummaries", () => {
  test("returns stable plain-English stages and only permitted next actions", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "ops", ["ops_diligence"]);
    await t.run(async (ctx) => {
      const base = {
        location: "Tampa, FL",
        propertyType: "Multifamily",
        units: 8,
        targetNetYield: 0.062,
        offeringSize: 1_240_000,
        fundedPct: 0,
        spvName: "Example LLC",
        minInvestment: 50,
      };
      const reviewId = await ctx.db.insert("properties", { ...base, name: "A Review", status: "gating", mintStatus: "none" });
      await ctx.db.insert("properties", { ...base, name: "B Publishing", status: "gating", mintStatus: "minting" });
      await ctx.db.insert("properties", { ...base, name: "C Ready", status: "gating", mintStatus: "confirmed" });
      await ctx.db.insert("properties", { ...base, name: "D Open", status: "open", mintStatus: "confirmed" });
      await ctx.db.insert("properties", { ...base, name: "E Funded", status: "funded", mintStatus: "confirmed" });
      await ctx.db.insert("properties", { ...base, name: "F Closed", status: "closed", mintStatus: "confirmed" });
      const publishId = await ctx.db.insert("properties", { ...base, name: "G Publish", status: "gating", mintStatus: "none" });
      await ctx.db.insert("properties", { ...base, name: "H Blocked", status: "gating", mintStatus: "minting", mint: "mint-blocked" });
      await ctx.db.insert("reconciliations", {
        signature: "blocked-signature",
        eventType: "mint_confirmed",
        mint: "mint-blocked",
        status: "unresolved",
        reason: "Network evidence needs review",
        processedAt: Date.now(),
      });
      for (let gateNo = 0; gateNo < 8; gateNo += 1) {
        const evidencePackageId = await ctx.db.insert("evidencePackages", {
          propertyId: publishId,
          gateNo,
          fieldIds: [],
          status: "assembled",
          assembledBy: "Dana Reviewer",
          assembledAt: Date.now(),
        });
        await ctx.db.insert("diligenceGates", {
          propertyId: publishId,
          gateNo,
          label: `Gate ${gateNo}`,
          status: "passed",
          evidencePackageId,
          signedByHuman: "Priya Desai",
          signedAt: Date.now(),
        });
      }
      return { reviewId, publishId };
    });

    const rows = await t.withIdentity(workos("ops")).query(api.adminOverview.getPropertySummaries, {});
    expect(rows.map((row) => [row.name, row.status, row.completedSteps])).toEqual([
      ["A Review", "review", 0],
      ["B Publishing", "publishing", 2],
      ["C Ready", "ready_to_open", 3],
      ["D Open", "open", 4],
      ["E Funded", "funded", 4],
      ["F Closed", "closed", 4],
      ["G Publish", "ready_to_publish", 1],
      ["H Blocked", "blocked", 2],
    ]);
    expect(rows[0].primaryAction).toMatchObject({
      kind: "gates",
      label: "Review approvals",
    });
    expect(rows[0].primaryAction?.href).toContain(`propertyId=${rows[0].id}`);
    expect(rows[0].availableActions.map((action) => action.kind)).toEqual(["gates"]);
    expect(rows[2].primaryAction).toMatchObject({ kind: "publish", label: "Open property" });
    expect(rows[2].primaryAction?.href).toContain(`#property-${rows[2].id}`);
    expect(rows[3].availableActions.map((action) => action.kind)).toEqual(["payments"]);
    expect(rows[5].availableActions).toEqual([]);
    expect(rows[6].availableActions.map((action) => action.kind)).toEqual(["gates", "publish"]);
    expect(rows[7].primaryAction).toMatchObject({ kind: "publish", label: "Review publishing issue" });
    expect(rows[7].availableActions.map((action) => action.kind)).toEqual(["publish"]);
    expect(rows.every((row) => row.availableActions.every((action) => action.href !== "/console/compliance"))).toBe(true);
  });

  test("does not expose property records to a role without property.read", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "admin", ["platform_admin"]);
    await seedQueueRecords(t);

    await expect(
      t.withIdentity(workos("admin")).query(api.adminOverview.getPropertySummaries, {}),
    ).resolves.toEqual([]);
  });

  test("keeps a compliance summary within compliance destinations", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "compliance", ["compliance"]);
    await seedQueueRecords(t);

    const rows = await t.withIdentity(workos("compliance")).query(api.adminOverview.getPropertySummaries, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].primaryAction).toMatchObject({
      kind: "investors",
      label: "Review investors",
    });
    expect(rows[0].primaryAction?.href).toContain(`propertyId=${rows[0].id}`);
  });

  test("queues approval setup when a gating property has no gate rows", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "ops", ["ops_diligence"]);
    await t.run(async (ctx) => {
      await ctx.db.insert("properties", {
        name: "Gate Setup",
        location: "Austin, TX",
        propertyType: "Multifamily",
        units: 4,
        targetNetYield: 0.058,
        offeringSize: 500_000,
        fundedPct: 0,
        status: "gating",
        spvName: "Gate Setup LLC",
        minInvestment: 50,
        mintStatus: "none",
      });
    });

    const rows = await t.withIdentity(workos("ops")).query(api.adminOverview.getActionQueue, {});
    expect(rows.some((row) => row.id.startsWith("gate-setup:") && row.actionLabel === "Set up approvals")).toBe(true);
  });

  test("queues document review work for an AI reviewer", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "reviewer", ["ai_reviewer"]);
    await seedQueueRecords(t);

    const rows = await t.withIdentity(workos("reviewer")).query(api.adminOverview.getActionQueue, {});
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lane: "needs_action",
        actionLabel: "Start document review",
        propertyName: "The Monroe",
      }),
    ]));
    expect(rows.every((row) => row.href.includes("propertyId="))).toBe(true);
  });
});

describe("eligibility.getIdentityRailStatus", () => {
  test("is unavailable when the development KYC simulation is not explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_ENABLE_KYC_STUB", "false");
    const t = convexTest(schema, modules);
    await expect(t.query(api.eligibility.getIdentityRailStatus, {})).resolves.toMatchObject({
      available: false,
      verifiedProvider: false,
      developmentSimulation: false,
    });
  });

  test("the capability helper identifies the explicit development simulation", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_RUNTIME_ENV", "development");
    vi.stubEnv("VESPER_ENABLE_KYC_STUB", "true");
    expect(developmentStubEnabled("kyc")).toBe(true);
  });
});
