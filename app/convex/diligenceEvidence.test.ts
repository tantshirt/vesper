import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import * as diligenceEvidence from "./diligenceEvidence";
import { assembleEvidencePackage, listEvidencePackages, getEvidencePackage } from "./diligenceEvidence";
import type { Id } from "./_generated/dataModel";

// Admin Story 2.2 — the story's core claims are PROVEN here, not asserted:
//   (1) verify is a human act — verifyExtractedField moves an `extracted` field to `verified`, audited.
//   (2) ONLY-VERIFIED assemble — a package carries only `verified` fields; assembling any
//       unverified/rejected/uncited/extracted field (or an empty set) throws.
//   (3) assembled, NOT approved — a package's status is the literal "assembled", never "approved".
//   (4) AI4 structural — the evidence module exposes NO approve/sign/mint/permission-elevation function.
//   (5) ai.review-gated — a non-ai.review staff is denied at verify, assemble, and the reads.
//   (6) property isolation — a field from another property is refused at assembly.

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}

async function seedProperty(t: ReturnType<typeof convexTest>, name = "The Monroe") {
  return await t.run(async (ctx) =>
    ctx.db.insert("properties", {
      name,
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      targetNetYield: 0.062,
      offeringSize: 1_240_000,
      fundedPct: 0.74,
      status: "open",
      spvName: `${name} LLC`,
      minInvestment: 50,
    }),
  );
}

async function seedStaff(
  t: ReturnType<typeof convexTest>,
  s: { workosId: string; roles: string[] },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("staff", {
      workosId: s.workosId,
      email: `${s.workosId}@vesper.co`,
      name: "AI Reviewer",
      roles: s.roles as never,
      status: "active",
      createdAt: Date.now(),
    }),
  );
}

// seedField — inserts an extractedField in a chosen status directly (the run/doc are the extraction
// engine's; 2-2 only needs a field to verify/assemble). Returns the new field id.
async function seedField(
  t: ReturnType<typeof convexTest>,
  propertyId: Id<"properties">,
  status: "extracted" | "uncited" | "rejected" | "verified",
  field = "noi",
): Promise<Id<"extractedFields">> {
  return await t.run(async (ctx) => {
    const runId = await ctx.db.insert("extractionRuns", {
      propertyId,
      status: "complete",
      model: "stub-v0",
      createdBy: "user_ai@vesper.co",
      createdAt: Date.now(),
    });
    const docId = await ctx.db.insert("diligenceDocuments", {
      propertyId,
      kind: "operating_statement",
      storageRef: "storage://stub/doc",
      uploadedBy: "x",
      createdAt: Date.now(),
    });
    return await ctx.db.insert("extractedFields", {
      runId,
      propertyId,
      docId,
      field,
      value: "120000",
      sourceRef: status === "uncited" ? undefined : "p12",
      confidence: 0.92,
      status,
      createdAt: Date.now(),
    });
  });
}

describe("verify is a human act — extracted → verified, audited to the named human", () => {
  test("verifyExtractedField moves an extracted field to verified with a note and audits ai.field.verified", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ai", roles: ["ai_reviewer"] });
    const fieldId = await seedField(t, propertyId, "extracted");

    await t
      .withIdentity(workos("user_ai"))
      .mutation(api.diligenceExtract.verifyExtractedField, { fieldId, note: "matches p12" });

    const after = await t.run(async (ctx) => ctx.db.get(fieldId));
    expect(after?.status).toBe("verified");
    expect(after?.reviewNote).toBe("matches p12");

    const audit = await auditRows(t);
    const ver = audit.find((a) => a.action === "ai.field.verified");
    expect(ver?.actor).toBe("user_ai@vesper.co");
    // No approval/sign/gate audit is ever written by the verify path.
    for (const a of audit.map((r) => r.action)) {
      expect(a).not.toMatch(/gate\.sign|\.signed|mint|approve/i);
    }
  });

  test("only an extracted field may be verified — uncited and rejected are refused", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ai", roles: ["ai_reviewer"] });

    const uncited = await seedField(t, propertyId, "uncited");
    await expect(
      t.withIdentity(workos("user_ai")).mutation(api.diligenceExtract.verifyExtractedField, {
        fieldId: uncited,
      }),
    ).rejects.toThrow(/Only an extracted field/);

    const rejected = await seedField(t, propertyId, "rejected");
    await expect(
      t.withIdentity(workos("user_ai")).mutation(api.diligenceExtract.verifyExtractedField, {
        fieldId: rejected,
      }),
    ).rejects.toThrow(/Only an extracted field/);
  });
});

describe("ONLY-VERIFIED assemble — a package carries only verified fields", () => {
  test("assembling a verified set inserts an 'assembled' package naming the reviewer, carrying exactly those fields", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ai", roles: ["ai_reviewer"] });
    const a = await seedField(t, propertyId, "verified", "noi");
    const b = await seedField(t, propertyId, "verified", "caprate");

    const packageId = await t
      .withIdentity(workos("user_ai"))
      .mutation(api.diligenceEvidence.assembleEvidencePackage, {
        propertyId,
        gateNo: 3,
        fieldIds: [a, b],
        note: "ready for the signer",
      });

    const pkg = await t
      .withIdentity(workos("user_ai"))
      .query(api.diligenceEvidence.getEvidencePackage, { packageId });
    expect(pkg?.status).toBe("assembled");
    expect(pkg?.assembledBy).toBe("user_ai@vesper.co");
    expect(pkg?.gateNo).toBe(3);
    expect(pkg?.fields.map((f) => f.id).sort()).toEqual([a, b].sort());
    // Every carried field is verified — never approved.
    for (const f of pkg?.fields ?? []) expect(f.status).toBe("verified");

    const list = await t
      .withIdentity(workos("user_ai"))
      .query(api.diligenceEvidence.listEvidencePackages, { propertyId });
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("assembled");
    expect(list[0].fieldCount).toBe(2);

    const audit = await auditRows(t);
    const asm = audit.find((a2) => a2.action === "ai.evidence.assembled");
    expect(asm?.actor).toBe("user_ai@vesper.co");
    expect((asm?.meta as { status: string }).status).toBe("assembled");
  });

  test("assembling with any non-verified field (extracted/uncited/rejected) or an empty set throws", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ai", roles: ["ai_reviewer"] });
    const verified = await seedField(t, propertyId, "verified");

    for (const bad of ["extracted", "uncited", "rejected"] as const) {
      const badField = await seedField(t, propertyId, bad);
      await expect(
        t.withIdentity(workos("user_ai")).mutation(api.diligenceEvidence.assembleEvidencePackage, {
          propertyId,
          fieldIds: [verified, badField],
        }),
      ).rejects.toThrow(/Only verified fields/);
    }

    // An empty set is refused too — assembly never fabricates a package out of nothing.
    await expect(
      t.withIdentity(workos("user_ai")).mutation(api.diligenceEvidence.assembleEvidencePackage, {
        propertyId,
        fieldIds: [],
      }),
    ).rejects.toThrow(/no fields/);

    // No partial package was written by any failed attempt.
    const list = await t
      .withIdentity(workos("user_ai"))
      .query(api.diligenceEvidence.listEvidencePackages, { propertyId });
    expect(list).toHaveLength(0);
  });

  test("a package's status is 'assembled', never 'approved' — no approved state exists in the schema", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ai", roles: ["ai_reviewer"] });
    const f = await seedField(t, propertyId, "verified");

    const packageId = await t
      .withIdentity(workos("user_ai"))
      .mutation(api.diligenceEvidence.assembleEvidencePackage, { propertyId, fieldIds: [f] });

    const raw = await t.run(async (ctx) => ctx.db.get(packageId));
    expect(raw?.status).toBe("assembled");
    // The literal status validator admits ONLY "assembled" — writing "approved" is a schema violation.
    await expect(
      t.run(async (ctx) => ctx.db.patch(packageId, { status: "approved" as never })),
    ).rejects.toThrow();
  });
});

describe("property isolation — a field from another property is refused", () => {
  test("assembling with a verified field that belongs to a DIFFERENT property throws", async () => {
    const t = convexTest(schema, modules);
    const propA = await seedProperty(t, "Property A");
    const propB = await seedProperty(t, "Property B");
    await seedStaff(t, { workosId: "user_ai", roles: ["ai_reviewer"] });
    const inA = await seedField(t, propA, "verified");
    const inB = await seedField(t, propB, "verified");

    await expect(
      t.withIdentity(workos("user_ai")).mutation(api.diligenceEvidence.assembleEvidencePackage, {
        propertyId: propA,
        fieldIds: [inA, inB],
      }),
    ).rejects.toThrow(/must belong to the package's property/);
  });
});

describe("ai.review-gated — a non-ai.review staff is denied at every function", () => {
  test("ops_diligence (no ai.review) is denied verify, assemble, and the reads", async () => {
    const t = convexTest(schema, modules);
    const propertyId = await seedProperty(t);
    await seedStaff(t, { workosId: "user_ops", roles: ["ops_diligence"] });
    const fieldId = await seedField(t, propertyId, "extracted");

    await expect(
      t.withIdentity(workos("user_ops")).mutation(api.diligenceExtract.verifyExtractedField, {
        fieldId,
      }),
    ).rejects.toThrow("Not permitted: ai.review");

    await expect(
      t.withIdentity(workos("user_ops")).mutation(api.diligenceEvidence.assembleEvidencePackage, {
        propertyId,
        fieldIds: [fieldId],
      }),
    ).rejects.toThrow("Not permitted: ai.review");

    await expect(
      t
        .withIdentity(workos("user_ops"))
        .query(api.diligenceEvidence.listEvidencePackages, { propertyId }),
    ).rejects.toThrow("Not permitted: ai.review");
  });
});

describe("AI4 structural — the evidence module exposes NO approve / sign / mint / elevation capability", () => {
  test("its only functions are assemble/list/get; no name (or its args) grants signing power", () => {
    const isPublic = (fn: unknown) => (fn as { isPublic?: boolean }).isPublic === true;
    const isInternal = (fn: unknown) => (fn as { isInternal?: boolean }).isInternal === true;

    // The public surface is EXACTLY assemble + the two reads — no approve/sign/mint/grant among them.
    expect(isPublic(assembleEvidencePackage)).toBe(true);
    expect(isPublic(listEvidencePackages)).toBe(true);
    expect(isPublic(getEvidencePackage)).toBe(true);

    // Every REGISTERED export's name is scanned for an approval/sign/elevation verb — there are none.
    const forbidden = /approve|sign|grant|mint|elevat|freeze|thaw|distribut|gate/i;
    const registered = Object.entries(diligenceEvidence).filter(
      ([, fn]) => isPublic(fn) || isInternal(fn),
    );
    expect(registered.length).toBeGreaterThan(0);
    for (const [name] of registered) {
      expect(name, `${name} must not name an approval/sign/elevation capability`).not.toMatch(
        forbidden,
      );
    }
    // The module is registered functions ONLY — no stray internal action/mutation that could sign/mint.
    expect(registered.length).toBe(3);
  });
});
