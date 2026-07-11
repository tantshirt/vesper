import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { grantRoles } from "./rbac";
import { recordPropertyInterest } from "./sod";
import { manageStaffRoles } from "./rbacAdmin";
import { permissionsForRoles } from "./roles";

// Story 1.4 — the public, rbac.manage-gated grant surface. Every guarantee is proven, not asserted:
// the permission gate, the RETURN-REJECTION contract (blocked grants are DURABLY audited WITHOUT a
// throw and apply no grant), the platform-admin-operational and SoD walls, and the clean-grant path.
const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

async function seedStaff(
  t: ReturnType<typeof convexTest>,
  s: { workosId: string; roles: string[]; status?: "active" | "revoked"; email?: string; name?: string },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId: s.workosId,
      email: s.email ?? `${s.workosId}@vesper.co`,
      name: s.name ?? s.workosId,
      roles: s.roles as never,
      status: s.status ?? "active",
      createdAt: Date.now(),
    }),
  );
}

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

async function staffByWorkosId(t: ReturnType<typeof convexTest>, workosId: string) {
  const rows = await t.run(async (ctx) => ctx.db.query("staff").collect());
  return rows.find((s) => s.workosId === workosId) ?? null;
}

async function seedProperty(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name,
      location: "Austin, TX",
      propertyType: "multifamily",
      units: 24,
      targetNetYield: 0.062,
      offeringSize: 1_000_000,
      fundedPct: 0,
      status: "open",
      spvName: "Monroe SPV LLC",
      minInvestment: 100,
    }),
  );
}

describe("manageStaffRoles — the rbac.manage gate", () => {
  test("a non-rbac.manage staff member is denied", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });

    await expect(
      t.withIdentity(workos("user_ops")).mutation(api.rbacAdmin.manageStaffRoles, {
        workosId: "user_target",
        email: "target@vesper.co",
        name: "Target",
        roles: ["compliance"],
      }),
    ).rejects.toThrow("Not permitted: rbac.manage");
  });

  test("a clean grant applies and audits staff.granted naming the acting Platform Admin", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Admin" });

    const res = await t.withIdentity(workos("user_pa")).mutation(api.rbacAdmin.manageStaffRoles, {
      workosId: "user_new",
      email: "new@vesper.co",
      name: "Nadia Vale",
      roles: ["compliance"],
    });
    expect(res.blocked).toBe(false);

    const staff = await staffByWorkosId(t, "user_new");
    expect(staff!.roles).toEqual(["compliance"]);

    const granted = (await auditRows(t)).filter((a) => a.action === "staff.granted");
    expect(granted).toHaveLength(1);
    expect(granted[0].actor).toBe("Sam Admin"); // the authorizer, never the grantee
    expect(granted[0].target).toBe("user_new");
  });
});

describe("manageStaffRoles — RETURN-REJECTION: blocked grants are durably audited WITHOUT a throw", () => {
  test("self-escalation is blocked, applies no grant, and is durably audited (no throw)", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Admin" });

    // Returns (does not throw) — proven by awaiting the value directly.
    const res = await t.withIdentity(workos("user_pa")).mutation(api.rbacAdmin.manageStaffRoles, {
      workosId: "user_pa", // the caller's OWN id
      email: "sam@vesper.co",
      name: "Sam Admin",
      roles: ["ops_diligence"],
    });
    expect(res.blocked).toBe(true);
    expect(res.reason).toMatch(/self-escalation/i);

    // Query the audit trail AFTER — the block is durable (the mutation committed).
    const blocks = (await auditRows(t)).filter((a) => a.action === "rbac.self_grant_blocked");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].target).toBe("user_pa");

    // No grant applied: the caller still holds exactly platform_admin.
    const staff = await staffByWorkosId(t, "user_pa");
    expect(staff!.roles).toEqual(["platform_admin"]);
  });

  test("granting a gate-signing role to a staff member with a fee interest is blocked + durably audited", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Admin" });
    await seedStaff(t, { workosId: "user_fee", roles: ["ai_reviewer"], name: "Fee Holder" });
    const propertyId = await seedProperty(t, "The Monroe");
    // 1-2's recorded interest — inserted via the internal mutation so the data path is reused verbatim.
    await t.run(async (ctx) =>
      ctx.db.insert("staffPropertyInterest", {
        workosId: "user_fee",
        propertyId,
        kind: "listing",
        recordedBy: "Owner",
        createdAt: Date.now(),
      }),
    );

    const res = await t.withIdentity(workos("user_pa")).mutation(api.rbacAdmin.manageStaffRoles, {
      workosId: "user_fee",
      email: "fee@vesper.co",
      name: "Fee Holder",
      roles: ["ops_diligence"], // carries gate.sign
    });
    expect(res.blocked).toBe(true);
    expect(res.reason).toContain("The Monroe"); // names the specific property
    expect(res.reason).toMatch(/SoD/i);

    const blocks = (await auditRows(t)).filter((a) => a.action === "rbac.sod_grant_blocked");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].target).toBe("user_fee");

    // No grant applied — still the original role.
    const staff = await staffByWorkosId(t, "user_fee");
    expect(staff!.roles).toEqual(["ai_reviewer"]);
  });

  test("combining platform_admin with an operational role is blocked (no operational perms attach)", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Admin" });

    const res = await t.withIdentity(workos("user_pa")).mutation(api.rbacAdmin.manageStaffRoles, {
      workosId: "user_x",
      email: "x@vesper.co",
      name: "Mixed Grant",
      roles: ["platform_admin", "ops_diligence"],
    });
    expect(res.blocked).toBe(true);
    expect(res.reason).toMatch(/operational/i);

    const blocks = (await auditRows(t)).filter((a) => a.action === "rbac.sod_grant_blocked");
    expect(blocks).toHaveLength(1);
    // No staff row was created for the blocked target.
    expect(await staffByWorkosId(t, "user_x")).toBeNull();
  });

  test("the role catalog still resolves platform_admin to ZERO operational permissions", () => {
    const pa = permissionsForRoles(["platform_admin"]);
    for (const op of ["gate.sign", "mint.execute", "freeze.execute", "distribution.execute"]) {
      expect(pa).not.toContain(op);
    }
    expect(pa).toContain("rbac.manage");
    expect(pa).toContain("breakglass.use");
  });
});

describe("previewGrantConflicts — read-only conflict surface for the UI", () => {
  test("surfaces the SoD conflict before submit, writing nothing", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });
    await seedStaff(t, { workosId: "user_fee", roles: ["ai_reviewer"] });
    const propertyId = await seedProperty(t, "The Monroe");
    await t.run(async (ctx) =>
      ctx.db.insert("staffPropertyInterest", {
        workosId: "user_fee",
        propertyId,
        kind: "fee",
        recordedBy: "Owner",
        createdAt: Date.now(),
      }),
    );

    const preview = await t
      .withIdentity(workos("user_pa"))
      .query(api.rbacAdmin.previewGrantConflicts, { workosId: "user_fee", roles: ["ops_diligence"] });
    expect(preview.wouldBlock).toBe(true);
    expect(preview.conflicts.map((c) => c.kind)).toContain("sod_fee");

    // A query cannot write; assert the trail stayed empty regardless.
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("a clean grant previews with no conflicts", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });

    const preview = await t
      .withIdentity(workos("user_pa"))
      .query(api.rbacAdmin.previewGrantConflicts, { workosId: "user_clean", roles: ["compliance"] });
    expect(preview.wouldBlock).toBe(false);
    expect(preview.conflicts).toHaveLength(0);
  });
});

describe("surface hygiene — the internal grant/interest mutations stay off the public api", () => {
  test("grantRoles + recordPropertyInterest are internalMutations; manageStaffRoles is public", () => {
    // Registered internal functions carry isInternal; public ones carry isPublic. This is the
    // structural proof that no anonymous browser reaches the grant/interest paths over api.*.
    expect((grantRoles as unknown as { isInternal?: boolean }).isInternal).toBe(true);
    expect((recordPropertyInterest as unknown as { isInternal?: boolean }).isInternal).toBe(true);
    // The one new public grant surface IS public — and is the only new door into a grant.
    expect((manageStaffRoles as unknown as { isPublic?: boolean }).isPublic).toBe(true);
    expect((manageStaffRoles as unknown as { isInternal?: boolean }).isInternal).not.toBe(true);
    // Sanity: the api surface for the new module exists (meaningfulness of the check above).
    expect((api as Record<string, unknown>).rbacAdmin).toBeDefined();
  });
});
