---
title: 'Story 4.2 — Fund escrow + push distribution (no self-settle)'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 4.2)'
  - '_bmad-output/admin/C-UX-Scenarios/A2-push-a-distribution/A2-push-a-distribution.md'
depends_on: ['4-1 (built scheduled draft)', '1-1 (distribution.execute)', '1-3 (audit)', '3-2 (requireStepUp)', 'existing distributionPush + reconcile income path']
blocker_note: 'B1 (custody) → fundDistributionEscrow STUB seam (requireUnsafeStubs, like STUB-MINT/STUB-DIST). B2 (step-up) → requireStepUp (3-2). The push reuses the existing pushUsdcToHolder STUB-DIST- seam; the paid flip is owned by reconcile (income.reconciled) — Convex NEVER self-settles.'
---

## Intent

**Problem:** A built distribution draft (`4-1`, `scheduled` rows) must be **funded** (escrow, B1) and **pushed** on-chain, with the push stating consequence + cost + **finality** behind **step-up**, and — critically — **Convex must never self-settle**: a row flips `scheduled`→`paid` ONLY when the on-chain push is confirmed by the reconcile harness (`income.reconciled`). A push failure marks no one paid, is audited, and is retryable. The push primitive (`pushUsdcToHolder` `STUB-DIST-`) + the reconcile paid-flip already exist; this adds the operator trigger + escrow + step-up.

## Boundaries & Constraints

**Always:**
- **Fund before push.** `fundDistributionEscrow` (B1 STUB seam, `requireUnsafeStubs` — mirrors the other stubs) records escrow funded for `(propertyId, period)`; `pushDistribution` refuses unless the escrow is funded for that period.
- **Convex never self-settles.** `pushDistribution` runs the push (reuse `runDistributionPush`/`pushUsdcToHolder` STUB seam) and records the push signatures, but does NOT set `incomeLedger.status:"paid"`. The `scheduled`→`paid` flip is owned by **reconcile** (`income.reconciled`) when the on-chain push confirms — reuse it; a stub confirm (like `confirmMintStub`) routes through the reconcile path to flip paid.
- **Step-up + finality on the irreversible push.** `pushDistribution` calls `requireStepUp` (B2 stub, 3-2) and the UI states "pays N owners · $X · irreversible" before confirm.
- **Failure is safe + audited + retryable.** If the push seam fails, no row is marked paid, `distribution.push.failed` is audited, and the draft stays `scheduled` for retry (idempotent — a re-push doesn't double-pay).
- `distribution.execute`-gated (platform_admin denied). Audited (`distribution.escrow.funded`, `distribution.pushed`).

**Never:**
- Do not change the consumer `runDistributionPush`/`pushUsdcToHolder`/`incomeLedger` semantics or the reconcile income flip. Do not add a live custody vendor / server wallet / keys. Do not weaken 4-1. Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*`, `vesper_dvp/`. Do NOT `git commit`.

## Code Map

- `app/convex/schema.ts` — `distributionEscrow` (propertyId, period, fundedAmount, custodyRef, fundedBy, fundedAt; index `by_property_period`).
- `app/convex/distributionPay.ts` (**new**):
  - `fundDistributionEscrow` (mutation, `distribution.execute` + `requireUnsafeStubs("distribution escrow")`): assert a built `scheduled` draft exists for (property, period); upsert the escrow row (idempotent); audit `distribution.escrow.funded`. (B1 stub — the real custody deposit replaces the seam.)
  - `pushDistribution` (**action**, `distribution.execute`): resolve the draft; refuse unless escrow funded; `requireStepUp`; reuse `runDistributionPush` (STUB-DIST push) → record push signatures on the rows (`txSig`), status stays `scheduled`; audit `distribution.pushed`. On seam failure: audit `distribution.push.failed`, no paid flip, retryable. Idempotent (already-pushed rows aren't re-pushed).
  - `confirmDistributionStub` (mutation/action, `requireUnsafeStubs` + `distribution.execute`): routes a distribution-confirm through the reconcile `income.reconciled` path → flips the pushed rows `scheduled`→`paid` (chain-authoritative). The real path is Helius → reconcile.
  - `distributionPayStatus` (query, `distribution.execute`): per-period escrow + push + paid state for the console.
- `app/convex/distributionPay.test.ts` (**new**): push refuses without escrow; funded + step-up push records txSig but leaves rows `scheduled` (NOT paid — no self-settle); the reconcile/confirm stub flips them `paid`; a push failure marks none paid + audits `distribution.push.failed` + is retryable; a re-push doesn't double-pay; `platform_admin` denied; step-up stub gates the push.
- `admin/app/console/distribution/page.tsx` (extend, from 4-1) — fund + push actions (push stating consequence+cost+finality behind step-up), and a pay-status view (escrow / pushed / paid). Reuse 1-5 primitives.

## Acceptance Criteria
- Given a built draft with no escrow, when push is attempted, then refused; once funded + step-up, push records `txSig` on the rows but leaves them `scheduled` — Convex does not self-settle.
- Given the pushed rows, when the reconcile/confirm arrives, then they flip `scheduled`→`paid` (chain owns the flip).
- Given a push failure, then no row is `paid`, `distribution.push.failed` is audited, and a retry does not double-pay.
- Given `platform_admin`, then denied; given step-up disabled (stub off), then push refuses.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests (737) still pass.

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
