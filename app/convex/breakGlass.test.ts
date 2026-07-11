import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { MAX_BREAK_GLASS_MINUTES } from "./breakGlass";

// Story 1.4 — audited, time-boxed break-glass. The load-bearing claims are proven: mandatory reason,
// bounded expiry, a durable `breakglass.invoked` audit + compliance-visible record, and — the crux —
// an ACTIVE grant confers its scope through the one permission path while an EXPIRED (or revoked) one
// confers NOTHING.
const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

async function seedStaff(
  t: ReturnType<typeof convexTest>,
  s: { workosId: string; roles: string[]; status?: "active" | "revoked"; name?: string },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId: s.workosId,
      email: `${s.workosId}@vesper.co`,
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

describe("invokeBreakGlass — gate, validation, and bounded expiry", () => {
  test("a non-breakglass.use staff member is denied", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    await expect(
      t.withIdentity(workos("user_ops")).mutation(api.breakGlass.invokeBreakGlass, {
        workosId: "user_ops",
        scope: ["gate.sign"],
        reason: "emergency",
      }),
    ).rejects.toThrow("Not permitted: breakglass.use");
  });

  test("an empty reason throws", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });
    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.breakGlass.invokeBreakGlass, {
        workosId: "user_pa",
        scope: ["gate.sign"],
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/);
  });

  test("an over-long window is rejected", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });
    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.breakGlass.invokeBreakGlass, {
        workosId: "user_pa",
        scope: ["gate.sign"],
        reason: "too long",
        durationMinutes: MAX_BREAK_GLASS_MINUTES + 1,
      }),
    ).rejects.toThrow(/minutes/);
  });

  test("an unknown permission in scope throws", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });
    await expect(
      t.withIdentity(workos("user_pa")).mutation(api.breakGlass.invokeBreakGlass, {
        workosId: "user_pa",
        scope: ["not.a.permission"],
        reason: "typo",
      }),
    ).rejects.toThrow(/unknown permission/);
  });

  test("a valid invocation writes a breakglass.invoked audit, a compliance record, and a bounded expiry", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"], name: "Sam Admin" });

    const before = Date.now();
    const res = await t.withIdentity(workos("user_pa")).mutation(api.breakGlass.invokeBreakGlass, {
      workosId: "user_target",
      scope: ["gate.sign"],
      reason: "gate stuck, on-call authorized elevation",
    });
    const cap = before + MAX_BREAK_GLASS_MINUTES * 60_000;
    expect(res.expiresAt).toBeGreaterThan(before);
    expect(res.expiresAt).toBeLessThanOrEqual(cap + 1000);

    const invoked = (await auditRows(t)).filter((a) => a.action === "breakglass.invoked");
    expect(invoked).toHaveLength(1);
    expect(invoked[0].actor).toBe("Sam Admin");
    expect(invoked[0].target).toBe("user_target");

    // Compliance-visible record exists and is listed while active.
    const active = await t
      .withIdentity(workos("user_pa"))
      .query(api.breakGlass.listActiveBreakGlass, {});
    expect(active).toHaveLength(1);
    expect(active[0].workosId).toBe("user_target");
    expect(active[0].scope).toEqual(["gate.sign"]);
  });
});

describe("break-glass confers scope ONLY inside its time box", () => {
  test("an ACTIVE grant confers its scope through me / effectivePermissions", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });
    // Target holds ai_reviewer — no gate.sign from roles.
    await seedStaff(t, { workosId: "user_target", roles: ["ai_reviewer"], name: "Rae Target" });

    await t.withIdentity(workos("user_pa")).mutation(api.breakGlass.invokeBreakGlass, {
      workosId: "user_target",
      scope: ["gate.sign"],
      reason: "authorized emergency gate signing",
    });

    const me = await t.withIdentity(workos("user_target")).query(api.rbac.me, {});
    expect(me!.permissions).toContain("gate.sign"); // conferred by the active grant
    expect(me!.permissions).toContain("ai.review"); // still has its role permissions
  });

  test("an EXPIRED grant confers NOTHING", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_target", roles: ["ai_reviewer"] });
    // Insert a grant whose window already lapsed (status still "active", clock past expiresAt).
    await t.run(async (ctx) =>
      ctx.db.insert("breakGlass", {
        workosId: "user_target",
        scope: ["gate.sign"],
        reason: "lapsed elevation",
        invokedBy: "Sam Admin",
        createdAt: Date.now() - 2 * 60 * 60_000,
        expiresAt: Date.now() - 60 * 60_000, // one hour in the past
        status: "active",
      }),
    );

    const me = await t.withIdentity(workos("user_target")).query(api.rbac.me, {});
    expect(me!.permissions).not.toContain("gate.sign"); // lapsed → confers nothing
    expect(me!.permissions).toContain("ai.review"); // role permissions unaffected
  });

  test("a REVOKED grant confers nothing, even before expiry", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_pa", roles: ["platform_admin"] });
    await seedStaff(t, { workosId: "user_target", roles: ["ai_reviewer"] });

    const { id } = await t
      .withIdentity(workos("user_pa"))
      .mutation(api.breakGlass.invokeBreakGlass, {
        workosId: "user_target",
        scope: ["gate.sign"],
        reason: "elevation to be revoked",
      });

    // Confers while active.
    let me = await t.withIdentity(workos("user_target")).query(api.rbac.me, {});
    expect(me!.permissions).toContain("gate.sign");

    await t.withIdentity(workos("user_pa")).mutation(api.breakGlass.revokeBreakGlass, { id });

    // Confers nothing after revoke, though not yet expired.
    me = await t.withIdentity(workos("user_target")).query(api.rbac.me, {});
    expect(me!.permissions).not.toContain("gate.sign");

    // And it drops out of the active list.
    const active = await t
      .withIdentity(workos("user_pa"))
      .query(api.breakGlass.listActiveBreakGlass, {});
    expect(active).toHaveLength(0);

    const revoked = (await auditRows(t)).filter((a) => a.action === "breakglass.revoked");
    expect(revoked).toHaveLength(1);
  });
});

describe("listActiveBreakGlass — gated read", () => {
  test("a non-audit.read staff member is denied", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_sp", roles: ["sponsor_ops"] });
    await expect(
      t.withIdentity(workos("user_sp")).query(api.breakGlass.listActiveBreakGlass, {}),
    ).rejects.toThrow("Not permitted: audit.read");
  });
});
