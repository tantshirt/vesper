---
title: 'Story 4.3 — Rights & risk acknowledgement'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: '225ec00904c82119b86baf131d8f26b710aeee90'
final_revision: '51007d09ba6aa8025d6dc733060483a2820c24f2'
---

<intent-contract>

## Intent

**Problem:** The order preview (Story 4.2) ends at a "Continue" CTA that only reveals a coming-soon note — a funded investor who has seen the full cost still has no place to give the active, informed consent that a Reg A+ purchase legally requires. FR9 requires **three checkboxes, all actively checked**, before Confirm enables; fewer than three keeps Confirm disabled. This is where intent becomes real consent.

**Approach:** Insert a local `rights` view between the order preview and the (future) settlement step (4.4), using the same button-driven `view`-toggle idiom 4.1/4.2 established (no new reactive gate state, no persistence). Three distinct risk acknowledgements, their "all checked" gate, and all consumer copy live in a new pure `rights.helpers.ts` — unit-tested without a DOM, asserted crypto-vocabulary-clean. The order preview's Continue CTA now advances into this rights view (entered fresh, all boxes unchecked); the rights Confirm reveals the honest 4.4 coming-soon note (settlement isn't wired yet).

## Boundaries & Constraints

**Always:** Confirm is enabled **only** when all three acknowledgements are actively checked (`allAcknowledged`); any fewer keeps it `disabled` + `aria-disabled`. The three acknowledgements, the required count, and every consumer string derive from `rights.helpers` — never hardcoded in JSX. Consumer copy stays free of crypto vocabulary (asserted by the shared `hasCryptoVocabulary` guard). The rights view is entered fresh from the order preview — all boxes reset to unchecked so consent is deliberate per order. Checkbox rows meet the 44px touch-target / WCAG 2.2 AA bar and use token-driven styles only (`check:tokens` stays green).

**Block If:** The requirement changes such that the number of required acknowledgements is not three, or a specific legally-mandated acknowledgement wording is handed down that contradicts the generic risk statements here (would be an upstream copy/compliance decision, not an unattended build choice).

**Never:** No new gate state, no `Order`/consent document, Convex mutation, or persistence (consent is captured with the atomic settlement in Story 4.4, not here). No settlement, payment, or token movement. No editing the amount or fees here (Back returns to the order preview). No crypto/settlement vocabulary in copy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| None checked | `{}` | `allAcknowledged` → `false` (Confirm disabled) | No error expected |
| Some checked | one or two ack ids `true` | `allAcknowledged` → `false` | No error expected |
| All checked | all three ack ids `true` | `allAcknowledged` → `true` (Confirm enabled) | No error expected |
| Stale/unknown key | two required `true` + an unknown id `true` | `allAcknowledged` → `false` (unknown keys never satisfy the gate) | ignore unknown keys |
| Explicit unchecked | a required id set `false` | `allAcknowledged` → `false` | No error expected |

</intent-contract>

## Code Map

- `app/app/invest/[id]/rights.helpers.ts` -- **NEW** pure module: `RIGHTS_ACKS` (three `{id,label}` risk statements — illiquidity, possible loss / not guaranteed, not-insured / invest-only-what-you-can-leave), `REQUIRED_ACK_COUNT = RIGHTS_ACKS.length`, `allAcknowledged(checked: Record<string, boolean>)` (true iff every required id is `=== true`), and `RIGHTS_COPY` (eyebrow/title/intro, back label, confirm CTA, 4.4 coming-soon note). Crypto-clean.
- `app/app/invest/[id]/rights.helpers.test.ts` -- **NEW** vitest: the count is 3 with distinct ids; the I/O matrix (`{}`/partial/all/unknown-key/explicit-false); and the no-crypto invariant over `RIGHTS_COPY` values and every `RIGHTS_ACKS` label (via imported `hasCryptoVocabulary`).
- `app/app/invest/[id]/page.tsx` -- extend `view` to include `"rights"`; replace `reviewOpened` with `acks` (a `Record<string,boolean>`) + `confirmOpened`; the order-preview Continue now resets `acks`/`confirmOpened` and sets `view = "rights"` (no longer reveals the order coming-soon note); render the rights view (context header, three checkbox rows from `RIGHTS_ACKS`, a `.calc-back` control to the order preview, and a Confirm CTA disabled until `allAcknowledged(acks)` that reveals the 4.4 coming-soon note).
- `app/app/invest/[id]/order.helpers.ts` -- repoint `ORDER_COPY.continueCta` to name its real destination (e.g. `"Continue to acknowledge risks →"`) and remove the now-unused `comingSoonNote` key (Continue advances to a real screen).
- `app/app/globals.css` -- add token-driven acknowledgement rows (`.ack-list`/`.ack-item` with an accent-tinted native checkbox, ≥44px target, champagne focus ring) and a shared `.cta:disabled` rule (dimmed + `not-allowed`, hover neutralized) so the AC-central disabled state is perceivable. Reuse `.card`/`.calc-back`/`.muted`.

## Tasks & Acceptance

**Execution:**
- [x] `app/app/invest/[id]/rights.helpers.ts` -- implement `RIGHTS_ACKS` (three distinct, crypto-clean `{id,label}` risk statements), `REQUIRED_ACK_COUNT`, `allAcknowledged(checked)` = `RIGHTS_ACKS.every(a => checked[a.id] === true)`, and `RIGHTS_COPY`. -- one pure, DOM-lessly-testable source of truth for the consent gate and copy.
- [x] `app/app/invest/[id]/rights.helpers.test.ts` -- assert `REQUIRED_ACK_COUNT === 3` and ids are unique; drive the I/O matrix through `allAcknowledged` (empty/one/two/all `true`, an unknown-key-true case, and an explicit-`false` case); iterate `RIGHTS_COPY` values plus every `RIGHTS_ACKS.label` through `hasCryptoVocabulary` expecting none. -- lock the consent gate and the consumer-copy invariant.
- [x] `app/app/invest/[id]/page.tsx` -- add `"rights"` to `view`; introduce `acks`/`confirmOpened` state (removing `reviewOpened`); the order Continue CTA opens the rights view fresh (`setAcks({})`, `setConfirmOpened(false)`); render the rights preview (eyebrow/title/intro, a `RIGHTS_ACKS.map` of accessible checkbox `<label>`s bound to `acks[id]`, a `.calc-back` to `setView("order")`, and a Confirm CTA `disabled`/`aria-disabled` on `!allAcknowledged(acks)` that sets `confirmOpened`, revealing `RIGHTS_COPY.comingSoonNote`). -- the active-consent gate between the order preview and settlement.
- [x] `app/app/invest/[id]/order.helpers.ts` -- repoint `ORDER_COPY.continueCta` to name the acknowledgement destination and delete the now-unused `comingSoonNote` key. -- keep the order CTA honest about where it leads.
- [x] `app/app/globals.css` -- add the token-only `.ack-list`/`.ack-item` checkbox rows (≥44px target, accent checkbox, champagne focus) and `.cta:disabled` (dimmed + `not-allowed`, neutral hover); keep `check:tokens` green. -- make the checkboxes tappable/accessible and the disabled Confirm visibly inert.

**Acceptance Criteria:**
- Given a funded investor who has reviewed their order and tapped its Continue CTA, when the rights view renders, then it shows three risk acknowledgements each with an unchecked checkbox and a Confirm CTA that is disabled.
- Given the rights view with fewer than all three checkboxes checked, when the investor checks or unchecks a box, then Confirm stays disabled; and when all three are checked, then Confirm enables. *(FR9)*
- Given all three checked and Confirm enabled, when the investor taps Confirm, then — until Story 4.4 exists — a calm coming-soon note appears (the primary path is not a dead end); and when they tap Back, then they return to the order preview with their amount and fees intact.
- Given the investor returns from the order preview into the rights view a second time, then all three checkboxes are unchecked again (consent is deliberate per order), and no crypto/settlement vocabulary appears anywhere on the screen.

## Design Notes

- **The gate is the story (FR9).** `allAcknowledged` is the single source of truth for Confirm's enabled state: it returns true only when *every* `RIGHTS_ACKS` id is explicitly `true`, so an unknown/stale key can never satisfy it and a missing key never accidentally enables. The button mirrors it with both `disabled` and `aria-disabled`.
- **View toggle, not a consent record.** The rights view is a local `view` between `order` and the future settlement step — the same idiom as 4.1's `funded → calculator` and 4.2's `calculator → order`. There is no consent document, mutation, or persistence: consent is captured atomically with the purchase in Story 4.4. The reactive `investGateState` machine is untouched.
- **Fresh consent per order.** Entering the rights view from the order Continue resets `acks` to `{}` (mirroring 4.2's fresh-entry fix for the coming-soon reveal), so a returning investor must actively re-check — consent is never pre-satisfied by a prior visit.
- **Three generic risks, single-sourced.** The acknowledgements cover illiquidity, possible loss / no guaranteed return (pairing the calculator's Downside case), and not-a-bank-deposit / invest-only-what-you-can-leave — standard Reg A+ risk categories, kept in `RIGHTS_ACKS` so a compliance-blessed wording swap is one edit with no JSX churn.

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (`/invest/[id]` still a dynamic route).
- `cd app && npm test` -- expected: vitest passes, including the new `rights.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: clean (no hardcoded non-token colors).

**Manual checks:**
- Grep `RIGHTS_COPY` values and `RIGHTS_ACKS` labels for crypto words (`wallet`/`token`/`mint`/`seed`/…) — expect none.
- Reason through the gate: 0/1/2 boxes → Confirm disabled; all 3 → enabled; unchecking any → disabled again.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 12
- addressed_findings:
  - `[low]` `[patch]` `page.tsx` the 4.4 coming-soon note (`confirmOpened`, `role="status"`) lingered after the investor confirmed then unchecked a box — the screen showed a "moving forward" note over a re-disabled gate. The checkbox `onChange` now resets `confirmOpened` on any toggle, so the note only follows a deliberate Confirm on the current complete set (mirrors 4.2's fresh-reveal fix).
  - `[low]` `[patch]` `page.tsx` the three acknowledgements sat in a bare `.ack-list` with no semantic grouping; added `role="group"` + `aria-label={RIGHTS_COPY.title}` so assistive tech reads them as one required consent set (mirrors the calculator toggle's `role="group"` idiom).
  - `[low]` `[patch]` `rights.helpers.ts` `allAcknowledged` used `RIGHTS_ACKS.every(...)`, which returns `true` for an empty array — a future edit trimming the list to zero would silently open Confirm with nothing checked. Guarded with `RIGHTS_ACKS.length > 0 &&` so the consent gate can never vacuously pass.
  - `[low]` `[patch]` `globals.css` the new `.cta:disabled:hover { background: var(--accent) }` would turn a disabled `.cta.ghost` (transparent by design) solid accent on hover; scoped it to `.cta:not(.ghost):disabled:hover` and added `.cta.ghost:disabled:hover { background: transparent }`.

## Auto Run Result

Status: done

**Summary.** Delivered Epic 4's active-consent step (FR9). Between the fee-transparent order preview (4.2) and the future atomic settlement (4.4), a funded investor now reaches a `rights` view presenting three distinct risk acknowledgements — illiquidity / long-term, possible loss with no guaranteed return, and not-a-bank-deposit / invest-only-what-you-can-leave — each an actively-checkable box. The Confirm CTA is enabled **only** when all three are checked (`allAcknowledged`, mirrored on both `disabled` and `aria-disabled`); fewer than three keeps it disabled. Implemented as a local `view` toggle off the order preview (same idiom as 4.1's `funded → calculator` and 4.2's `calculator → order`; the reactive gate-state machine is untouched), with the three acknowledgements, the "all checked" gate, and all consumer copy in a new pure `rights.helpers.ts` — unit-tested without a DOM and asserted crypto-vocabulary-clean. No consent document, mutation, or persistence: consent is captured atomically with the purchase in Story 4.4. The rights view is entered fresh from the order Continue (`acks` reset to `{}`) so consent is deliberate per order; Confirm reveals the honest 4.4 coming-soon note.

**Files changed:**
- `app/app/invest/[id]/rights.helpers.ts` — NEW pure module: `RiskAck` interface, `RIGHTS_ACKS` (three distinct crypto-clean risk statements), `REQUIRED_ACK_COUNT`, `allAcknowledged` (empty-list-guarded consent gate), and `RIGHTS_COPY`.
- `app/app/invest/[id]/rights.helpers.test.ts` — NEW: 17 vitest cases (count is 3 with unique ids; the `allAcknowledged` matrix — empty/one/two/all/unknown-key/explicit-false; and the no-crypto invariant over every `RIGHTS_COPY` value and every `RIGHTS_ACKS` label).
- `app/app/invest/[id]/page.tsx` — added `"rights"` to `view`; replaced `reviewOpened` with `acks` (`Record<string,boolean>`) + `confirmOpened`; the order Continue opens the rights view fresh (resetting both); new rights render block (back-to-order control, eyebrow/title/context/intro, a grouped `RIGHTS_ACKS.map` of accessible checkbox rows, a Confirm CTA disabled until `allAcknowledged(acks)`, and the 4.4 coming-soon reveal); checkbox toggles reset `confirmOpened`.
- `app/app/invest/[id]/order.helpers.ts` — `ORDER_COPY.continueCta` repointed to `"Continue to acknowledge risks →"`; removed the now-unused `comingSoonNote` key (Continue advances to a real screen).
- `app/app/globals.css` — token-only `.ack-list`/`.ack-item` checkbox rows (≥44px target, accent checkbox, champagne focus) and a shared `.cta:disabled` rule (dimmed + `not-allowed`, hover neutralized without clobbering the ghost variant).

**Review findings breakdown:** 4 patches applied (all low: coming-soon note no longer lingers over a re-disabled gate; acknowledgements grouped for assistive tech; `allAcknowledged` guarded against an empty list; disabled-CTA hover scoped off the ghost variant). 0 deferred. 12 rejected (no render tests — repo convention; `disabled` pruned from tab order + redundant `aria-disabled` — established repo-wide idiom; view persisted across a reactive blip — deemed desired in 4.2; null-`p` fall-through — guarded by `state==="funded"`; directional glyphs in copy — universal existing idiom; "shares" vocabulary — the epic itself frames ownership as "a share"; missing disabled-reason hint / repeated "I understand" / 45px-floor — enhancements that already meet the bar; `comingSoonNote` removal — verified no remaining consumers). 0 intent gaps, 0 bad-spec repairs.

**Follow-up review recommendation:** `false`. The final pass made four localized, low-consequence fixes (a one-line reveal-reset, an ARIA grouping attribute, a one-line helper guard, and a CSS selector scope) with no change to the data model, API surface, security, or the settlement path. All gates green after the patches.

**Verification:** `npm run build` ✓ (compiles; `/invest/[id]` still dynamic), `npm test` ✓ (260 passed, 11 files — +17 `rights.helpers.test.ts`), `npm run check:tokens` ✓ (clean). Gate reasoned through: 0/1/2 boxes → Confirm disabled; all three → enabled; unchecking any → disabled again; entering the view resets all boxes.

**Residual risks:** Consent is captured only in client `view` state with no persistence yet — by design, since the acknowledgement is bound into the atomic purchase in Story 4.4 (the settlement mutation must record the acknowledged consent alongside the order). Until 4.4 lands, Confirm reveals a coming-soon note rather than moving money. The rights surface was not exercised in a live browser (no DOM harness by repo convention); the consent gate, the empty-list guard, and the copy invariant are covered by the pure-helper suite, and build/typecheck/token gates pass. The exact acknowledgement wording is generic Reg A+ risk copy single-sourced in `RIGHTS_ACKS` — a compliance-blessed rewording is a one-file swap with no JSX churn.
