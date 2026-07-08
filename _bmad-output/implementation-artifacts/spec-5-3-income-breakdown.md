---
title: 'Story 5.3 — Income breakdown + matches-target'
type: 'feature'
created: '2026-07-08'
status: 'in-progress'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: 'f15b109c90e2ff1aaf299d0ce471d72c14e622b7'
---

<intent-contract>

## Intent

**Problem:** There is no `/income` route. Home surfaces only a fresh distribution's `netPaid` (5.1) and Portfolio only per-property this-month `netPaid` (5.2) — neither itemizes it. FR14 requires an owner-facing Income surface that itemizes each distribution (gross rent share → operating costs → management fee → reserve → net paid), confirms whether it matches the target yield, shows history plus the next distribution date, and — for a missed distribution — explains why and links to the update, never silent. The `incomeLedger` schema already carries the itemized fields, but `home.devSeedDistribution` writes a degenerate waterfall (`grossShare = netPaid`; `costs/mgmtFee/reserve = 0`) and no "matches target" computation exists anywhere. (Resolves DW-10 and the gross→net-waterfall half of DW-4.)

**Approach:** Add a reactive, auth-scoped `income.summary` Convex query that derives the model from data already in the read model — the caller's `incomeLedger` rows plus held `properties.targetNetYield`/`costBasis` — emitting the latest distribution's full waterfall, a target evaluation (annualized realized net vs `targetNetYield`), distribution history, and the next-distribution date (reusing home's `selectNextDistributionDate`). Enhance `devSeedDistribution` to write a realistic itemized waterfall via a new pure `splitDistribution` helper (gross > net; components sum exactly to `grossShare`). Build the `/income` route mirroring Home/Portfolio's state ladder — the itemized waterfall, a calm "matches your target" affirmation (below-target → a calm variance note), an honest banner for a missed distribution, a history list, and the next date. Link Home and Portfolio to `/income`.

## Boundaries & Constraints

**Always:** Income renders only from data in hand and never writes. Waterfall line items are the schema's `grossShare, costs, mgmtFee, reserve, netPaid` on `incomeLedger`, shown in the DD-002 order (gross rent share → operating costs → management fee → reserve → net paid), and the invariant `grossShare === costs + mgmtFee + reserve + netPaid` holds for every seeded and rendered distribution (the math nets to the paid amount). The **matches-target** check compares the distribution's annualized realized net yield (`netPaid × 12 / holdingCostBasis`, guarded to `0` when cost basis ≤ 0) against the property's `targetNetYield`: it **matches** when realized ≥ `targetNetYield − TARGET_MATCH_TOLERANCE` (a small percentage-point tolerance absorbing monthly rounding), else it is a **below-target** calm variance note (names realized vs target, never alarming); the target percent renders via the existing `formatYieldPct` (e.g. `"6.2%"`). Latest distribution = the caller's most recent `incomeLedger` row by (`period`, then `paidAt`); history = the caller's distributions most-recent-first. A distribution whose `status !== "paid"` renders an **honest banner** (warning-tinted, calm) explaining it and offering an onward link toward the property's update — never silent, and it still appears in history. The next-distribution date reuses home's `selectNextDistributionDate` (soonest held-property `firstDistributionDate` ≥ today); the no-distributions state shows "first distribution expected {date}" from it. The query resolves the caller server-side from the JWT (`getUserIdentity()` → `by_privyId`) and returns `null` when unauthenticated or unprovisioned — client identity is never trusted — and never emits raw `txSig` or chain internals. Money is tabular and the Income surface uses **cents precision** (`formatUsdCents`) so a payout reads exactly (O3 legibility); one champagne accent max (spend it on the net-paid emphasis). Styling is token-only (`check:tokens` clean): the matches chip copies the `.pd-verified` gain soft-tint idiom, the honest banner copies the `.port-nudge` `--warning` idiom. WCAG 2.2 AA: 44px targets, ≥1 focus target, the waterfall carries an accessible text equivalent, no layout shift. All copy is crypto-vocabulary-clean (asserted by the shared `hasCryptoVocabulary` guard): amounts in dollars (the USDC settlement rail is never surfaced as a label), no wallet/token/on-chain terms, no raw `txSig`.

**Block If:** A compliance/offering decision mandates a **matches-target definition** other than annualized-realized-net-vs-`targetNetYield`-within-tolerance (e.g. cumulative-to-date vs target, a specific mandated tolerance or required legend/disclosure, or a "guaranteed"/"earns" framing), OR an **income-itemization model** different from the DD-002 gross→costs→mgmt→reserve→net order and categories — either changes what the numbers *mean*, not just how they render, and is not an unattended build choice.

**Never:** Do **not** build the distribution scheduler / recurring cadence or an admin distribution producer (the scheduler half of DW-4 stays open) — this story reads existing `incomeLedger` and enhances only the CLI dev seed. Do **not** add a `"paused"` status literal or any schema migration — `missed` is the only non-paid state with a producer; the honest banner keys off `status !== "paid"` so a paused state is covered identically if the literal is added later (deferred). Do **not** invent live NAV/appreciation (per-holding basis stays cost basis, per 5.1/5.2) or annualize beyond the single-month realized-vs-target check. Do **not** itemize every historical row's full waterfall — history rows show month + net + status; the detailed waterfall is the latest distribution (per-row itemization deferred). Do **not** build the `/updates` monthly-update route (Story 5.4); the missed-distribution banner uses an interim onward link (the property's existing surface) and the live update-detail target is deferred to 5.4. Do **not** seed a missed or below-target distribution as production data — those branches are proven by unit tests (a live demo is deferred, mirroring 5.2's diversified branch). Do **not** surface crypto vocabulary, the `"USDC"` label, or raw `txSig`, and do **not** add a charting dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Matches target | authed; latest `paid` distribution, realized annual net ≥ `targetNetYield − tolerance` | Itemized waterfall (gross→net, summing exactly) + calm "Matches your {target}% target" affirmation + history + next date | No error |
| Below target | authed; latest `paid` distribution, realized annual net < `targetNetYield − tolerance` | Waterfall + calm variance note (names realized vs target, not alarming) — no matches chip | No error |
| Missed distribution | authed; latest row `status:"missed"` | Honest warning banner explaining it + onward link toward the property's update; the row still appears in history — never silent | No error |
| History | authed; multiple distributions | Most-recent-first list (month, net in gain color, status); the latest also shown as the detailed waterfall | No error |
| Empty (no distributions) | authed, provisioned, holdings but zero `incomeLedger` rows | Calm "first distribution expected {date}" (from the next-distribution date) | No error |
| No holdings | authed, provisioned, zero holdings | Calm start state + Explore CTA | No error |
| Unauthenticated | no Privy session / no user row | `summary` = `null` → signed-out welcome (Sign in / Explore) | No error |
| Zero cost basis | distribution exists but resolved holding cost basis ≤ 0 | realized yield = `0` (never Infinity/NaN); below-target branch | No throw |
| Waterfall invariant | any seeded/rendered distribution | `grossShare === costs + mgmtFee + reserve + netPaid` | Test-enforced |
| Copy invariant | every `INCOME_COPY` value + rendered waterfall / affirmation / banner strings | `hasCryptoVocabulary(value) === false` | Test-enforced |

</intent-contract>

## Code Map

- `app/convex/income.ts` -- **NEW**. Pure exports (no ctx): `TARGET_MATCH_TOLERANCE`; `annualizedYield(netPaid, costBasis)` (guarded `0` when costBasis ≤ 0); `evaluateTarget(netPaid, costBasis, targetNetYield)` → `{ targetYield, realizedYield, matchesTarget }`; `selectLatestDistribution(rows)` (most recent by `period` then `paidAt`, or null); `buildHistory(rows)` (most-recent-first). Plus the `summary` **query** (auth-scoped; resolves user; collects `incomeLedger`/`holdings` `by_user`; fetches held `properties` via `ctx.db.get`; resolves each distribution's property `targetNetYield` + that property's total `costBasis`; emits the latest distribution's waterfall + target evaluation + status, `history`, `nextDistributionDate`, `firstDistributionDate`, and `hasHoldings`; `null` when unauth/unprovisioned; never emits `txSig`). Reuse `periodFor` + `selectNextDistributionDate` from `./home`.
- `app/convex/income.test.ts` -- **NEW** convex-test: `summary` across every matrix state (matches, below-target, missed, history ordering, empty, no-holdings, unauth→null, zero-cost-basis) + pure-helper units (annualize guard, target boundary at exactly the tolerance edge, latest selection by period/paidAt, history ordering).
- `app/app/income.helpers.ts` -- **NEW**. `INCOME_COPY` (crypto-clean: eyebrow, title, breakdown section label, the five waterfall line labels, matches-affirmation + below-target variance builders, history label, next-distribution label, honest-banner title + body + update CTA, empty/first-distribution copy, no-holdings + signed-out copy, Explore/Sign-in CTAs); `IncomeSummary`/`IncomeDistribution`/`IncomeHistoryRow`/`TargetEvaluation` types; `incomeViewState(summary)` → `"empty" | "income"`; `formatMatchesTarget(targetYield)` and `formatBelowTarget(realizedYield, targetYield)`; `describeWaterfall(distribution)` (WCAG text equivalent). Reuse `formatUsdCents`/`formatYieldPct` (calculator.helpers), `formatDistributionDate` (confirmation.helpers), `hasCryptoVocabulary` (invest.helpers). Pure, no JSX/DOM.
- `app/app/income.helpers.test.ts` -- **NEW** vitest: `incomeViewState` branches, `formatMatchesTarget`/`formatBelowTarget`, `describeWaterfall`, and the no-crypto-vocabulary invariant over every `INCOME_COPY` value + rendered waterfall/affirmation/banner strings.
- `app/app/income/page.tsx` -- **NEW**. The `/income` route (client): copy Portfolio's Privy/`ensureUser` provisioning + guard-return ladder (signed-out / loading `undefined` / provisioning `null` / empty / income states); read `api.income.summary`; render the latest distribution's itemized waterfall (with a text equivalent) + the matches-target chip or below-target note, the honest banner when the latest is missed, the history list, and the next-distribution date.
- `app/convex/home.ts` -- **MODIFY**: add the pure `splitDistribution(netPaid)` helper (gross > net; `grossShare = costs + mgmtFee + reserve + netPaid` exactly; all-zero when netPaid ≤ 0) and use it in `devSeedDistribution` so the seed writes a real itemized waterfall instead of `grossShare = netPaid`, `costs/mgmtFee/reserve = 0`. Keep the existing `netPaid`/`status`/`paidAt` values unchanged (5.1/5.2 depend on them).
- `app/convex/home.test.ts` -- **MODIFY (append)**: unit `splitDistribution` (invariant sum, zero-guard) and assert `devSeedDistribution` now writes a non-degenerate consistent waterfall.
- `app/app/page.tsx` + `app/app/home.helpers.ts` -- **MODIFY**: add an "income" affordance linking to `/income` (new `HOME_COPY.incomeCta`) so the fresh-distribution hero can reach its breakdown.
- `app/app/portfolio/page.tsx` + `app/app/portfolio.helpers.ts` -- **MODIFY**: add an "income" affordance linking to `/income` (new `PORTFOLIO_COPY.incomeCta`) — the natural onward step from this-month income.
- `app/app/globals.css` -- **MODIFY (append)**: E5.3 Income classes only — waterfall rows (`.stat-row` idiom with a `--hairline` divider), a net-paid emphasis line, the matches chip (gain soft-tint, `.pd-verified` idiom), the honest banner (`--warning`, `.port-nudge` idiom), and history rows (`.port-holding` idiom). All token-driven (no hex; `check:tokens` clean).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- **UPDATE**: mark DW-10 resolved and DW-4 partially resolved (waterfall done; scheduler still open); **APPEND** new deferrals (see Design Notes).

## Tasks & Acceptance

**Execution:**
- [ ] `app/convex/income.ts` -- add pure target/annualize/selection helpers + the auth-scoped `summary` query -- the reactive Income model with a server-side target evaluation.
- [ ] `app/convex/income.test.ts` -- convex-test the query across all matrix states + pure-helper units (annualize guard, target boundary, latest/history ordering) -- lock behavior and edge cases.
- [ ] `app/convex/home.ts` -- add `splitDistribution` and use it in `devSeedDistribution` so the seed produces a real, internally-consistent waterfall.
- [ ] `app/convex/home.test.ts` -- unit `splitDistribution` (sum invariant, zero-guard) and assert the seed's new itemized output.
- [ ] `app/app/income.helpers.ts` -- add `INCOME_COPY`, types, view-state, target/variance formatters, and the waterfall text-equivalent -- single-source copy/format, keep the no-crypto invariant.
- [ ] `app/app/income.helpers.test.ts` -- unit-test the view-state, formatters, text-equivalent, and crypto-vocab invariant.
- [ ] `app/app/income/page.tsx` -- build the `/income` route (signed-out / loading / provisioning / empty / income states; waterfall; matches/below-target; honest banner; history; next date) -- deliver FR14.
- [ ] `app/app/globals.css` -- append token-only Income styles (waterfall rows, net-paid emphasis, matches chip, honest banner, history rows).
- [ ] `app/app/page.tsx` + `app/app/home.helpers.ts` -- add the Home "income" affordance → `/income`.
- [ ] `app/app/portfolio/page.tsx` + `app/app/portfolio.helpers.ts` -- add the Portfolio "income" affordance → `/income`.
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- resolve DW-10, partially resolve DW-4, record the new deferrals.

**Acceptance Criteria:**
- Given an owner with a paid distribution, when Income loads, then it itemizes gross rent share → operating costs → management fee → reserve → net paid (summing exactly to the net), confirms whether it matches the target yield, and shows history plus the next distribution date. *(FR14)*
- Given a distribution whose realized annual net meets or exceeds the target within tolerance, when Income loads, then a calm "matches your target" affirmation renders; given a below-target distribution, then a calm variance note renders instead — never an alarm and never a "guaranteed" framing.
- Given a missed distribution, when Income loads, then an honest banner explains it and offers an onward link toward the update, and the distribution still appears in history — never silent.
- Given an unauthenticated visitor, when Income loads, then `summary` is `null` and a calm signed-out welcome (Sign in / Explore) renders — never a crash or someone else's income.
- Given the Income surface is on screen, when its copy and rendered values are inspected, then no crypto vocabulary, no `"USDC"` label, and no raw `txSig` appear, and the waterfall exposes an accessible text equivalent.
- Given `check:tokens`, when it scans `app/app`, then Income introduces no hardcoded hex (chip/banner/rows come from tokens).
- Given the Home and Portfolio income affordances, when tapped, then they route to `/income`.

## Design Notes

- **Itemized fields already exist; the seed was degenerate.** `incomeLedger` carries `grossShare/costs/mgmtFee/reserve/netPaid`, but `devSeedDistribution` set `grossShare = netPaid` and the rest `0`. `splitDistribution` fills a realistic gross > net split with the exact sum invariant `grossShare = costs + mgmtFee + reserve + netPaid`; `netPaid`/`status`/`paidAt` are unchanged so Home (5.1) and Portfolio (5.2) are unaffected. The split proportions are illustrative dev-seed values — real per-line values will come from the operator/reconciliation (deferred).
- **Matches-target = annualized realized net vs `targetNetYield`.** A month's `netPaid × 12 / costBasis` compared to `property.targetNetYield` within a small pp tolerance (absorbs the seed's `Math.round`). The seed computes `netPaid = round(costBasis × targetNetYield / 12)`, so the seeded holder matches; the below-target branch is proven by unit tests. Voice per the design system: "matches your target"/"targets", never "guaranteed"/"earns".
- **Cents on Income by design.** Unlike Home/Portfolio (glanceable whole dollars via `formatUsd`), Income is the legibility surface (O3 — "understand exactly what you were paid"), so it uses `formatUsdCents` for exactness. Amounts stay dollar-denominated; the USDC settlement rail is never labeled (keeps the crypto-vocab invariant clean).
- **Missed ≠ paused; `/updates` not built.** Only `missed` has a producer; the banner keys off `status !== "paid"` so a future `paused` literal is covered identically. Story 5.4's `/updates` route doesn't exist, so the banner's "link to the update" uses an interim onward link to the property surface; the live update-detail target is deferred to 5.4.
- **Reuse over reinvention.** `periodFor` + `selectNextDistributionDate` (home), `formatUsdCents`/`formatYieldPct` (calculator.helpers), `formatDistributionDate` (confirmation.helpers), `hasCryptoVocabulary` (invest.helpers), the `.stat-row` line primitive, the `.pd-verified` gain soft-tint (matches chip) and `.port-nudge` warning idiom (honest banner), and Portfolio's provisioning ladder. Pure helpers are DOM-less and unit-tested (repo convention).
- **Deferred:** the distribution scheduler / recurring cadence (DW-4 scheduler half); a `"paused"` status literal + producer; full per-historical-row itemization; a live missed/below-target seed demo; real operator-sourced line items via reconciliation; a shared `by_user_period` index (income adds to the existing home/portfolio full-history scan).

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (new `income.summary` query + `/income` client route compile).
- `cd app && npm test` -- expected: vitest passes, including new `income.test.ts` (query states + helpers) and `income.helpers.test.ts` (formatters + text-equivalent + crypto-vocab invariant), plus the appended `home.test.ts` `splitDistribution`/seed assertions; existing suites unchanged.
- `cd app && npm run check:tokens` -- expected: clean (Income uses only `var(--…)` tokens; gain for the chip, `--warning` for the banner).
- `cd app && npx convex run properties:seedTheMonroe && npx convex run home:devSeedDistribution` -- expected (with a live deployment + a holding): drives a real itemized distribution so Income shows the full gross→net waterfall + the matches-target affirmation.

**Manual checks:**
- Signed out → calm welcome (Sign in / Explore). Signed in with a seeded distribution → the itemized waterfall (gross→net summing to the net), the "matches your {target}% target" affirmation, the history list, and the next-distribution date; synthetic below-target/missed data → the calm variance note / honest banner (unit-tested; live demo deferred).
- Grep `INCOME_COPY` for crypto words (`wallet`/`token`/`mint`/`gas`/`tx`/`on-chain`/`USDC`) — expect none; confirm no `txSig` rendered. Confirm the Home and Portfolio "income" affordances route to `/income`.
