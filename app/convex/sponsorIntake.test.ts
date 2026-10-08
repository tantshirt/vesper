/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { REQUIRED_DOC_KINDS } from "./sponsorIntake";
import type { Id } from "./_generated/dataModel";

// Story 6.2 — the intake checklist + validation-on-upload + timeline. Proven, not asserted:
// validation rejects (durably, no throw), the checklist GATES submit alongside KYB, tenant isolation
// holds on every doc read/write, sponsor_ops (Sofia) CAN upload but still cannot start/submit, and a
// non-sponsor is barred. Identity idiom mirrors sponsor.test.ts (all staff are WorkOS).
const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

async function provision(
  t: ReturnType<typeof convexTest>,
  args: {
    workosId: string;
    role: "sponsor_principal" | "sponsor_ops";
    orgName?: string;
    sponsorOrgId?: Id<"sponsorOrgs">;
  },
): Promise<Id<"sponsorOrgs">> {
  return await t.mutation(internal.sponsor.provisionSponsor, {
    workosId: args.workosId,
    email: `${args.workosId}@sponsor.co`,
    name: "Sponsor Human",
    role: args.role,
    orgName: args.orgName,
    sponsorOrgId: args.sponsorOrgId,
    provisionedBy: "Owner (deployment)",
  });
}

// Upload EVERY required kind for a deal (helper for the "checklist complete" paths).
async function uploadAllRequired(
  t: ReturnType<typeof convexTest>,
  subject: string,
  dealId: Id<"sponsorDeals">,
) {
  for (const kind of REQUIRED_DOC_KINDS) {
    await t
      .withIdentity(workos(subject))
      .mutation(api.sponsorIntake.uploadDocument, { dealId, kind, storageRef: `ref://${kind}` });
  }
}

describe("validation on upload — received vs a durable rejection", () => {
  test("a valid required doc is received and appears on the checklist", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const dealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    const res = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsorIntake.uploadDocument, {
        dealId,
        kind: "title",
        storageRef: "ref://title.pdf",
      });
    expect(res.status).toBe("received");

    const checklist = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsorIntake.checklistStatus, { dealId });
    expect(checklist.find((c) => c.kind === "title")?.status).toBe("received");
    // Every OTHER required kind is still missing.
    expect(checklist.filter((c) => c.status === "missing").length).toBe(REQUIRED_DOC_KINDS.length - 1);

    const audit = await auditRows(t);
    expect(audit.find((a) => a.action === "sponsor.doc.uploaded")?.actor).toBe("sp_a@sponsor.co");
  });

  test("a WRONG kind is rejected with a plain reason — persisted, no throw", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const dealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    // Does NOT throw — returns the rejection.
    const res = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsorIntake.uploadDocument, {
        dealId,
        kind: "selfie",
        storageRef: "ref://selfie.jpg",
      });
    expect(res.status).toBe("rejected");
    expect(res.status === "rejected" && res.rejectReason).toMatch(/not a required document type/i);

    // The rejection row is DURABLE (persisted), and it does NOT satisfy the checklist.
    const docs = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsorIntake.listDealDocuments, { dealId });
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe("rejected");
    expect(docs[0].rejectReason).toBeTruthy();

    const checklist = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsorIntake.checklistStatus, { dealId });
    expect(checklist.every((c) => c.status === "missing")).toBe(true);

    const audit = await auditRows(t);
    expect(audit.some((a) => a.action === "sponsor.doc.rejected")).toBe(true);
  });

  test("an EMPTY storageRef is rejected with a distinct reason (no throw)", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const dealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    const res = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsorIntake.uploadDocument, {
        dealId,
        kind: "title",
        storageRef: "   ",
      });
    expect(res.status).toBe("rejected");
    expect(res.status === "rejected" && res.rejectReason).toMatch(/no file was provided/i);
  });
});

describe("the checklist GATES submission alongside KYB/Gate 0", () => {
  test("a missing required doc blocks submit — even with KYB passed", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const dealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    // KYB passes...
    await t.withIdentity(workos("sp_a")).mutation(api.sponsor.recordKyb, { result: "passed" });

    // ...but with NO documents, submit is still blocked, naming what's missing.
    await expect(
      t.withIdentity(workos("sp_a")).mutation(api.sponsor.submitDeal, { dealId }),
    ).rejects.toThrow(/Upload required documents first/i);

    // Upload all but one → still blocked.
    for (const kind of REQUIRED_DOC_KINDS.slice(0, -1)) {
      await t
        .withIdentity(workos("sp_a"))
        .mutation(api.sponsorIntake.uploadDocument, { dealId, kind, storageRef: `ref://${kind}` });
    }
    await expect(
      t.withIdentity(workos("sp_a")).mutation(api.sponsor.submitDeal, { dealId }),
    ).rejects.toThrow(/Upload required documents first/i);

    // Upload the last one → submit now succeeds.
    const last = REQUIRED_DOC_KINDS[REQUIRED_DOC_KINDS.length - 1];
    await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsorIntake.uploadDocument, { dealId, kind: last, storageRef: `ref://${last}` });

    const submitted = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.submitDeal, { dealId });
    expect(submitted).toBe(dealId);
  });

  test("KYB gate still fires FIRST when both KYB and docs are incomplete", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const dealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    // Neither KYB nor docs — the existing KYB message wins (single submit path, order preserved).
    await expect(
      t.withIdentity(workos("sp_a")).mutation(api.sponsor.submitDeal, { dealId }),
    ).rejects.toThrow("Complete KYB first");
  });
});

describe("the derived status timeline", () => {
  test("timeline reflects KYB / each checklist item / submitted states from live rows", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const dealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    // Fresh deal: KYB needs-you, every doc needs-you, submitted pending.
    let timeline = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsorIntake.dealTimeline, { dealId });
    expect(timeline.find((s) => s.key === "kyb")?.state).toBe("needs-you");
    expect(timeline.find((s) => s.key === "title")?.state).toBe("needs-you");
    expect(timeline.find((s) => s.key === "submitted")?.state).toBe("pending");

    // Pass KYB + upload everything → prerequisites met, submitted becomes needs-you (ready).
    await t.withIdentity(workos("sp_a")).mutation(api.sponsor.recordKyb, { result: "passed" });
    await uploadAllRequired(t, "sp_a", dealId);

    timeline = await t.withIdentity(workos("sp_a")).query(api.sponsorIntake.dealTimeline, { dealId });
    expect(timeline.find((s) => s.key === "kyb")?.state).toBe("passed");
    expect(timeline.filter((s) => REQUIRED_DOC_KINDS.includes(s.key as never)).every((s) => s.state === "passed")).toBe(true);
    expect(timeline.find((s) => s.key === "submitted")?.state).toBe("needs-you");

    // Submit → submitted becomes passed.
    await t.withIdentity(workos("sp_a")).mutation(api.sponsor.submitDeal, { dealId });
    timeline = await t.withIdentity(workos("sp_a")).query(api.sponsorIntake.dealTimeline, { dealId });
    expect(timeline.find((s) => s.key === "submitted")?.state).toBe("passed");
  });
});

describe("tenant isolation on every doc read/write", () => {
  test("sponsor B cannot upload to / read sponsor A's deal (not-found)", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    await provision(t, { workosId: "sp_b", role: "sponsor_principal", orgName: "Org B" });

    const aDealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    // B crafts A's real deal id → every doc read/write is not-found (never confirmed).
    await expect(
      t
        .withIdentity(workos("sp_b"))
        .mutation(api.sponsorIntake.uploadDocument, {
          dealId: aDealId,
          kind: "title",
          storageRef: "ref://x",
        }),
    ).rejects.toThrow("Deal not found");

    await expect(
      t.withIdentity(workos("sp_b")).query(api.sponsorIntake.checklistStatus, { dealId: aDealId }),
    ).rejects.toThrow("Deal not found");

    await expect(
      t.withIdentity(workos("sp_b")).query(api.sponsorIntake.dealTimeline, { dealId: aDealId }),
    ).rejects.toThrow("Deal not found");

    await expect(
      t.withIdentity(workos("sp_b")).query(api.sponsorIntake.listDealDocuments, { dealId: aDealId }),
    ).rejects.toThrow("Deal not found");

    // And A's deal has no docs written by B.
    const docs = await t
      .withIdentity(workos("sp_a"))
      .query(api.sponsorIntake.listDealDocuments, { dealId: aDealId });
    expect(docs).toHaveLength(0);
  });
});

describe("role split — sponsor_ops (Sofia) uploads; non-sponsor is barred", () => {
  test("sponsor_ops CAN upload + read docs, but still cannot start or submit a deal", async () => {
    const t = convexTest(schema, modules);
    // Principal + ops share ONE org (Sofia is ops in the same tenant).
    const orgId = await provision(t, {
      workosId: "sp_principal",
      role: "sponsor_principal",
      orgName: "Shared Co",
    });
    await provision(t, { workosId: "sp_ops", role: "sponsor_ops", sponsorOrgId: orgId });

    // Principal starts the deal (ops cannot).
    const dealId = await t
      .withIdentity(workos("sp_principal"))
      .mutation(api.sponsor.startDeal, { propertyName: "Shared Deal" });

    // sponsor_ops (holds sponsor.documents) CAN upload...
    const res = await t
      .withIdentity(workos("sp_ops"))
      .mutation(api.sponsorIntake.uploadDocument, {
        dealId,
        kind: "financials",
        storageRef: "ref://fin.xlsx",
      });
    expect(res.status).toBe("received");
    expect((await auditRows(t)).find((a) => a.action === "sponsor.doc.uploaded")?.actor).toBe(
      "sp_ops@sponsor.co",
    );

    // ...and CAN read the checklist.
    const checklist = await t
      .withIdentity(workos("sp_ops"))
      .query(api.sponsorIntake.checklistStatus, { dealId });
    expect(checklist.find((c) => c.kind === "financials")?.status).toBe("received");

    // But sponsor_ops still lacks sponsor.manage → cannot start (principal-only stays principal-only).
    await expect(
      t.withIdentity(workos("sp_ops")).mutation(api.sponsor.startDeal, { propertyName: "Nope" }),
    ).rejects.toThrow("Not permitted: sponsor.manage");

    // ...nor submit.
    await expect(
      t.withIdentity(workos("sp_ops")).mutation(api.sponsor.submitDeal, { dealId }),
    ).rejects.toThrow("Not permitted: sponsor.manage");
  });

  test("a NON-sponsor (internal ops staff) cannot upload a document", async () => {
    const t = convexTest(schema, modules);
    await provision(t, { workosId: "sp_a", role: "sponsor_principal", orgName: "Org A" });
    const dealId = await t
      .withIdentity(workos("sp_a"))
      .mutation(api.sponsor.startDeal, { propertyName: "A Tower" });

    // A pure internal staff row — no sponsor role, no membership.
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

    // requireSponsor bars them regardless of the deal id.
    await expect(
      t
        .withIdentity(workos("user_ops"))
        .mutation(api.sponsorIntake.uploadDocument, {
          dealId,
          kind: "title",
          storageRef: "ref://x",
        }),
    ).rejects.toThrow(/Not permitted: sponsor.documents|Not authorized as a sponsor/);
  });
});
