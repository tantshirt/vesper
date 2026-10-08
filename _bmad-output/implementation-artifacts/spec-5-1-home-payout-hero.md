---
title: 'Story 5.1 — Home: the payout is the hero'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
baseline_revision: '77143c98495132bdc29f106233cdaca42ef22bf4'
final_revision: '1972ea41ce4772ea1493a47bb53d9e2ebb26b62f'
---

<intent-contract>

## Intent

**Problem:** The root route `app/app/page.tsx` is still the E1.1 proof-of-wiring screen (DIDs, JWT status, embedded-account address). FR12 requires Home to be the owner's at-a-glance income surface: when a fresh distribution has landed it must lead with "Rent just landed +$X" (dusk card, champagne star) and always show portfolio value, all-time return (signed), income-to-date, and a balance sparkline; with no fresh distribution it shows the next-distribution date instead.

**Approach:** Add a reactive, auth-scoped `home.summary` Convex query that derives the whole Home model from data already owned by the read model (`holdings` cost basis, `incomeLedger` paid rows, held `properties`) — no new authoritative state. Give `incomeLedger` an optional `paidAt` (set by the existing reconcile distribution path) so "fresh" means *recently* landed, not merely paid. Add a CLI-runnable dev seed (`home.devSeedDistribution`, sibling to `seedTheMonroe`) that materializes a paid distribution for existing holdings so the hero is drivable without a live chain. Rebuild `page.tsx` to render fresh-hero / next-date / empty / signed-out states, with all copy + formatting + sparkline geometry in pure, unit-tested helpers.

## Boundaries & Constraints

**Always:** The summary renders only from data in hand — `portfolioValue` = Σ `holdings.costBasis`; `incomeToDate` = Σ `netPaid` over `status:"paid"` rows; `allTimeReturn` = `incomeToDate` (the only realized return; no live NAV) with pct = income/portfolioValue guarded to 0 when value is 0; `freshDistribution` = the most recent `paid` row whose `paidAt` is within a 7-day window (rows without `paidAt` are never "fresh"); `nextDistributionDate` = the soonest held-property `firstDistributionDate` on/after today. The query resolves the caller server-side from the JWT (`getUserIdentity()` → `by_privyId`) and returns `null` when unauthenticated or unprovisioned — the client-supplied identity is never trusted. Money uses tabular numerals and existing formatters; gains/losses always show an explicit sign; one champagne accent (the fresh-distribution star) only; dusk hero uses the `--dusk` token; WCAG 2.2 AA (44px targets, ≥1 focus target, the sparkline carries a text equivalent), no layout shift. All consumer copy is crypto-vocabulary-clean (asserted by the shared `hasCryptoVocabulary` guard); no wallet/token/on-chain terms surface on Home. `paidAt`/`firstDistributionDate` stay optional (no migration; existing docs remain valid).

**Block If:** A compliance/offering decision hands down a mandated portfolio-valuation basis that must differ from cost basis, or a required distribution-cadence/schedule model — either would change what the stats *mean*, not just how they render, and is not an unattended build choice.

**Never:** Do **not** build the `/portfolio` (Story 5.2) or `/income` (Story 5.3) routes or the real distribution waterfall/scheduler — Home links to `/explore` for the interim portfolio affordance (matching Story 4.5) and shows only `netPaid`, never an itemized gross→net breakdown. Do **not** invent appreciation/NAV or a recurring-cadence forecast (no data source). Do **not** add an authoritative balance/value table or write ownership/money state from Home (read-only surface). Do **not** wire `devSeedDistribution` to any consumer UI — it is a CLI seed only. Do **not** surface the raw distribution `txSig` or any crypto vocabulary on Home.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh distribution | authed user; a `paid` `incomeLedger` row with `paidAt` within 7 days | Dusk hero "Rent just landed +$X" (champagne star) + balance card: portfolio value, signed all-time return, income-to-date, sparkline | No error |
| No fresh, has holdings | holdings exist; no paid row in window; a held property `firstDistributionDate` ≥ today | No hero; balance card + "Next distribution · {Month D, YYYY}" | No error |
| No fresh, no upcoming date | holdings exist; no fresh row; no future `firstDistributionDate` | Balance card + honest fallback ("Next distribution announced soon") | No throw / no "Invalid Date" |
| Empty (authed, no holdings) | authed, provisioned, zero holdings | Calm start state (income $0) + link to Explore | No error |
| Unauthenticated | no Privy session / no user row | `summary` = `null` → signed-out welcome + Sign in / Explore | No error |
| Sparkline degenerate | 0 or 1 balance points | Minimal/flat render + "No balance history yet" text equivalent | No throw |
| Return pct, zero value | portfolioValue = 0, income ≥ 0 | pct = 0 (never Infinity/NaN) | No throw |
| Copy invariant | every `HOME_COPY` value + rendered hero string | `hasCryptoVocabulary(value) === false` | Test-enforced |

</intent-contract>

## Code Map

- `app/convex/schema.ts` -- **MODIFY** `incomeLedger`: add `paidAt: v.optional(v.number())` (epoch ms; set when a distribution is observed paid; optional → no migration).
- `app/convex/reconcile.ts` -- **MODIFY** `applyDistribution`: when patching a row to `paid`, also set `paidAt: Date.now()` (the moment the distribution was reconciled as paid). No signature/idempotency change.
- `app/convex/home.ts` -- **NEW**. Pure exports (no ctx): `FRESH_WINDOW_MS` (7d); `sumCostBasis`, `sumNetPaid` (paid only), `returnPct(income, value)` (0 when value ≤ 0); `selectFreshDistribution(paidRows, now)` (max `paidAt` within window, else null); `selectNextDistributionDate(props, todayIso)` (soonest `firstDistributionDate` ≥ today, else null); `buildBalanceSeries(settledOrders)` (cumulative cost basis over `createdAt`, ascending → `number[]`). Plus `summary` **query** (auth-scoped; assembles the model; `null` when unauth/unprovisioned) and `devSeedDistribution` **mutation** (CLI seed: for every holding upsert a `status:"paid"` `incomeLedger` row for the current `YYYY-MM`, `paidAt: Date.now()`, `netPaid = round(costBasis × targetNetYield / 12)`, `grossShare = netPaid`, `costs/mgmtFee/reserve = 0` — real waterfall is Story 5.3; idempotent per (user, property, period); audited).
- `app/convex/home.test.ts` -- **NEW** convex-test: `summary` across every matrix state (fresh, no-fresh+date, no-date fallback, empty, unauth→null, zero-value pct, `paidAt` window boundary) + pure-helper unit tests; `devSeedDistribution` idempotency + audit.
- `app/app/home.helpers.ts` -- **NEW**. `HOME_COPY` (crypto-clean: eyebrow, hero lead/star label, portfolio/return/income labels, next-distribution label + fallback, empty-state + signed-out copy, explore CTA); `homeHeroState(summary)` → `"fresh" | "next" | "empty"`; `formatSignedUsd`, `formatSignedPct` (explicit +/− sign, tabular, reuse `formatUsd` from `../invest/[id]/invest.helpers`); `sparklinePoints(series, w, h)` → SVG polyline points; `describeSparkline(series)` → text equivalent; reuse `formatDistributionDate` from `../invest/[id]/confirmation.helpers`. Pure, no JSX/DOM.
- `app/app/home.helpers.test.ts` -- **NEW** vitest: `homeHeroState` branches, signed formatters (positive/negative/zero), `sparklinePoints`/`describeSparkline` (empty, single, multi), and the no-crypto-vocabulary invariant over every `HOME_COPY` value + a sample hero string.
- `app/app/page.tsx` -- **MODIFY (replace body)**: keep the Privy/`ensureUser` provisioning; read `api.home.summary`; render signed-out welcome (`summary===null` & not authed), loading (`undefined`), the fresh dusk hero (dusk card + champagne star + "Rent just landed +$X"), the balance card (portfolio value, signed all-time return, income-to-date, sparkline SVG with `role="img"` + text equivalent), the next-distribution line, and the empty/start state; portfolio/explore affordances link to `/explore`.
- `app/app/globals.css` -- **MODIFY (append)**: Home classes only — `.home-hero` (dusk `--dusk` card, `--dusk-fg`), `.home-star` (champagne), `.home-lead`, `.balance-card`, `.stat-row`/`.stat-figure` (tabular), `.spark`/`.spark svg`, `.home-empty` — all token-driven (no hex; `check:tokens` clean).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- **APPEND** deferrals (see Design Notes).

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/schema.ts` -- add optional `paidAt` to `incomeLedger` -- give "fresh" a recency signal without a migration.
- [x] `app/convex/reconcile.ts` -- set `paidAt: Date.now()` when a distribution row is marked paid -- record when it landed.
- [x] `app/convex/home.ts` -- add pure derivation helpers + the `summary` query + the `devSeedDistribution` CLI seed -- the reactive Home model and a demo income producer.
- [x] `app/convex/home.test.ts` -- convex-test the query across all matrix states + pure-helper units + seed idempotency/audit -- lock behavior and edge cases.
- [x] `app/app/home.helpers.ts` -- add `HOME_COPY`, `homeHeroState`, signed formatters, sparkline geometry + text equivalent -- single-source copy/format, keep the no-crypto invariant.
- [x] `app/app/home.helpers.test.ts` -- unit-test the decision + formatters + sparkline + crypto-vocab invariant.
- [x] `app/app/page.tsx` -- replace the E1.1 backbone screen with the payout-hero Home -- deliver FR12.
- [x] `app/app/globals.css` -- append token-only Home styles (dusk hero, champagne star, balance card, stat rows, sparkline).
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- record the deferrals.

**Acceptance Criteria:**
- Given an owner with a distribution paid within the fresh window, when Home loads, then it leads with a dusk "Rent just landed +$X" hero (champagne star) and shows portfolio value, a signed all-time return, income-to-date, and a balance sparkline. *(FR12)*
- Given an owner with holdings but no fresh distribution, when Home loads, then no hero shows and the next-distribution date (or an honest "announced soon" fallback) is shown alongside the balance card.
- Given an unauthenticated visitor, when Home loads, then `summary` is `null` and a calm signed-out welcome (Sign in / Explore) renders — never a crash or a stats screen with someone else's data.
- Given the Home surface is on screen, when its copy and rendered values are inspected, then no crypto vocabulary and no raw distribution `txSig` appear, and the sparkline exposes a text equivalent.
- Given `check:tokens`, when it scans `app/app`, then Home introduces no hardcoded hex (dusk/champagne come from tokens).

## Design Notes

- **Read-only, data-in-hand.** Portfolio value is cost basis (no live NAV — Pyth is market-context only, single-property NAV is admin-signed and unavailable), so all-time return equals realized income-to-date; both are honest given the model. `summary` adds no authoritative state and never writes — Home is a pure read surface over the reconciled mirror.
- **"Fresh" needs a clock.** `incomeLedger` had no timestamp, so freshness was unprovable. `paidAt` (set by the reconcile distribution path, the one place a row becomes `paid`) makes "just landed" mean *recent*; rows lacking it (pre-migration) degrade to not-fresh rather than falsely leading the hero.
- **Demo income producer.** No code path creates distributions yet (the scheduler/waterfall is Story 5.3 / admin), so the headline state would be undemoable. `devSeedDistribution` is a CLI seed sibling to `seedTheMonroe` — never UI-wired, audited, idempotent — that pays out existing holdings so the hero is drivable. It sets only `netPaid` (with `grossShare=netPaid`, other components 0); the real gross→net waterfall belongs to Story 5.3.
- **Reuse over reinvention.** `formatUsd` (invest.helpers), `formatDistributionDate` (confirmation.helpers), `hasCryptoVocabulary` (invest.helpers) are reused; signed variants wrap `formatUsd`. Sparkline geometry is pure and testable without a DOM (repo convention: helper-only unit tests).
- **Sparkline honesty.** The series is cumulative cost basis over settled-order dates (what you own, growing as you invest) — no fabricated appreciation. 0/1 points render a flat minimal line with a "No balance history yet" text equivalent.
- **Deferred:** real distribution scheduling + gross→net waterfall (Story 5.3); live portfolio valuation/NAV (returns just cost basis today); dedicated `/portfolio` route (Story 5.2 — interim link to `/explore`); Home reactive-load `aria-live`/focus announcement (consistent with the app-wide gated-screen a11y item already logged).

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (schema compiles with optional `paidAt`; `/` stays a client route).
- `cd app && npm test` -- expected: vitest passes, including new `home.test.ts` (query states + helpers + seed) and `home.helpers.test.ts` (formatters + sparkline + crypto-vocab invariant); existing suites unchanged.
- `cd app && npm run check:tokens` -- expected: clean (Home uses only `var(--…)` tokens — `--dusk`, `--champagne`, tabular figures).
- `cd app && npx convex run properties:seedTheMonroe && npx convex run home:devSeedDistribution` -- expected (with a live deployment + a holding): seeds a paid distribution so Home shows the fresh hero.

**Manual checks:**
- Signed out → Home shows the calm welcome (Sign in / Explore), no stats. Signed in with a holding + a freshly-seeded distribution → dusk "Rent just landed +$X" hero with the champagne star, portfolio value, signed all-time return, income-to-date, and a sparkline; with no fresh distribution → the next-distribution date (or "announced soon") and no hero.
- Grep `HOME_COPY` for crypto words (`wallet`/`token`/`mint`/`gas`/`tx`/`on-chain`) — expect none; confirm no `txSig` rendered.

## Spec Change Log

No entries — no `bad_spec` repair loopback occurred this run.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 0, low 5)
- defer: 3: (high 0, medium 2, low 1)
- reject: 4: (high 0, medium 3, low 1)
- addressed_findings:
  - `[high]` `[patch]` `home.devSeedDistribution` was a PUBLIC `mutation`, so any client could invoke it and fabricate `status:"paid"` income rows for **every** user's holdings (it iterates all holdings, no auth). Changed to `internalMutation` (still runnable via `npx convex run`, no longer client-reachable); updated the test to call it via `internal.home.devSeedDistribution`.
  - `[low]` `[patch]` `selectFreshDistribution` accepted a `NaN` `paidAt` (`typeof NaN === "number"` passed both window comparisons) so a corrupt timestamp could lead the hero forever; it also promoted `netPaid ≤ 0` rows to a "$0" hero. Now requires `Number.isFinite(paidAt)` and `netPaid > 0`; added unit tests for both.
  - `[low]` `[patch]` `formatSignedUsd`/`formatSignedPct` emitted a sign with no magnitude (`+$0`, `+0.0%`/`-0.0%`) for sub-unit values. Sign is now keyed off the rounded magnitude; added tiny-value tests.
  - `[low]` `[patch]` Sparkline incoherence: a 1-point series drew a flat line while its text equivalent said "No balance history yet", a 0-point series rendered a blank box, and the description was announced twice (aria-label + a duplicate visually-hidden `<p>`). `describeSparkline` now describes the single-balance case; the SVG renders only when there is ≥1 point; the duplicate hidden text was removed (the `role="img"` aria-label is the single announcement).
  - `[low]` `[patch]` The signed-out welcome could flash for a returning authenticated user while Convex auth lagged Privy. The signed-out branch is now gated on Privy's own `authenticated`, so such a user falls through to the provisioning loader instead.
  - Deferred (real, pre-existing/future-scoped — logged to `deferred-work.md`): `paidAt` records reconcile time not economic distribution time (spoofable by replay/backfill once live Helius lands); a permanently-failing `ensureUser` leaves Home stuck on the loader with no retry/escape (app-wide swallow pattern); the sparkline sums `orders.amount` while portfolio sums `holdings.costBasis`, which diverge on reconcile-mint holdings.
  - Rejected (spec-intended / out of scope): "next distribution" only reflects a property's first distribution (the intent-contract's Never forbids a recurring-cadence forecast — no data source; Block-If reserves a cadence model for a human decision); "all-time return" pairing cumulative income $ with income/cost-basis % (coherent by design — cumulative, not annualized, and income *is* that % of basis); the fresh hero showing the latest single distribution rather than an aggregated same-week multi-property total (hero = latest payout by design; single seeded property today); the freshness comment "overstating" the guarantee (its statement about pre-existing rows degrading to not-fresh is factually correct).

## Auto Run Result

Status: done

**Summary.** Delivered FR12 — Home is now the owner's at-a-glance income surface. Replaced the E1.1 backbone proof screen at `app/app/page.tsx` with a reactive, auth-scoped Home driven by a new `home.summary` Convex query that derives the whole model from data already in the read model (holdings cost basis, paid `incomeLedger` rows, settled orders, held properties) — no new authoritative state, no writes. When a distribution landed within a 7-day window it leads with a dusk "Rent just landed +$X" hero (one champagne accent — the star); otherwise it shows the next-distribution date (or an honest "Announced soon"). It always shows portfolio value, a signed all-time return, income-to-date, and a balance sparkline with a text equivalent. Signed-out, unprovisioned, and empty (no-holdings) states all render calmly. Added an optional `incomeLedger.paidAt` (set by the reconcile distribution path) to make "fresh" mean *recent*, and a CLI-only `home.devSeedDistribution` (`internalMutation`) to drive the hero without a live chain.

**Files changed.**
- `app/convex/schema.ts` — added `paidAt: v.optional(v.number())` to `incomeLedger` (no migration).
- `app/convex/reconcile.ts` — `applyDistribution` now stamps `paidAt: Date.now()` when marking a distribution row paid.
- `app/convex/home.ts` — NEW. Pure exports (`FRESH_WINDOW_MS`, `sumCostBasis`, `sumNetPaid`, `returnPct`, `selectFreshDistribution`, `selectNextDistributionDate`, `buildBalanceSeries`, `periodFor`) + the auth-scoped `summary` query (`null` when unauth/unprovisioned) + the CLI-only `devSeedDistribution` `internalMutation` (idempotent per user/property/period, audited).
- `app/convex/home.test.ts` — NEW. convex-test across every I/O-matrix state + pure-helper units + seed idempotency/audit + the review-added NaN/`netPaid`≤0 guard cases.
- `app/app/home.helpers.ts` — NEW. `HOME_COPY`, `homeHeroState`, `formatSignedUsd`, `formatSignedPct`, `formatNextDistribution`, `sparklinePoints`, `describeSparkline` (reuse `formatUsd`, `formatDistributionDate`, `hasCryptoVocabulary`).
- `app/app/home.helpers.test.ts` — NEW. Decision + formatters + sparkline geometry/text + the no-crypto-vocabulary invariant over every `HOME_COPY` value + a rendered hero string.
- `app/app/page.tsx` — replaced the E1.1 screen with the payout-hero Home (signed-out / loading / provisioning / empty / fresh-hero / next-date states; balance card; `role="img"` sparkline with an aria text equivalent; `/explore` affordances).
- `app/app/globals.css` — appended token-only Home styles (`.home-hero` on `--dusk`, champagne `.home-star`, `.balance-card`, `.stat-row`/`.stat-figure` tabular, `.spark`).
- `_bmad-output/implementation-artifacts/deferred-work.md` — recorded the spec's planned deferrals (DW-4..DW-7) and the three review deferrals.

**Review findings breakdown.** 6 patches applied (1 high: public seed mutation → `internalMutation`; 5 low: fresh-distribution NaN/zero guards, signed-formatter sign-without-magnitude, sparkline coherence + double-announcement, signed-out flash). 3 deferred (paidAt reconcile-time vs distribution-time; unrecoverable provisioning loader; sparkline-vs-portfolio source divergence). 4 rejected as spec-intended/out-of-scope. 0 intent gaps, 0 spec repairs.

**Verification performed.**
- `cd app && npm run build` — ✅ type-check + build succeed; `/` remains a client route; schema compiles with the new optional field.
- `cd app && npm test` — ✅ 406 tests across 15 files pass, including the new `home.test.ts` and `home.helpers.test.ts` (and the 5 review-added guard tests).
- `cd app && npm run check:tokens` — ✅ clean, no hardcoded hex in `app/app`.
- `npx convex run properties:seedTheMonroe && npx convex run home:devSeedDistribution` — NOT run (no live deployment); left as a manual reviewer step. The seed is idempotent per (user, property, period).

**Residual risks.**
- `paidAt` uses reconcile time as an honest proxy for distribution time; a replayed/backfilled old event could read as fresh once live Helius lands (deferred).
- `portfolioValue`/`allTimeReturn` are cost-basis (no live NAV); real valuation is deferred (DW-5).
- `home.devSeedDistribution` is a disclosed demo income producer (only `netPaid`, no real gross→net waterfall — Story 5.3) and the portfolio affordance links to `/explore` interim (Story 5.2).
- Home's reactive-load `aria-live`/focus announcement remains deferred (DW-7), consistent with the app-wide gated-screen a11y item; the sparkline already carries a text equivalent.
