import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Story 3.2 — mutation-level coverage for the eligibility surface (the story's real risk surface:
// the eligibility→Token-ACL mirror, idempotent upsert, and audit writes). DOM-less; uses convex-test
// exactly like reconcile.test.ts. The pure limit/jurisdiction helpers are covered in eligibility.test.ts.

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const PRIVY_ID = "did:privy:test-3-2";

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
      kycStatus: "none",
      createdAt: Date.now(),
    });
    return { propertyId, userId };
  });
}

const asUser = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: PRIVY_ID });

async function auditActions(t: ReturnType<typeof convexTest>): Promise<string[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("auditLog").collect()).map((a) => a.action),
  );
}

describe("recordEligibility — eligibility→ACL mirror + audit", () => {
  test("US applicant → eligible + thawed, cap stored, verification + ACL audited", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);

    const res = await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "United States",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    });
    expect(res).toEqual({ verified: true, eligible: true, regAAnnualLimit: 10_000 });

    const { user, elig } = await t.run(async (ctx) => ({
      user: await ctx.db.get(userId),
      elig: await ctx.db
        .query("eligibility")
        .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
        .unique(),
    }));
    expect(user?.kycStatus).toBe("verified");
    expect(user?.regAAnnualLimit).toBe(10_000);
    expect(elig?.eligible).toBe(true);
    expect(elig?.tokenAclState).toBe("thawed");

    const actions = await auditActions(t);
    expect(actions).toContain("kyc.verified");
    expect(actions).toContain("eligibility.recorded");
    expect(actions).toContain("acl.thawed");
  });

  test("restricted jurisdiction → not eligible + frozen (never eligible/thawed)", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);

    const res = await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "Somewhere else",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    });
    expect(res.eligible).toBe(false);

    const elig = await t.run(async (ctx) =>
      ctx.db
        .query("eligibility")
        .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
        .unique(),
    );
    expect(elig?.eligible).toBe(false);
    expect(elig?.tokenAclState).toBe("frozen");
    expect(await auditActions(t)).toContain("acl.frozen");
  });

  test("identity failure → kycStatus failed, no eligibility row, no thaw", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);

    const res = await asUser(t).mutation(api.eligibility.recordEligibility, {
      propertyId,
      jurisdiction: "United States",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: false,
    });
    expect(res).toEqual({ verified: false });

    const { user, elig, actions } = await t.run(async (ctx) => ({
      user: await ctx.db.get(userId),
      elig: await ctx.db
        .query("eligibility")
        .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
        .unique(),
      actions: (await ctx.db.query("auditLog").collect()).map((a) => a.action),
    }));
    expect(user?.kycStatus).toBe("failed");
    expect(elig).toBeNull();
    expect(actions).toContain("kyc.failed");
    expect(actions).not.toContain("acl.thawed");
  });

  test("re-submitting identical data is idempotent — one row, no repeat eligibility/ACL audit", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);
    const args = {
      propertyId,
      jurisdiction: "United States",
      annualIncome: 100_000,
      netWorth: 50_000,
      verified: true,
    } as const;

    await asUser(t).mutation(api.eligibility.recordEligibility, args);
    await asUser(t).mutation(api.eligibility.recordEligibility, args);

    const { rows, recorded, thawed } = await t.run(async (ctx) => {
      const all = await ctx.db.query("auditLog").collect();
      return {
        rows: await ctx.db
          .query("eligibility")
          .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
          .collect(),
        recorded: all.filter((a) => a.action === "eligibility.recorded").length,
        thawed: all.filter((a) => a.action === "acl.thawed").length,
      };
    });
    expect(rows).toHaveLength(1);
    expect(recorded).toBe(1);
    expect(thawed).toBe(1);
  });

  test("unauthenticated caller is rejected", async () => {
    const t = convexTest(schema, modules);
    const { propertyId } = await seed(t);
    await expect(
      t.mutation(api.eligibility.recordEligibility, {
        propertyId,
        jurisdiction: "United States",
        annualIncome: 1,
        netWorth: 1,
        verified: true,
      }),
    ).rejects.toThrow();
  });
});

describe("joinWaitlist — idempotent, audited", () => {
  test("first join writes one row + audit; a repeat join is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { propertyId, userId } = await seed(t);

    const first = await asUser(t).mutation(api.eligibility.joinWaitlist, {
      propertyId,
      jurisdiction: "Somewhere else",
    });
    const second = await asUser(t).mutation(api.eligibility.joinWaitlist, {
      propertyId,
      jurisdiction: "Somewhere else",
    });
    expect(second).toEqual(first);

    const { rows, joins } = await t.run(async (ctx) => ({
      rows: await ctx.db
        .query("waitlist")
        .withIndex("by_user_property", (q) => q.eq("userId", userId).eq("propertyId", propertyId))
        .collect(),
      joins: (await ctx.db.query("auditLog").collect()).filter(
        (a) => a.action === "waitlist.joined",
      ).length,
    }));
    expect(rows).toHaveLength(1);
    expect(joins).toBe(1);
  });
});
