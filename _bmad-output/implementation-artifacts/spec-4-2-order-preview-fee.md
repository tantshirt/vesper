---
title: 'Story 4.2 — Order preview & fee transparency'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: 'f933241c49329e30ed00c4f22376f39f06f9b07f'
final_revision: '8569c79daa7ac153043f22e7055ce21b635e45bf'
---

<intent-contract>

## Intent

**Problem:** The calculator (Story 4.1) ends at a "Review your order" CTA that only reveals a coming-soon note — a funded investor who has modeled an amount still can't see what they'd actually be charged. FR8 requires full cost transparency *before* they commit: the investment amount, the one-time **0.9% platform fee**, the total charged today, and an explicit note that the annual management fee is already inside the quoted net yield and is never re-charged (no double-charging).

**Approach:** Insert a local `order` view between the calculator and the (future) rights step (4.3), using the same button-driven `view`-toggle idiom 4.1 established (no new reactive gate state, no persistence). All fee math, the total-today figure, the management-fee note, and consumer copy live in a new pure `order.helpers.ts` — unit-tested without a DOM, reusing the calculator's cents/percent formatters, and asserted crypto-vocabulary-clean. The calculator's CTA now advances into this order preview; the order preview's Continue CTA reveals the honest 4.3 coming-soon placeholder.

## Boundaries & Constraints

**Always:** The only charge on top of the investment is the one-time 0.9% platform fee; total today = amount + fee (= amount × 1.009). The 0.9% rate and the net-yield percentage in the note derive from a constant / `property.targetNetYield` — never hardcoded digits in JSX. All money is tabular with two fraction digits and must not visually shift (CLS < 0.1). Consumer copy stays free of crypto vocabulary (asserted by the shared `hasCryptoVocabulary` guard). Fee math is finite-guarded and clamps a negative amount to a neutral $0.00 (mirrors 4.1's `projAmount`).

**Block If:** The platform-fee rate is anything other than the documented one-time 0.9%, or the requirement changes such that the management fee must appear as a *separate line item* (it must not — it is inside the yield). Either would be an upstream contradiction to resolve before building.

**Never:** No new gate state, no `Order` document / Convex persistence / mutation (order is settled atomically in Story 4.4, not here). No funding-source selection or rights checkboxes (4.3). No editing the amount on the order screen (Back returns to the calculator to change it). No crypto/settlement vocabulary in copy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | amount `100` | `platformFee` → `$0.90`, `totalChargedToday` → `$100.90` | No error expected |
| Non-finite amount | `NaN` / `Infinity` | fee `$0.00`, total `$0.00` | finite-guard → 0 |
| Negative amount | `-100` | fee `$0.00`, total `$0.00` | clamped to `max(0, amount)` |
| Management-fee note | `targetNetYield 0.062` | note text contains `6.2%` and states the fee is not charged again | No error expected |

</intent-contract>

## Code Map

- `app/app/invest/[id]/order.helpers.ts` -- **NEW** pure module: `PLATFORM_FEE_RATE = 0.009`, finite-guarded/clamped `platformFee(amount)` and `totalChargedToday(amount)`, `formatMgmtFeeNote(targetNetYield)`, and `ORDER_COPY` (consumer strings, no crypto/no double-charge). Reuses `formatUsdCents` + `formatYieldPct` from `calculator.helpers` (no formatter duplication).
- `app/app/invest/[id]/order.helpers.test.ts` -- **NEW** vitest: the worked example ($100 → fee/total), finite + negative-clamp guards, the note referencing the property yield, and the no-crypto-vocabulary invariant over `ORDER_COPY` and `formatMgmtFeeNote` (via imported `hasCryptoVocabulary`).
- `app/app/invest/[id]/page.tsx` -- extend `view` to `"funded" | "calculator" | "order"`; the calculator CTA now sets `view = "order"` (not the coming-soon note); render the order-preview view (property mini-context, investment / one-time platform fee (0.9%) / total-charged-today rows, the management-fee note, a `.calc-back` control back to the calculator, and a Continue CTA that reveals the 4.3 coming-soon note). Reuse `reviewOpened` for the order→rights handoff note.
- `app/app/invest/[id]/calculator.helpers.ts` -- repoint `CALC_COPY.reviewCta` to `"Review your order →"` (it now advances to a real screen) and remove the now-unused `comingSoonNote` key.
- `app/app/globals.css` -- add one minimal token-driven `.order-total` emphasis rule (hairline top + weight); reuse `.card`/`.calc-row`/`.calc-figure`/`.calc-back`/`.muted`.

## Tasks & Acceptance

**Execution:**
- [x] `app/app/invest/[id]/order.helpers.ts` -- implement `PLATFORM_FEE_RATE = 0.009`; `platformFee(amount)` = `max(0, finite(amount)) * PLATFORM_FEE_RATE`; `totalChargedToday(amount)` = `max(0, finite(amount)) + platformFee(amount)`; `formatMgmtFeeNote(targetNetYield)` composing the no-double-charge sentence from `formatYieldPct(targetNetYield)`; and `ORDER_COPY` (eyebrow/title, investment/platform-fee/total labels, back label, continue CTA, coming-soon note) — all crypto-clean. Reuse `formatUsdCents`/`formatYieldPct`. -- one pure, DOM-lessly-testable source of truth for the order/fee surface.
- [x] `app/app/invest/[id]/order.helpers.test.ts` -- assert the worked example (amount `100`: `formatUsdCents(platformFee(100))` = `"$0.90"`, `formatUsdCents(totalChargedToday(100))` = `"$100.90"`); the rate label `formatYieldPct(PLATFORM_FEE_RATE)` = `"0.9%"`; finite guards (`NaN`/`Infinity` → `$0.00`) and negative clamp (`-100` → `$0.00`); `formatMgmtFeeNote(0.062)` contains `"6.2%"`; and iterate `ORDER_COPY` values plus `formatMgmtFeeNote(0.062)` through `hasCryptoVocabulary` expecting none. -- lock the fee math, the rate, and the consumer-copy invariant.
- [x] `app/app/invest/[id]/page.tsx` -- add `"order"` to `view`; enable the calculator CTA to open the order view; render the order preview (context header `name · {formatYieldPct(targetNetYield)} · location`; rows: `ORDER_COPY.investmentLabel` → `formatUsdCents(projAmount)`, `ORDER_COPY.platformFeeLabel ({formatYieldPct(PLATFORM_FEE_RATE)})` → `formatUsdCents(platformFee(projAmount))`, emphasized `ORDER_COPY.totalLabel` → `formatUsdCents(totalChargedToday(projAmount))`; the `formatMgmtFeeNote(targetNetYield)` note; a `.calc-back` control to `setView("calculator")`; a Continue CTA that sets `reviewOpened` and reveals `ORDER_COPY.comingSoonNote`). No amount editing here. -- delivers the fee-transparent order surface between calculator and rights.
- [x] `app/app/invest/[id]/calculator.helpers.ts` -- change `CALC_COPY.reviewCta` to `"Review your order →"` and delete the unused `comingSoonNote` key (the calculator now advances into the order view). -- keep the calculator CTA honest about where it leads.
- [x] `app/app/globals.css` -- add a minimal token-driven `.order-total` rule (hairline top border + heavier weight for the total row) reusing existing idioms; keep `check:tokens` green. -- emphasize the total without a new champagne accent (the eyebrow dot remains the single accent).

**Acceptance Criteria:**
- Given a funded investor who set a valid amount on the calculator and tapped its CTA, when the order preview renders, then it shows the investment amount, the one-time 0.9% platform fee (with the 0.9% rate visible), and the total charged today — each in tabular figures with no layout shift.
- Given the order preview computes for The Monroe at $100, then it shows investment `$100.00`, platform fee (0.9%) `$0.90`, and total today `$100.90`.
- Given the order preview, then a note states the annual management fee is already included in the property's net yield (`6.2%` for the seed) and is never charged again (no double-charging).
- Given the order preview, when the investor taps Back, then they return to the calculator with their amount intact; when they tap Continue, then — until Story 4.3 exists — a calm coming-soon note appears (the primary path is not a dead end).

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 3
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` `order.helpers.ts` a sub-cent typed amount (e.g. `50.555`) made the order rows fail to sum — investment `$50.55` + fee `$0.45` shown, but `totalChargedToday` was computed from the unrounded value, a penny-level contradiction on a fee-transparency screen. `platformFee`/`totalChargedToday` now build from cents-rounded parts (`roundCents`) so displayed investment + fee always equals the displayed total; added a reconciliation test over whole, round, and sub-cent amounts.
  - `[low]` `[patch]` `page.tsx` the shared `reviewOpened` flag (never reset) pre-revealed the 4.3 coming-soon note on re-entry to the order view (Continue → Back → re-open showed the note without tapping Continue). The calculator CTA now clears `reviewOpened` before `setView("order")`, so the order preview always opens fresh.
  - `[low]` `[patch]` `page.tsx` the order-view Continue button lacked `type="button"` (its sibling Back buttons have it). Added `type="button"` for consistency and to avoid implicit submit semantics.

## Design Notes

- **Fee model (FR8).** The one-time 0.9% platform fee is the *only* charge on top of the investment: `total today = amount × 1.009`. The annual management fee is deliberately **not** a line item — it is already inside `targetNetYield`, and the note makes that non-re-charging explicit. Both the fee rate and the yield in the note derive from `PLATFORM_FEE_RATE` / `property.targetNetYield`, so a different rate or offering renders correctly with no hardcoded digits.
- **View toggle, not a gate state or an order record.** The order preview is a local `view` between `calculator` and the future rights step — the same idiom as 4.1's `funded → calculator`. There is no `Order` document, mutation, or persistence: the order is only *previewed* here; it is created and settled atomically in Story 4.4. The reactive `investGateState` machine is untouched.
- **Defensive amount.** The order view reuses the calculator's `projAmount = max(0, finite(amount))`, and `order.helpers` clamps identically, so a stray non-finite/negative amount yields a neutral `$0.00` rather than a nonsensical negative fee — even though the calculator CTA gates entry on a valid amount.
- **Honest placeholder.** Story 4.3 doesn't exist yet, so Continue reveals a calm coming-soon note (the same pattern 4.1/3.x used), while the calculator's own CTA is repointed away from its old placeholder into this real screen.

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (`/invest/[id]` still a dynamic route).
- `cd app && npm test` -- expected: vitest passes, including the new `order.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: clean (no hardcoded non-token colors).

**Manual checks:**
- Grep `ORDER_COPY` and `formatMgmtFeeNote` output for crypto words (`wallet`/`token`/`mint`/…) — expect none; confirm the note conveys "already included / not charged again" (no double-charge).

## Auto Run Result

Status: done

**Summary.** Delivered Epic 4's fee-transparency step (FR8). Between the calculator (4.1) and the future rights step (4.3), a funded investor now sees a full order preview before committing: the investment amount, the one-time **0.9% platform fee** (rate visible), and the **total charged today** — plus a note that the annual management fee is already inside the property's net yield and is never charged again (no double-charging). Implemented as a local `order` `view` off the calculator (same button-toggle idiom as 4.1; the reactive gate-state machine is untouched), with all fee math, the total, the management-fee note, and consumer copy in a new pure `order.helpers.ts` — unit-tested without a DOM and asserted crypto-vocabulary-clean. No `Order` document, mutation, or persistence: the order is only *previewed* here; it is created and settled atomically in Story 4.4. The calculator's CTA was repointed from its old coming-soon placeholder into this real screen; the order preview's Continue reveals the honest 4.3 coming-soon note.

**Files changed:**
- `app/app/invest/[id]/order.helpers.ts` — NEW pure module: `PLATFORM_FEE_RATE = 0.009`, finite-guarded + negative-clamped + cents-rounded `platformFee`/`totalChargedToday`, `formatMgmtFeeNote(targetNetYield)`, and `ORDER_COPY`. Reuses `formatUsdCents`/`formatYieldPct` from `calculator.helpers`.
- `app/app/invest/[id]/order.helpers.test.ts` — NEW: 23 vitest cases (worked example $100 → fee `$0.90`, total `$100.90`; 0.9% rate label; finite guards; negative clamp; management-fee note references the property yield; row-sum reconciliation across whole/round/sub-cent amounts; no-crypto invariant over `ORDER_COPY` + the note).
- `app/app/invest/[id]/page.tsx` — extended `view` to `"funded" | "calculator" | "order"`; the calculator CTA opens the order view fresh (clearing `reviewOpened`); new order-preview render block (back control, eyebrow/title/context, investment / one-time platform fee (0.9%) / total-today rows, management-fee note, Continue → coming-soon note).
- `app/app/invest/[id]/calculator.helpers.ts` — `CALC_COPY.reviewCta` → `"Review your order →"`; removed the now-unused `comingSoonNote` key.
- `app/app/globals.css` — token-only `.order-total` rule (hairline top + heavier ink weight for the total row); no second champagne accent.
- `_bmad-output/implementation-artifacts/deferred-work.md` — three review deferrals (invest view-transition focus management; single-source the preview fee rate with 4.4 settlement; calculator amount input has no upper bound).

**Review findings breakdown:** 3 patches applied (medium 1: sub-cent amounts now reconcile to the penny via cents-rounded fee math + a reconciliation test — low 2: order view opens fresh so the coming-soon note never pre-shows; Continue button given `type="button"`). 3 deferred (view-transition focus a11y — pre-existing 4.1 pattern; preview-fee/settlement single-sourcing — by-design until 4.4; unbounded amount input — pre-existing 4.1 validation gap). 6 rejected (view preserved across a reactive blip is desired; `.order-total` 24px matches the existing `.calc-fy` idiom; no render tests by repo convention; "Total charged today" is AC-mandated FR8 wording; the 1-line `finite` guard duplication is acceptable for self-contained pure modules; `reviewOpened` name still meaningful). 0 intent gaps, 0 bad-spec repairs.

**Follow-up review recommendation:** `false`. The final pass made three localized, test-covered fixes (a rounding correction contained entirely in the pure fee helper with six new reconciliation assertions, plus two trivial UI hygiene fixes) with no change to the data model, API surface, security, or the settlement path. All gates green after the patches.

**Verification:** `npm run build` ✓ (compiles; `/invest/[id]` still dynamic), `npm test` ✓ (244 passed, 10 files — +23 `order.helpers.test.ts`), `npm run check:tokens` ✓ (clean). Worked example verified exactly: investment `$100.00`, platform fee (0.9%) `$0.90`, total today `$100.90`; management-fee note reads the property's `6.2%` yield.

**Residual risks:** The previewed total is pure client-side math with no server authority yet — by design, since settlement is Story 4.4 (deferred: single-source the fee rate with the settlement mutation so preview and charge cannot drift). The invest view transitions still lack focus management (deferred a11y polish, pre-existing from 4.1), and the calculator amount input remains unbounded above (deferred, pre-existing) — neither manifests for a normal investor on the seed property (The Monroe, 6.2% yield, $50 minimum). The order surface was not exercised in a live browser (no DOM harness by repo convention); the fee math, cents reconciliation, and copy invariant are covered by the pure-helper suite, and build/typecheck/token gates pass.
