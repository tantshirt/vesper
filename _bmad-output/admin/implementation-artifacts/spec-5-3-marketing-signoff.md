---
title: 'Story 5.3 — Marketing sign-off gate (+ audit export already exists)'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 5.3)'
  - '_bmad-output/admin/C-UX-Scenarios/A4-compliance-signoff/A4-compliance-signoff.md'
depends_on: ['1-1 (compliance.review)', '1-3 (audit + exportAudit — the export half is DONE)', '5-1', '1-5']
blocker_note: 'B4 (Reg A+ pre-auth marketing limits) is POLICY the compliance officer APPLIES at sign-off (guidance/data), not hardcoded. The sign-off WORKFLOW is buildable now; B4 becomes the reviewer''s criteria, optionally captured as a policy note.'
---

## Intent — SCOPE NOTE (read first)

AE5.3 has two halves. The **audit-export** half is already built (`1-3`: `exportAudit`, `audit.export`-gated, append-only, attributable) — do NOT rebuild it; link to it. This story builds the remaining half: the **marketing sign-off gate** — public/marketing copy cannot ship without a counsel-gated (`compliance.review`) sign-off, or is blocked with notes. B4 (the Reg A+ marketing limits) is the reviewer's *criteria/policy*, applied at sign-off — not code.

## Boundaries & Constraints

**Always:**
- **Nothing ships unsigned.** Marketing/public content has a lifecycle `draft → signed_off | blocked`. Only `compliance.review` may sign off or block (with a required note on block). A helper `isMarketingSignedOff(content)` is the gate any public-render path would consult (wiring the consumer Explore/Property public copy to it is a NOTE — the workflow + gate is the deliverable).
- **Reason-bearing + audited.** `signOffMarketing` audits `compliance.marketing.signed_off`; `blockMarketing` requires a non-empty note and audits `compliance.marketing.blocked`. Both name the compliance human.
- **Reuse the existing export.** The "regulator-ready record" is `1-3`'s `exportAudit`; surface a link/entry to it from the compliance console (do not re-implement).
- `compliance.review`-gated sign-off/block; content submission may be a lighter role (ops/marketing) — gate submission on a sensible existing perm (e.g. `compliance.review` for MVP, or a submit that any staff can draft but only compliance signs). platform_admin denied sign-off.

**Never:**
- Do not rebuild audit export (1-3). Do not build the consumer public-render wiring (note it). Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*`, `vesper_dvp/`. Do NOT `git commit`.

## Code Map

- `app/convex/schema.ts` — `marketingContent` (propertyId `v.optional(v.id("properties"))`, kind, body, status `draft|signed_off|blocked`, submittedBy, reviewedBy?, reviewNote?, createdAt, reviewedAt?; index `by_status`).
- `app/convex/marketing.ts` (**new**):
  - `submitMarketingContent` (mutation): create a `draft` item; audit `marketing.submitted`.
  - `signOffMarketing` (mutation, `compliance.review`): set `signed_off` + reviewedBy/reviewedAt; audit `compliance.marketing.signed_off`. Refuse if already signed_off.
  - `blockMarketing` (mutation, `compliance.review`): require a non-empty note; set `blocked` + reviewNote; audit `compliance.marketing.blocked`.
  - `isMarketingSignedOff` (exported helper) + `listMarketingQueue`/`getMarketingItem` (queries, `compliance.review`).
- `app/convex/marketing.test.ts` (**new**): a draft cannot be treated as shippable (`isMarketingSignedOff` false) until signed off; a non-`compliance.review` staff cannot sign off/block (denied); block requires a note (empty throws); sign-off/block audit the named human; `platform_admin` denied sign-off.
- `admin/app/console/compliance/page.tsx` (extend, from 5-1/5-2) — a Marketing sign-off queue (draft items → sign off / block-with-note), status chips, and a link to the audit export (1-3). Reuse 1-5 primitives; no new nav entry (under Compliance).

## Acceptance Criteria
- Given draft marketing copy, when it awaits release, then `isMarketingSignedOff` is false and it cannot ship until a `compliance.review` officer signs it off; a block requires a note and records it.
- Given sign-off or block, then it is audited to the named compliance human.
- Given a non-`compliance.review` staff (or `platform_admin`), when they sign off/block, then denied.
- Given the regulator-ready record requirement, then it is satisfied by the existing `1-3` `exportAudit` (surfaced, not rebuilt).
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass.

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
