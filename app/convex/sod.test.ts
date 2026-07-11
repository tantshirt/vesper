import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { logBlockedAttempt, recordPropertyInterest, removePropertyInterest } from "./sod";
import { me } from "./rbac";

// Admin Story 1.2 — the SoD engine's two integrity walls are the story's core claim, so they are
// proven here, not asserted. The DURABILITY proof (a blocked attempt survives the caller's throw) is
// the AO2 mechanism: the entry point is an ACTION, so its ctx.scheduler.runAfter commits independently
// of the action's later throw. Fake timers + finishAllScheduledFunctions drain that scheduled log so we
// can query auditLog AFTER the throw and see the durable row.
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

async function seedProperty(t: ReturnType<typeof convexTest>) {
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
      email: s.email ?? "priya@vesper.co",
      name: s.name ?? "Priya Desai",
      roles: s.roles as never,
      status: "active",
      createdAt: Date.now(),
    }),
  );
}

describe("assertNoFeeConflict — the listing-revenue-vs-diligence wall (durable-block proof)", () => {
  test("fee-conflicted signer is blocked AND a durable sod.blocked audit exists AFTER the throw", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    // Record the fee interest through the audited internalMutation (the only recording path).
    await t.mutation(internal.sod.recordPropertyInterest, {
      workosId: "user_ops",
      propertyId,
      kind: "fee",
      recordedBy: "Compliance Officer",
    });

    // The signing attempt throws...
    await expect(
      t
        .withIdentity(workos("user_ops"))
        .action(internal.sod.requireGateSignerAction, { propertyId, existingSignerWorkosIds: [] }),
    ).rejects.toThrow("SoD: fee/listing interest bars signing this property");

    // ...and AFTER draining the scheduler, the durable blocked-attempt record is present. This is the
    // proof it survived the caller's rollback: it was written by a job scheduled from the action.
    await drainScheduled(t);
    const blocked = (await auditRows(t)).filter((a) => a.action === "sod.blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].actor).toBe("priya@vesper.co"); // names the human, not "system"
    expect(blocked[0].target).toBe(propertyId);
    expect((blocked[0].meta as { reason: string }).reason).toBe("sod.fee_conflict");
    expect((blocked[0].meta as { detail: { kind: string } }).detail.kind).toBe("fee");
  });

  test("removePropertyInterest clears the conflict — the same signer then passes", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    await t.mutation(internal.sod.recordPropertyInterest, {
      workosId: "user_ops",
      propertyId,
      kind: "listing",
      recordedBy: "Compliance Officer",
    });
    await t.mutation(internal.sod.removePropertyInterest, {
      workosId: "user_ops",
      propertyId,
      recordedBy: "Compliance Officer",
    });

    const staff = await t
      .withIdentity(workos("user_ops"))
      .action(internal.sod.requireGateSignerAction, { propertyId, existingSignerWorkosIds: [] });
    expect(staff.workosId).toBe("user_ops");

    const actions = (await auditRows(t)).map((a) => a.action);
    expect(actions).toContain("sod.interest.recorded");
    expect(actions).toContain("sod.interest.removed");
  });
});

describe("assertDistinctSigner — no self-approval (durable-block proof)", () => {
  test("caller already in the existing-signer set is blocked AND durably audits sod.self_approval", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });

    await expect(
      t.withIdentity(workos("user_ops")).action(internal.sod.requireGateSignerAction, {
        propertyId,
        existingSignerWorkosIds: ["user_ops"], // the caller is already a signer
      }),
    ).rejects.toThrow("SoD: a distinct second signer is required");

    await drainScheduled(t);
    const blocked = (await auditRows(t)).filter((a) => a.action === "sod.blocked");
    expect(blocked).toHaveLength(1);
    expect((blocked[0].meta as { reason: string }).reason).toBe("sod.self_approval");
  });

  test("self-approval is by IDENTITY, not display name — a namesake with a distinct workosId passes", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    // Same display name, different workosId than the existing signer.
    await seedStaff(t, { workosId: "user_twin", roles: ["ops_diligence"], name: "Priya Desai" });

    const staff = await t.withIdentity(workos("user_twin")).action(internal.sod.requireGateSignerAction, {
      propertyId,
      existingSignerWorkosIds: ["user_original"], // a DIFFERENT identity that also happens to be "Priya Desai"
    });
    expect(staff.workosId).toBe("user_twin");
  });
});

describe("requireGateSigner — permission gate first (the 1-1 wall), then SoD", () => {
  test("clean ops_diligence with no interest and excluded from the signer set → returns the staff doc", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"], name: "Priya Desai" });

    const staff = await t
      .withIdentity(workos("user_ops"))
      .action(internal.sod.requireGateSignerAction, {
        propertyId,
        existingSignerWorkosIds: ["user_someone_else"],
      });
    expect(staff.workosId).toBe("user_ops");
    expect(staff.name).toBe("Priya Desai");

    // No block was logged on a clean pass.
    await drainScheduled(t);
    const blocked = (await auditRows(t)).filter((a) => a.action === "sod.blocked");
    expect(blocked).toHaveLength(0);
  });

  test("platform_admin is denied at the PERMISSION step (no operational power) — no SoD leakage", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Lee" });

    await expect(
      t
        .withIdentity(workos("user_pa"))
        .action(internal.sod.requireGateSignerAction, { propertyId, existingSignerWorkosIds: [] }),
    ).rejects.toThrow("Not permitted: gate.sign");

    // Denied before any SoD wall ran → no sod.blocked record (it never reached the schedule).
    await drainScheduled(t);
    const blocked = (await auditRows(t)).filter((a) => a.action === "sod.blocked");
    expect(blocked).toHaveLength(0);
  });
});

describe("internal-only surface — the engine's write/log paths are absent from the public api", () => {
  test("recordPropertyInterest / removePropertyInterest / logBlockedAttempt are internalMutations, not on api", () => {
    for (const fn of [logBlockedAttempt, recordPropertyInterest, removePropertyInterest]) {
      expect((fn as unknown as { isInternal?: boolean }).isInternal).toBe(true);
      expect((fn as unknown as { isPublic?: boolean }).isPublic).not.toBe(true);
    }
    // Sanity: a genuinely public function (rbac.me) carries isPublic, so the checks above are meaningful
    // and not vacuously true for every registered function.
    expect((me as unknown as { isPublic?: boolean }).isPublic).toBe(true);
  });
});
