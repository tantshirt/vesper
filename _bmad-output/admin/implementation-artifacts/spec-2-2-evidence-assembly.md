---
title: 'Story 2.2 — Evidence verification + assembly ("assembled, not approved")'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 2.2)'
  - '_bmad-output/admin/C-UX-Scenarios/A5-ai-diligence-review/A5-ai-diligence-review.md'
depends_on: ['2-1 (extractedFields, diligence module + queries, ai.review)', '1-3 (audit)', '1-5 (UI primitives)']
---

## Intent

**Problem:** 2-1 produced AI `extractedFields` (with citations, cite-or-refuse). A human reviewer (Dana, `ai_reviewer`) must now **verify or reject** each field against its source, then **assemble** the verified evidence into a package **marked "assembled, not approved"** that routes to the gate signer (3-1). The reviewer must have **no sign capability** — she assembles evidence; a human *signer* acts on it later. This closes AI4's human-in-the-loop: AI extracts, a human verifies, a *different* human signs.

## Boundaries & Constraints

**Always:**
- **The reviewer never approves or signs.** `ai_reviewer` holds no `gate.sign` (1-1) — assembly produces an `evidencePackage` whose status is only ever `assembled` (never `approved`/`signed`). The module imports no signing/mint function (structural test, as in 2-1).
- **Only VERIFIED fields assemble.** A package may contain only fields with `status: "verified"`. `uncited`, `extracted` (unreviewed), and `rejected` fields are excluded — assembling with none throws.
- **Verify/reject are human, audited, note-bearing.** `verifyExtractedField` sets `verified` + optional note; reject reuses/extends 2-1's `rejectExtractedField`. Both audited to the named human.
- **The package is a hand-off, not an approval.** `assembleEvidencePackage` marks `assembled, assembledBy=<reviewer>, status:"assembled"` and audits `ai.evidence.assembled`. The gate signer (3-1) will READ it; assembly confers nothing.
- All functions `ai.review`-gated (assembly/verify) or readable by the eventual signer; reuse 1-1 `requirePermission`. 1-5 primitives for UI.

**Never:**
- Do not build the gate ceremony / signing (3-1), mint, or give assembly any approval/permission-elevation capability.
- Do not touch `admin/app/components/ui/*`, `globals.css`, `vesper_dvp/`.

## Code Map

- `app/convex/schema.ts` — `evidencePackages` (propertyId, gateNo `v.optional(v.number())`, fieldIds `v.array(v.id("extractedFields"))`, status `v.literal("assembled")`, assembledBy, assembledAt, note?; index `by_property`). (Deliberately no "approved" status — 3-1 signs a GATE, not this package.)
- `app/convex/diligenceExtract.ts` (extend) — `verifyExtractedField` (mutation, `ai.review`: set `status:"verified"` + optional `reviewNote`, audit `ai.field.verified`; only an `extracted` field may be verified — not an `uncited`/`rejected` one). Keep `rejectExtractedField` as is.
- `app/convex/diligenceEvidence.ts` (**new**) — `assembleEvidencePackage` (mutation, `ai.review`: takes propertyId + optional gateNo + fieldIds; asserts every field belongs to the property AND is `verified`; throws if any isn't or the set is empty; inserts the package `status:"assembled"`; audits `ai.evidence.assembled` with the reviewer). `listEvidencePackages` / `getEvidencePackage` (queries, `ai.review` — the gate signer read is wired in 3-1).
- `app/convex/diligenceEvidence.test.ts` (**new**) — verify moves a field to `verified`; assembling includes only verified fields; assembling with an unverified/rejected/uncited field throws; a package's status is `assembled`, never `approved`; the module exposes no sign/approve/mint capability (structural); non-`ai.review` denied; fields from another property are refused.
- `admin/app/console/diligence/page.tsx` (extend) — add per-field Verify/Reject actions (with note) and an "Assemble package" action over the verified set; show assembled packages with an explicit "Assembled — pending a human signer (not an approval)" label. Reuse 1-5 primitives; no new nav entry.

## Acceptance Criteria
- Given an `extracted` field, when the reviewer verifies it with a note, then it becomes `verified` and the action is audited to the named human.
- Given a mix of field statuses, when a package is assembled, then it contains only `verified` fields; assembling with any non-verified field (or an empty set) throws.
- Given an assembled package, when read, then its status is `assembled` (never `approved`), it names the assembler, and it is labelled a hand-off to a human signer.
- Given the evidence module, when scanned, then it exposes no approve/sign/mint/permission-elevation function.
- Given a non-`ai.review` staff member, when they verify or assemble, then denied.
- Given fields belonging to a different property, when assembly is attempted, then refused.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests (653) still pass.

## Verify (from repo root)
`npm test` (653 + new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
