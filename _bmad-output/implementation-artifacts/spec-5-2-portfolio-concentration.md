---
title: 'Story 5.2 — Portfolio + concentration honesty'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: '2db17c5dbf4206fd8cc989feb195a19f7abb5e15'
final_revision: '388fde291507955e523a4148a2acf69d6bb50851'
---

<intent-contract>

## Intent

**Problem:** There is no `/portfolio` route — Home and Confirmation link their "portfolio" affordance to `/explore` as an interim (Story 5.1 / 4.5). FR13 requires an owner-facing Portfolio that shows per-holding value + this-month income and allocation-by-market, and — when any single market exceeds 35% of allocation — surfaces a calm warning + diversify nudge (never hidden).

**Approach:** Add a reactive, auth-scoped `portfolio.summary` Convex query that derives the whole model from data already in the read model (`holdings` cost basis, current-period paid `incomeLedger` rows, held `properties.location`) — no new authoritative state, no writes. Compute allocation-by-market (grouping cost basis by `location`) and flag the top market when its share strictly exceeds 0.35, server-side and unit-tested. Build the `/portfolio` route mirroring Home's state ladder, with per-holding rows, token-driven allocation bars, and the calm concentration nudge; repoint the Home and Confirmation portfolio affordances to `/portfolio`.

## Boundaries & Constraints

**Always:** Portfolio renders only from data in hand and never writes — per-holding value = `holding.costBasis` (same cost-basis model as Home 5.1; no live NAV); this-month income = Σ `netPaid` over `incomeLedger` rows with `status:"paid"` AND `period === periodFor(now)`, attributed to the holding's property; **market** = `property.location` (the only geographic field); allocation-by-market groups holdings' cost basis by resolved `location`, market share = market value / Σ total value, guarded to 0 when total ≤ 0; the **concentration warning fires when the top market's share strictly exceeds 0.35** (`CONCENTRATION_THRESHOLD`), names that market and its share, and offers a calm diversify nudge (link to Explore) — never hidden, never alarming. The query resolves the caller server-side from the JWT (`getUserIdentity()` → `by_privyId`) and returns `null` when unauthenticated or unprovisioned — the client-supplied identity is never trusted. Money uses tabular numerals via the existing `formatUsd`; one champagne accent max per screen; WCAG 2.2 AA (44px targets, ≥1 focus target, allocation bars carry an accessible text equivalent), no layout shift. All copy is crypto-vocabulary-clean (asserted by the shared `hasCryptoVocabulary` guard); no wallet/token/on-chain terms and no raw distribution `txSig` surface. Styling is token-only (`check:tokens` clean; bars + nudge via `var(--…)`/`color-mix`, the nudge on `--warning`).

**Block If:** A compliance/offering decision mandates a portfolio-valuation basis other than cost basis, OR a concentration/diversification-disclosure model that differs from the ">35% market nudge" (a different threshold, allocation basis, or a required legend/disclosure) — either changes what the numbers *mean*, not just how they render, and is not an unattended build choice.

**Never:** Do **not** build `/income` (Story 5.3), the gross→net waterfall, or a distribution scheduler — Portfolio shows only per-property this-month `netPaid`, never an itemized breakdown. Do **not** invent live NAV/appreciation or annualized returns (value = cost basis). Do **not** add authoritative balance/allocation state or write ownership/money from Portfolio (read-only surface). Do **not** seed a second market as production data or alter Explore/funding to fabricate diversification (the no-warning branch is proven by unit tests; a live demo of it is deferred). Do **not** surface crypto vocabulary or raw `txSig`, and do **not** add a pie-chart/charting dependency — reuse the token bar primitive.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Concentrated | authed; holdings put the top market's cost-basis share > 35% | Per-holding rows (value + this-month income) + allocation-by-market bars + calm concentration nudge naming the market & its share + diversify CTA | No error |
| Diversified | authed; holdings spread so every market's share ≤ 35% | Per-holding rows + allocation bars; **no** concentration nudge | No error |
| This-month income | authed; a `paid` `incomeLedger` row for the current period on a held property | That holding shows this month's income (Σ `netPaid`, current period, paid only); other holdings show $0 | No error |
| Empty (authed, no holdings) | authed, provisioned, zero holdings | Calm start state (no bars/nudge) + link to Explore | No error |
| Unauthenticated | no Privy session / no user row | `summary` = `null` → signed-out welcome (Sign in / Explore) | No error |
| Zero total value | holdings exist but Σ `costBasis` = 0 | Allocation pct = 0 (never Infinity/NaN); no nudge fires | No throw |
| Threshold boundary | top market share == 0.35 exactly | No nudge (strictly-greater-than) | No throw |
| Copy invariant | every `PORTFOLIO_COPY` value + rendered nudge string | `hasCryptoVocabulary(value) === false` | Test-enforced |

</intent-contract>

## Code Map

- `app/convex/portfolio.ts` -- **NEW**. Pure exports (no ctx): `CONCENTRATION_THRESHOLD` (0.35); `buildAllocations(positions)` (group `{market, value}` by market → `{market, value, pct}`, `pct = value / total` guarded to 0 when total ≤ 0, sorted by value desc); `selectConcentration(allocations, threshold)` (the top allocation whose `pct > threshold`, else null); `monthIncomeByProperty(rows, period)` (Σ `netPaid` over `status:"paid"` rows matching `period`, keyed by `propertyId`). Plus the `summary` **query** (auth-scoped; resolves user; collects `holdings`/`incomeLedger` `by_user`; fetches held `properties` via `ctx.db.get`; emits per-holding rows `{propertyId, name, market, value, monthIncome}`, `allocations`, totals, and `concentration`; `null` when unauth/unprovisioned). Reuse `periodFor` from `./home`.
- `app/convex/portfolio.test.ts` -- **NEW** convex-test: `summary` across every matrix state (concentrated, diversified, this-month income, empty, unauth→null, zero-value) + pure-helper units (allocation grouping/sort/pct, concentration boundary at exactly 0.35 vs >0.35, month-income period/status filter).
- `app/app/portfolio.helpers.ts` -- **NEW**. `PORTFOLIO_COPY` (crypto-clean: eyebrow, title, holdings + allocation section labels, this-month label, empty-state + signed-out copy, concentration nudge title + body, diversify CTA, explore CTA); `PortfolioSummary`/`PortfolioHolding` types; `portfolioViewState(summary)` → `"empty" | "holdings"`; `formatAllocationPct(fraction)` → unsigned whole-percent (e.g. `"72%"`); `allocationBarWidth(fraction)` → clamped `"NN%"`; `formatConcentrationNudge(market, fraction)` → the calm sentence. Reuse `formatUsd`, `hasCryptoVocabulary` from `./invest/[id]/invest.helpers`. Pure, no JSX/DOM.
- `app/app/portfolio.helpers.test.ts` -- **NEW** vitest: `portfolioViewState` branches, `formatAllocationPct`/`allocationBarWidth` (0, mid, 1, over-1 clamp), `formatConcentrationNudge`, and the no-crypto-vocabulary invariant over every `PORTFOLIO_COPY` value + a rendered nudge string.
- `app/app/portfolio/page.tsx` -- **NEW**. The `/portfolio` route (client): copy Home's Privy/`ensureUser` provisioning + guard-return ladder; read `api.portfolio.summary`; render signed-out welcome (`summary===null` & not authed), loading (`undefined`), provisioning (`null` while authed), the empty start state, and the holdings view — per-holding rows (name, market, value, this-month income) + allocation-by-market bars (token bar primitive with an accessible text equivalent) + the calm concentration nudge (when `concentration` present) with a diversify link to `/explore`.
- `app/app/globals.css` -- **MODIFY (append)**: E5.2 Portfolio classes only — `.port-row`/`.port-holding` (per-holding rows, tabular figures), `.alloc-row`/`.alloc-bar`/`.alloc-bar i` (allocation bars, extend the `.fundbar` idiom), `.port-nudge` (calm warning on `--warning` via `color-mix`, following the `.pd-verified` soft-tint idiom). All token-driven (no hex; `check:tokens` clean).
- `app/app/invest/[id]/page.tsx` -- **MODIFY**: repoint the "View your portfolio" CTA (~line 378) from `/explore` to `/portfolio` (the dedicated route now exists).
- `app/app/page.tsx` + `app/app/home.helpers.ts` -- **MODIFY**: add a "View portfolio" affordance on Home's balance card linking to `/portfolio` (new `HOME_COPY.portfolioCta`), replacing the interim `/explore` portfolio affordance.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- **APPEND** deferrals (see Design Notes).

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/portfolio.ts` -- add pure allocation/concentration/month-income helpers + the auth-scoped `summary` query -- the reactive Portfolio model with a server-side concentration flag.
- [x] `app/convex/portfolio.test.ts` -- convex-test the query across all matrix states + pure-helper units (grouping, threshold boundary, period/status filter) -- lock behavior and edge cases.
- [x] `app/app/portfolio.helpers.ts` -- add `PORTFOLIO_COPY`, view-state, allocation/percent formatters, and the concentration-nudge text -- single-source copy/format, keep the no-crypto invariant.
- [x] `app/app/portfolio.helpers.test.ts` -- unit-test the view-state, formatters, nudge text, and crypto-vocab invariant.
- [x] `app/app/portfolio/page.tsx` -- build the `/portfolio` route (signed-out / loading / provisioning / empty / holdings states; per-holding rows; allocation bars; concentration nudge) -- deliver FR13.
- [x] `app/app/globals.css` -- append token-only Portfolio styles (holding rows, allocation bars, calm `--warning` nudge).
- [x] `app/app/invest/[id]/page.tsx` -- repoint the "View your portfolio" CTA to `/portfolio`.
- [x] `app/app/page.tsx` + `app/app/home.helpers.ts` -- add the Home "View portfolio" affordance → `/portfolio`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- record the deferrals.

**Acceptance Criteria:**
- Given an owner whose holdings put a single market over 35% of allocation, when Portfolio loads, then per-holding value + this-month income and allocation-by-market bars render, and a calm concentration warning names the market and its share with a diversify nudge — never hidden. *(FR13)*
- Given an owner diversified so no market exceeds 35%, when Portfolio loads, then holdings + allocation bars render with no concentration warning.
- Given an unauthenticated visitor, when Portfolio loads, then `summary` is `null` and a calm signed-out welcome (Sign in / Explore) renders — never a crash or someone else's holdings.
- Given the Portfolio surface is on screen, when its copy and rendered values are inspected, then no crypto vocabulary and no raw distribution `txSig` appear, and the allocation bars expose an accessible text equivalent.
- Given `check:tokens`, when it scans `app/app`, then Portfolio introduces no hardcoded hex (bars/warning come from tokens).
- Given the Home and Confirmation portfolio affordances, when tapped, then they route to `/portfolio` (not the interim `/explore`).

## Spec Change Log

No entries — no `bad_spec` repair loopback occurred this run.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 1: (high 0, medium 0, low 1)
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` `portfolio.summary` mapped raw `holdings` docs one-to-one with `key={propertyId}` and looked up `incomeByProperty[propertyId]` per row, so a stray duplicate `(user, property)` holding row (the schema enforces no unique index) would double-count this-month income and collide React keys. The query now collapses holdings to one row per property (summing cost basis, adding income once); added a convex-test seeding two holdings for one property asserting a single summed row.
  - `[low]` `[patch]` `totalValue` / `totalMonthIncome` were computed and returned by the query but never rendered. Added a compact portfolio-totals card (cost-basis value + this-month income, tabular) at the top of the holdings view, reusing the existing `.balance-card`/`.stat-row` classes + a new `PORTFOLIO_COPY.totalValueLabel`.
  - `[low]` `[patch]` `formatAllocationPct` and `allocationBarWidth` were byte-for-byte identical (drift risk). `allocationBarWidth` now delegates to `formatAllocationPct`, so the bar width and its label can never diverge; existing tests for both still pass.
  - `[low]` `[patch]` The two loading frames used inconsistent a11y markup (`role="status"` on a `<p>` vs `role="status" aria-live="polite"` on `<main>`). Aligned both loaders to the same `role="status" aria-live="polite"` container.
  - Deferred (real, pre-existing pattern — logged to `deferred-work.md`): `portfolio.summary` `.collect()`s the caller's entire `incomeLedger` history on every read and filters to the current period in JS (no `by_user_period` index); the honest fix is a composite index shared with `home.summary`.
  - Rejected (spec-intended / noise): the nudge showing a whole-percent "35%" at a just-over-threshold share (the shipped copy never asserts ">35%" — it states the share and calmly suggests spreading, so no contradiction); allocation percentages not summing to exactly 100% (standard independent rounding, tolerable); only the single largest over-threshold market being named (spec-intended single diversify nudge — locked with a new test); "never writes" framing vs the `ensureUser` provisioning mutation (provisioning ≠ portfolio/ownership writes; mirrors Home); a permanently-failing `ensureUser` stranding the loader and Convex `isAuthenticated` never resolving (the same app-wide provisioning-loader pattern already logged from Story 5.1); dynamic `property.name`/`location` not run through `hasCryptoVocabulary` (curated admin/seed data, not our copy); a missing held-property doc degrading to a calm "Unknown market" placeholder (safe non-crashing fallback; requires a data-integrity violation reconciliation prevents); Home's income-to-date vs Portfolio's this-month income (both distinctly labeled); the `aria-hidden` per-holding rows relying on `describeHolding` (which conveys the same figures as text).

## Design Notes

- **Cost-basis model (inherited from 5.1).** Per-holding value and market allocation use `costBasis` — no live NAV; honest given the model. This-month income is real `paid` `incomeLedger` for the current period (driven by `home:devSeedDistribution`), never a projection.
- **Market = `property.location`.** There is no dedicated market field; `location` ("Tampa, FL") is the grouping key. The seed has ONE market, so a live holder is 100% concentrated and the >35% nudge correctly fires; the calm no-warning (diversified) branch is proven by unit tests. A live demo of the diversified state needs a second seeded market — deferred (not required for FR13).
- **Concentration honesty.** Strictly-greater-than `0.35` on the top market (boundary at exactly 0.35 shows no nudge); the nudge is calm and constructive (names the share, links to diversify), never alarming and never hidden — matches the epic's "honesty over concealment".
- **Reuse over reinvention.** `formatUsd` + `hasCryptoVocabulary` (invest.helpers), `periodFor` (home), the `.fundbar` token bar primitive, the `.pd-verified` soft-tint idiom for the `--warning` nudge, and Home's provisioning ladder. Pure allocation/concentration/income helpers are DOM-less and unit-tested (repo convention).
- **Deferred:** live portfolio NAV (value = cost basis today); a second seeded market to demo the diversified state; gross→net income breakdown (Story 5.3); any recurring-cadence forecast.

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (new query + `/portfolio` client route compile).
- `cd app && npm test` -- expected: vitest passes, including new `portfolio.test.ts` (query states + helpers) and `portfolio.helpers.test.ts` (formatters + nudge + crypto-vocab invariant); existing suites unchanged.
- `cd app && npm run check:tokens` -- expected: clean (Portfolio uses only `var(--…)` tokens; `--warning` for the nudge).
- `cd app && npx convex run properties:seedTheMonroe && npx convex run home:devSeedDistribution` -- expected (with a live deployment + a holding): drives this-month income so Portfolio shows a populated holding plus the 100%-Tampa concentration nudge.

**Manual checks:**
- Signed out → calm welcome (Sign in / Explore), no holdings. Signed in with a holding → per-holding row (value + this-month income), allocation bar, and (single-market seed) the calm concentration nudge; multi-market synthetic data → no nudge.
- Grep `PORTFOLIO_COPY` for crypto words (`wallet`/`token`/`mint`/`gas`/`tx`/`on-chain`) — expect none; confirm no `txSig` rendered. Confirm the Home and Confirmation "portfolio" CTAs route to `/portfolio`.

## Auto Run Result

Status: done

**Summary.** Delivered FR13 — the owner-facing Portfolio surface. Added a new `/portfolio` route driven by a reactive, auth-scoped `portfolio.summary` Convex query that derives the whole model from data already in the read model (holdings cost basis, current-period paid `incomeLedger` rows, held `properties.location`) — no new authoritative state, no writes. It shows per-holding value + this-month income, allocation-by-market bars, and a portfolio-totals card; when a single market's cost-basis share strictly exceeds 35% it surfaces a calm, never-hidden concentration nudge that names the market and its share and links to diversify. Signed-out, unprovisioned, and empty (no-holdings) states render calmly. Repointed the Home and Confirmation "portfolio" affordances from the interim `/explore` to `/portfolio`.

**Files changed.**
- `app/convex/portfolio.ts` — NEW. Pure exports (`CONCENTRATION_THRESHOLD`, `buildAllocations`, `selectConcentration`, `monthIncomeByProperty`) + the auth-scoped `summary` query (`null` when unauth/unprovisioned; collapses holdings to one row per property).
- `app/convex/portfolio.test.ts` — NEW. convex-test across every I/O-matrix state + pure-helper units (grouping, 0.35 boundary, two-over-threshold, period/status filter, zero-value, duplicate-holdings grouping).
- `app/app/portfolio.helpers.ts` — NEW. `PORTFOLIO_COPY`, `PortfolioSummary`/`PortfolioHolding`/`PortfolioAllocation` types, `portfolioViewState`, `formatAllocationPct`, `allocationBarWidth` (delegates to `formatAllocationPct`), `formatConcentrationNudge`, `describeHolding` (reuse `formatUsd`, `hasCryptoVocabulary`).
- `app/app/portfolio.helpers.test.ts` — NEW. view-state, formatters, nudge text, and the no-crypto-vocabulary invariant over every `PORTFOLIO_COPY` value + a rendered nudge string.
- `app/app/portfolio/page.tsx` — NEW. The `/portfolio` route (signed-out / loading / provisioning / empty / holdings states; totals card; per-holding rows with a text equivalent; allocation bars; concentration nudge).
- `app/app/globals.css` — appended token-only E5.2 Portfolio styles (`.port-holding`/`.port-row`, `.alloc-row`/`.alloc-bar`, `.port-nudge` on `--warning` via `color-mix`).
- `app/app/invest/[id]/page.tsx` — repointed the "View your portfolio" CTA to `/portfolio`.
- `app/app/home.helpers.ts` + `app/app/page.tsx` — added `HOME_COPY.portfolioCta` and a Home "View portfolio" affordance → `/portfolio`.
- `_bmad-output/implementation-artifacts/deferred-work.md` — recorded the spec's planned deferrals (DW-8..DW-10) and one review deferral (unbounded per-user income scan / `by_user_period` index).

**Review findings breakdown.** 4 patches applied (all low: defensive one-row-per-property grouping in the query; render the previously-unused `totalValue`/`totalMonthIncome` as a totals card; dedupe the byte-identical `formatAllocationPct`/`allocationBarWidth`; align the two loaders' a11y markup). 1 deferred (whole-history `incomeLedger` scan per read — needs a shared `by_user_period` index). 10 rejected as spec-intended or noise. 0 intent gaps, 0 spec repairs.

**Verification performed.**
- `cd app && npm run build` — ✅ type-check + build succeed; `/portfolio` compiled as a static route.
- `cd app && npm test` — ✅ 445 tests across 17 files pass, including the new `portfolio.test.ts` and `portfolio.helpers.test.ts` (and the 2 review-added tests).
- `cd app && npm run check:tokens` — ✅ clean, no hardcoded hex in `app/app`.
- `npx convex run properties:seedTheMonroe && npx convex run home:devSeedDistribution` — NOT run (no live deployment); left as a manual reviewer step to drive this-month income + the concentration nudge.

**Residual risks.**
- `value`/allocation are cost-basis (no live NAV); real valuation is deferred (DW-8).
- With the single-market seed (Tampa, FL) any live holder is 100% concentrated, so the nudge always fires; the diversified no-warning branch is proven only by unit tests until a second market is seeded (DW-9).
- Portfolio shows only per-property this-month `netPaid`; the itemized gross→net breakdown is Story 5.3 (DW-10).
- `portfolio.summary` scans the caller's full income history per read until a `by_user_period` index lands (deferred).
