---
title: 'Story 4.1 — Distribution builder + matches-target'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 4.1)'
  - '_bmad-output/admin/C-UX-Scenarios/A2-push-a-distribution/A2-push-a-distribution.md'
depends_on: ['3-1/3-2/3-3 (a listed property)', '1-1 (distribution.execute)', '1-3 (audit)', '1-5', 'existing distribution.computeShares/runDistribution/splitDistribution']
---

## Intent

**Problem:** An operator needs to turn a closed month's operator numbers into a **draft distribution** — the gross→net waterfall (gross rent → costs → **management fee (already inside net — not re-charged)** → reserve → net-per-token) — and confirm the **net matches the offering's target yield** before any money moves (funding + push are `4-2`). The math already exists (`computeShares`/`runDistribution`/`splitDistribution`, consumer E5); this story adds the **`distribution.execute`-gated operator surface** + the **matches-target** check.

## Boundaries & Constraints

**Always:**
- **Reuse the existing waterfall math.** Build the draft by reusing `computeShares` + the `splitDistribution` gross→net split (mgmt fee is inside net — never re-charged) that `runDistribution` already uses. Do NOT reimplement the waterfall or fork a second one.
- **Draft, not paid.** `buildDistribution` produces `incomeLedger` rows `status:"scheduled"` (never `paid` — payment is 4-2). Idempotent per `(propertyId, period)` — rebuilding the same period updates the draft, never duplicates or double-counts.
- **Matches-target check.** Compute the resulting net yield vs the property's `targetNetYield`; return `{ matchesTarget: boolean, variance, reason? }`. A variance does NOT throw — it surfaces so the operator acknowledges it (the actual push gate is 4-2); but it must be visible before proceeding.
- **Gate on a listed property.** Only a listed (`status:"open"`) property with holders can be built against; a `gating`/unlisted one refuses.
- `distribution.execute`-gated (ops_diligence; platform_admin denied). Audited (`distribution.built`). No money moves here.

**Never:**
- Do not fund escrow or push on-chain (Story 4-2 — B1). Do not change the consumer `runDistribution`/`pushUsdcToHolder` behavior or `incomeLedger` semantics. Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*`, `vesper_dvp/`. Do NOT `git commit`.

## Code Map

- `app/convex/distributionBuild.ts` (**new**):
  - `buildDistribution` (mutation, `distribution.execute`-gated): args `{propertyId, period, grossRentDollars, costsDollars?}`; refuse unless the property is `open`; resolve holders (reuse `distributionTargets`/the same ownershipPct weighting `runDistribution` uses); compute the waterfall + per-holder `incomeLedger` `scheduled` rows (idempotent upsert per (user, property, period)); compute `matchesTarget` vs `targetNetYield`; audit `distribution.built` (meta: period, pool, net, matchesTarget, variance — no PII). Returns the summary + matchesTarget.
  - `distributionDraft` (query, `distribution.execute`): the built draft for a (property, period) — waterfall totals, per-holder rows count, net-per-unit, matchesTarget/variance.
  - `listDistributableProperties` (query, `distribution.execute`): listed properties with holders (gated picker, like 3-1's `listGateProperties`).
- `app/convex/distributionBuild.test.ts` (**new**): building creates `scheduled` rows with the internally-consistent waterfall (grossShare = costs+mgmtFee+reserve+netPaid; mgmt fee inside net, not re-charged); rebuilding the same period updates not duplicates; `matchesTarget` true when net ≈ target and false + variance otherwise; an unlisted (`gating`) property refuses; `platform_admin` denied `distribution.execute`; no row is `paid` (payment is 4-2).
- `admin/app/console/distribution/page.tsx` (**new**): the builder — property/period pick, gross/costs input, the waterfall (tabular; mgmt-fee-inside-net note), and a matches-target indicator (StatusChip). `distribution.execute`-gated "Distribution" nav entry.

## Acceptance Criteria
- Given operator numbers, when a distribution is built, then per-holder `scheduled` `incomeLedger` rows carry the gross→net waterfall (mgmt fee inside net, not re-charged), and the net-vs-target result (matches or variance+reason) is returned — with NO money moved and no row `paid`.
- Given a rebuild of the same period, then the draft updates in place (no duplicate/double-count).
- Given an unlisted property, then building refuses.
- Given `platform_admin`, then denied.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests (720ish) still pass — `runDistribution`/`pushUsdcToHolder` unchanged.

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
