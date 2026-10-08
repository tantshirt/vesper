---
title: 'Story 5.2 — Reg A+ cap: compliance oversight (enforcement already exists)'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 5.2)'
depends_on: ['1-1 (compliance.review)', '5-1', '1-5', 'existing settlement.ts cap gate + eligibility.computeRegALimit']
---

## Intent — SCOPE NOTE (read first)

**Reg A+ per-investor cap ENFORCEMENT already exists and is NOT rebuilt here.** `settlement.businessGateDecision` already blocks an over-cap purchase (`reason: "reg-a-cap"`; an unset limit blocks entirely), and `eligibility.computeRegALimit` computes the cap. This story therefore delivers only the **compliance OVERSIGHT** half of AE5.2: a `compliance.review` view of every investor's cap headroom (ok / near / over), single-sourcing the cap-status logic so the oversight view and the enforcement gate can never disagree. It deliberately does NOT touch the working consumer settlement path.

## Boundaries & Constraints

**Always:**
- **Single-source the cap-status logic.** Add a pure `regACapStatus({limit, invested})` helper (in `eligibility.ts`, next to `computeRegALimit`, or a small shared module) → `{ limit, invested, remaining, pctUsed, state: "no-limit" | "ok" | "near" | "over" }` (`near` = pctUsed ≥ 0.8; `over` = invested ≥ limit or no finite limit ⇒ blocking, matching settlement's "unset limit blocks"). The oversight view uses it; note in a comment that settlement's inline check is the enforcement authority and this helper mirrors its rule.
- Oversight reads are `requirePermission(ctx, "compliance.review")`-gated, expose **no income/net-worth PII** (only the computed limit + invested + state + a display-safe handle).
- Reuse the existing `users.regAAnnualLimit` / `users.regAInvestedThisYear` fields — read-only. Do NOT change how they are written.

**Never:**
- Do not modify `settlement.ts`, `eligibility.recordEligibility`, or any enforcement behavior. Do not rebuild cap enforcement. Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*`, `vesper_dvp/`.

## Code Map

- `app/convex/eligibility.ts` (extend) — export the pure `regACapStatus` helper (mirrors settlement's rule; unit-testable, no ctx).
- `app/convex/compliance.ts` (extend, from 5-1) — `listCapUsage` (query, `compliance.review`): investors with a computed limit, each with `{ handle, kycStatus, limit, invested, remaining, state }` via `regACapStatus`; support an optional `state` filter (e.g. only `near`/`over`). No PII.
- `app/convex/compliance.test.ts` (extend) — `regACapStatus` returns `over` at/above limit and for a missing limit, `near` at ≥80%, `ok` below; `listCapUsage` is `compliance.review`-gated (ops denied) and surfaces no income/net-worth; the state filter works.
- `admin/app/console/compliance/page.tsx` (extend, from 5-1) — a Cap-usage table (limit / invested / remaining / state chip), reusing 1-5 primitives; no new nav entry (lives under the existing Compliance page).

## Acceptance Criteria
- Given an investor at/over their cap, when the cap-usage view renders, then their state is `over`; at ≥80% `near`; below `ok`; with no finite limit, `over` (blocking) — matching settlement's enforcement rule.
- Given a non-`compliance.review` staff member, when they call `listCapUsage`, then denied.
- Given the view, when it renders, then no income/net-worth value appears (PII stays out).
- Given the consumer suite, when `npm test` runs, then all pre-existing tests (681) still pass — settlement untouched.

## Verify (from repo root)
`npm test` (681 + new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
