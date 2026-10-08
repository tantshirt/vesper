import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";

// Admin Story 2.2 — human evidence VERIFICATION + ASSEMBLY, "assembled, not approved". This module
// closes AI4's human-in-the-loop: the AI extracted fields (2-1, cite-or-refuse), a human VERIFIED the
// ones that hold (verifyExtractedField, in diligenceExtract.ts), and here a human ASSEMBLES the verified
// set into an `evidencePackage`.
//
//   AI4 (absolute, structural): assembly is a HAND-OFF, never an approval. Everything here produces ONLY
//   `evidencePackages` rows whose status is the literal "assembled" — there is NO "approved"/"signed"
//   state anywhere. It imports NO signing/gate/mint/ACL/permission-elevation function, calls
//   requirePermission ONLY for "ai.review" (the reviewer role holds no `gate.sign`), and a package
//   confers nothing: the gate SIGNER (Story 3-1) READS it and signs a GATE — this row never grants
//   authority. The reviewer assembles evidence; a DIFFERENT human signs.
//
//   ONLY-VERIFIED invariant: a package may contain only fields with `status: "verified"` that belong to
//   the named property. `extracted` (unreviewed), `uncited` (no source), and `rejected` fields are
//   refused, and an empty set is refused — assembling never fabricates a package out of nothing.
//
// The gate ceremony / signing (3-1), mint, and document upload (6-2) do NOT live here.

// assembleEvidencePackage — the ai.review-gated assembly entry. It resolves the caller through 1-1's
// SINGLE permission path (a non-ai.review staff is denied HERE), then asserts EVERY field belongs to
// `propertyId` AND is `verified` — throwing on the first that isn't, and refusing an empty set. Only then
// does it insert the package `status:"assembled"` and audit `ai.evidence.assembled` to the named human.
// It writes NO approval and touches no gate/mint/ACL.
export const assembleEvidencePackage = mutation({
  args: {
    propertyId: v.id("properties"),
    gateNo: v.optional(v.number()),
    fieldIds: v.array(v.id("extractedFields")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"evidencePackages">> => {
    const staff: Doc<"staff"> = await requirePermission(ctx, "ai.review");
    const actor = staff.email || staff.name || staff.workosId;

    // Refuse an empty set — a package must carry verified evidence, never nothing.
    if (args.fieldIds.length === 0) {
      throw new Error("Cannot assemble an evidence package with no fields");
    }

    // Every field must exist, belong to THIS property, and be `verified`. Any violation throws — the
    // package is all-or-nothing, so a single unverified/cross-property field aborts the whole assembly.
    for (const fieldId of args.fieldIds) {
      const field = await ctx.db.get(fieldId);
      if (!field) throw new Error(`Extracted field not found: ${fieldId}`);
      if (field.propertyId !== args.propertyId) {
        throw new Error("Every field must belong to the package's property");
      }
      if (field.status !== "verified") {
        throw new Error(
          `Only verified fields may be assembled (field "${field.field}" is ${field.status})`,
        );
      }
    }

    const note = args.note?.trim();
    const packageId = await ctx.db.insert("evidencePackages", {
      propertyId: args.propertyId,
      gateNo: args.gateNo,
      fieldIds: args.fieldIds,
      status: "assembled", // ONLY ever "assembled" — never "approved"/"signed"
      assembledBy: actor,
      assembledAt: Date.now(),
      note: note || undefined,
    });

    await writeAudit(ctx, {
      actor, // the named reviewer who assembled — never a system
      action: "ai.evidence.assembled",
      target: packageId,
      meta: {
        propertyId: args.propertyId,
        gateNo: args.gateNo ?? null,
        fields: args.fieldIds.length,
        // Recorded explicitly so the audit trail can never read this as an approval.
        status: "assembled",
      },
    });

    return packageId;
  },
});

// listEvidencePackages — a property's assembled packages, newest first. ai.review-gated (the gate
// signer's read is wired in Story 3-1). Read-only; returns nothing that is an approval.
export const listEvidencePackages = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ai.review");
    const packages = await ctx.db
      .query("evidencePackages")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .order("desc")
      .collect();
    return packages.map((p) => ({
      id: p._id,
      propertyId: p.propertyId,
      gateNo: p.gateNo ?? null,
      fieldIds: p.fieldIds,
      fieldCount: p.fieldIds.length,
      status: p.status, // always "assembled"
      assembledBy: p.assembledBy,
      assembledAt: p.assembledAt,
      note: p.note ?? null,
    }));
  },
});

// getEvidencePackage — one assembled package with its verified fields resolved for reading. ai.review-
// gated. This is a READ; it confers nothing — the eventual signer (3-1) uses it to sign a GATE.
export const getEvidencePackage = query({
  args: { packageId: v.id("evidencePackages") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ai.review");
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg) return null;

    const fields: {
      id: Id<"extractedFields">;
      field: string;
      value: string;
      sourceRef: string | null;
      status: Doc<"extractedFields">["status"];
    }[] = [];
    for (const fieldId of pkg.fieldIds) {
      const f = await ctx.db.get(fieldId);
      if (!f) continue;
      fields.push({
        id: f._id,
        field: f.field,
        value: f.value,
        sourceRef: f.sourceRef ?? null,
        status: f.status,
      });
    }

    return {
      id: pkg._id,
      propertyId: pkg.propertyId,
      gateNo: pkg.gateNo ?? null,
      status: pkg.status, // always "assembled" — never "approved"
      assembledBy: pkg.assembledBy,
      assembledAt: pkg.assembledAt,
      note: pkg.note ?? null,
      fields,
    };
  },
});
