---
title: 'Story 4.3 — Distribution reconciliation + paused-with-reason'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 4.3)'
  - '_bmad-output/admin/C-UX-Scenarios/A2-push-a-distribution/A2-push-a-distribution.md'
depends_on: ['4-1/4-2', '1-3 (audit)', 'existing reconcile income path + consumer income.ts + reconciliationStatus (3-3)']
---

## Intent

**Problem:** Two gaps remain in the distribute half: (1) the **reconciliation view** for distributions (the Helius-confirmed paid flip already exists via `income.reconciled` / `4-2`'s confirm; surface it), and (2) **paused-with-reason** — when a distribution can't proceed (insufficient cash flow, missing operator numbers), it must be **paused with an explicit reason that feeds the consumer's "why paused" income state — never silent.** The consumer income view already renders `missed` rows but stores no reason; this story records the reason and threads it through.

## Boundaries & Constraints

**Always:**
- **Never silent.** `pauseDistribution` requires a structured, non-empty reason. It flips the period's `scheduled` rows to `status:"missed"` + `pauseReason`, audits `distribution.paused` (reason + human). A paused period cannot be pushed (`4-2`) until resumed.
- **Feed the consumer.** Add an optional `pauseReason` to `incomeLedger` and surface it on the consumer income view's `missed` row (additive, read-only extension of `income.ts` — the row already renders; it just gains the reason). This is the story's whole point: the consumer's existing "explains why" state becomes real.
- **Reuse the reconcile paid-flip.** The `scheduled`→`paid` flip stays owned by reconcile (`income.reconciled`, `4-2`'s confirm). This story adds only the pause path + surfaces reconciliation status for distributions (reuse/extend `3-3`'s `reconciliationStatus` or add a distribution-scoped read); do NOT fork the reconcile path or self-settle.
- `distribution.execute`-gated (platform_admin denied). `resumeDistribution` flips `missed`→`scheduled` (reason resolved), audited.

**Never:**
- Do not change the reconcile `income.reconciled` behavior or the consumer income view beyond surfacing `pauseReason` (additive). Do not touch `admin/app/components/ui/*`, `globals.css`, `vesper_dvp/`. Do NOT `git commit`.

## Code Map

- `app/convex/schema.ts` — `incomeLedger` + optional `pauseReason` (`v.optional(v.union(v.literal("insufficient_cash_flow"), v.literal("missing_operator_numbers"), v.literal("other")))`) + optional `pauseNote`.
- `app/convex/distributionPay.ts` (extend, from 4-2):
  - `pauseDistribution` (mutation, `distribution.execute`): {propertyId, period, reason, note?}; require a valid reason; flip the period's `scheduled` rows → `missed` + `pauseReason`/`pauseNote`; audit `distribution.paused`. Refuse if already `paid`.
  - `resumeDistribution` (mutation, `distribution.execute`): flip `missed`→`scheduled` (clear pauseReason) for the period; audit `distribution.resumed`.
  - (`pushDistribution` from 4-2: ensure it refuses a `missed`/paused period — add the guard if not already implied.)
- `app/convex/income.ts` (consumer, minimal additive) — include `pauseReason`/`pauseNote` on the latest `missed` row output so the consumer "why paused" is real. Read-only, additive; do not change existing fields/behavior.
- `app/convex/distributionReconcile.test.ts` (**new**): pause requires a reason (empty throws) → rows `missed` + reason + audit; a paused period cannot be pushed (4-2) until resumed; resume flips back to `scheduled`; the consumer income view surfaces the `pauseReason` on the missed row; a confirmed push still reconciles to `paid` (reuse, unchanged); `platform_admin` denied pause/resume.
- `admin/app/console/distribution/page.tsx` (extend) — pause (reason picker) / resume actions + a reconciliation/status view (scheduled/pushed/paid/missed-with-reason). Reuse 1-5 primitives.

## Acceptance Criteria
- Given a distribution that can't proceed, when it is paused with a reason, then the period's rows become `missed` + `pauseReason`, it is audited (never silent), and it cannot be pushed until resumed.
- Given a paused distribution, when the consumer opens Income, then the missed row surfaces the reason (the "why paused" state is real).
- Given a resume, then rows flip back to `scheduled`.
- Given a pushed + confirmed distribution, then it still reconciles to `paid` (reuse unchanged); given `platform_admin`, pause/resume denied.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass (only the additive `pauseReason` surfacing changes consumer output).

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
