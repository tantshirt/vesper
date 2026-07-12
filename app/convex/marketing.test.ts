import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isMarketingSignedOff } from "./marketing";

// Admin Story 5.3 — the MARKETING SIGN-OFF gate. The story's real risk surface is PROVEN here, not
// asserted:
//   (1) a fresh draft is NOT shippable (`isMarketingSignedOff` false) and STAYS unshippable until a
//       `compliance.review` officer signs it off — only then does the gate open.
//   (2) a non-`compliance.review` staff (ops) is DENIED sign-off AND block.
//   (3) `platform_admin` (holds no compliance.review) is DENIED sign-off.
//   (4) block REQUIRES a non-empty note (empty/whitespace throws) and records it.
//   (5) sign-off / block AUDIT the named compliance human.
//   (6) signing off an already-signed item is refused (a decision recorded once, not twice).
// The audit-export half (1-3 exportAudit) is NOT re-tested here — it is reused, not rebuilt.

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

const asCompliance = (t: ReturnType<typeof convexTest>) => t.withIdentity(workos("user_compliance"));
const asOps = (t: ReturnType<typeof convexTest>) => t.withIdentity(workos("user_ops"));
const asAdmin = (t: ReturnType<typeof convexTest>) => t.withIdentity(workos("user_admin"));

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

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

// Any active staff may draft copy — ops drafts, compliance signs. Returns the new item's id.
async function submitDraft(
  t: ReturnType<typeof convexTest>,
  as: ReturnType<typeof asCompliance>,
): Promise<Id<"marketingContent">> {
  const res = await as.mutation(api.marketing.submitMarketingContent, {
    kind: "property_headline",
    body: "The Monroe — 6.2% target net yield, fully diligence-gated.",
  });
  return res.id;
}

describe("isMarketingSignedOff — the shippability gate (pure)", () => {
  test("only a signed_off item is shippable; draft/blocked/absent are not", () => {
    expect(isMarketingSignedOff({ status: "signed_off" })).toBe(true);
    expect(isMarketingSignedOff({ status: "draft" })).toBe(false);
    expect(isMarketingSignedOff({ status: "blocked" })).toBe(false);
    expect(isMarketingSignedOff(null)).toBe(false);
    expect(isMarketingSignedOff(undefined)).toBe(false);
  });
});

describe("marketing sign-off gate — nothing ships unsigned", () => {
  test("a fresh draft is NOT shippable until a compliance officer signs it off", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"], email: "marcus@vesper.co" });

    const id = await submitDraft(t, asCompliance(t));

    // Draft: the gate is CLOSED.
    const draft = await asCompliance(t).query(api.marketing.getMarketingItem, { id });
    expect(draft?.status).toBe("draft");
    expect(isMarketingSignedOff(draft)).toBe(false);

    // The submission is audited to the named human.
    const submitted = (await auditRows(t)).find((a) => a.action === "marketing.submitted");
    expect(submitted?.actor).toBe("marcus@vesper.co");

    // Compliance signs off → the gate OPENS.
    const res = await asCompliance(t).mutation(api.marketing.signOffMarketing, { id });
    expect(res.status).toBe("signed_off");

    const signed = await asCompliance(t).query(api.marketing.getMarketingItem, { id });
    expect(signed?.status).toBe("signed_off");
    expect(isMarketingSignedOff(signed)).toBe(true);
    expect(signed?.reviewedBy).toBe("marcus@vesper.co");
    expect(signed?.reviewedAt).not.toBeNull();

    // The sign-off is audited to the named compliance human.
    const audit = (await auditRows(t)).find((a) => a.action === "compliance.marketing.signed_off");
    expect(audit?.actor).toBe("marcus@vesper.co");
    expect(audit?.target).toBe(id);
  });

  test("signing off an already-signed item is refused", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    const id = await submitDraft(t, asCompliance(t));

    await asCompliance(t).mutation(api.marketing.signOffMarketing, { id });
    await expect(
      asCompliance(t).mutation(api.marketing.signOffMarketing, { id }),
    ).rejects.toThrow("already signed off");
  });
});

describe("submitMarketingContent — internal staff only (sponsors excluded)", () => {
  test("a sponsor role is DENIED — platform marketing is not a sponsor's to draft", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_sponsor", roles: ["sponsor_ops"] });
    await expect(
      t.withIdentity(workos("user_sponsor")).mutation(api.marketing.submitMarketingContent, {
        kind: "property_headline",
        body: "Beacon Capital — invest now.",
      }),
    ).rejects.toThrow("Not authorized to submit marketing");
  });

  test("internal ops and compliance staff CAN submit a draft", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });

    const opsRes = await asOps(t).mutation(api.marketing.submitMarketingContent, {
      kind: "explore_blurb",
      body: "Diligence-gated real estate offerings.",
    });
    expect(opsRes.status).toBe("draft");

    const compRes = await asCompliance(t).mutation(api.marketing.submitMarketingContent, {
      kind: "email_blast",
      body: "This month's new offerings.",
    });
    expect(compRes.status).toBe("draft");
  });
});

describe("blockMarketing — refusal requires a note, audited to the human", () => {
  test("block with a note → blocked + reviewNote recorded + audited; stays unshippable", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"], email: "marcus@vesper.co" });
    const id = await submitDraft(t, asCompliance(t));

    const res = await asCompliance(t).mutation(api.marketing.blockMarketing, {
      id,
      note: "Yield claim exceeds Reg A+ pre-authorization marketing limits (B4).",
    });
    expect(res.status).toBe("blocked");

    const blocked = await asCompliance(t).query(api.marketing.getMarketingItem, { id });
    expect(blocked?.status).toBe("blocked");
    expect(blocked?.reviewNote).toBe(
      "Yield claim exceeds Reg A+ pre-authorization marketing limits (B4).",
    );
    expect(isMarketingSignedOff(blocked)).toBe(false); // blocked is NOT shippable

    const audit = (await auditRows(t)).find((a) => a.action === "compliance.marketing.blocked");
    expect(audit?.actor).toBe("marcus@vesper.co"); // the named compliance human
    expect((audit?.meta as { note: string }).note).toBe(
      "Yield claim exceeds Reg A+ pre-authorization marketing limits (B4).",
    );
  });

  test("an empty / whitespace note throws (a block naming no reason is unauditable)", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    const id = await submitDraft(t, asCompliance(t));

    await expect(
      asCompliance(t).mutation(api.marketing.blockMarketing, { id, note: "   " }),
    ).rejects.toThrow("non-empty note");
  });
});

describe("only compliance.review may sign off / block", () => {
  test("ops_diligence (no compliance.review) is DENIED sign-off AND block", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    // ops may draft (any active staff can), but may not decide.
    const id = await submitDraft(t, asOps(t));

    await expect(
      asOps(t).mutation(api.marketing.signOffMarketing, { id }),
    ).rejects.toThrow("Not permitted: compliance.review");
    await expect(
      asOps(t).mutation(api.marketing.blockMarketing, { id, note: "nope" }),
    ).rejects.toThrow("Not permitted: compliance.review");
  });

  test("platform_admin (holds no compliance.review) is DENIED sign-off", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    await seedStaff(t, { workosId: "user_admin", roles: ["platform_admin"] });
    const id = await submitDraft(t, asCompliance(t));

    await expect(
      asAdmin(t).mutation(api.marketing.signOffMarketing, { id }),
    ).rejects.toThrow("Not permitted: compliance.review");
  });

  test("the queue is compliance.review-gated; ops is denied", async () => {
    const t = convexTest(schema, modules);
    await seedStaff(t, { workosId: "user_compliance", roles: ["compliance"] });
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    await submitDraft(t, asCompliance(t));

    const queue = await asCompliance(t).query(api.marketing.listMarketingQueue, { status: "draft" });
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe("draft");

    await expect(
      asOps(t).query(api.marketing.listMarketingQueue, {}),
    ).rejects.toThrow("Not permitted: compliance.review");
  });
});
