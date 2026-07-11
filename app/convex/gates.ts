import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { requireGateSigner } from "./sod";

// Admin Story 3.1 — the diligence GATE SIGNATURE CEREMONY. THE SPINE: "no property reaches an investor
// without every gate human-signed." This module builds the signing ceremony on top of the engines that
// already exist — it does NOT fork them:
//
//   • SoD (1-2): `signGate` is an ACTION that calls `requireGateSigner(ctx, propertyId, existingSigners)`
//     — the SINGLE entry point that enforces the `gate.sign` permission (platform_admin denied THERE, at
//     1-1's wall), the fee/listing-conflict wall, and the distinct-signer (no self-approval) wall, each
//     with a DURABLE blocked-attempt audit. This module never re-checks permission or conflict itself.
//   • Evidence (2-2): the workspace shows a gate's assembled `evidencePackages` as EVIDENCE with citations
//     (and any uncited field as a flag) — never as an approval. A package confers nothing; a HUMAN signs.
//   • AI is NEVER an approver (spine I4): signing structurally requires a WorkOS human resolved by
//     requireGateSigner. There is no code path by which a model/system signs — `signedByHuman` is only
//     ever a resolved staff name.
//
// Multi-party is DATA: `diligenceGates.multiParty` (seeded from GATE_DEFINITIONS) decides whether a gate
// passes at 1 signer or needs 2 DISTINCT signers. Doc-hash-on-chain is a STUBBED seam (see recordSignature).

// ── GATE_DEFINITIONS — the 8 diligence gates (PLACEHOLDER pending B3) ────────────────────────────────
// The labels mirror the seeded Monroe gates (properties.ts seedTheMonroe). `multiParty` is the B3
// DATA placeholder: gate 6 "Multi-party approval" needs two distinct signers; the rest need one. B3
// (which gates are multi-party + their evidence defs) becomes a DATA edit to this table + the schema
// field — NOT a rebuild. Keeping it here (one source) means beginGating and allGatesSigned agree.
export const GATE_DEFINITIONS: ReadonlyArray<{ gateNo: number; label: string; multiParty: boolean }> = [
  { gateNo: 0, label: "Sponsor vetting (KYB & UBO)", multiParty: false },
  { gateNo: 1, label: "Property existence & ownership", multiParty: false },
  { gateNo: 2, label: "Independent valuation & condition", multiParty: false },
  { gateNo: 3, label: "Legal, tax & regulatory", multiParty: false },
  { gateNo: 4, label: "Financial integrity", multiParty: false },
  { gateNo: 5, label: "On-chain binding", multiParty: false },
  { gateNo: 6, label: "Multi-party approval", multiParty: true }, // B3 placeholder: the one multi-party gate
  { gateNo: 7, label: "Continuous monitoring", multiParty: false },
];

// requiredSigners — the passing threshold for a gate: 2 for a multi-party gate, else 1. One definition
// so signGate's write and any reader agree on what "signed" means.
function requiredSigners(multiParty: boolean | undefined): number {
  return multiParty ? 2 : 1;
}

// allGatesSigned — the ADVANCEMENT gate. Returns true ONLY when every gate in GATE_DEFINITIONS exists
// for the property AND is `passed`. Exported as a plain helper so Story 3-2 (mint/list) can gate on it:
// a property cannot advance to mint/list while any gate is unsigned. Read-only; works on any read ctx.
export async function allGatesSigned(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<"properties">,
): Promise<boolean> {
  const gates = await ctx.db
    .query("diligenceGates")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  const passed = new Set(gates.filter((g) => g.status === "passed").map((g) => g.gateNo));
  return GATE_DEFINITIONS.every((d) => passed.has(d.gateNo));
}

// ── beginGating — start the ceremony for a property (gate.sign-gated, ops) ───────────────────────────
// Moves the property to status `"gating"` (pre-open, not investor-browsable) and creates the 8
// `diligenceGates` rows `status:"pending"` from GATE_DEFINITIONS. IDEMPOTENT: re-running never
// duplicates a gate row and never regresses a gate already signed — only missing rows are created.
export const beginGating = mutation({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args): Promise<{ created: number; status: string }> => {
    const staff: Doc<"staff"> = await requirePermission(ctx, "gate.sign");
    const actor = staff.email || staff.name || staff.workosId;

    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new Error("Property not found");

    // Only move a fresh (pre-open) property into gating — never pull a live open/funded/closed property
    // back into diligence. If it is already gating this is a harmless re-run.
    if (property.status !== "gating") {
      if (property.status !== "open") {
        // A funded/closed property is live on chain; refuse. An open one is allowed to begin gating only
        // if it has not yet been offered — but in this prototype tests seed a fresh property directly.
        throw new Error(`Cannot begin gating a ${property.status} property`);
      }
      await ctx.db.patch(args.propertyId, { status: "gating" });
    }

    const existing = await ctx.db
      .query("diligenceGates")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const haveGateNos = new Set(existing.map((g) => g.gateNo));

    let created = 0;
    for (const def of GATE_DEFINITIONS) {
      if (haveGateNos.has(def.gateNo)) continue; // idempotent — never duplicate or regress
      await ctx.db.insert("diligenceGates", {
        propertyId: args.propertyId,
        gateNo: def.gateNo,
        label: def.label,
        status: "pending",
        multiParty: def.multiParty,
        signerWorkosIds: [],
      });
      created++;
    }

    await writeAudit(ctx, {
      actor,
      action: "gate.gating.begun",
      target: args.propertyId,
      meta: { created, gates: GATE_DEFINITIONS.length },
    });

    return { created, status: "gating" };
  },
});

// ── loadGate — the action's read half (internal) ─────────────────────────────────────────────────────
// An action has no db; it hops through this to read the gate's current signer set + multiParty flag
// BEFORE calling the SoD engine. Returns null when the gate does not exist.
export const loadGate = internalQuery({
  args: { propertyId: v.id("properties"), gateNo: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    gateId: Id<"diligenceGates">;
    status: Doc<"diligenceGates">["status"];
    multiParty: boolean;
    signerWorkosIds: string[];
  } | null> => {
    const gate = await ctx.db
      .query("diligenceGates")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .filter((q) => q.eq(q.field("gateNo"), args.gateNo))
      .first();
    if (!gate) return null;
    return {
      gateId: gate._id,
      status: gate.status,
      multiParty: gate.multiParty ?? false,
      signerWorkosIds: gate.signerWorkosIds ?? [],
    };
  },
});

// ── recordSignature — the WRITE half of signGate (internal) ──────────────────────────────────────────
// Appends the (SoD-cleared) signer to the gate's distinct signer set, attaches the evidence package the
// signer acted on, and — ONLY when the distinct signer count reaches the requirement (2 for multi-party,
// else 1) — flips the gate to `passed` with `signedByHuman` (the resolved distinct human names, NEVER an
// AI) + `signedAt`. Audits `gate.signed`. Called ONLY from signGate AFTER requireGateSigner cleared the
// caller, so it performs no permission/SoD check itself.
//
// DOC-HASH-ON-CHAIN SEAM (deferred, B-series): a live impl would hash the attached evidence package and
// anchor that hash on Solana here, threading the tx signature into the audit's `onchainRef`. Stubbed to a
// comment for now — the ceremony, attribution, and advancement gate are real and testable without it.
export const recordSignature = internalMutation({
  args: {
    gateId: v.id("diligenceGates"),
    signerWorkosId: v.string(),
    signerActor: v.string(), // email/name for the audit actor (the named human, never a system)
    evidencePackageId: v.optional(v.id("evidencePackages")),
  },
  handler: async (ctx, args): Promise<{ passed: boolean; signerCount: number }> => {
    const gate = await ctx.db.get(args.gateId);
    if (!gate) throw new Error("Gate not found");
    if (gate.status === "passed") {
      // Already fully signed — nothing to add. Never regress or double-count.
      return { passed: true, signerCount: (gate.signerWorkosIds ?? []).length };
    }

    // Append the caller's IDENTITY if not already present (the SoD distinct-signer wall already ran in the
    // action; this guards a concurrent re-entry from double-counting one human).
    const signers = [...(gate.signerWorkosIds ?? [])];
    if (!signers.includes(args.signerWorkosId)) signers.push(args.signerWorkosId);

    const required = requiredSigners(gate.multiParty);
    const passed = signers.length >= required;

    const patch: Partial<Doc<"diligenceGates">> = {
      signerWorkosIds: signers,
    };
    if (args.evidencePackageId) patch.evidencePackageId = args.evidencePackageId;

    if (passed) {
      // Resolve the distinct human names for attribution — signedByHuman is NEVER an AI/system.
      const names: string[] = [];
      for (const wid of signers) {
        const s = await ctx.db
          .query("staff")
          .withIndex("by_workosId", (q) => q.eq("workosId", wid))
          .unique();
        names.push(s?.name || s?.email || wid);
      }
      patch.status = "passed";
      patch.signedByHuman = names.join(", ");
      patch.signedAt = Date.now();
    }
    await ctx.db.patch(args.gateId, patch);

    await writeAudit(ctx, {
      actor: args.signerActor, // the named human who signed — never a system
      action: "gate.signed",
      target: args.gateId,
      // onchainRef intentionally unset — the doc-hash-on-chain anchor is the deferred seam above.
      meta: {
        propertyId: gate.propertyId,
        gateNo: gate.gateNo,
        evidencePackageId: args.evidencePackageId ?? null,
        signerCount: signers.length,
        required,
        passed,
      },
    });

    return { passed, signerCount: signers.length };
  },
});

// ── signGate — the ceremony's public entry (ACTION) ──────────────────────────────────────────────────
// An ACTION (not a mutation) because it must run the SoD engine, whose durable blocked-attempt logging
// depends on an action's non-transactional scheduling (see sod.ts). Flow:
//   1. load the gate (internal query) → its current distinct-signer set + multiParty flag.
//   2. requireGateSigner(ctx, propertyId, existingSigners) — 1-2's SINGLE wall: permission (platform_admin
//      denied here), fee/listing conflict, and distinct-signer (self-approval on the SECOND sign of a
//      multi-party gate is blocked + durably audited). THROWS on any violation; nothing is written.
//   3. recordSignature (internal mutation) — append the cleared signer, attach evidence, pass when the
//      distinct-signer count meets the requirement.
export const signGate = action({
  args: {
    propertyId: v.id("properties"),
    gateNo: v.number(),
    evidencePackageId: v.optional(v.id("evidencePackages")),
  },
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<{ passed: boolean; signerCount: number }> => {
    const gate = await ctx.runQuery(internal.gates.loadGate, {
      propertyId: args.propertyId,
      gateNo: args.gateNo,
    });
    if (!gate) throw new Error("Gate not found");
    if (gate.status === "passed") {
      throw new Error("Gate is already fully signed");
    }

    // 1-2's SINGLE SoD entry point — permission (platform_admin denied), fee conflict, distinct signer.
    // Passing the gate's EXISTING signers is what makes the same human signing a multi-party gate twice a
    // blocked self-approval. Returns the caller's staff doc on success; throws (durably audited) otherwise.
    const staff: Doc<"staff"> = await requireGateSigner(ctx, args.propertyId, gate.signerWorkosIds);

    return await ctx.runMutation(internal.gates.recordSignature, {
      gateId: gate.gateId,
      signerWorkosId: staff.workosId,
      signerActor: staff.email || staff.name || staff.workosId,
      evidencePackageId: args.evidencePackageId,
    });
  },
});

// ── Read surface (all gate.sign-gated) ───────────────────────────────────────────────────────────────

// listGateProperties — the signer's property picker (id + name + status only). Like 2-1's
// listReviewableProperties, the ceremony needs a `gate.sign`-gated way to CHOOSE a property (reusing the
// consumer `listOpen` would leak the choice through an ungated surface and hide gating properties).
export const listGateProperties = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "gate.sign");
    const properties = await ctx.db.query("properties").take(200);
    return properties.map((p) => ({ id: p._id, name: p.name, status: p.status }));
  },
});

// gateWorkspace — the signer's per-property view: the gates 0..7 (status, distinct signers, threshold)
// and the property's assembled 2-2 evidence packages rendered as EVIDENCE (fields + citations, flags) —
// never as approvals. `allGatesSigned` is surfaced so the UI can show the advancement indicator.
// gate.sign-gated; read-only.
export const gateWorkspace = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "gate.sign");

    const property = await ctx.db.get(args.propertyId);
    if (!property) return null;

    const gateRows = await ctx.db
      .query("diligenceGates")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    gateRows.sort((a, b) => a.gateNo - b.gateNo);

    // Resolve signer identities → human names for display (attribution is always a named human).
    const nameCache = new Map<string, string>();
    async function resolveName(wid: string): Promise<string> {
      const hit = nameCache.get(wid);
      if (hit) return hit;
      const s = await ctx.db
        .query("staff")
        .withIndex("by_workosId", (q) => q.eq("workosId", wid))
        .unique();
      const name = s?.name || s?.email || wid;
      nameCache.set(wid, name);
      return name;
    }

    const gates = [];
    for (const g of gateRows) {
      const signerIds = g.signerWorkosIds ?? [];
      const signerNames: string[] = [];
      for (const wid of signerIds) signerNames.push(await resolveName(wid));
      const required = requiredSigners(g.multiParty);
      gates.push({
        id: g._id,
        gateNo: g.gateNo,
        label: g.label,
        status: g.status,
        multiParty: g.multiParty ?? false,
        required,
        signerCount: signerIds.length,
        signerNames,
        signedByHuman: g.signedByHuman ?? null,
        signedAt: g.signedAt ?? null,
        evidencePackageId: g.evidencePackageId ?? null,
        // How many MORE distinct signers this gate still needs to pass (0 once passed).
        remaining: g.status === "passed" ? 0 : Math.max(0, required - signerIds.length),
      });
    }

    // The property's assembled evidence packages, resolved to fields+citations. Evidence, never approval:
    // every field carries its status so an uncited field renders as a FLAG, never an established fact.
    const packageRows = await ctx.db
      .query("evidencePackages")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .order("desc")
      .collect();
    const evidencePackages = [];
    for (const pkg of packageRows) {
      const fields: {
        field: string;
        value: string;
        sourceRef: string | null;
        status: Doc<"extractedFields">["status"];
      }[] = [];
      for (const fid of pkg.fieldIds) {
        const f = await ctx.db.get(fid);
        if (!f) continue;
        fields.push({
          field: f.field,
          value: f.value,
          sourceRef: f.sourceRef ?? null,
          status: f.status,
        });
      }
      evidencePackages.push({
        id: pkg._id,
        gateNo: pkg.gateNo ?? null,
        status: pkg.status, // always "assembled" — never "approved"
        assembledBy: pkg.assembledBy,
        assembledAt: pkg.assembledAt,
        note: pkg.note ?? null,
        fields,
      });
    }

    return {
      property: { id: property._id, name: property.name, status: property.status },
      gates,
      evidencePackages,
      allGatesSigned: await allGatesSigned(ctx, args.propertyId),
    };
  },
});

// propertyGateStatus — the lightweight advancement read (the shape 3-2 gates mint/list on): each gate's
// status + the single `allGatesSigned` boolean. gate.sign-gated; read-only.
export const propertyGateStatus = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "gate.sign");
    const gateRows = await ctx.db
      .query("diligenceGates")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    gateRows.sort((a, b) => a.gateNo - b.gateNo);
    return {
      gates: gateRows.map((g) => ({ gateNo: g.gateNo, status: g.status })),
      allGatesSigned: await allGatesSigned(ctx, args.propertyId),
    };
  },
});
