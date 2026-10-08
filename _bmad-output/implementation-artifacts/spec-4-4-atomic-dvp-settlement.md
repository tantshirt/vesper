---
title: 'Story 4.4 — Atomic DvP settlement'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: 'ca656e3e22a95e98a86039e2fe18e17b771e0c5d'
final_revision: '00e8d8d17c372a201701790d8ce412d15b2a4943'
---

<intent-contract>

## Intent

**Problem:** The rights-acknowledgement Confirm (Story 4.3) is a dead-end reveal — a funded, eligible investor who has given active consent still cannot buy. FR10/I2 require settlement to be **atomic Delivery-versus-Payment**: USDC payment and token delivery settle *together or not at all*, a failure charges nothing and writes an audit entry, and an **ineligible account is blocked from receiving tokens** (I5). No module writes the `orders` table yet; this story makes intent become ownership.

**Approach:** Introduce a Convex settlement mutation (`convex/settlement.ts`) as the atomicity boundary — one transaction that JWT-resolves the caller, gates on eligibility/Token-ACL + Reg A+ cap + spendable balance, routes the settle decision through a stubbed **DvP seam** (`dvpSettle`, the B1/on-chain stand-in), then writes the `orders` (`settled`) + `holdings` (intent) rows, increments the Reg A+ accumulator, and audits — mirroring the `funding.addMoney` shape. Wire the rights Confirm to it, replacing the coming-soon note with a submitting → minimal factual settled / calm-failure outcome (the celebratory confirmation screen is Story 4.5). All decision logic lives in pure, unit-tested helpers.

## Boundaries & Constraints

**Always:** Settlement is one atomic Convex mutation — either the full settled set (order=`settled`+`dvpTxSig`, holding, Reg A+ increment, `order.settled` audit) commits together, or nothing of it does. The caller is resolved from `ctx.auth.getUserIdentity().subject` via `by_privyId`; client-supplied identity is never trusted. Settlement proceeds **only** when the caller's `eligibility` row for the property has `eligible === true && tokenAclState === "thawed"`; any other eligibility state blocks token delivery. The `settled` status is authorized **solely** by the `dvpSettle` seam's confirmation (the stubbed on-chain DvP), never asserted independently — "Convex never self-settles." Every business failure (ineligible/ACL-frozen, over Reg A+ cap, insufficient balance, DvP failure) is a **committed** `failed` order + audit entry with **nothing charged** (no holding, no Reg A+ increment), returned to the client — never a throw (a throw would roll back the mandated audit). The server is authoritative for the charge (`amount + 0.9% platform fee`) and requires `total <= spendable balance` (settled deposits − prior settled-order totals). Consumer-facing copy stays crypto-vocabulary-clean (`hasCryptoVocabulary`); on-chain terms live only in the pull-only proof view.

**Block If:** A specific legally-mandated settlement/consent record shape or wording is handed down that contradicts the generic capture here (compliance decision, not an unattended build choice). The Reg A+ per-investor cap semantics change from "cumulative `regAInvestedThisYear + amount <= regAAnnualLimit`."

**Never:** Do **not** stand up the real Anchor DvP program, escrow/custody vendor (B1), Token-2022 mint, or on-chain freeze/thaw — `dvpSettle` is a synchronous stub returning a clearly-marked stub signature; the real program/reconcile-confirm swaps in behind the seam with no change to the settle-authorization structure. Do **not** build the full celebratory "You're an owner" confirmation screen (ownership %, first-distribution date, portfolio/proof links) — that is Story 4.5; 4.4 lands on a minimal factual settled acknowledgement only. No new balance/escrow table (balance stays derived). No crypto vocabulary in consumer copy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | eligible+thawed, within cap, sufficient balance, DvP confirms | order `settled` + `dvpTxSig`, holding written (intent), Reg A+ incremented, `order.settled` audit; returns `{status:"settled", orderId, dvpTxSig, ownershipPct, amount, platformFee, total}` | No error |
| Ineligible / ACL frozen | eligibility missing, or `eligible!==true`, or `tokenAclState!=="thawed"` | no holding (token receipt blocked); `failed` order + `order.failed` audit (reason `ineligible`); returns `{status:"failed", reason:"ineligible"}` | Committed failure, not a throw |
| Over Reg A+ cap | `(regAInvestedThisYear ?? 0) + amount > regAAnnualLimit` (or limit unset) | `failed` order + audit (reason `reg-a-cap`); nothing charged | Committed failure |
| Insufficient balance | `total > spendableBalance(fundings, settledOrders)` | `failed` order + audit (reason `insufficient-funds`); nothing charged | Committed failure |
| DvP execution fails | `dvpSettle` returns non-confirm | `failed` order + audit (reason `dvp-failed`); no holding, no charge | Committed failure |
| Malformed amount | `amountUsd` non-finite / `< property.minInvestment` / `> sanity cap` | reject before any write | Throw `Invalid amount` (UI-prevented; not a settlement attempt) |
| Not authenticated / not provisioned | no identity, or no `users` row | reject | Throw (`Not authenticated` / `User not provisioned`) |

</intent-contract>

## Code Map

- `app/convex/settlement.ts` -- **NEW**. Pure helpers (all ctx-free, unit-tested): `PLATFORM_FEE_RATE = 0.009`, `platformFeeCents(amount)` / `totalChargedCents(amount)` (round-to-cents, must match `order.helpers`), `settledOrdersTotal(orders)` (Σ `amount+platformFee` over `status:"settled"`), `spendableBalance(fundings, orders)` (`availableBalance(fundings) − settledOrdersTotal(orders)`), `ownershipBasis(amount, offeringSize)` (= `amount/offeringSize`, clamped — mirrors `calculator.ownershipFraction`, B2/DW-2), `REQUIRED_RISK_ACK_COUNT = 3`, `settlementDecision(...)` (pure: given eligibility/limit/invested/spendable/acks/dvpOk → `{ok:true}` | `{ok:false, reason}`), and the `dvpSettle(orderId)` **stub seam** returning `{confirmed:true, dvpTxSig:"STUB-DVP-<orderId>"}`. Mutation `confirmPurchase({propertyId, amountUsd, acknowledgedRiskIds})`: resolve caller → load property/eligibility/user → validate amount → insert order `pending` → run `settlementDecision` + `dvpSettle` → on ok patch order `settled`+`dvpTxSig`, upsert holding (accumulate on repeat buy), increment `regAInvestedThisYear`, `writeAudit("order.settled", meta:{amount,platformFee,dvpTxSig,acknowledgedRiskIds})`; on not-ok patch order `failed`, `writeAudit("order.failed", meta:{reason})`, return failed. Reuses `writeAudit` (`convex/audit.ts`) and `availableBalance` (`convex/funding.ts`).
- `app/convex/settlement.test.ts` -- **NEW** vitest over every pure helper and the full I/O matrix through `settlementDecision` (each failure reason; happy path; cap/balance boundaries; empty/short `acknowledgedRiskIds`), plus `platformFeeCents`/`totalChargedCents` parity with `order.helpers` values and `ownershipBasis` parity with `calculator.ownershipFraction`.
- `app/convex/funding.ts` -- **MODIFY** `getFundedBalance` to return spendable balance (query `orders` `by_user`, subtract `settledOrdersTotal`) so the displayed/gated balance stays honest after a purchase. `availableBalance`/`addMoney` unchanged.
- `app/app/invest/[id]/page.tsx` -- **MODIFY** the rights Confirm (page.tsx:661-672): add `useMutation(api.settlement.confirmPurchase)` + `submitting`/`settleResult`/`settleError` state; on click (when `acknowledged && !submitting`) call `{propertyId: p._id, amountUsd: projAmount, acknowledgedRiskIds: RIGHTS_ACKS.filter(a=>acks[a.id]).map(a=>a.id)}`; `disabled={!acknowledged || submitting}`; on `settled` show a minimal factual acknowledgement (ownership %, DvP receipt ref) via a new `"settled"` outcome; on `failed`/thrown show a calm "nothing was charged" note. Retire the `comingSoonNote` reveal.
- `app/app/invest/[id]/rights.helpers.ts` -- **MODIFY** retire `RIGHTS_COPY.comingSoonNote`; add crypto-clean copy for the settlement outcome (`submittingLabel`, `settledEyebrow`/`settledTitle`/`receiptLabel`, `failedNote`). Keep `hasCryptoVocabulary` invariant green.

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/settlement.ts` -- implement the pure helpers, `dvpSettle` stub seam, `settlementDecision`, and the `confirmPurchase` mutation per Code Map -- the atomic settlement boundary; DvP-authorized `settled`, committed `failed` on any business gate.
- [x] `app/convex/settlement.test.ts` -- unit-test every helper + the I/O matrix through `settlementDecision`, fee/ownership parity -- lock the atomicity gates and charge math without a Convex ctx (repo convention).
- [x] `app/convex/funding.ts` -- net settled-order totals out of `getFundedBalance` -- keep the shown/gated balance honest across purchases; server stays authoritative on spendable funds.
- [x] `app/app/invest/[id]/page.tsx` -- wire rights Confirm to `confirmPurchase` with submitting/settled/failed handling; retire the coming-soon reveal -- turn active consent into a real, non-dead-end purchase.
- [x] `app/app/invest/[id]/rights.helpers.ts` -- swap `comingSoonNote` for crypto-clean settlement-outcome copy -- single-source the new consumer strings, keep the no-crypto invariant.

**Acceptance Criteria:**
- Given an eligible (`thawed`), funded investor who has actively acknowledged all three risks, when they tap Confirm, then a single atomic mutation records a `settled` order with a DvP receipt reference and an intent holding, increments their Reg A+ total, writes an `order.settled` audit entry, and the screen shows a factual settled acknowledgement — never a partial state. *(FR10, I2)*
- Given the settlement's DvP seam does not confirm (or any gate fails), when Confirm is tapped, then the whole order fails with **nothing charged** (no holding, no balance change, no Reg A+ increment), a `failed` order + audit entry are durably written, and the investor sees a calm "nothing was charged" note — not a thrown error page. *(FR10, I2)*
- Given an account that is not eligible/`thawed` for the property, when settlement is attempted, then no token/holding is delivered and the attempt is recorded as `failed` with an audit entry — the Token-ACL block is enforced server-side, not just in the UI. *(FR10, I5)*
- Given an investor whose spendable balance is below the total (amount + 0.9% fee), when Confirm is tapped, then settlement fails with nothing charged; and no crypto/settlement vocabulary appears anywhere on the consumer screens.

## Design Notes

- **Atomicity via the Convex transaction + DvP seam.** A Convex mutation is already all-or-nothing, so payment (the settled order that reduces spendable balance) and token delivery (the holding) commit together or not at all. `dvpSettle` is the seam that *authorizes* the `settled` write — in the stub it confirms synchronously and returns `STUB-DVP-<orderId>`; when B1 lands it becomes the real Anchor DvP call (or the Helius reconcile path flips `pending → settled` from chain truth). The order is inserted `pending` first, so the async-confirm future needs no structural change. This is how "Convex never self-settles" is honored under a stub.
- **Failures are committed, not thrown (the audit-survival rule).** A thrown Convex mutation rolls back its own `writeAudit` (see DW ledger, spec-3-1), but the AC mandates a durable audit on failure. So every *business* failure patches the order to `failed`, writes `order.failed`, and returns `{status:"failed", reason}` — all committed, nothing charged. Only true client/auth/arg bugs (UI-prevented) throw.
- **"Nothing charged" needs no debit row.** Balance is derived; a settled order *is* the debit (`getFundedBalance` nets settled-order totals). A `failed` order carries no charge because balance subtracts only `settled` orders and no holding/increment is written.
- **Eligibility = the on-chain ACL mirror.** The real frozen-by-default Token-2022 ACL + Convex→chain thaw is deferred (B1 / DW spec-3-2); 4.4 enforces the Convex mirror (`eligible && tokenAclState==="thawed"`) so an ineligible account gets no holding. The real on-chain freeze independently rejects delivery when wired.
- **Intent holding, chain-corrected.** The holding is Convex *intent*: `costBasis = amount`, `ownershipPct = amount/offeringSize` (B2/DW-2 basis), `tokenAmount = amount` as a documented 1:1 stub placeholder — the chain-authoritative reconcile path (I3, chain wins) corrects `tokenAmount`/`ownershipPct` when the real mint/DvP land. Repeat purchases upsert (accumulate cost basis) by `by_user`/`by_property`, mirroring reconcile.
- **Charge authority + fee.** The server computes `platformFee`/`total` (`PLATFORM_FEE_RATE = 0.009`, cents-rounded to match `order.helpers`), closing most of DW spec-4-2's preview/charge drift risk (full single-sourcing of the rate stays deferred). Consent (`acknowledgedRiskIds`) is captured durably in the `order.settled` audit meta — the atomic capture Story 4.3 deferred here.

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (`/invest/[id]` still dynamic; new `convex/settlement.ts` compiles).
- `cd app && npm test` -- expected: vitest passes, including the new `settlement.test.ts` (helpers + `settlementDecision` matrix + fee/ownership parity).
- `cd app && npm run check:tokens` -- expected: clean (no hardcoded non-token colors in the new settlement outcome UI).

**Manual checks:**
- Reason the gate: eligible+thawed+funded+all-acks+DvP-ok → `settled` (order+holding+increment+audit all present); flip each of eligibility/cap/balance/DvP → `failed` with the matching reason, nothing charged, audit present.
- Grep the new `RIGHTS_COPY` settlement strings for crypto words (`wallet`/`token`/`mint`/`gas`/`tx`) — expect none.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 3, low 3)
- defer: 2: (high 0, medium 2, low 0)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[high]` `[patch]` Settled acknowledgement was gated on `state === "funded"`, but `getFundedBalance` now nets settled orders — a full-balance purchase dropped the derived balance to 0, flipping `state → "funding"` and rendering the Add Money form instead of the confirmation (violating AC1). Hoisted the settled outcome into a terminal early-return keyed on `settleResult`, above the reactive gate-state switch, so it shows regardless of post-purchase balance.
  - `[medium]` `[patch]` `dvpSettle` was invoked unconditionally before the business gates — dormant under the pure stub, but the real Anchor program would settle for ineligible/over-cap/underfunded callers, breaking the seam's "swaps in with no change to the settle-authorization structure" guarantee. Extracted `businessGateDecision` (gates 1–3); the mutation now gates FIRST and calls the seam only on pass (`gate.ok ? dvpSettle(orderId) : null`). `settlementDecision` composes the two and is unchanged for the test matrix.
  - `[medium]` `[patch]` Consent gate counted raw array length, so `["x","x","x"]` (or replayed/crafted ids) satisfied the three-ack requirement and was audited as consent. Added `distinctAckCount` (Set size) and wired it into the gate so duplicates can't inflate the count.
  - `[medium]` `[patch]` The raw on-chain `dvpTxSig` was rendered on the consumer settled screen under "Confirmation reference", contradicting the intent contract ("on-chain terms live only in the pull-only proof view") and the module's own comment; `hasCryptoVocabulary` does not guard runtime values. Removed the receipt row (and the client-side `dvpTxSig` state) — the receipt stays recorded in the order + audit and surfaces only in the proof view. Retired the now-unused `RIGHTS_COPY.receiptLabel`.
  - `[low]` `[patch]` `order.amount` persisted the raw `amountUsd` while `total` was cents-rounded, drifting the derived balance debit from the returned/charged total by a sub-cent on fractional amounts. The mutation now rounds once (`amount = roundCents(amountUsd)`) and uses it consistently for the order, holding, Reg A+ increment, audit, and return.
  - `[low]` `[patch]` The failure note promised "you can try again in a moment" — false for the over-cap/eligibility blocks reachable on this screen. Reworded `failedNote` to reason-neutral calm copy that doesn't imply an imminent retry will succeed.
  - `[low]` `[patch]` The test file comment overclaimed that "the mutation/auth/audit surface is exercised through these gates" (only pure helpers are). Corrected the comment to scope it to the pure decision layer, and added `businessGateDecision` + `distinctAckCount` test coverage (329 tests total, all green).

### 2026-07-08 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 3: (high 1, medium 2, low 0)
- reject: 10: (high 0, medium 2, low 8)
- addressed_findings:
  - none
- notes: Independent follow-up review (both hunters, no prior context) over the restructured settlement authorization + settled-render path recommended by the prior pass. Core atomicity re-confirmed by both reviewers: the order-settle + holding-upsert + Reg A+ increment + audit commit-or-rollback together, and every business failure is a committed `failed` order + audit (never a throw). No new intent_gap/bad_spec/patch. Three genuinely-new gaps deferred to the ledger (offering-`status` gate; aggregate per-offering supply cap / oversell; `offeringSize <= 0` charging for 0% ownership). Rejected findings were subsumed by the two existing spec-4-4 ledger entries (idempotency/double-charge; canonical-ack membership), by-design stub behavior, pre-existing derived-balance/input-bounding patterns, or items the prior pass already rejected (`order.failed` audit meta; settled-screen navigation → Story 4.5).

## Auto Run Result

Status: done

**Note on run recovery:** the spec was re-invoked at `status: in-review` with all tasks marked `[x]`, but the working tree contained **no implementation** (the diff since baseline was empty). Rather than review an empty diff and falsely mark it done, the run reset the tasks and routed through implementation, then review.

### Summary
Story 4.4 lands the atomic Delivery-versus-Payment settlement boundary (FR10 / spine I2). A single Convex mutation (`settlement.confirmPurchase`) JWT-resolves the caller, gates on eligibility/Token-ACL + distinct consent + Reg A+ cap + spendable balance, routes the settle decision through the stubbed `dvpSettle` seam, then writes the `orders` (`settled`) + `holdings` (intent) rows, increments the Reg A+ accumulator, and audits — all committed together, or a committed `failed` order + audit with nothing charged. The rights Confirm is wired to it (submitting → settled / calm-failure), replacing the coming-soon reveal.

### Files changed
- `app/convex/settlement.ts` — NEW. Pure helpers (`platformFeeCents`/`totalChargedCents`, `settledOrdersTotal`, `spendableBalance`, `ownershipBasis`, `isValidPurchaseAmount`, `distinctAckCount`, `businessGateDecision`, `settlementDecision`, `dvpSettle` stub) + the atomic `confirmPurchase` mutation (gates BEFORE the seam; rounded-amount charge; committed failures, never thrown).
- `app/convex/settlement.test.ts` — NEW. 65 tests: helpers, charge/ownership parity with `order.helpers`/`calculator.helpers`, the full `settlementDecision` I/O matrix, `businessGateDecision` gates, and `distinctAckCount`.
- `app/convex/funding.ts` — MODIFIED. `getFundedBalance` nets settled-order totals (spendable balance); `availableBalance`/`addMoney` untouched.
- `app/app/invest/[id]/page.tsx` — MODIFIED. Rights Confirm wired to `confirmPurchase` with `settling`/`settleResult`/`settleError`; settled acknowledgement hoisted to a terminal early-return (renders regardless of post-purchase balance); no `dvpTxSig` on the consumer screen; coming-soon reveal retired.
- `app/app/invest/[id]/rights.helpers.ts` — MODIFIED. Retired `comingSoonNote` and `receiptLabel`; added crypto-clean settlement-outcome copy; reason-neutral `failedNote`.

### Review findings
- intent_gap 0 · bad_spec 0 · patch 7 (high 1, medium 3, low 3) · defer 2 (medium 2) · reject 3 (low 3). See `## Review Triage Log`.
- Patches applied: settled-screen balance-flip (high), DvP-seam-before-gates ordering (medium), consent distinct-count (medium), raw receipt on consumer screen (medium), raw-vs-rounded amount drift (low), overpromising failure copy (low), overclaiming test comment (low).
- Deferred (to `deferred-work.md`): mutation idempotency / double-charge (mirrors `addMoney`); full canonical-ack-id membership validation server-side.
- Rejected: funding↔settlement circular import (resolves cleanly, build+tests green), `order.failed` audit omitting acks, settled-screen navigation (Story 4.5).

### Verification
- `cd app && npm test` → **329 passed** (12 files), incl. `settlement.test.ts` (65).
- `cd app && npm run build` → **succeeds**; `/invest/[id]` still `ƒ (Dynamic)`.
- `cd app && npm run check:tokens` → **clean** (no hardcoded hex).
- Manual: confirmed `dvpSettle` is invoked only on `gate.ok`; `dvpTxSig` no longer rendered to the consumer; `hasCryptoVocabulary` green over all `RIGHTS_COPY`.

### Residual risks
- Follow-up review recommended (`followup_review_recommended: true`): the review pass restructured the settlement mutation's authorization ordering and a high-severity UI render path — an independent pass over those changes is warranted.
- Two deferred items above remain open (idempotency; canonical-ack membership) — real but not triggerable in normal use today.
- `dvpSettle` remains a synchronous stub; the real Anchor DvP program / on-chain freeze-thaw (blocker B1) swaps in behind the seam.

### Follow-up review pass — 2026-07-08

The prior run set `followup_review_recommended: true` because it had restructured the settlement authorization ordering (gate-before-seam) and a high-severity settled-render path. This pass ran that independent review (Blind Hunter + Edge Case Hunter, no prior context) over the committed diff since baseline.

- **Outcome:** no code changes. intent_gap 0 · bad_spec 0 · patch 0 · defer 3 · reject 10. See `## Review Triage Log` → "2026-07-08 — Review pass (follow-up)".
- **Atomicity re-confirmed:** both reviewers independently verified the order-settle + holding-upsert + Reg A+ increment + audit commit-or-rollback together, and that every business failure is a committed `failed` order + audit (never a throw). The gate-before-seam restructure and the settled-terminal early-return both hold.
- **Newly deferred (ledger, NEW entries):** (1) no `property.status` gate — a `funded`/`closed` offering can still be settled; (2) no aggregate per-offering supply cap — an offering can be oversold past 100% across investors; (3) `offeringSize <= 0` charges but records 0% ownership. All three are genuinely-new scope/data-integrity gaps, not spec deviations.
- **Rejected:** subsumed by the two existing spec-4-4 ledger entries (idempotency; canonical-ack membership), by-design stub behavior (`dvp-failed` unreachable), pre-existing derived-balance/input-bounding patterns (float math, client cap divergence), and items the prior pass already rejected (`order.failed` audit meta; settled-screen navigation → Story 4.5).
- **Verification:** this pass made no code changes, so the prior run's green verification (329 tests pass, build succeeds, `check:tokens` clean) still holds; the reviews were static analysis of the committed diff. `followup_review_recommended` set to `false` — the recommended independent pass has now run and surfaced nothing requiring an in-code fix.
