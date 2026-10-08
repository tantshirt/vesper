import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { regACapStatus } from "./eligibility";

// Admin Story 5.1 — the compliance adjudication → Token-ACL surface. The story's real risk surface is
// PROVEN here, not asserted:
//   (1) a compliance officer adjudicating ineligible with a reason → row frozen + attestation scheduled
//       + audit names the human + the reason (no PII).
//   (2) an empty/whitespace reason throws.
//   (3) an ops_diligence staff (no compliance.review / no freeze.execute) is DENIED adjudicate + f/thaw.
//   (4) setTokenAclState needs freeze.execute; a freeze flips + audits + schedules.
//   (5) screenAml is stub-guarded (refuses with unsafe stubs off) and records an amlFlag.
//   (6) the consumer recordEligibility path is UNAFFECTED by the new optional fields (regression).
//
// adjudicate/setTokenAclState SCHEDULE attestEligibilityOnChain via scheduler.runAfter(0). Fake timers +
// finishAllScheduledFunctions drain that job inside the test (same idiom as eligibility.mutations.test).
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });
const PRIVY_ID = "did:privy:test-5-1";

async function drainScheduled(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

async function seed(t: ReturnType<typeof convexTest>) {
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
    });
    const userId = await ctx.db.insert("users", {
      privyId: PRIVY_ID,
      kycStatus: "verified",
      walletAddress: "AaBbCcDdEeFfGgHhJjKkLmNpQrStUvWxYz1234567890",
      createdAt: Date.now(),
    });
    return { propertyId, userId };
  });
}

async function seedStaff(
  t: ReturnType<typeof convexTest>,
  s: { workosId: string; roles: string[]; email?: string; name?: string },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId: s.workosId,
      email: s.email ?? `${s.workosId}@vesper.co`,
      name: s.name ?? "Marcus Compliance",
      roles: s.roles as never,
      status: "active",
      createdAt: Date.now(),
    }),
  );
}

// Seed a consumer eligibility row so adjudication/freeze upsert one existing row (mirrors what
// recordEligibility would have written first).
async function seedEligibility(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  propertyId: Id<"properties">,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("eligibility", {
      userId,
      propertyId,
      eligible: true,
      jurisdiction: "United States",
      tokenAclState: "thawed",
    }),
  );
}

const asCompliance = (t: ReturnType<typeof convexTest>) => t.withIdentity(workos("user_compliance"));
const asOps = (t: ReturnType<typeof convexTest>) => t.withIdentity(workos("user_ops"));

async function readElig(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  propertyId: Id<"properties">,
) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("eligibility").collect();
    return rows.find((r) => r.userId === userId && r.propertyId === propertyId) ?? null;
  });
}

describe("adjudicateEligibility — compliance override → Token ACL, reason-bearing + audited", () => {
  test("ineligible + reason → row eligible:false + frozen, attestation scheduled, audit names human + reason", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"], email: "marcus@vesper.co" });
    await seedEligibility(t, userId, propertyId);

    const res = await asCompliance(t).mutation(api.compliance.adjudicateEligibility, {
      userId,
      propertyId,
      eligible: false,
      reason: "Sanctions-list hit on manual review",
    });
    expect(res).toEqual({ eligible: false, tokenAclState: "frozen" });
    await drainScheduled(t);

    const elig = await readElig(t, userId, propertyId);
    expect(elig?.eligible).toBe(false);
    expect(elig?.tokenAclState).toBe("frozen");
    expect(elig?.reviewedBy).toBe("marcus@vesper.co");
    expect(elig?.reviewReason).toBe("Sanctions-list hit on manual review");

    const audit = await auditRows(t);
    const adj = audit.find((a) => a.action === "compliance.eligibility.adjudicated");
    expect(adj?.actor).toBe("marcus@vesper.co"); // the named compliance human, never a system
    const meta = adj?.meta as { eligible: boolean; reason: string; propertyId: string };
    expect(meta.eligible).toBe(false);
    expect(meta.reason).toBe("Sanctions-list hit on manual review");
    // NO PII in the audit meta — no income/net worth/wallet ever.
    expect(JSON.stringify(adj?.meta)).not.toContain("AaBbCc");
  });

  test("eligible + reason → row thawed", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    // Start from a frozen row and thaw it via adjudication.
    await t.run(async (ctx) =>
      ctx.db.insert("eligibility", {
        userId,
        propertyId,
        eligible: false,
        jurisdiction: "United States",
        tokenAclState: "frozen",
      }),
    );

    const res = await asCompliance(t).mutation(api.compliance.adjudicateEligibility, {
      userId,
      propertyId,
      eligible: true,
      reason: "Cleared enhanced due diligence",
    });
    expect(res).toEqual({ eligible: true, tokenAclState: "thawed" });
    await drainScheduled(t);

    const elig = await readElig(t, userId, propertyId);
    expect(elig?.eligible).toBe(true);
    expect(elig?.tokenAclState).toBe("thawed");
  });

  test("empty / whitespace reason throws (reason is mandatory)", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    await seedEligibility(t, userId, propertyId);

    await expect(
      asCompliance(t).mutation(api.compliance.adjudicateEligibility, {
        userId,
        propertyId,
        eligible: false,
        reason: "   ",
      }),
    ).rejects.toThrow("non-empty reason");
  });

  test("re-adjudicating an identical decision is idempotent — one audit, no second attestation", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"], email: "marcus@vesper.co" });
    await seedEligibility(t, userId, propertyId);

    const args = { userId, propertyId, eligible: false as const, reason: "AML flag" };
    await asCompliance(t).mutation(api.compliance.adjudicateEligibility, args);
    await asCompliance(t).mutation(api.compliance.adjudicateEligibility, args);
    await drainScheduled(t);

    const adjudications = (await auditRows(t)).filter(
      (a) => a.action === "compliance.eligibility.adjudicated",
    );
    expect(adjudications).toHaveLength(1);
  });

  test("ops_diligence (no compliance.review) is DENIED adjudication", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    await seedEligibility(t, userId, propertyId);

    await expect(
      asOps(t).mutation(api.compliance.adjudicateEligibility, {
        userId,
        propertyId,
        eligible: false,
        reason: "should never apply",
      }),
    ).rejects.toThrow("Not permitted: compliance.review");
  });
});

describe("setTokenAclState — freeze.execute-gated ACL lever", () => {
  test("compliance freeze → row frozen, acl.frozen audited, attestation scheduled", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"], email: "marcus@vesper.co" });
    await seedEligibility(t, userId, propertyId); // starts thawed

    const res = await asCompliance(t).mutation(api.compliance.setTokenAclState, {
      userId,
      propertyId,
      state: "freeze",
    });
    expect(res).toEqual({ tokenAclState: "frozen" });
    await drainScheduled(t);

    const elig = await readElig(t, userId, propertyId);
    expect(elig?.tokenAclState).toBe("frozen");

    const audit = await auditRows(t);
    const frozen = audit.find((a) => a.action === "acl.frozen");
    expect(frozen?.actor).toBe("marcus@vesper.co");
  });

  test("ops_diligence (no freeze.execute) is DENIED freeze/thaw", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    await seedEligibility(t, userId, propertyId);

    await expect(
      asOps(t).mutation(api.compliance.setTokenAclState, { userId, propertyId, state: "freeze" }),
    ).rejects.toThrow("Not permitted: freeze.execute");
  });
});

describe("screenAml — stub-guarded AML input", () => {
  test("refuses when unsafe stubs are OFF", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    await seedEligibility(t, userId, propertyId);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VESPER_ENABLE_AML_STUB", "true");
    try {
      await expect(
        asCompliance(t).mutation(api.compliance.screenAml, { userId, propertyId, flag: "flagged" }),
      ).rejects.toThrow("AML screening is disabled");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("production refuses AML input even when its dedicated flag is true", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    await seedEligibility(t, userId, propertyId);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VESPER_ENABLE_AML_STUB", "true");
    await expect(
      asCompliance(t).mutation(api.compliance.screenAml, { userId, propertyId, flag: "flagged" }),
    ).rejects.toThrow("AML screening is disabled");
  });

  test("with the flag on (test env) records amlFlag + audits compliance.aml.screened", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"], email: "marcus@vesper.co" });
    await seedEligibility(t, userId, propertyId);

    await asCompliance(t).mutation(api.compliance.screenAml, { userId, propertyId, flag: "flagged" });

    const elig = await readElig(t, userId, propertyId);
    expect(elig?.amlFlag).toBe("flagged");
    const screened = (await auditRows(t)).find((a) => a.action === "compliance.aml.screened");
    expect(screened?.actor).toBe("marcus@vesper.co");
    expect((screened?.meta as { flag: string }).flag).toBe("flagged");
  });
});

describe("queues are compliance.review-gated", () => {
  test("listComplianceQueue returns display-safe cases; ops is denied", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    await seedEligibility(t, userId, propertyId);

    const queue = await asCompliance(t).query(api.compliance.listComplianceQueue, { propertyId });
    expect(queue).toHaveLength(1);
    expect(queue[0].userId).toBe(userId);
    expect(queue[0].tokenAclState).toBe("thawed");
    // Display-safe handle — never the raw full wallet.
    expect(queue[0].userHandle).not.toBe("AaBbCcDdEeFfGgHhJjKkLmNpQrStUvWxYz1234567890");

    await expect(
      asOps(t).query(api.compliance.listComplianceQueue, { propertyId }),
    ).rejects.toThrow("Not permitted: compliance.review");
  });
});

// Regression: the consumer recordEligibility path is UNAFFECTED by the new optional fields.
describe("consumer recordEligibility is unaffected by the compliance fields", () => {
  test("a US applicant still records eligible + thawed with no compliance fields set", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    // reset kyc so recordEligibility drives the transition
    await t.run(async (ctx) => ctx.db.patch(userId, { kycStatus: "none" }));

    const res = await t.withIdentity({ subject: PRIVY_ID }).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "United States",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    });
    expect(res).toEqual({ verified: true, eligible: true, regAAnnualLimit: 10_000 });
    await drainScheduled(t);

    const elig = await readElig(t, userId, propertyId);
    expect(elig?.eligible).toBe(true);
    expect(elig?.tokenAclState).toBe("thawed");
    // The consumer path leaves the compliance fields UNSET.
    expect(elig?.reviewedBy).toBeUndefined();
    expect(elig?.reviewReason).toBeUndefined();
    expect(elig?.amlFlag).toBeUndefined();
  });
});

// Admin Story 5.2 — Reg A+ cap OVERSIGHT. The pure `regACapStatus` helper MIRRORS settlement's
// enforcement rule (settlement.businessGateDecision: unset/non-finite limit blocks; invested at/above
// limit blocks), so the oversight view and the settlement gate can never disagree.
describe("regACapStatus — mirrors settlement's Reg A+ cap enforcement rule", () => {
  test("invested ABOVE the limit ⇒ over (blocking)", () => {
    const s = regACapStatus({ limit: 10_000, invested: 12_000 });
    expect(s.state).toBe("over");
    expect(s.remaining).toBe(-2_000);
  });

  test("invested exactly AT the limit ⇒ over (settlement blocks any further amount)", () => {
    const s = regACapStatus({ limit: 10_000, invested: 10_000 });
    expect(s.state).toBe("over");
    expect(s.remaining).toBe(0);
    expect(s.pctUsed).toBe(1);
  });

  test("no finite limit (unset) ⇒ over (blocking) — matching settlement's 'unset limit blocks'", () => {
    expect(regACapStatus({ limit: undefined, invested: 0 }).state).toBe("over");
    expect(regACapStatus({ limit: null, invested: 0 }).state).toBe("over");
    const nan = regACapStatus({ limit: Number.NaN, invested: 500 });
    expect(nan.state).toBe("over");
    expect(nan.limit).toBeNull();
  });

  test("≥80% of the cap consumed ⇒ near (headroom warning, not blocking)", () => {
    const at80 = regACapStatus({ limit: 10_000, invested: 8_000 });
    expect(at80.state).toBe("near");
    expect(at80.pctUsed).toBeCloseTo(0.8);
    expect(regACapStatus({ limit: 10_000, invested: 9_500 }).state).toBe("near");
  });

  test("below 80% consumed ⇒ ok", () => {
    const s = regACapStatus({ limit: 10_000, invested: 2_500 });
    expect(s.state).toBe("ok");
    expect(s.remaining).toBe(7_500);
    expect(s.pctUsed).toBeCloseTo(0.25);
  });

  test("missing invested defaults to 0 (never NaN/negative garbage)", () => {
    const s = regACapStatus({ limit: 10_000, invested: undefined });
    expect(s.invested).toBe(0);
    expect(s.remaining).toBe(10_000);
    expect(s.state).toBe("ok");
  });
});

describe("listCapUsage — compliance.review-gated Reg A+ cap oversight, no PII", () => {
  // Seed three investors with COMPUTED caps at different headroom levels + one with NO computed cap
  // (never surfaces in the oversight list). No income/net worth is stored on `users` at all.
  async function seedCapUsers(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const ok = await ctx.db.insert("users", {
        privyId: "did:privy:cap-ok",
        kycStatus: "verified",
        walletAddress: "OkWaLLeT111111111111111111111111111111111111",
        regAAnnualLimit: 10_000,
        regAInvestedThisYear: 2_000, // 20% → ok
        createdAt: Date.now(),
      });
      const near = await ctx.db.insert("users", {
        privyId: "did:privy:cap-near",
        kycStatus: "verified",
        walletAddress: "NeArWaLLeT2222222222222222222222222222222222",
        regAAnnualLimit: 10_000,
        regAInvestedThisYear: 9_000, // 90% → near
        createdAt: Date.now(),
      });
      const over = await ctx.db.insert("users", {
        privyId: "did:privy:cap-over",
        kycStatus: "verified",
        walletAddress: "OvErWaLLeT3333333333333333333333333333333333",
        regAAnnualLimit: 10_000,
        regAInvestedThisYear: 11_000, // over cap
        createdAt: Date.now(),
      });
      // No computed cap → excluded from oversight entirely.
      await ctx.db.insert("users", {
        privyId: "did:privy:cap-none",
        kycStatus: "pending",
        walletAddress: "NoNeWaLLeT4444444444444444444444444444444444",
        createdAt: Date.now(),
      });
      return { ok, near, over };
    });
  }

  test("returns display-safe cap rows for investors with a computed limit; ops is DENIED", async () => {
    const t = convexTest(schema, modules);
    await seedCapUsers(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });

    const rows = await asCompliance(t).query(api.compliance.listCapUsage, {});
    // Exactly the three with a computed cap — the no-cap investor is excluded.
    expect(rows).toHaveLength(3);
    const byState = Object.fromEntries(rows.map((r) => [r.state, r]));
    expect(byState.ok.remaining).toBe(8_000);
    expect(byState.near.state).toBe("near");
    expect(byState.over.remaining).toBe(-1_000);
    // Display-safe handle — never the raw full wallet.
    expect(rows.every((r) => !r.handle.includes("11111111"))).toBe(true);

    await expect(asOps(t).query(api.compliance.listCapUsage, {})).rejects.toThrow(
      "Not permitted: compliance.review",
    );
  });

  test("surfaces NO income/net-worth PII — only computed limit / invested / remaining / state", async () => {
    const t = convexTest(schema, modules);
    await seedCapUsers(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });

    const rows = await asCompliance(t).query(api.compliance.listCapUsage, {});
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        ["handle", "invested", "kycStatus", "limit", "remaining", "state", "userId"].sort(),
      );
    }
    const json = JSON.stringify(rows);
    expect(json).not.toContain("annualIncome");
    expect(json).not.toContain("netWorth");
  });

  test("state filter narrows to a single cap state", async () => {
    const t = convexTest(schema, modules);
    await seedCapUsers(t);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });

    const over = await asCompliance(t).query(api.compliance.listCapUsage, { state: "over" });
    expect(over).toHaveLength(1);
    expect(over[0].state).toBe("over");

    const near = await asCompliance(t).query(api.compliance.listCapUsage, { state: "near" });
    expect(near).toHaveLength(1);
    expect(near[0].state).toBe("near");
  });
});
