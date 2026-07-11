---
title: 'Story 6.2 — Sponsor intake checklist + validated upload + status timeline'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 6.2)'
  - '_bmad-output/admin/C-UX-Scenarios/A3-sponsor-intake/A3-sponsor-intake.md'
depends_on: ['6-1 (sponsorDeals, requireSponsor tenant isolation, KYB/Gate 0)', '1-3 (audit)', '1-5 (UI)']
---

## Intent

**Problem:** 6-1 gave sponsors a walled portal + KYB/Gate 0 + `startDeal`/`submitDeal`. Now Sofia (sponsor_ops) needs a **guided intake**: an explicit **checklist** of required documents, **validation on upload** (the wrong/incomplete doc rejected early with a plain reason), and a **diligence status timeline** (passed / pending / needs-you). All tenant-isolated. This completes the sponsor *submission* experience; internal review of the submission is Epic 3.

## Boundaries & Constraints

**Always:**
- **Tenant isolation via 6-1.** Every document/checklist read+write resolves the org through `requireSponsor` and asserts the deal belongs to that org (a crafted foreign `dealId` reads as not-found). Never trust a client-supplied orgId.
- **Validation on upload, with a plain reason.** `uploadDocument` checks the `kind` against the required checklist and rejects an unknown/duplicate/empty submission with a human-readable reason (`status:"rejected"`, `rejectReason`) rather than silently accepting it. A valid one is `status:"received"`.
- **Checklist gates submission** together with 6-1's KYB/Gate 0: `submitDeal` (already exists) must additionally require every required checklist item `received`. Extend the existing 6-1 `submitDeal` guard — do NOT fork a second submit path.
- **Status timeline is derived, not stored twice.** `dealTimeline` computes stage states {KYB/Gate 0, each checklist item, submitted} as passed/pending/needs-you from the existing rows — one source of truth.
- Sponsor.manage-gated writes; sponsor.read for reads. Audited to the sponsor human. 1-5 primitives.

**Never:**
- Do not build internal review of the submission (Epic 3), real file-content parsing/OCR, or a live storage vendor (the `storageRef` is an opaque locator; validation is on `kind`/metadata, not bytes). Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*` (consumer), or `vesper_dvp/`.
- Do not reuse `diligenceDocuments` (that table, from 2-1, is property-keyed / internal). Sponsor docs are DEAL-keyed and tenant-isolated — a separate table.

## Code Map

- `app/convex/schema.ts` — `sponsorDocuments` (dealId `v.id("sponsorDeals")`, kind, storageRef, status `received|rejected`, rejectReason?, uploadedBy, createdAt; index `by_deal`).
- `app/convex/roles.ts` (extend) — add a `sponsor.documents` permission ("Upload/manage sponsor deal documents") and grant it to **BOTH** `sponsor_principal` AND `sponsor_ops` (Sofia/ops does the uploading per her persona; `startDeal`/`submitDeal` stay `sponsor.manage` = principal-only). One catalog, single derivation path.
- `app/convex/sponsorIntake.ts` (**new**):
  - `REQUIRED_DOC_KINDS` — the checklist constant (e.g. title, valuation, financials, operating_history, legal).
  - `uploadDocument` (mutation, gated `sponsor.documents` so BOTH sponsor roles can upload): resolve org via `requireSponsor`, assert deal ∈ org; validate `kind ∈ REQUIRED_DOC_KINDS` and non-empty `storageRef`, else insert `status:"rejected"` + `rejectReason` and RETURN the rejection (do not throw — a bad upload is a business rejection, per the 1-2/1-4 lesson: durable, no rollback); a valid one inserts `status:"received"`. Audit `sponsor.doc.uploaded` / `sponsor.doc.rejected`.
  - `checklistStatus` (query, `sponsor.read`, org-scoped): each required kind → received | missing.
  - `dealTimeline` (query, `sponsor.read`, org-scoped): {kyb, each checklist item, submitted} → passed|pending|needs-you.
  - `listDealDocuments` (query, `sponsor.read`, org-scoped).
- `app/convex/sponsor.ts` (extend) — `submitDeal`: add "every REQUIRED_DOC_KIND is received" to the existing KYB gate (keep the single submit path; import the checklist check). Block with a plain reason listing what's missing.
- `app/convex/sponsorIntake.test.ts` (**new**): a valid upload → received; a wrong `kind` → rejected + reason (no throw, row persisted); tenant isolation (sponsor B cannot upload to / read sponsor A's deal docs → not-found/denied); checklist gates submit (missing item blocks even with KYB passed); the timeline reflects states; **`sponsor_ops` (Sofia) CAN upload and read** (holds `sponsor.documents`/`sponsor.read`); a NON-sponsor (internal ops staff) cannot upload; `startDeal` stays principal-only (`sponsor_ops` denied it).
- `admin/app/sponsor/page.tsx` (extend, from 6-1) — checklist (each item received/missing), upload control with inline validation/reject reason, and the status timeline (StatusChip states). Stays in the walled `/sponsor` tree.

## Acceptance Criteria
- Given the checklist, when a sponsor uploads a valid required doc, then it is `received` and shown on the checklist; when they upload a wrong/empty one, then it is `rejected` with a plain reason (persisted, no throw).
- Given a deal missing a required doc, when submission is attempted, then it is blocked listing what's missing — even if KYB passed.
- Given sponsor B, when they upload to or read sponsor A's deal, then not-found/denied (tenant isolation).
- Given `sponsor_ops` (Sofia), then they CAN upload and read their org's docs; a non-sponsor cannot.
- Given a deal, when the timeline renders, then KYB/checklist/submitted stages show passed/pending/needs-you from the live rows.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass.

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green (`/sponsor`) · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
