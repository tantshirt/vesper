import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { requireStaff, requirePermission, permissionsForRoles, grantRoles, me } from "./rbac";

// Story 1.1 — the scope wall + per-request RBAC are the story's core claim, so they are proven here,
// not asserted. Every row of the spec's I/O matrix is a test. Both identity shapes are faked:
//   - WorkOS (staff): a recognized WorkOS issuer + subject.
//   - Privy (consumer): subject only — convex-test defaults its issuer to a NON-WorkOS value, so this
//     mirrors the existing consumer tests exactly (the wall is issuer-POSITIVE, never issuer-negative).
const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });
const privy = (subject: string) => ({ subject }); // no issuer → treated as consumer

type StaffSeed = {
  workosId: string;
  roles: string[];
  status?: "active" | "revoked";
  email?: string;
  name?: string;
};

async function seedStaff(t: ReturnType<typeof convexTest>, s: StaffSeed) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId: s.workosId,
      email: s.email ?? "priya@vesper.co",
      name: s.name ?? "Priya Desai",
      roles: s.roles as never,
      status: s.status ?? "active",
      createdAt: Date.now(),
    }),
  );
}

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

describe("requireStaff / requirePermission — the WorkOS half of the scope wall", () => {
  test("staff request, permitted → returns the staff doc", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });

    const staff = await t
      .withIdentity(workos("user_ops"))
      .run(async (ctx) => requirePermission(ctx, "property.read"));

    expect(staff.workosId).toBe("user_ops");
    expect(staff.name).toBe("Priya Desai");
  });

  test("staff request, NOT permitted (platform_admin → gate.sign) → throws Not permitted", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });

    await expect(
      t.withIdentity(workos("user_pa")).run(async (ctx) => requirePermission(ctx, "gate.sign")),
    ).rejects.toThrow("Not permitted: gate.sign");
  });

  test("unauthenticated → requireStaff throws Not authenticated", async () => {
    const t = convexTest(schema, modules);
    await expect(t.run(async (ctx) => requireStaff(ctx))).rejects.toThrow("Not authenticated");
  });

  test("consumer (Privy) token at an admin function → Not authenticated as staff", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(privy("did:privy:abc")).run(async (ctx) => requireStaff(ctx)),
    ).rejects.toThrow("Not authenticated as staff");
  });

  test("known WorkOS user with NO staff row → Not authenticated as staff (grant-only)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(workos("user_nobody")).run(async (ctx) => requireStaff(ctx)),
    ).rejects.toThrow("Not authenticated as staff");
  });

  test("revoked staff → Staff access revoked on every request", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_rev", roles: ["ops_diligence"], status: "revoked" });
    await expect(
      t.withIdentity(workos("user_rev")).run(async (ctx) => requireStaff(ctx)),
    ).rejects.toThrow("Staff access revoked");
  });
});

describe("the consumer half of the scope wall — a staff token must not reach consumer scope", () => {
  test("staff token at users.currentUser → resolves to null (no consumer row)", async () => {
    const t = convexTest(schema, modules);
    const user = await t.withIdentity(workos("user_x")).query(api.users.currentUser, {});
    expect(user).toBeNull();
  });

  test("staff token at users.ensureUser → throws AND manufactures no users row / no audit", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.withIdentity(workos("user_x")).mutation(api.users.ensureUser, {}),
    ).rejects.toThrow(); // "Not authenticated as a consumer"

    const { users, created } = await t.run(async (ctx) => ({
      users: await ctx.db.query("users").collect(),
      created: (await ctx.db.query("auditLog").collect()).filter((a) => a.action === "user.created"),
    }));
    expect(users).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  test("subject-only (Privy) identity STILL resolves to its consumer user — wall is issuer-positive", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) =>
      ctx.db.insert("users", { privyId: "did:privy:me", kycStatus: "none", createdAt: Date.now() }),
    );
    const user = await t.withIdentity(privy("did:privy:me")).query(api.users.currentUser, {});
    expect(user?.privyId).toBe("did:privy:me");
  });
});

describe("me — named human, derived permissions, no dead status field", () => {
  test("platform_admin: RBAC permissions present, NO operational permission", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Lee" });

    const result = await t.withIdentity(workos("user_pa")).query(api.rbac.me, {});
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Sam Lee"); // the named human, not "admin"
    expect(result!.permissions).toContain("rbac.manage");
    for (const op of ["gate.sign", "mint.execute", "freeze.execute", "distribution.execute"]) {
      expect(result!.permissions).not.toContain(op);
    }
    // No status field on the wire — a revoked member already resolves to null.
    expect(result).not.toHaveProperty("status");
  });

  test("revoked staff → me returns null", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_rev", roles: ["ops_diligence"], status: "revoked" });
    const result = await t.withIdentity(workos("user_rev")).query(api.rbac.me, {});
    expect(result).toBeNull();
  });

  test("consumer token → me returns null (never a staff read)", async () => {
    const t = convexTest(schema, modules);
    const result = await t.withIdentity(privy("did:privy:abc")).query(api.rbac.me, {});
    expect(result).toBeNull();
  });
});

describe("grantRoles — the crown jewel: internal-only, audited to the grantor, revoke-preserving", () => {
  test("grantRoles is an internalMutation — ABSENT from the public api surface", () => {
    // Registered internal functions carry isInternal; public ones carry isPublic. This is the
    // structural proof that no anonymous browser can reach the grant path over api.*.
    expect((grantRoles as unknown as { isInternal?: boolean }).isInternal).toBe(true);
    expect((grantRoles as unknown as { isPublic?: boolean }).isPublic).not.toBe(true);
    // Sanity: the public read surface (me) is genuinely public, so the assertion above is meaningful.
    expect((me as unknown as { isPublic?: boolean }).isPublic).toBe(true);
  });

  test("grant then me: a granted staff member resolves with their derived permissions", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.rbac.grantRoles, {
      workosId: "user_new",
      email: "new@vesper.co",
      name: "Nadia Vale",
      roles: ["compliance"],
      grantedBy: "Owner (deployment)",
    });
    const result = await t.withIdentity(workos("user_new")).query(api.rbac.me, {});
    expect(result!.name).toBe("Nadia Vale");
    expect(result!.permissions).toContain("compliance.review");
  });

  test("the staff.granted audit names the GRANTOR, not the grantee", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.rbac.grantRoles, {
      workosId: "user_bob",
      email: "bob@vesper.co",
      name: "Bob Grantee",
      roles: ["ops_diligence"],
      grantedBy: "Alice Authorizer",
    });
    const granted = (await auditRows(t)).filter((a) => a.action === "staff.granted");
    expect(granted).toHaveLength(1);
    expect(granted[0].actor).toBe("Alice Authorizer");
    expect(granted[0].target).toBe("user_bob");
  });

  test("a name/role edit does NOT silently reactivate revoked staff", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_rev", roles: ["ops_diligence"], status: "revoked" });

    // Re-grant to edit roles, WITHOUT passing status.
    await t.mutation(internal.rbac.grantRoles, {
      workosId: "user_rev",
      email: "rev@vesper.co",
      name: "Rev User",
      roles: ["compliance"],
      grantedBy: "Alice Authorizer",
    });

    const staff = await t.run(async (ctx) =>
      ctx.db
        .query("staff")
        .withIndex("by_workosId", (q) => q.eq("workosId", "user_rev"))
        .unique(),
    );
    expect(staff!.status).toBe("revoked"); // still revoked — not reactivated
    expect(staff!.roles).toEqual(["compliance"]); // but the edit did apply
  });

  test("an explicit status can reactivate, and empty required fields are rejected", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_rev", roles: ["ops_diligence"], status: "revoked" });

    await t.mutation(internal.rbac.grantRoles, {
      workosId: "user_rev",
      email: "rev@vesper.co",
      name: "Rev User",
      roles: ["compliance"],
      grantedBy: "Alice Authorizer",
      status: "active",
    });
    const staff = await t.run(async (ctx) =>
      ctx.db.query("staff").withIndex("by_workosId", (q) => q.eq("workosId", "user_rev")).unique(),
    );
    expect(staff!.status).toBe("active");

    await expect(
      t.mutation(internal.rbac.grantRoles, {
        workosId: "user_z",
        email: "",
        name: "",
        roles: ["compliance"],
        grantedBy: "Alice",
      }),
    ).rejects.toThrow();
  });
});

describe("permissionsForRoles — the single derivation path", () => {
  test("platform_admin carries no operational permission; ops_diligence does", () => {
    const pa = permissionsForRoles(["platform_admin"]);
    expect(pa).toContain("rbac.manage");
    for (const op of ["gate.sign", "mint.execute", "freeze.execute", "distribution.execute"]) {
      expect(pa).not.toContain(op);
    }
    const ops = permissionsForRoles(["ops_diligence"]);
    expect(ops).toContain("gate.sign");
    expect(ops).toContain("property.read");
  });

  test("empty roles → no permissions; unknown roles are ignored", () => {
    expect(permissionsForRoles([])).toEqual([]);
    expect(permissionsForRoles(["not_a_role"])).toEqual([]);
  });
});
