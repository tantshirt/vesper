---
title: 'Story 5.4 — Monthly property update (even quiet ones)'
type: 'feature'
created: '2026-07-08'
status: 'done'
baseline_revision: 'f50f99fcd116c4a6c5c43c1c7fa87cdd80f49b25'
final_revision: '60402fa4299c8a989337c07cdf4cae7ac1254846'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Owned properties have a `propertyUpdates` schema but no producer, query, route, or overdue check — so an owner never sees the monthly operator update, and Story 5.3's missed-distribution banner links to an interim `/property/[id]` stub (DW-15). Silence in a quiet month erodes trust.

**Approach:** Add a Convex `updates.summary` query that returns each owned property's latest operator update (occupancy, reserves, rent-on-time, plain note, named operator) plus an honest overdue flag; a dev-seed producer and a scheduled function that flags any property overdue for an update; a `/updates` route that renders the cards (never silent — an awaiting/overdue property shows a calm note); and retarget the income banner at `/updates`.

## Boundaries & Constraints

**Always:** Auth-scope every read to the caller resolved from `identity.subject` — return `null` when unauthenticated or unprovisioned (mirror `income.summary`). Every owned property appears, including quiet months and properties with no update yet (show a calm "update expected"/"overdue" note — never silence). Money/percentages in tabular figures; each card carries a WCAG text-equivalent. Token-only styling (no hex; `check:tokens` clean). Any overdue flag write goes through `writeAudit` (append-only). Reuse `periodFor` (home), the provisioning ladder, and the `.port-holding`/`.stat-row`/`.income-banner` CSS idioms.

**Block If:** The seed/producer would require live Solana/Helius or a real operator feed to function (it must not — use a dev-seed producer like `devSeedDistribution`). A required `propertyUpdates` field is missing from the schema.

**Never:** No crypto vocabulary (wallet/gas/tx/mint/USDC) anywhere in this surface. Do not seed a missed/overdue update as production data to demo the branch (prove overdue via unit tests, per DW-13). Do not build real operator authoring, notifications, or push delivery. Do not add live NAV, distribution scheduling (DW-4), or per-property drill-downs. Do not alter `devSeedDistribution` behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner, fresh update | Held property has a `propertyUpdate` for the current period | Card renders operator name, occupancy %, reserves-months, rent-on-time, plain note; `overdue:false` | No error expected |
| Owner, quiet month | Update exists but note is uneventful | Same card renders (never hidden); `overdue:false` | No error expected |
| Owner, overdue | Latest update `period` < current period (or none) | Card shows calm overdue/awaiting note; `overdue:true` | No error expected |
| Property never updated | Held property with zero `propertyUpdates` rows | Card renders name + awaiting note; `latest:null`, `overdue:true` | No missing-data crash |
| Unauthenticated | No identity | `summary` returns `null`; page shows signed-out welcome | No crash / no other user's data |
| No holdings | Provisioned user owns nothing | `summary.hasHoldings:false`; empty state (Explore) | No error expected |
| Overdue scan | Scheduled `flagOverdueUpdates` runs | Writes one `propertyUpdate.overdue` audit per overdue property per current period; idempotent (no duplicate per period) | Skips already-flagged; never throws on empty |

</intent-contract>

## Code Map

- `app/convex/schema.ts` -- `propertyUpdates` (fields: `propertyId, period, occupancy, reservesMonths, rentOnTime, note, operator, publishedAt`; index `by_property`), `holdings` (`by_user`), `properties`, `auditLog`. No change expected; read only.
- `app/convex/updates.ts` -- **NEW**. Pure exports (no ctx): `previousPeriod(nowMs)` → `"YYYY-MM"` of the prior month; `isUpdateOverdue(latestPeriod|null, nowMs)` → `latestPeriod === null || latestPeriod < periodFor(nowMs)`; `selectLatestUpdate(rows)` → most recent by `period` then `publishedAt`, else `null`. Plus `summary` **query** (auth-scoped; resolves user; `holdings.by_user` → distinct `propertyId`s → `properties`; per property, `propertyUpdates.by_property` → latest → row `{propertyId, name, location, operator, period, occupancy, reservesMonths, rentOnTime, note, publishedAt, overdue}` with `latest:null`+`overdue:true` when none; `hasHoldings`; `null` when unauth/unprovisioned). Plus `flagOverdueUpdates` **internalMutation** (scan `properties`; for each overdue one with no existing `propertyUpdate.overdue` audit for the current period, `writeAudit`; return count). Plus `devSeedPropertyUpdate` **internalMutation** (per held property, idempotent on `by_property`+period, insert a realistic current-period update, audited). Reuse `periodFor` from `./home`, `writeAudit` from `./audit`.
- `app/convex/updates.test.ts` -- **NEW** convex-test: `summary` across every matrix state (fresh, quiet, overdue, never-updated, unauth→null, no-holdings) + `flagOverdueUpdates` (flags overdue, idempotent per period, empty-safe) + pure-helper units (`previousPeriod`, `isUpdateOverdue` boundary at exactly current period, `selectLatestUpdate` ordering).
- `app/convex/crons.ts` -- **NEW**. `cronJobs()`; register `crons.daily("flag overdue property updates", {hourUTC, minuteUTC}, internal.updates.flagOverdueUpdates)`; `export default crons`.
- `app/app/updates.helpers.ts` -- **NEW**. `UPDATES_COPY` (crypto-clean: eyebrow, titles, stat labels, rent-on-time/delayed variants, overdue/awaiting note, empty + signed-out copy, Explore/Sign-in CTAs); types (`UpdatesSummary`, `PropertyUpdateCard`); `updatesViewState(summary)` → `"empty" | "updates"`; formatters `formatOccupancy(fraction)` (whole %), `formatReserves(months)`, `formatRentOnTime(bool)`; `describeUpdate(card)` (WCAG text-equivalent). Reuse `hasCryptoVocabulary` from `./invest/[id]/invest.helpers`. Pure, no JSX/DOM.
- `app/app/updates.helpers.test.ts` -- **NEW** vitest: `updatesViewState` branches, the three formatters, `describeUpdate`, and the no-crypto-vocabulary invariant over every `UPDATES_COPY` value + rendered card/note strings.
- `app/app/updates/page.tsx` -- **NEW**. `/updates` route (client): copy the Portfolio/Income provisioning + guard-return ladder (signed-out / loading `undefined` / provisioning `null` / empty / updates states); read `api.updates.summary`; render one card per owned property (operator name, occupancy/reserves/rent-on-time stat rows, plain note, text-equivalent), with the calm overdue/awaiting note when `overdue`.
- `app/app/income/page.tsx` -- **MODIFY**: retarget the missed-distribution banner link (~line 130) from `/property/${latest.propertyId}` to `/updates`; remove the interim comment.
- `app/app/page.tsx` + `app/app/home.helpers.ts` -- **MODIFY**: add a "Property updates" affordance → `/updates` (`HOME_COPY.updatesCta`).
- `app/app/portfolio/page.tsx` + `app/app/portfolio.helpers.ts` -- **MODIFY**: add a "Property updates" affordance → `/updates` (`PORTFOLIO_COPY.updatesCta`).
- `app/app/globals.css` -- **MODIFY (append)**: Story 5.4 classes only — update cards (extend `.port-holding`), stat rows (`.stat-row`/`.stat-figure`), plain note, and the calm overdue note (extend the `.income-banner` `--warning` soft-tint idiom). All token-driven.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- **UPDATE** DW-15 → resolved; **APPEND** new deferrals (see Design Notes).

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/updates.ts` -- pure overdue/period/selection helpers + auth-scoped `summary` query + `flagOverdueUpdates` internalMutation + `devSeedPropertyUpdate` internalMutation -- the reactive updates model, the scheduled overdue flag, and a producer.
- [x] `app/convex/crons.ts` -- register the daily overdue-flag cron -- satisfy "a scheduled function must flag any property overdue".
- [x] `app/convex/updates.test.ts` -- convex-test `summary` (all matrix states), `flagOverdueUpdates` (flags + idempotent + empty-safe), and pure-helper units (overdue boundary, latest ordering).
- [x] `app/app/updates.helpers.ts` -- add `UPDATES_COPY`, types, view-state, formatters, and the text-equivalent -- single-source copy/format, keep the no-crypto invariant.
- [x] `app/app/updates.helpers.test.ts` -- unit-test view-state, formatters, text-equivalent, and crypto-vocab invariant.
- [x] `app/app/updates/page.tsx` -- build the `/updates` route (signed-out / loading / provisioning / empty / updates; per-property cards; overdue/awaiting note) -- deliver the monthly-update surface.
- [x] `app/app/globals.css` -- append token-only Story 5.4 styles (update cards, stat rows, plain note, overdue note).
- [x] `app/app/income/page.tsx` -- retarget the missed-distribution banner onward link to `/updates`.
- [x] `app/app/page.tsx` + `app/app/home.helpers.ts` -- add the Home "Property updates" affordance → `/updates`.
- [x] `app/app/portfolio/page.tsx` + `app/app/portfolio.helpers.ts` -- add the Portfolio "Property updates" affordance → `/updates`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- resolve DW-15 and record the new deferrals.

**Acceptance Criteria:**
- Given an owner whose held property has a current-period update, when `/updates` loads, then a card renders the named operator, occupancy %, reserves-months, rent-on-time state, and the plain note — including in an uneventful month — with a text-equivalent and no crypto vocabulary. *(Story 5.4)*
- Given a held property whose latest update predates the current period (or has none), when `/updates` loads, then the card shows a calm overdue/awaiting note (`overdue:true`) — never a silent gap.
- Given the scheduled `flagOverdueUpdates` runs, when a property is overdue and not yet flagged for the current period, then exactly one `propertyUpdate.overdue` audit entry is written; a second run in the same period writes none (idempotent).
- Given an unauthenticated visitor, when `/updates` loads, then `summary` is `null` and a calm signed-out welcome renders — never a crash or another owner's updates.
- Given the Income missed-distribution banner, when its onward link is tapped, then it routes to `/updates` (not the interim `/property/[id]`).
- Given `check:tokens`, when it scans `app/app`, then Story 5.4 introduces no hardcoded hex.

## Design Notes

- **Overdue = no update for the current period.** `isUpdateOverdue(latestPeriod, now)` is `latestPeriod === null || latestPeriod < periodFor(now)` — the literal reading of a monthly cadence, with a crisp boundary (a current-period update is not overdue; anything older is). A configurable grace day-of-month is deferred. The dev seed writes the current period, so live state is not-overdue; the overdue branch is proven by unit tests (mirrors DW-9/DW-13).
- **Scheduled flag is an audit signal.** With no notification infrastructure, the honest minimal "flag" is an append-only `propertyUpdate.overdue` audit entry per overdue property per period (idempotent by checking `auditLog` for an existing entry this period). `summary.overdue` drives the user-facing calm note independently — the surface is never silent.
- **Producer is a dev seed, like distributions.** `devSeedPropertyUpdate` follows `devSeedDistribution`: iterate held properties, idempotent per period, audited, realistic values (e.g. `operator: "Maria Alvarez, Property Manager"`, `occupancy: 0.96`, `reservesMonths: 4`, `rentOnTime: true`, plain note). Real operator authoring/feed is deferred (mirrors DW-14).
- **Reuse over reinvention.** `periodFor` + provisioning ladder + `writeAudit`, `hasCryptoVocabulary`, and the `.port-holding`/`.stat-row`/`.income-banner` idioms. Pure helpers are DOM-less and unit-tested (repo convention); no page test harness.
- **Deferred:** real operator authoring UI + notification/push delivery of overdue flags; a configurable overdue grace window; a `by_property_period` index on `propertyUpdates` (summary scans `by_property` per held property — acceptable at seed scale); per-property update history (surface shows the latest only).

## Verification

**Commands:**
- `cd app && npm test` -- expected: all vitest suites pass, including `updates.test.ts` and `updates.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: no hardcoded hex reported under `app/app`.
- `cd app && npm run build` -- expected: `next build` succeeds (type-checks the new query, route, and helpers).

**Manual checks:**
- Run the producer (`convex run updates:devSeedPropertyUpdate`) against seeded holdings, then load `/updates` as the seeded owner: one card per owned property with operator/occupancy/reserves/rent-on-time/note; the Income missed-distribution banner links here.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 3: (high 0, medium 0, low 3)
- reject: 11
- addressed_findings:
  - `[low]` `[patch]` `devSeedPropertyUpdate` header comment referenced a nonexistent `propertyUpdates.status` field ("a realistic `status`-quiet update") — reworded to "a realistic, quiet-month update" so the comment matches the schema.

Notes: The two most substantive review findings were verified as spec-conformant, not defects — the returned card shape (`period`/`publishedAt`) and the unused `previousPeriod` export are both explicitly mandated by the frozen spec's Code Map, and `flagOverdueUpdates` scanning all `properties` is exactly what the Code Map / I/O matrix specify. Three real-but-out-of-scope items were deferred: the `flagOverdueUpdates` unbounded `auditLog.by_target` idempotency scan; the orphaned-holding "silent gap" (can't occur while `properties` docs are never deleted); and the app-wide `ensureUser()` swallow-and-block provisioning pattern. Remaining findings (zero-grace month boundary [DW-18], operator/note crypto-vocab guard tied to real authoring [DW-17], locale-aware sort, same-instant tie determinism, malformed/future period from controlled producers, screen-reader parity that already matches the visual states) were rejected as spec-covered, controlled-producer-only, or by-design.

## Auto Run Result

Status: done

**Implemented change.** Story 5.4 — the monthly `/updates` surface. Adds a Convex `updates.summary` query (auth-scoped; one card per owned property with the latest operator update or an honest awaiting/overdue flag; `null` when unauthenticated/unprovisioned), a daily `flagOverdueUpdates` cron writing append-only idempotent `propertyUpdate.overdue` audit entries, and a `devSeedPropertyUpdate` CLI producer. Ships the `/updates` route (full provisioning/guard ladder + per-property cards + calm overdue/awaiting note + WCAG text-equivalents), retargets the Income missed-distribution banner to `/updates`, and adds "See property updates" affordances on Home and Portfolio. Resolves DW-15.

**Files changed.**
- `app/convex/updates.ts` (new) — pure helpers (`previousPeriod`, `isUpdateOverdue`, `selectLatestUpdate`), auth-scoped `summary` query, `flagOverdueUpdates` internalMutation, `devSeedPropertyUpdate` internalMutation.
- `app/convex/crons.ts` (new) — daily `flagOverdueUpdates` cron.
- `app/convex/updates.test.ts` (new) — 25 tests: full I/O matrix, flag idempotency/empty-safety, pure-helper units.
- `app/app/updates.helpers.ts` (new) — `UPDATES_COPY`, types, `updatesViewState`, formatters, `describeUpdate`.
- `app/app/updates.helpers.test.ts` (new) — 23 tests incl. the no-crypto-vocabulary invariant.
- `app/app/updates/page.tsx` (new) — the `/updates` client route.
- `app/app/globals.css` — appended token-only Story 5.4 classes.
- `app/app/income/page.tsx` — banner link retargeted to `/updates`.
- `app/app/page.tsx` + `app/app/home.helpers.ts` — Home `updatesCta` affordance.
- `app/app/portfolio/page.tsx` + `app/app/portfolio.helpers.ts` — Portfolio `updatesCta` affordance.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-15 resolved; DW-17…DW-20 added; three review deferrals appended.

**Review findings breakdown.** 1 patch applied (low — misleading comment). 3 items deferred (low — unbounded `auditLog` idempotency scan; orphaned-holding silent gap; app-wide `ensureUser` swallow-and-block). 11 rejected (spec-conformant, controlled-producer-only, or by-design). No intent gaps, no spec repairs, no loopbacks (`review_loop_iteration` stays 0).

**Follow-up review recommendation.** `false` — the only review-driven change was a one-word comment fix; no behavior, API, data, or security surface changed.

**Verification.** `cd app && npm test` → 21 files, 534 passed (incl. the two new suites, 48 tests). `cd app && npm run check:tokens` → clean, no hardcoded hex under `app/app`. `cd app && npm run build` → compiled + type-checked, `/updates` route emitted. The one applied patch is comment-only (no compilation impact).

**Residual risks.** All low and captured as deferrals: the overdue-flag `auditLog` scan grows month-over-month (bounded at seed scale); the orphaned-holding silent gap is latent only (properties are never deleted); the provisioning-failure loader dead-end is an accepted app-wide pattern; real operator-authored `operator`/`note` strings are not yet crypto-vocab-guarded (no real authoring exists — DW-17).
