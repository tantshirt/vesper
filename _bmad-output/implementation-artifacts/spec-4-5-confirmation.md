---
title: 'Story 4.5 — Confirmation ("You''re an owner")'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: '2b641835c487547eb74bd63ca28e7aba986741bd'
final_revision: '36ee0967914ab8cde007a7da030cef7e5b8ff415'
---

<intent-contract>

## Intent

**Problem:** Story 4.4 lands settlement on a deliberately *minimal* factual acknowledgement — eyebrow "Done", title, and ownership % only. FR11 requires the moment intent becomes ownership to be a clear, celebratory-but-factual receipt: the new owner must see their **exact ownership %**, the **first-distribution date**, and a **receipt reference**, plus low-weight links to their portfolio and the on-chain proof. Right now the date has no data source, the receipt reference is dropped on the client floor, and there are no onward links.

**Approach:** Replace the 4.4 minimal settled early-return in `app/app/invest/[id]/page.tsx` with a celebratory "You're an owner" confirmation (champagne accent, tabular figures). Add an optional `firstDistributionDate` to the `properties` schema and seed/backfill The Monroe so the date rides along on the already-loaded property. Widen the client `settleResult` state to also keep the `orderId` the mutation already returns, and surface it as a **consumer-safe confirmation reference** (never the raw on-chain `dvpTxSig`). Put all copy + the two pure formatters in a new `confirmation.helpers.ts`, unit-tested including the no-crypto-vocabulary invariant. No backend read query and no settlement-logic change.

## Boundaries & Constraints

**Always:** The confirmation renders from data already in hand — `settleResult.ownershipPct` (formatted with the existing `formatOwnershipPct`), `settleResult.orderId` (as the confirmation reference), and `property.firstDistributionDate` (off the already-loaded `getWithGates` doc) — no new query. It stays a `settleResult`-keyed **terminal early-return above the gate-state switch** (a full-balance purchase zeroes the derived balance; keying off `state` would flip back to the funding form — the 4.4 rationale). Money/percent figures use tabular numerals and the existing formatters; one champagne accent only; WCAG 2.2 AA, 44px targets, no layout shift. All consumer copy is crypto-vocabulary-clean (asserted by the shared `hasCryptoVocabulary` guard) — the raw on-chain receipt (`dvpTxSig`) and crypto terms live **only** in the pull-only proof view. `firstDistributionDate` is optional: when absent or unparseable the date row degrades to an honest fallback, never "Invalid Date".

**Block If:** A legally-mandated confirmation/receipt wording or a specific real first-distribution-date policy is handed down that contradicts the generic seed value here (compliance/offering decision, not an unattended build choice).

**Never:** Do **not** build the dedicated `/portfolio` route (Epic 5 / Story 5.2) — the portfolio affordance links to the live `/explore` surface for now (recorded as deferred work). Do **not** render the raw `dvpTxSig` or any crypto vocabulary on the consumer screen. Do **not** add a new Convex read query, change settlement logic, or hold `dvpTxSig` in client state. Do **not** make `firstDistributionDate` required (would break existing seeded/reconciled property docs).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | `settleResult.status === "settled"`, `ownershipPct`, `orderId` present; `property.firstDistributionDate` set | "You're an owner" confirmation: exact ownership %, formatted first-distribution date, consumer-safe confirmation reference, portfolio link (`/explore`), on-chain proof link (`/property/[id]/proof`) | No error |
| Distribution date missing/unparseable | `firstDistributionDate` undefined or not `YYYY-MM-DD` | `formatDistributionDate` returns null → date row shows honest fallback copy (e.g. "Announced soon"), rest of confirmation unchanged | No throw |
| Confirmation reference | `formatConfirmationRef(orderId)` | Deterministic consumer-safe ref (e.g. `VSP-XXXXXXXX`), no crypto vocabulary | Empty/short id → safe fallback, no throw |
| Copy invariant | every `CONFIRMATION_COPY` value | `hasCryptoVocabulary(value) === false` | Test-enforced |

</intent-contract>

## Code Map

- `app/convex/schema.ts` -- **MODIFY** `properties` table: add `firstDistributionDate: v.optional(v.string())` (`YYYY-MM-DD`; optional so existing docs stay valid — no migration).
- `app/convex/properties.ts` -- **MODIFY** `seedTheMonroe`: set `firstDistributionDate` on the insert **and** backfill it on the already-seeded path (mirror the existing `mint` backfill so a running deployment gets the field without a full reseed). `getWithGates` already spreads the whole doc, so the field reaches the client with no query change.
- `app/app/invest/[id]/confirmation.helpers.ts` -- **NEW**. `CONFIRMATION_COPY` (crypto-clean: eyebrow "You're an owner", title, `ownedLabel`, `distributionLabel`, `distributionFallback`, `referenceLabel`, `portfolioCta`, `proofLinkLabel`); `formatDistributionDate(iso?: string): string | null` (parse `YYYY-MM-DD` as UTC → "August 31, 2026"; return `null` on missing/invalid); `formatConfirmationRef(orderId: string): string` (deterministic consumer-safe ref, e.g. `"VSP-" + orderId.slice(-8).toUpperCase()`, safe on empty). Pure, no JSX/DOM.
- `app/app/invest/[id]/confirmation.helpers.test.ts` -- **NEW** vitest: `formatDistributionDate` (valid, missing, malformed, month/day formatting, no TZ drift), `formatConfirmationRef` (normal id, empty/short), and the no-crypto-vocabulary invariant over every `CONFIRMATION_COPY` value (reusing `hasCryptoVocabulary` from `./invest.helpers`).
- `app/app/invest/[id]/page.tsx` -- **MODIFY** widen `settleResult` state to `{ status: "settled"; ownershipPct: number; orderId: string } | { status: "failed" } | null` and capture `orderId` in `setSettleResult` on success. Replace the minimal settled early-return (~lines 329–343) with the celebratory confirmation using `CONFIRMATION_COPY` + the formatters + existing `formatOwnershipPct`; add a `Link` to `/explore` (portfolio, interim) and a low-weight `Link` to `/property/${p._id}/proof`. Keep the early-return placement above the gate-state switch.
- `app/app/invest/[id]/rights.helpers.ts` -- **MODIFY** retire the placeholder settled copy now owned by `CONFIRMATION_COPY` (`settledEyebrow`, `settledTitle`, `ownedLabel`); keep `submittingLabel` and `failedNote` (still used by the rights gate). `rights.helpers.test.ts` iterates `RIGHTS_COPY` keys, so removing keys just removes cases.

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/schema.ts` -- add optional `firstDistributionDate` to `properties` -- give the confirmation a real, backward-compatible data source.
- [x] `app/convex/properties.ts` -- seed + backfill `firstDistributionDate` on The Monroe -- so the seeded/running deployment surfaces the date without a reseed.
- [x] `app/app/invest/[id]/confirmation.helpers.ts` -- add `CONFIRMATION_COPY` + `formatDistributionDate` + `formatConfirmationRef` -- single-source the celebratory copy and formatting, keep the no-crypto invariant.
- [x] `app/app/invest/[id]/confirmation.helpers.test.ts` -- unit-test the two formatters (incl. missing/malformed date, no-TZ-drift) and the crypto-vocab invariant -- lock the edge cases without a DOM (repo convention).
- [x] `app/app/invest/[id]/page.tsx` -- widen `settleResult` to carry `orderId`; replace the minimal settled screen with the "You're an owner" confirmation + portfolio and proof links -- deliver FR11.
- [x] `app/app/invest/[id]/rights.helpers.ts` -- retire the placeholder settled copy keys now owned by `CONFIRMATION_COPY` -- avoid two sources for the same strings.

**Acceptance Criteria:**
- Given a just-settled investor (`settleResult.status === "settled"`), when the confirmation renders, then they see a celebratory "You're an owner" screen stating their **exact ownership %**, the property's **first-distribution date**, and a **confirmation reference**, plus a link to their portfolio and a low-weight link to the on-chain proof. *(FR11)*
- Given the property has no (or a malformed) `firstDistributionDate`, when the confirmation renders, then the date row shows an honest fallback and the screen never displays "Invalid Date" or throws.
- Given the confirmation is on screen, when its consumer copy and rendered values are inspected, then no crypto vocabulary and no raw on-chain receipt (`dvpTxSig`) appear — the DvP receipt is reachable only via the proof link.
- Given a full-balance purchase (derived balance now 0), when the confirmation renders, then it still shows (the `settleResult`-keyed early-return is not pre-empted by the reactive gate-state).

## Design Notes

- **Data already in hand.** `ownershipPct` and `orderId` both come back from `confirmPurchase` (4.4); today the client keeps only `ownershipPct`. Widening `settleResult` to also hold `orderId` is the whole client-side data change — no new query, no `dvpTxSig` on the client. The first-distribution date rides along on the property doc that `getWithGates` already spreads.
- **Receipt reference vs on-chain receipt.** FR11's "DvP receipt reference" is satisfied on the consumer screen by a stable, non-crypto confirmation reference derived from the order id — the same design 4.4's review settled on when it removed the raw `dvpTxSig` from the consumer screen ("the receipt stays recorded in the order + audit and surfaces only in the proof view"). The actual on-chain signature stays in `/property/[id]/proof`, reached via the low-weight pull link.
- **Portfolio is Epic 5.** The dedicated `/portfolio` (Story 5.2) is out of scope; the portfolio affordance points at `/explore` (the live app surface that already carries a Portfolio tab) so the link is honest today and updates when 5.2 lands. Recorded in `deferred-work.md`.
- **Honest empties.** `firstDistributionDate` is optional and seed-provided; `formatDistributionDate` returns `null` on missing/invalid so the UI degrades to a fallback line rather than rendering `Invalid Date` — consistent with the app's "honest empties" stance (2.4 proof view).

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (`/invest/[id]` still dynamic; schema compiles with the new optional field).
- `cd app && npm test` -- expected: vitest passes, including the new `confirmation.helpers.test.ts` (formatters + crypto-vocab invariant) and the unchanged `rights.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: clean (confirmation screen uses only `var(--…)` tokens — champagne accent, `.calc-figure` tabular figures).
- `cd app && npx convex run properties:seedTheMonroe` -- expected: backfills `firstDistributionDate` on the already-seeded Monroe (or sets it on a fresh seed).

**Manual checks:**
- Drive a settled purchase → confirmation shows ownership %, a formatted first-distribution date, a `VSP-…` reference, a portfolio link (`/explore`), and a proof link (`/property/[id]/proof`); a full-balance purchase still lands here.
- Grep the new `CONFIRMATION_COPY` for crypto words (`wallet`/`token`/`mint`/`gas`/`tx`/`dvp`) — expect none; confirm no `dvpTxSig` is held in client state or rendered.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (medium 1, low 1)
- defer: 1 (medium 1)
- reject: 11
- addressed_findings:
  - `[medium]` `[patch]` Settled early-return depended on `&& p`, so a full-balance purchase (derived balance → 0) could, if the reactive `property` query lacked a value for a frame, fall through to the gate-state switch and be swallowed by the Add Money form ("money vanished"). Rekeyed the branch off `settleResult` alone with an inner `!p` terminal "finalizing" holding view (`CONFIRMATION_COPY.finalizingNote`) so a settled buyer can never leak into the funding gate.
  - `[low]` `[patch]` The `MONROE_FIRST_DISTRIBUTION_DATE` comment claimed a legally-blessed date "supersedes this via a plain edit here," but the idempotent backfill is fill-only and never overwrites an already-seeded date — an ops footgun. Corrected the comment to state that editing the constant sets the date only on a fresh seed / a Monroe missing it, and that correcting an already-seeded date needs a manual patch.
  - Rejected (spec-intended or out of scope): portfolio CTA → `/explore` (documented interim, Story 5.2 deferred); proof link reaching the disclosed-demo stub receipt (pre-existing Epic 2.4 demo posture); "First income date" showing the placeholder seed value (covered by the intent-contract Block-If — a compliance decision, none handed down); `formatConfirmationRef` truncation/collision (the exact `VSP-` + last-8 formula is spec-mandated); `VSP-PENDING` fallback (safe, unreachable on the settled path); accepting past dates (no spec/compliance bound handed down); page-level component tests (repo convention is helper-only unit tests, the spec's defined scope); backfill return-string wording (informational mutation return, nothing asserts it); reuse of `.calc-row`/`.calc-figure` (spec-mandated tabular figures); `p.name`/`p.location` outside the crypto-vocabulary invariant (pre-existing, trusted seed data); hardcoded `en-US` locale (app-wide convention, latent i18n).
  - Deferred: gated invest-page screens (incl. this confirmation) lack `aria-live`/focus management on transition (WCAG 2.2 SC 4.1.3, AA) — a pre-existing app-wide pattern, best fixed as a shared announcement/focus treatment rather than a spot fix. Logged to `deferred-work.md`.

## Auto Run Result

Status: done

**Summary.** Delivered FR11: replaced Story 4.4's minimal settled acknowledgement with the celebratory "You're an owner" confirmation on `/invest/[id]`. It shows exact ownership %, the property's first-distribution date, and a consumer-safe confirmation reference, plus a portfolio link (`/explore`, interim until Story 5.2) and a low-weight on-chain proof link. All copy and formatting are single-sourced in a new pure `confirmation.helpers.ts` and unit-tested, including the no-crypto-vocabulary invariant. Added an optional `firstDistributionDate` to the `properties` schema (no migration) and seed/backfill it on The Monroe. No new Convex read query, no settlement-logic change, no `dvpTxSig` held on the client.

Note: this run found the spec pre-marked `in-review` with all tasks `[x]` but **no code on disk** (a prior run set the status without persisting the implementation). The run re-derived the implementation from the spec (step-03), then reviewed it (step-04).

**Files changed.**
- `app/convex/schema.ts` — added `firstDistributionDate: v.optional(v.string())` to `properties`.
- `app/convex/properties.ts` — added `MONROE_FIRST_DISTRIBUTION_DATE`; `seedTheMonroe` sets it on fresh insert and fill-only-backfills it (generalized the mint backfill into a `patch` object).
- `app/app/invest/[id]/confirmation.helpers.ts` — NEW. `CONFIRMATION_COPY` + pure `formatDistributionDate` (UTC-parsed, overflow-rejecting, `null` on missing/invalid) + `formatConfirmationRef` (`VSP-`+last-8, `VSP-PENDING` fallback) + `finalizingNote`.
- `app/app/invest/[id]/confirmation.helpers.test.ts` — NEW. 23 tests: both formatters (valid/missing/malformed/overflow/no-TZ-drift, ref normal/short/empty/whitespace) + the no-crypto-vocabulary invariant over every `CONFIRMATION_COPY` value and the derived reference.
- `app/app/invest/[id]/page.tsx` — widened `settleResult` to carry `orderId`; replaced the settled early-return with the confirmation; keyed it off `settleResult` alone (terminal, above the gate switch) with a `!p` holding view; added the portfolio + proof links.
- `app/app/invest/[id]/rights.helpers.ts` — retired `settledEyebrow`/`settledTitle`/`ownedLabel` (now owned by `CONFIRMATION_COPY`); kept `submittingLabel`/`failedNote`.

**Review findings breakdown.** 2 patches applied (1 medium: settled fall-through race; 1 low: misleading reseed comment). 1 deferred (a11y live-region/focus on gated screens). 11 rejected as spec-intended or out of scope. 0 intent gaps, 0 spec repairs.

**Verification performed.**
- `cd app && npm run build` — ✅ type-check + build succeed; `/invest/[id]` remains dynamic; schema compiles with the new optional field.
- `cd app && npm test` — ✅ 349 tests across 13 files pass, including the new `confirmation.helpers.test.ts` and the unchanged `rights.helpers.test.ts`.
- `cd app && npm run check:tokens` — ✅ clean, no hardcoded hex colors.
- `npx convex run properties:seedTheMonroe` — NOT run (requires a live deployment); left as a manual reviewer step. The backfill is fill-only and idempotent.

**Residual risks.**
- `firstDistributionDate` is a disclosed placeholder (`2026-08-31`); a real offering date is a compliance decision (intent-contract Block-If), and correcting an already-seeded value needs a manual patch, not a reseed.
- The `/explore` portfolio link and the demo-stub on-chain proof surface are intentional interim states (Story 5.2 / Epic 2.4 demo posture), not final.
- Gated-screen accessibility (announcement/focus) remains deferred.
