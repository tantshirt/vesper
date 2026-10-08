---
title: 'Story 3.1 — Diligence workspace + gate signature ceremony ★ (the spine)'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 3.1)'
  - '_bmad-output/admin/C-UX-Scenarios/A1-list-a-property/A1-list-a-property.md'
depends_on: ['1-2 (requireGateSigner SoD, ActionCtx)', '2-2 (evidencePackages)', '1-3 (audit)', '1-5 (UI)']
blocker_note: 'B3 (which gates are multi-party + evidence defs) is modeled as DATA (GATE_DEFINITIONS + diligenceGates.multiParty). The seeded default (gate 6 multi-party) is a PLACEHOLDER pending B3 — B3 becomes a data edit, not a rebuild.'
---

## Intent

**Problem:** The whole product rests on "no property reaches an investor without every gate human-signed." The engine exists — SoD walls (`1-2`), the assembled evidence package (`2-2`), the `diligenceGates` rows — but there is **no signing ceremony**. This story builds it: an operator reviews each gate's evidence and **signs as a named human**, multi-party gates require a **distinct second signer**, a **fee-conflicted** signer is blocked, and a property **cannot advance to mint/list with any gate unsigned**. The AI never appears as an approver.

## Boundaries & Constraints

**Always:**
- **Signing goes through `1-2`'s `requireGateSigner` (ActionCtx) — do not fork the SoD checks.** It already enforces `gate.sign` permission (platform_admin denied), fee-vs-gate conflict, and distinct-signer (self-approval) with durable blocked-attempt audit. `signGate` is an **action** that calls it, then records the signature via an internal mutation.
- **Multi-party is DATA (B3 placeholder).** `GATE_DEFINITIONS` (the 8 gates from the brief; gate 6 "Multi-party approval" `multiParty:true`, others `false`) seeds `diligenceGates.multiParty`. A single-party gate passes at 1 signer; a multi-party gate passes only at **2 distinct** signers (enforced by passing the gate's existing `signerWorkosIds` into `requireGateSigner`). Flag this default as pending B3 in a comment.
- **AI is never an approver.** The workspace shows the `2-2` evidence package's fields as **evidence with citations** (and any AI flag as a flag) — never as an approval. No AI signature path exists (structural — signing requires a WorkOS human via `requireGateSigner`).
- **Advancement gate.** `allGatesSigned(ctx, propertyId)` returns true only when every `GATE_DEFINITIONS` gate is `passed`. `3-2` (mint/list) calls it; here, expose it + a `gateWorkspace` read.
- Every signature audits `gate.signed` (named human, gateNo, evidencePackageId). Doc-hash-on-chain is a **stubbed seam** (comment: real impl hashes the evidence package on-chain; deferred with B-series).

**Never:**
- Do not build the mint/listing (3-2) or distribution (4-x). Do not weaken 1-2. Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*` (consumer), or `vesper_dvp/`.

## Code Map

- `app/convex/schema.ts` — `diligenceGates` + `multiParty` (`v.optional(v.boolean())`), `signerWorkosIds` (`v.optional(v.array(v.string()))`), `evidencePackageId` (`v.optional(v.id("evidencePackages"))`). `properties.status` union + `"gating"` (pre-`open`).
- `app/convex/gates.ts` (**new**):
  - `GATE_DEFINITIONS` — the 8 `{gateNo, label, multiParty}` (PLACEHOLDER pending B3; gate 6 multiParty).
  - `beginGating` (mutation, `gate.sign`-gated, ops): for a property, set status `"gating"` and create the 8 `diligenceGates` rows `status:"pending"` from `GATE_DEFINITIONS` (idempotent). (A submitted sponsorDeal → gating property promotion can set `operatorSponsorOrgId`; keep lean — tests may seed a gating property directly.)
  - `signGate` (**action**): args `{propertyId, gateNo, evidencePackageId?}`. Load the gate (internal query); call `requireGateSigner(ctx, propertyId, existingSignerWorkosIds)` (1-2 — permission + fee + distinct); then `ctx.runMutation(internal.gates.recordSignature, ...)`: append the signer, attach `evidencePackageId`, and if signer count ≥ required (multiParty?2:1) set `status:"passed"` + `signedByHuman`/`signedAt`; audit `gate.signed`. (Doc-hash-on-chain seam noted, deferred.)
  - `recordSignature` (internalMutation) — the write half of `signGate`.
  - `gateWorkspace` (query, `gate.sign`): the property's gates (0–7) with status, signers, and the linked/available `2-2` evidence packages (evidence + flags, never approvals). `allGatesSigned` (exported helper) + `propertyGateStatus` (query).
- `app/convex/gates.test.ts` (**new**): sign a single-party gate → passed at 1 signer; a multi-party gate (6) is NOT passed at 1 signer and IS at 2 DISTINCT signers; the SAME human signing a multi-party gate twice is blocked (self-approval, via 1-2) with a durable `sod.blocked`; a fee-conflicted signer (recorded `staffPropertyInterest`) is blocked (1-2); `platform_admin` denied at the permission step; `allGatesSigned` is false until all 8 pass; there is no path for a non-human/AI to sign.
- `admin/app/console/diligence/gates/page.tsx` (**new**) OR extend the diligence area — the gate workspace: gates 0–7 with evidence (from 2-2), a sign action stating the consequence ("Signing Gate N attests … attributed to you, permanent in the audit log"), SoD blocks surfaced (loss-red, with the required distinct signer), and an all-gates-signed indicator. `gate.sign`-gated nav entry "Gates".

## Acceptance Criteria
- Given a gating property, when an operator signs a single-party gate, then it becomes `passed` attributed to the named human + audited.
- Given a multi-party gate, when one human signs, then it stays pending; when a distinct second human signs, then it passes; when the same human attempts both, then the second is blocked (self-approval) and durably audited.
- Given a signer with a recorded fee/listing interest in the property, when they sign, then blocked (1-2) + durably audited.
- Given `platform_admin`, when they sign, then denied (no operational power).
- Given any gate unsigned, then `allGatesSigned` is false (property cannot advance to mint/list).
- Given the workspace, when it renders, then AI evidence shows as flags/citations, never as an approval; no AI signature path exists.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests (697) still pass.

## Verify (from repo root)
`npm test` (697 + new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
