---
title: 'Story 3.3 — Add money (fiat → USDC)'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: '957e3af7e59306e6ecd064ccef7829709771fd7b'
final_revision: '89e14e35dde31a50caade5750fcd089ddd158118'
---

<intent-contract>

## Intent

**Problem:** The invest flow ends at an eligible-but-terminal screen (Story 3.2) whose "Continue to your investment" CTA is permanently disabled — an eligible, wallet-ready investor has no way to put money in. Before anyone can invest (Epic 4), they must be able to add fiat from a card or bank and have it become a spendable balance, shown entirely in dollars with no crypto vocabulary (FR6, NFR3).

**Approach:** Extend the `/invest/[id]` gate-state machine past `eligible` into two new states — `funding` (add money) and `funded` (balance + the E4 handoff). Add a Convex `funding` module backed by an append-only `fundings` ledger: `addMoney` records a settled deposit through a stubbed on-ramp, `getFundedBalance` derives the account balance from settled deposits, and every deposit is audited. The real Privy + Bridge on-ramp and the escrow/custody vendor (blocker B1, unresolved) are stubbed behind the mutation boundary and deferred; the consumer surface stays fiat-native (dollars only), mirroring the 3.1/3.2 "record in Convex, defer live infra" precedent.

## Boundaries & Constraints

**Always:**
- No crypto vocabulary (the existing `CRYPTO_VOCABULARY` list — includes `token`, `coin`, `crypto`, `custody`, `ledger`) and no internal names (`usdc`, `funding`, `escrow`, `bridge`, `onramp`) in any consumer-visible copy (I6 / NFR3). Every amount is shown in dollars via `formatUsd` (whole-dollar, tabular figures).
- Inherit design-system tokens/classes only; reuse `.wrap`/`.card`/`.cta`/`.inv-form`/`.inv-field`/`.inv-label`/`.inv-input`/`.inv-headroom`/`.row`/`.muted`. `npm run check:tokens` must stay green (`/* token-guard-allow */` only if unavoidable).
- The calling user is resolved server-side from the JWT (`getUserIdentity()` → `by_privyId`); never trust a client-supplied user id. Every successful deposit writes a `funding.added` AuditLog entry (`actor`, `action`, `target`, `meta:{amountUsd, method}`) via `writeAudit`.
- Funding is gated behind eligibility (only reachable when `eligible === true`). Balance is **derived** from the append-only `fundings` ledger (sum of `status:"settled"` deposits), is **account-level** (per-user, not per-property), and never lives in a denormalized field. Amounts are validated whole-dollar within `[MIN_FUNDING, MAX_FUNDING]`.

**Block If:**
- A live Privy + Bridge on-ramp, real card/ACH processing, or a real escrow/custody integration is discovered already wired such that adding the stub interface would regress it — HALT rather than overwrite working infra.
- Extending the schema would require a destructive migration of existing rows — HALT rather than risk data loss. (The new `fundings` table is purely additive and must not trigger this.)

**Never:**
- Do not stand up a live Privy + Bridge on-ramp, real card/ACH movement, or a live escrow/custody path this run cannot configure (B1 unresolved) — build against the documented mutation boundary and log the live wiring as deferred work. No real money moves.
- Do not build the invest flow proper — calculator (4.1), order/fee (4.2), acknowledgement (4.3), DvP settlement (4.4), confirmation (4.5). The `funded` state ends at the same disabled "Continue to your investment" handoff 3.1/3.2 established.
- Do not debit balance or wire settlement (Epic 4 feeds that); `fundings` is deposit-only here. Do not add a denormalized balance field — derive from the ledger.
- Do not introduce a DOM/browser test harness — follow the repo's pure-helper + vitest (edge-runtime) + convex-test pattern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Eligible, balance not yet resolved | `eligible===true`, `getFundedBalance` returns `undefined` | Transient `loading` (hold) — do not flash `funding` | Wait for reactive resolve |
| Eligible, zero balance | `eligible===true`, balance `0` | `funding` state: calm "Add money" form (whole-dollar amount input + card/bank method select) + hint | — |
| Add money submitted (valid) | `addMoney({ amountUsd (whole $ ≥ MIN), method })` | insert `fundings{status:"settled"}`; USDC computed 1:1 behind the scenes; audit `funding.added`; reactive balance increases → `funded` | Mutation throws if unauthenticated / user row missing |
| Add money, invalid amount | `amountUsd` below `MIN_FUNDING`, non-integer, ≤ 0, non-finite, or above `MAX_FUNDING` | Blocked at the form (validation + `required`); mutation also rejects — no `fundings` row written | Mutation throws `Invalid amount`; no audit (rolled back) |
| Eligible, positive balance | `eligible===true`, balance `> 0` | `funded` state: "Available to invest" balance in dollars (tabular) + "Add more money" affordance + disabled E4 continue handoff | — |
| Add more money (repeat) | `addMoney` again from `funded` | appends a new settled `fundings` row; balance is the running sum; each deposit separately audited | Additive by design (not idempotent); double-submit guarded by the form's disabled state |
| Restricted user reaches flow | `eligible===false` | `restricted` state unchanged — no funding entry offered | Funding gated behind eligibility |
| New user balance query | authenticated, no `fundings` rows | `getFundedBalance` returns `0` (never null) | No throw |

</intent-contract>

## Code Map

- `app/convex/schema.ts` -- add a new **`fundings`** table `{ userId: v.id("users"), amountUsd: v.number(), method: v.union(v.literal("card"), v.literal("ach")), status: v.union(v.literal("pending"), v.literal("settled"), v.literal("failed")), providerRef: v.optional(v.string()), createdAt: v.number() }` with index `by_user ["userId"]`. Additive only — no destructive migration.
- `app/convex/funding.ts` -- **NEW** module: `getFundedBalance` query (caller from JWT → sum settled deposits → dollars, `0` if none), `addMoney({ amountUsd, method })` mutation (JWT-resolved caller, validate, insert settled deposit, audit), and exported pure helpers `isValidFundingAmount`, `usdToUsdc`, `availableBalance`, plus `MIN_FUNDING`/`MAX_FUNDING`. Mirror the auth + audit structure of `eligibility.ts` / `users.ts:setWalletAddress`.
- `app/convex/funding.test.ts` -- **NEW** vitest coverage for the pure helpers (amount validation, 1:1 conversion, balance summation).
- `app/convex/funding.mutations.test.ts` -- **NEW** convex-test coverage (records settled row, audits `funding.added`, balance accumulates across deposits, invalid amount rejected, unauthenticated rejected, `getFundedBalance` = 0 for new user).
- `app/convex/audit.ts` -- reuse `writeAudit` as-is; new action `funding.added`.
- `app/app/invest/[id]/invest.helpers.ts` -- extend `InvestGateState`: replace terminal `eligible` with `funding | funded`; add `balanceLoaded: boolean` and `fundedBalance?: number | null` inputs to `investGateState`; add funding/funded copy to `INVEST_COPY` (flat strings). Reuse existing `formatUsd`.
- `app/app/invest/[id]/invest.helpers.test.ts` -- extend the state matrix (loading-hold, funding at $0, funded at >$0, restricted unchanged); the `Object.entries(INVEST_COPY)` no-crypto-vocab loop auto-covers new copy.
- `app/app/invest/[id]/page.tsx` -- wire `useQuery(api.funding.getFundedBalance)` + `useMutation(api.funding.addMoney)`; render `funding` (Add Money form → `addMoney`) and `funded` (balance + "Add more" + disabled E4 handoff). No crypto vocabulary; reuse token classes; `required`/client validation blocks invalid amounts.
- `app/app/globals.css` -- token source; add minimal `.inv-*` styling only if existing classes are insufficient (token-guarded). The KYC form + headroom row already provide the needed idioms.

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/schema.ts` -- add the additive `fundings` table + `by_user` index. -- persist an append-only deposit ledger without reshaping existing rows.
- [x] `app/convex/funding.ts` -- `getFundedBalance()` returns `availableBalance(callerFundings)` in dollars (`0` if none). `addMoney({ amountUsd, method })`: resolve caller from JWT (throw if unauthenticated / user missing); `if (!isValidFundingAmount(amountUsd)) throw`; compute `usdToUsdc(amountUsd)` (conversion seam); insert `fundings{ status:"settled", createdAt }`; `writeAudit({action:"funding.added", target:userId, meta:{amountUsd, method}})`; return `{ fundingId, balance }`. Export pure `isValidFundingAmount` (finite, `Number.isInteger`, `MIN_FUNDING ≤ amount ≤ MAX_FUNDING`), `usdToUsdc` (1:1), `availableBalance` (sum of settled), `MIN_FUNDING=50`, `MAX_FUNDING=1_000_000`. -- authoritative, audited, append-only funding record behind a stubbed on-ramp.
- [x] `app/convex/funding.test.ts` -- unit-test `isValidFundingAmount` (accepts 50/100/MAX; rejects 0, 49, negative, 50.5, NaN, Infinity, >MAX), `usdToUsdc` (1:1, 0, large), `availableBalance` (sums settled; ignores pending/failed; empty→0). -- lock the amount rule, conversion seam, and balance formula.
- [x] `app/convex/funding.mutations.test.ts` -- convex-test: valid deposit writes one settled row + a `funding.added` audit + balance reflects it; two deposits accumulate (balance = sum, two audits); invalid amount rejects with no row/audit; unauthenticated rejects; `getFundedBalance` returns 0 for a fresh user. -- cover the real risk surface (ledger write, audit, auth, summation).
- [x] `app/app/invest/[id]/invest.helpers.ts` -- extend the state machine (`funding|funded` replacing terminal `eligible`) with `balanceLoaded`/`fundedBalance` inputs and precedence: eligible → (`!balanceLoaded` ⇒ `loading`) → (`balance>0` ⇒ `funded`, else `funding`); add funding/funded copy to `INVEST_COPY`. -- one pure, DOM-lessly-testable source of truth for screen selection.
- [x] `app/app/invest/[id]/invest.helpers.test.ts` -- add matrix rows for loading-hold, `funding` ($0), `funded` (>$0), and restricted-unchanged; update `base` to produce `funded`; the copy-invariant loop auto-covers the new copy. -- lock the state machine and the no-crypto-vocab invariant.
- [x] `app/app/invest/[id]/page.tsx` -- consume `getFundedBalance` + `addMoney`; render `funding` (whole-dollar amount input + card/bank method select, `required`, submit disabled while submitting and for invalid amounts) and `funded` (calm balance line + "Add more money" toggling the same form + disabled E4 continue handoff). No crypto vocabulary; reuse token classes. -- delivers the fiat-native add-money surface between eligibility and the E4 handoff.
- [x] `app/app/globals.css` -- add minimal token-driven styling only if existing `.inv-*` classes are insufficient. -- keep the screens on-brand without inventing alternates.

**Acceptance Criteria:**
- Given an eligible, wallet-ready investor who needs funds, when they add money via card or bank transfer, then the amount converts to USDC behind a fiat-like flow, a settled funding record is written with an `AuditLog` entry, their balance increases, and every amount on screen is shown in dollars with no crypto terminology.
- Given a funded investor returning to any property's invest flow, when the page loads, then their account-level balance is shown (the same balance across properties) and they can add more before reaching the disabled E4 handoff.
- Given a restricted/ineligible user, when they reach the flow, then no funding entry is offered — funding is only reachable once eligibility is `true`.
- Given an invalid amount (below the $50 minimum, non-whole-dollar, empty, or above the sanity cap), when they attempt to add money, then the deposit is blocked at the form and no `fundings` row or audit entry is written.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 4
- addressed_findings:
  - `[low]` `[patch]` `page.tsx` the carried-over Reg A+ row was labeled "Your yearly investment limit" but displayed `remainingRegAHeadroom(limit, invested)` (i.e. *remaining* headroom, not the cap) — correct only by coincidence today (`regAInvestedThisYear` is always 0), but once E4 settlement feeds `regAInvestedThisYear` the row would understate the actual cap. Now shows the floored actual limit (`remainingRegAHeadroom(limit, 0)`), matching the label.
  - `[low]` `[patch]` `page.tsx` `regaLimitRow` rendered for any numeric limit including `0`, so a degenerate `$0` Reg A+ cap would paint "Your yearly investment limit: $0" — a wall, contradicting the never-a-wall intent. Now the row is hidden unless the cap is `> 0`.
  - `[low]` `[patch]` `funding.ts` the `funding.added` audit meta omitted the created `fundingId`, so two same-amount deposits in the same second produced audit entries un-joinable to their specific `fundings` rows. Added `fundingId` to the meta for money-ledger traceability.
  - `[low]` `[patch]` `funding.mutations.test.ts` the `settledRows` helper collected *all* funding rows (any status) while its name and the `toHaveLength(1)` assertions implied settled-only, giving false confidence if a non-settled row is ever written. Renamed to `settledFundingRows` and filtered to `status === "settled"`.

## Design Notes

- **Escrow/custody vendor (B1) is unresolved → the on-ramp + custody boundary is stubbed.** `addMoney` records a `status:"settled"` deposit directly (a mock instant on-ramp) — this mutation *is* the on-ramp/settlement boundary. The real flow is deferred and logged in `deferred-work.md`: card/ACH via the Privy + Bridge hosted on-ramp → funds settle to the escrow/custody account (the B1 vendor) as USDC → the provider's webhook calls a **server-attested `internalMutation`** to record the settled funding (same shape as the 3.2 Persona boundary and the 3.1 defer-live-infra precedent). No real money moves this run.
- **Balance is derived from an append-only ledger.** `getFundedBalance` sums `status:"settled"` rows in `fundings` — a single source of truth that cannot drift, matching the `incomeLedger` / `reconciliations` discipline. E4 settlement will introduce debits / reduce available balance; that is out of scope (deposit-only here). No denormalized balance field.
- **USDC is a 1:1 dollar stablecoin.** `usdToUsdc` is the explicit, tested conversion seam (1:1 today); a real Bridge conversion with spread/fees plugs in there. Consumers only ever see dollars (`formatUsd`, whole-dollar, `tabular-nums`) — the word "USDC" never appears in copy.
- **Funding is account-level (per-user), unlike per-property eligibility** — hence `by_user` and no `propertyId` on `fundings`. Once funded, every eligible property renders `funded` with the same balance.
- **Whole-dollar amounts** (`Number.isInteger`, `$50 ≤ amount ≤ $1,000,000`) keep the displayed balance exact and prevent sub-dollar drift; `MIN_FUNDING=50` mirrors the platform minimum investment, and the max is a sanity guard against overflow/absurd input. Keep the rule a small, documented, testable constant (like `isEligibleJurisdiction`).
- **State machine:** the terminal `eligible` screen is repurposed into `funding` (balance 0 → Add Money) and `funded` (balance > 0 → balance + E4 handoff), keeping screen selection in the pure helper and holding on `loading` while the balance query is unresolved so `funding` never flashes for an already-funded user.
- **Residual to flag as deferred:** `addMoney` is a public, client-callable mutation trusting the client-supplied amount (mock on-ramp) — when the live on-ramp lands it must become server-attested before real money moves (highest-consequence residual, same shape as the 3.2 authorization-boundary deferral). Deposits are additive (not idempotent); double-submit is guarded only by the form's disabled state — a provider idempotency key is deferred with live wiring. Client-write rejection swallowing follows the accepted app-wide pattern (already tracked).

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (`/invest/[id]` still a dynamic route).
- `cd app && npm test` -- expected: vitest passes, including new `funding.test.ts`, `funding.mutations.test.ts`, and the extended `invest.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: clean (no hardcoded non-token colors).

**Manual checks (if no CLI):**
- Grep the new/extended `INVEST_COPY` constants for the forbidden crypto words and for internal names (`usdc`, `funding`, `custody`, `escrow`, `bridge`, `onramp`) — expect none in consumer-visible strings.

## Auto Run Result

Status: done

**Summary.** Added the fiat "Add money" surface to the `/invest/[id]` flow. The gate-state machine now runs past `eligible` into two new states — `funding` (eligible with a zero balance → a calm Add Money form: whole-dollar amount + card/bank method) and `funded` (positive balance → the account balance in dollars, an "Add more money" affordance, and the still-disabled Epic 4 handoff). A new Convex `funding` module backs it with an append-only `fundings` ledger: `addMoney` resolves the caller from the JWT, validates a whole-dollar amount in `[50, 1,000,000]`, records a `status:"settled"` deposit through a stubbed instant on-ramp (USDC computed 1:1 behind the scenes via the `usdToUsdc` seam), and audits `funding.added`; `getFundedBalance` derives the account-level balance from settled deposits (never a denormalized field). The escrow/custody vendor and the live Privy + Bridge on-ramp (blocker B1) are stubbed behind the mutation boundary and logged as deferred work. The consumer surface stays fiat-native — every amount is shown in dollars and no crypto vocabulary appears. The Reg A+ per-investor limit (shipped by Story 3.2 on the now-repurposed `eligible` screen) is carried onto both add-money screens so the yearly cap stays calmly visible.

**Files changed:**
- `app/convex/schema.ts` — added the additive `fundings` table (`by_user`); no destructive migration.
- `app/convex/funding.ts` — NEW module: `getFundedBalance` query, `addMoney` mutation (JWT-resolved caller, whole-dollar validation, append-only settled deposit, `funding.added` audit incl. `fundingId`), and exported pure helpers `isValidFundingAmount` / `usdToUsdc` / `availableBalance` + `MIN_FUNDING`/`MAX_FUNDING`.
- `app/convex/funding.test.ts` — NEW: 22 pure-helper tests (amount rule, 1:1 conversion, balance summation).
- `app/convex/funding.mutations.test.ts` — NEW: 7 convex-test cases (settled-row write + audit + balance, two-deposit accumulation, invalid/non-whole-dollar reject with no row/audit, unauthenticated reject, fresh-user balance 0).
- `app/app/invest/[id]/invest.helpers.ts` — extended `InvestGateState` (`funding|funded` replacing terminal `eligible`) + `balanceLoaded`/`fundedBalance` inputs; added funding/funded/Reg A+-limit copy to `INVEST_COPY`.
- `app/app/invest/[id]/invest.helpers.test.ts` — added state-matrix rows (loading-hold, funding at $0, non-finite balance, funded at >$0, restricted-unchanged); the copy-invariant loop auto-covers the new copy.
- `app/app/invest/[id]/page.tsx` — wired `getFundedBalance` + `addMoney`; renders the Add Money form (whole-dollar input + method select, `required`, submit-gated), the funded balance + "Add more" + disabled E4 handoff, and the calm Reg A+ limit row on both screens.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 3 entries (live on-ramp/custody wiring, authorization boundary → server-attested `internalMutation`, provider idempotency key).

**Review findings breakdown:** 4 patches applied (all low: (1) the carried-over Reg A+ row labeled "limit" displayed *remaining* headroom — now shows the floored actual cap, matching the label, avoiding a latent understatement once E4 feeds `regAInvestedThisYear`; (2) a `$0` Reg A+ cap would render "limit: $0" as a wall — now hidden unless `> 0`; (3) `funding.added` audit now carries `fundingId` for ledger traceability; (4) the `settledRows` test helper now truly filters settled rows and is renamed). 4 rejected (balance can exceed the yearly cap — by design, funding cash ≠ per-year investing cap, enforced at E4; discarded `usdToUsdc` result — intentional 1:1 seam, real conversion+persistence covered by the live-on-ramp deferral; client `MIN_ADD`/`MAX_ADD` duplication — server stays authoritative and a shared import would couple the Convex module to UI; funded-render finiteness nit — unreachable and `formatUsd` re-guards). 0 intent gaps, 0 bad-spec repairs.

**Follow-up review recommendation:** `false`. The final pass applied only four localized, low-consequence patches (a copy/label correction, a zero-guard, one audit-meta field, and a test-helper cleanup) with no behavior/API/security/data-model or intent-contract change; the funding money-path fixes (audit `fundingId`, whole-dollar validation, balance summation) are each asserted by the pure-helper and convex-test suites, and all gates are green. The story has converged.

**Verification:** `npm run build` ✓ (compiles; `/invest/[id]` present as a dynamic route), `npm test` ✓ (182 passed, 8 files — +22 `funding.test.ts`, +7 `funding.mutations.test.ts`, +2 extended `invest.helpers.test.ts`), `npm run check:tokens` ✓ (clean). Re-run green after the four review patches.

**Residual risks:** `addMoney` is a public, client-callable mutation that trusts the client-supplied amount and records a settled deposit against a mock instant on-ramp — no real money moves, but when the live Privy + Bridge on-ramp + escrow/custody vendor (B1) lands, this must become a server-attested `internalMutation` driven by the provider webhook, and it needs a provider idempotency key (deposits are additive and today double-submit is guarded only by the form's disabled state). The `usdToUsdc` conversion is 1:1 with no persisted USDC amount, so a future non-1:1 Bridge conversion needs a recorded `usdcAmount`. All three are logged in `deferred-work.md`. Live card/ACH funding was not exercised end-to-end (no DOM/browser harness by repo convention); the state machine, pure helpers, and mutation behavior (ledger write, audit, auth, summation) are covered by unit + convex-test suites, and build/typecheck pass.
