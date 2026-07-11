import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { writeAudit } from "./audit";
import { listAudit, exportAudit, EXPORT_CAP } from "./auditQueries";

// Story 1.3 — the audit read/export surface. Mirrors rbac.test.ts's idioms: a recognized WorkOS
// issuer + subject is staff; permissions are DERIVED from the seeded roles. The story's real claims —
// permission gating, onchainRef round-trip, append-only (no patch/delete on api), bounded export with
// truncation reported — are proven here, not asserted.
const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

const PAGE = { numItems: 50, cursor: null };

async function seedStaff(
  t: ReturnType<typeof convexTest>,
  workosId: string,
  roles: string[],
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId,
      email: `${workosId}@vesper.co`,
      name: `Staff ${workosId}`,
      roles: roles as never,
      status: "active",
      createdAt: Date.now(),
    }),
  );
}

describe("audit.read / audit.export gating", () => {
  test("compliance staff may listAudit and exportAudit", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "user_comp", ["compliance"]);

    const list = await t
      .withIdentity(workos("user_comp"))
      .query(api.auditQueries.listAudit, { paginationOpts: PAGE });
    expect(Array.isArray(list.page)).toBe(true);

    const exp = await t
      .withIdentity(workos("user_comp"))
      .query(api.auditQueries.exportAudit, {});
    expect(exp).toHaveProperty("rows");
    expect(exp).toHaveProperty("truncated");
  });

  test("platform_admin (oversight) may read+export; ops_diligence may read but NOT export", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "user_pa", ["platform_admin"]);
    await seedStaff(t, "user_ops", ["ops_diligence"]);

    await t.withIdentity(workos("user_pa")).query(api.auditQueries.listAudit, { paginationOpts: PAGE });
    await t.withIdentity(workos("user_pa")).query(api.auditQueries.exportAudit, {});

    // ops_diligence carries audit.read but not audit.export.
    await t.withIdentity(workos("user_ops")).query(api.auditQueries.listAudit, { paginationOpts: PAGE });
    await expect(
      t.withIdentity(workos("user_ops")).query(api.auditQueries.exportAudit, {}),
    ).rejects.toThrow("Not permitted: audit.export");
  });

  test("sponsor_ops is denied both listAudit and exportAudit", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "user_so", ["sponsor_ops"]);

    await expect(
      t.withIdentity(workos("user_so")).query(api.auditQueries.listAudit, { paginationOpts: PAGE }),
    ).rejects.toThrow("Not permitted: audit.read");
    await expect(
      t.withIdentity(workos("user_so")).query(api.auditQueries.exportAudit, {}),
    ).rejects.toThrow("Not permitted: audit.export");
  });

  test("an unauthenticated caller is refused before any read", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.auditQueries.listAudit, { paginationOpts: PAGE }),
    ).rejects.toThrow();
  });
});

describe("onchainRef round-trip + legacy rows", () => {
  test("an entry written with onchainRef surfaces it; a legacy entry without one reads as null", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "user_comp", ["compliance"]);

    await t.run(async (ctx) => {
      await writeAudit(ctx, {
        actor: "Priya Desai",
        action: "mint.execute",
        target: "prop_monroe",
        onchainRef: "5xSig111111111111111111111111111111111111111",
      });
      // Legacy-shape entry: no onchainRef (exactly what the 25 consumer callers write).
      await writeAudit(ctx, { actor: "System", action: "acl.thawed", target: "user_1" });
    });

    const list = await t
      .withIdentity(workos("user_comp"))
      .query(api.auditQueries.listAudit, { paginationOpts: PAGE });

    const withRef = list.page.find((r) => r.action === "mint.execute");
    const legacy = list.page.find((r) => r.action === "acl.thawed");
    expect(withRef?.onchainRef).toBe("5xSig111111111111111111111111111111111111111");
    expect(legacy?.onchainRef).toBeNull();
  });

  test("newest-first ordering", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "user_comp", ["compliance"]);
    await t.run(async (ctx) => {
      await ctx.db.insert("auditLog", { actor: "a", action: "first", target: "t", timestamp: 1_000 });
      await ctx.db.insert("auditLog", { actor: "a", action: "second", target: "t", timestamp: 2_000 });
    });
    const list = await t
      .withIdentity(workos("user_comp"))
      .query(api.auditQueries.listAudit, { paginationOpts: PAGE });
    expect(list.page[0].action).toBe("second");
    expect(list.page[1].action).toBe("first");
  });
});

describe("filters", () => {
  test("actor filter, target filter, and action prefix each narrow the trail", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "user_comp", ["compliance"]);
    await t.run(async (ctx) => {
      await ctx.db.insert("auditLog", { actor: "Alice", action: "acl.thawed", target: "u1", timestamp: 10 });
      await ctx.db.insert("auditLog", { actor: "Alice", action: "acl.frozen", target: "u2", timestamp: 20 });
      await ctx.db.insert("auditLog", { actor: "Bob", action: "mint.execute", target: "u1", timestamp: 30 });
    });
    const as = t.withIdentity(workos("user_comp"));

    const byActor = await as.query(api.auditQueries.listAudit, { paginationOpts: PAGE, actor: "Alice" });
    expect(byActor.page.map((r) => r.actor)).toEqual(["Alice", "Alice"]);

    const byTarget = await as.query(api.auditQueries.listAudit, { paginationOpts: PAGE, target: "u1" });
    expect(byTarget.page.map((r) => r.target)).toEqual(["u1", "u1"]);

    const byAction = await as.query(api.auditQueries.listAudit, { paginationOpts: PAGE, action: "acl" });
    expect(byAction.page.map((r) => r.action).sort()).toEqual(["acl.frozen", "acl.thawed"]);
  });
});

describe("append-only: no patch/delete path on api", () => {
  test("the audit surfaces on api are read-only queries; writeAudit is not exposed", () => {
    // listAudit / exportAudit are registered as QUERIES — a query ctx has no db.insert/patch/delete,
    // so neither can mutate auditLog. This is the structural proof that the read surface is read-only.
    expect((listAudit as unknown as { isQuery?: boolean }).isQuery).toBe(true);
    expect((listAudit as unknown as { isMutation?: boolean }).isMutation).not.toBe(true);
    expect((exportAudit as unknown as { isQuery?: boolean }).isQuery).toBe(true);
    expect((exportAudit as unknown as { isMutation?: boolean }).isMutation).not.toBe(true);

    // writeAudit is a bare helper (append-only insert), NOT a registered function: it carries none of
    // the registration flags, so file-based routing never puts it on `api` as a callable mutation. No
    // anonymous caller can reach a write, and there is deliberately no patch/delete helper to expose.
    const flags = writeAudit as unknown as {
      isMutation?: boolean;
      isQuery?: boolean;
      isPublic?: boolean;
    };
    expect(flags.isMutation).toBeUndefined();
    expect(flags.isQuery).toBeUndefined();
    expect(flags.isPublic).toBeUndefined();
  });
});

describe("exportAudit — bounded, truncation reported", () => {
  test("under the cap: not truncated, count matches", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "user_comp", ["compliance"]);
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("auditLog", { actor: "a", action: "x", target: "t", timestamp: i });
      }
    });
    const exp = await t.withIdentity(workos("user_comp")).query(api.auditQueries.exportAudit, {});
    expect(exp.count).toBe(5);
    expect(exp.truncated).toBe(false);
    expect(exp.cap).toBe(EXPORT_CAP);
  });

  test("over the cap: exactly EXPORT_CAP rows returned and truncated=true", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, "user_comp", ["compliance"]);
    await t.run(async (ctx) => {
      for (let i = 0; i < EXPORT_CAP + 1; i++) {
        await ctx.db.insert("auditLog", { actor: "a", action: "x", target: "t", timestamp: i });
      }
    });
    const exp = await t.withIdentity(workos("user_comp")).query(api.auditQueries.exportAudit, {});
    expect(exp.count).toBe(EXPORT_CAP);
    expect(exp.rows).toHaveLength(EXPORT_CAP);
    expect(exp.truncated).toBe(true);
  });
});
