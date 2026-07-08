---
title: 'Story 4.1 — Calculator & live projection'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: 'ccf1ac66931c8a518cd0c07e87de8fa683e6c4b7'
final_revision: 'ce622f3cb36ea09c20d2beebeb92280c9d3d08ff'
---

<intent-contract>

## Intent

**Problem:** The invest flow ends at the `funded` screen (Story 3.3) whose "Continue to your investment" CTA is a disabled placeholder — a funded, eligible investor has no way to model an investment. Epic 4's write path opens here: the investor must set an amount and see, live, exactly what they'd own and earn — base **and** downside — with the $50 minimum enforced (FR7, NFR1).

**Approach:** Advance the funded screen into a new local `calculator` view (a button-driven view toggle, mirroring the existing `showAddMore` idiom — the reactive gate-state machine is unchanged). The calculator reads the loaded property (`offeringSize`, `targetNetYield`, `minInvestment`) and recomputes ownership %, estimated monthly income, and first-year base live on every amount change (input, slider, or chip), with a Base|Downside toggle that flips the first-year figure to the −12% case. All projection math, validation, and formatting live in a new pure `calculator.helpers.ts` (unit-tested, no DOM), matching the repo's helper+vitest pattern. Order preview, fees, funding-source, and acknowledgement are later stories (4.2/4.3) and are out of scope.

## Boundaries & Constraints

**Always:**
- Every projection recomputes **live** on amount change (typed input, slider drag, or quick chip) with no layout shift (CLS: tabular numerals, fixed row layout). Money is rendered tabular via the formatters.
- Minimum investment is `property.minInvestment` (seed = $50). Below it: an inline "The minimum is $50." hint shows and the primary CTA is **disabled**; at/above it the CTA is enabled. Enforcement lives in a pure, tested `isValidInvestAmount`.
- The Downside toggle shows the first-year figure as the −12% case in **loss color (`--loss`) with an explicit `−`**; the Base view shows the positive first-year figure with a `+`. Both views stay visible/one-tap — downside is never hidden behind a tap-away.
- Ownership % basis is `amount / property.offeringSize` — localized to one pure function (`ownershipFraction`) so the B2 basis decision is a one-line swap. Projections read `targetNetYield` from the property (never a hardcoded 6.2%); appreciation and downside are named constants.
- No crypto vocabulary in any consumer copy (the existing `hasCryptoVocabulary` guard) and no order/fee/funding-source terms. Inherit design-system tokens/classes only — reuse `.wrap`/`.card`/`.row`/`.chip`/`.chip.on`/`.metric`/`.cta`/`.muted`; `npm run check:tokens` must stay green.

**Block If:**
- The property record lacks `offeringSize`, `targetNetYield`, or `minInvestment` such that the calculator cannot compute — HALT rather than invent a basis. (Seed `The Monroe` has all three: `offeringSize: 1_240_000`, `targetNetYield: 0.062`, `minInvestment: 50`.)

**Never:**
- Do not build the order preview, the one-time 0.9% platform fee line, the "Paid from balance" funding-source row, or resulting-ownership order copy — that is Story 4.2. Do not build the risk acknowledgement (4.3), DvP settlement (4.4), or confirmation (4.5).
- Do not add an affordability / "amount > balance → Add $X more" check — that belongs to the order/funding step (4.2). The calculator models any amount ≥ minimum (it is a projection, not a purchase).
- Do not persist anything (no Convex mutation, no schema change, no `orders`/`holdings` write); the calculator is pure client-side projection. Do not resolve the B2 ownership-% basis or the exact −12%→first-year derivation unattended — build against the documented assumption and log both as deferred work.
- Do not introduce a DOM/browser test harness — follow the pure-helper + vitest pattern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Base projection at $100 (The Monroe) | amount `100`, view `base` | own `0.0081%`; est. monthly `+$0.40`; first year `+$6.20` (rent `$4.80` · appreciation `$1.40`); CTA enabled | — |
| Downside toggle | amount `100`, view `downside` | first year flips to `−$0.80` in `--loss` with `−`; the −12% assumption copy shows; ownership % and monthly unchanged | — |
| Change via slider / chip | user drags slider or taps a `$50/$100/$250/$500` chip | amount updates and every figure recomputes instantly, tabular, no layout shift | — |
| Below minimum | amount `< minInvestment` (e.g. `40`) | inline "The minimum is $50." hint; primary CTA **disabled** (`isValidInvestAmount` false) | Projections still render (small values); no crash |
| Empty / non-numeric amount | input cleared or `NaN` | figures show `$0.00` / `0.0000%`; CTA disabled | Helpers treat non-finite as `0` (no throw) |
| At/above minimum | amount `≥ minInvestment` | all projections live; CTA enabled; tapping it reveals the calm "review step coming soon" handoff (4.2/4.3 placeholder) | — |

</intent-contract>

## Code Map

- `app/app/invest/[id]/calculator.helpers.ts` -- **NEW** pure module: projection constants (`APPRECIATION_YIELD = 0.014`, `DOWNSIDE_FIRST_YEAR_RATE = -0.008`, `DOWNSIDE_VALUE_LABEL = "−12%"`, `SLIDER_MIN = 50`, `SLIDER_MAX = 2000`, `QUICK_CHIPS = [50,100,250,500]`), math (`ownershipFraction`, `estMonthlyIncome`, `firstYearBase`, `firstYearDownside`, `rentComponent`, `appreciationComponent`), validation (`isValidInvestAmount`), formatters (`formatUsdCents`, `formatSignedUsd`, `formatOwnershipPct`, `formatYieldPct`), and `CALC_COPY` (consumer strings). All finite-guarded (non-finite → 0).
- `app/app/invest/[id]/calculator.helpers.test.ts` -- **NEW** vitest: the design-contract worked example ($100 → own/monthly/base/rent/appreciation/downside), validation boundaries, formatter output, and the `CALC_COPY` no-crypto-vocab invariant (via imported `hasCryptoVocabulary`).
- `app/app/invest/[id]/page.tsx` -- add local `view: "funded" | "calculator"`, `investAmount` (default `"100"`), and `projection: "base" | "downside"` state; enable the `funded` "Continue to your investment" CTA to set `view = "calculator"`; render the calculator view (property mini-context, big editable amount + slider + quick chips, projection block with Base|Downside toggle + itemized rent/appreciation, min-hint, and a validity-gated "Review rights & risks →" CTA that reveals a coming-soon note). Stop rendering `fundedNote` (the CTA now advances).
- `app/app/globals.css` -- add minimal token-driven `.calc-*` styling only where existing classes are insufficient (big amount figure, range slider, projection rows, the Base|Downside segmented toggle); reuse `.chip`/`.card`/`.row`/`.metric`/`.cta`.
- `app/app/invest/[id]/invest.helpers.ts` -- reuse `formatUsd` / `hasCryptoVocabulary` as-is; no change to `investGateState`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- append two rows: B2 ownership-% basis confirmation, and the −12%→first-year downside-rate derivation confirmation.

## Tasks & Acceptance

**Execution:**
- [x] `app/app/invest/[id]/calculator.helpers.ts` -- implement the constants, math, validation, formatters, and `CALC_COPY`. `ownershipFraction(amount, offeringSize)` = `amount/offeringSize` (0 if `offeringSize<=0` or non-finite). `estMonthlyIncome(amount, targetNetYield)` = `amount*(targetNetYield-APPRECIATION_YIELD)/12`. `firstYearBase(amount, targetNetYield)` = `amount*targetNetYield`. `firstYearDownside(amount)` = `amount*DOWNSIDE_FIRST_YEAR_RATE`. `rentComponent`/`appreciationComponent` split the base. `isValidInvestAmount(amount, min)` = finite && `amount>=min`. `formatSignedUsd` prefixes `+`/`−` on the cents value; `formatOwnershipPct(fraction)` = `(fraction*100).toFixed(4)+"%"`. -- one pure, DOM-lessly-testable source of truth for the calculator.
- [x] `app/app/invest/[id]/calculator.helpers.test.ts` -- assert the worked example (amount `100`, `offeringSize 1_240_000`, `targetNetYield 0.062`): own `"0.0081%"`, monthly `"+$0.40"`, base `"+$6.20"`, rent `$4.80`, appreciation `$1.40`, downside `"−$0.80"`; validation (accepts 50/100/2000; rejects 49, 0, negative, NaN, Infinity, empty→NaN); formatters (signed +/−, cents, 4-dp pct, yield `"6.2%"`); and iterate `CALC_COPY` through `hasCryptoVocabulary` expecting none. -- lock the math, the min rule, and the consumer-copy invariant.
- [x] `app/app/invest/[id]/page.tsx` -- add the three local states; enable the funded CTA to open the calculator view; render the calculator (context header `name · {formatYieldPct(targetNetYield)} · location`; big editable `investAmount` input; range slider `SLIDER_MIN..SLIDER_MAX`; quick chips reusing `.chip`/`.chip.on`; projection rows You'd own / Est. monthly / First year with the Base|Downside toggle and itemized rent·appreciation; inline min hint when `!isValidInvestAmount`; primary CTA `disabled={!valid}` that on click shows the coming-soon review note). No crypto/order/fee copy. -- delivers the live calculator surface after funded.
- [x] `app/app/globals.css` -- add minimal token-driven `.calc-*` rules (amount figure, slider, projection rows, segmented toggle) reusing existing idioms; keep `check:tokens` green. -- keep the screen on-brand without inventing non-token color.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append the B2 ownership-basis and downside-derivation confirmation rows (Origin story 4.1, Status Open). -- record the two documented assumptions this story builds against.

**Acceptance Criteria:**
- Given a funded, eligible investor on the calculator, when they change the amount via input, slider, or a quick chip, then ownership %, estimated monthly income, and the first-year base figure recompute live in tabular figures with no layout shift.
- Given the minimum is `property.minInvestment` ($50), when the amount is below it, then an inline "The minimum is $50." hint appears and the primary CTA is disabled; when it is at or above the minimum, the CTA is enabled.
- Given the projection, when the investor toggles to Downside, then the first-year figure shows the −12% case in loss color with an explicit `−`, while ownership % and monthly income are unchanged and the base view remains one tap away.
- Given the calculator computes for The Monroe at $100, then it shows ownership `0.0081%`, est. monthly `+$0.40`, first-year base `+$6.20` (rent `$4.80` · appreciation `$1.40`), and downside `−$0.80`.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 5, low 4)
- defer: 2
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` `calculator.helpers.ts`/`page.tsx` the min hint was the hardcoded string "The minimum is $50." while the CTA gate used `property.minInvestment` — they agree only for the seed; a non-$50 property would show a hint contradicting the enforced floor. Added `formatMinHint(min)` deriving the hint from the property minimum.
  - `[medium]` `[patch]` `page.tsx` a typed negative amount (the number field's `min=0` doesn't block typed input) rendered negative figures in positive (ink) color. Projections now compute from `projAmount = max(0, amount)`; validity still tracks the raw input so the hint + disabled CTA fire.
  - `[medium]` `[patch]` `page.tsx` the amount `<input>` and the range slider shared the identical accessible name ("How much?"). Gave them distinct labels (`amountInputLabel`/`sliderLabel`) and added `aria-valuetext={formatUsd(sliderValue)}` to the slider.
  - `[medium]` `[patch]` `page.tsx` the calculator view was a navigation dead-end (no way back to the funded/balance screen). Added a low-weight `.calc-back` control that sets `view="funded"`.
  - `[medium]` `[patch]` `calculator.helpers.ts` the "−12%" label sat next to a −$0.80 figure with no clarification that −12% is a *property-value* drop (a $100 stake reads as if it should lose ~$12). Reworded `downsideExplainer` to state it models a −12% drop in the property's value.
  - `[low]` `[patch]` `calculator.helpers.ts` `DOWNSIDE_VALUE_LABEL` was exported/tested but never rendered ("−12%" was duplicated inline). The reworded explainer now single-sources it from the constant.
  - `[low]` `[patch]` `calculator.helpers.ts` `ownershipFraction` could return >100% for an absurd amount above the offering (e.g. "161.2903%"). Clamped to [0, 1].
  - `[low]` `[patch]` `page.tsx` the "review coming soon" note lingered after the amount was edited to invalid (CTA disabled but note still shown). Gated the note on `valid`.
  - `[low]` `[patch]` `globals.css` the section comment overclaimed "zero CLS" (tabular figures only stabilize digit width, not the toggled hint/explainer/note slots). Reworded to "tabular figures for stable money".

## Design Notes

- **Projection formulas (design contract DD-001 / screen 01.6, worked at $100).** Base first-year = `amount × targetNetYield` (6.2% → $6.20), split into rent = `amount × (targetNetYield − APPRECIATION_YIELD)` (4.8% → $4.80) and appreciation = `amount × APPRECIATION_YIELD` (1.4% → $1.40). Est. monthly = the rent slice ÷ 12 ($0.40) — only rent is cash-distributed. `targetNetYield` is read from the property so a different offering recomputes correctly; only appreciation (1.4%) and the downside rate are constants.
- **Downside is a documented constant, not a live model.** `DOWNSIDE_FIRST_YEAR_RATE = -0.008` is the design contract's first-year net figure for the −12% value-stress scenario ($100 → −$0.80); the `−12%` shown in copy is the scenario label. The exact −12%→−0.8% derivation is unspecified upstream and is logged as deferred work — it isolates to one constant + one function.
- **B2 (ownership-% basis) is open but building now is sanctioned** (epic-4 context). The calculator uses `offeringSize` (appraisal basis, $1,240,000 seed) via the single `ownershipFraction` function; swapping to a raise/share-count basis later is a one-line change. Logged as deferred work.
- **View toggle, not a new gate state.** The reactive `investGateState` cannot distinguish "just funded" from "wants to invest" (no reactive signal), so the calculator is a local `view` toggle off the funded screen — the same idiom as `showAddMore`. The gate-state machine and its tests are untouched.
- **CTA handoff.** The primary CTA's disabled state is genuinely amount-driven (AC: disabled below min). Because 4.2/4.3 don't exist, tapping the enabled CTA reveals a calm "coming soon" review note — the same honest-placeholder pattern 3.1/3.2/3.3 used, but here enable/disable reflects validity so the min-enforcement AC is observable and testable.
- **Signs & color.** Positive figures (monthly, base) render in ink with a `+`; the downside first-year renders in `--loss` with a `−` — meeting the AC's "loss color + −" precisely while keeping the screen calm (positives are not over-colored).

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (`/invest/[id]` still a dynamic route).
- `cd app && npm test` -- expected: vitest passes, including the new `calculator.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: clean (no hardcoded non-token colors).

**Manual checks:**
- Grep `CALC_COPY` for crypto words (`wallet`/`token`/`mint`/…) and order/fee terms (`fee`/`USDC`/`platform`) — expect none in the calculator copy (fees/funding are Story 4.2).

## Auto Run Result

Status: done

**Summary.** Opened Epic 4's write path with a live calculator after the funded screen. The funded "Continue to your investment" CTA (formerly a disabled placeholder) now opens a local `calculator` view (a button-driven toggle off the funded screen — the reactive gate-state machine is untouched). The calculator reads the loaded property's `offeringSize`, `targetNetYield`, and `minInvestment` and recomputes ownership %, estimated monthly income, and the first-year figure live on every amount change (typed input, range slider, or a $50/$100/$250/$500 quick chip). A Base|Downside segmented toggle flips the first-year figure to the documented −12% value-stress case, rendered in `--loss` with a `−`; the minimum is enforced from `property.minInvestment` with an inline hint and a validity-gated CTA. All projection math, validation, formatting, and consumer copy live in a new pure `calculator.helpers.ts`, unit-tested without a DOM. The calculator is pure client-side projection — no persistence, no order preview, no fee line, no funding-source, no acknowledgement (those are Stories 4.2–4.5). The ownership-% basis (B2) and the exact −12%→first-year derivation are documented assumptions, each isolated to one constant/function and logged as deferred work (DW-2/DW-3).

**Files changed:**
- `app/app/invest/[id]/calculator.helpers.ts` — NEW pure module: projection constants, finite-guarded math (`ownershipFraction` clamped to [0,1], `estMonthlyIncome`, `firstYearBase`, `firstYearDownside`, `rentComponent`, `appreciationComponent`), `isValidInvestAmount`, formatters (`formatUsdCents`, `formatSignedUsd`, `formatOwnershipPct`, `formatYieldPct`, `formatMinHint`), and `CALC_COPY`.
- `app/app/invest/[id]/calculator.helpers.test.ts` — NEW: 40 vitest cases (worked example, finite/clamp guards, min-rule boundaries, formatter output, min-hint derivation, and the `CALC_COPY` no-crypto-vocab invariant).
- `app/app/invest/[id]/page.tsx` — added `view`/`investAmount`/`projection`/`reviewOpened` state; the funded CTA opens the calculator; new calculator view (mini-context, big amount input + slider + chips, live projection block with Base|Downside toggle + itemized rent·appreciation, min hint, back affordance, validity-gated review CTA + coming-soon note).
- `app/app/globals.css` — token-only `.calc-*` rules (amount figure, slider, projection rows, segmented toggle, back link).
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-2 (B2 ownership-% basis) + DW-3 (downside-rate derivation) in the table; two step-04 review deferrals (low-yield rent slice, slider/chip range vs non-$50 minimum).

**Review findings breakdown:** 9 patches applied (medium 5: min-hint now derived from `property.minInvestment`; negative typed amount clamped to a neutral $0 projection; distinct a11y labels + slider `aria-valuetext`; back affordance out of the calculator; downside copy clarified as a property-value drop — low 4: single-sourced `DOWNSIDE_VALUE_LABEL`; ownership clamped to ≤100%; coming-soon note gated on validity; overstated "zero CLS" comment reworded). 2 deferred (low-yield rent slice, slider/chip range vs minimum — neither triggerable on seed data, both design-governed). 6 rejected (monthly-unchanged-in-downside and monthly×12≠first-year are spec/AC-intended; segmented-toggle `aria-pressed` is an accepted pattern; non-integer amounts scoped out; chip formatter intentional; zero-projection-when-empty is I/O-matrix intended). 0 intent gaps, 0 bad-spec repairs.

**Follow-up review recommendation:** `false`. The final pass made only localized, test-covered refinements (a11y labels, copy clarity, defensive input clamps, a nav affordance, a derived hint) with no change to the core projection math, data model, security, or API surface. All gates green after the patches.

**Verification:** `npm run build` ✓ (compiles; `/invest/[id]` dynamic, 4.7 kB), `npm test` ✓ (222 passed, 9 files — +40 `calculator.helpers.test.ts`), `npm run check:tokens` ✓ (clean). Worked example verified exactly: own `0.0081%`, monthly `+$0.40`, base `+$6.20` (rent `$4.80` · appreciation `$1.40`), downside `−$0.80`.

**Residual risks:** The ownership-% basis (B2) and the −12%→first-year downside rate are unconfirmed design assumptions (DW-2/DW-3), each isolated to a single constant/function for a one-line swap. `APPRECIATION_YIELD` is a fixed global (deferred low-yield guard) and the slider/chip range is fixed at 50–2000 (deferred multi-property coupling) — neither manifests on the seed property (The Monroe, 6.2% yield, $50 minimum). The calculator was not exercised in a live browser (no DOM harness by repo convention); the projection math, min rule, clamps, and copy invariant are covered by the pure-helper suite, and build/typecheck/token gates pass.
