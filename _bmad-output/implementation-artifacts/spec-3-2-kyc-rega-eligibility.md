---
title: 'Story 3.2 — KYC + Reg A+ eligibility'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: 'de17b7b6b1644c34a15bb04e27954e82db54aeef'
final_revision: '3f9bbf6b326fecc48893b84367dca2aee57c974e'
---

<intent-contract>

## Intent

**Problem:** The invest flow ends at an account-ready handoff (Story 3.1) with no eligibility gate. Before anyone can confirm an investment, identity must be verified (KYC), a Reg A+ per-investor limit must be computed and shown calmly, and eligibility must be recorded in Convex and reflected in the on-chain Token ACL — with restricted jurisdictions routed to a waitlist, never a dead-end.

**Approach:** Extend the `/invest/[id]` gate-state machine with KYC → eligible/restricted states after the account is provisioned. Add a Convex `eligibility` module that records the (stubbed-Persona) KYC result, computes the Reg A+ limit, upserts the `eligibility` row, mirrors the frozen/thawed Token-ACL state, and audits every transition. The consumer surface stays fiat-native (no crypto vocabulary); the real Persona hosted-flow and live on-chain freeze/thaw are wired behind interfaces and deferred.

## Boundaries & Constraints

**Always:**
- No crypto vocabulary (per the existing `CRYPTO_VOCABULARY` list) in any consumer-visible copy on this route (I6 / NFR3). Internal field names (`kycStatus`, `eligible`, `tokenAclState`, `jurisdiction`) must never appear in copy either.
- Inherit design-system tokens/classes only; reuse `.wrap`/`.card`/`.cta`/`.eyebrow`/`.muted`/`.row`. `npm run check:tokens` must stay green (use `/* token-guard-allow */` only if unavoidable).
- Every KYC/eligibility state change is an auditable write: `writeAudit` on KYC pass/fail, eligibility record, ACL thaw/freeze, and waitlist join (I3 / FR16). Mutations resolve the caller server-side from the JWT (`getUserIdentity()` → `by_privyId`); never trust a client-supplied user id.
- Eligibility is frozen-by-default: `tokenAclState` starts/stays `"frozen"` and only flips to `"thawed"` when KYC is verified AND the jurisdiction is eligible (self-thaw on eligibility). Recording eligibility in Convex is the authoritative mirror; the on-chain propagation is a marked boundary.
- The Reg A+ limit is shown calmly as information (remaining headroom in dollars, tabular figures) — never framed as a wall. All mutations are idempotent (upsert by `by_user_property`; no duplicate rows or audit churn on unchanged state).

**Block If:**
- A real Persona SDK/webhook or a live on-chain Token-ACL freeze/thaw integration is discovered already wired such that adding the stub interface would regress it — HALT rather than overwrite working infra.
- Extending the schema would require a destructive migration of existing `eligibility`/`users`/`holdings` rows (e.g. a non-optional field on populated tables) — HALT rather than risk data loss.

**Never:**
- Do not build the invest flow proper — calculator (4.1), order/fee (4.2), acknowledgement (4.3), DvP settlement (4.4), confirmation (4.5). The `eligible` state ends at the same disabled "continue" handoff 3.1 established.
- Do not build fiat→USDC funding (3.3, B1-blocked). No funding UI here.
- Do not stand up a live Persona hosted flow, real KYC vendor credentials, or an on-chain signing/RPC path this run cannot configure — build against the documented interface and log the live wiring as deferred work (mirrors 3.1). Do not increment `regAInvestedThisYear` — that accumulator is fed by settlement (Epic 4).
- Do not introduce a DOM/browser test harness — follow the repo's pure-helper + vitest (edge-runtime) pattern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Account ready, not yet verified | authenticated, wallet mirrored, `kycStatus !== "verified"` | `kyc` state: calm identity-check step (jurisdiction + income/net-worth inputs) + begin CTA; failed prior attempt shows a calm retry note | Cancelled/failed submit → stay on `kyc`, retryable |
| KYC submitted, eligible jurisdiction | `recordEligibility(verified=true, eligible jurisdiction, income, netWorth)` | `kycStatus="verified"`; upsert `eligibility{eligible:true, tokenAclState:"thawed"}`; store computed `regAAnnualLimit`; audit `kyc.verified` + `eligibility.recorded` + `acl.thawed` | Mutation throws if unauthenticated / user row missing |
| KYC submitted, restricted jurisdiction | `recordEligibility(verified=true, restricted jurisdiction, ...)` | `kycStatus="verified"`; upsert `eligibility{eligible:false, tokenAclState:"frozen"}`; audit `eligibility.recorded` + `acl.frozen`; UI → `restricted` | No throw; frozen is the safe default |
| Identity check fails | `recordEligibility(verified=false, ...)` | `kycStatus="failed"`; no thaw; audit `kyc.failed`; UI stays on `kyc` with retry note | No throw |
| Verified + eligible | `kycStatus="verified"`, eligibility `eligible=true` | `eligible` state: shows remaining Reg A+ headroom (`limit − regAInvestedThisYear`) in dollars, then the E4 handoff (disabled continue CTA) | No error expected |
| Verified + restricted | `kycStatus="verified"`, eligibility `eligible=false` | `restricted` state: calm explainer + "Join the waitlist" CTA calling `joinWaitlist` | Never a dead-end |
| Join waitlist (repeat) | `joinWaitlist` when already on waitlist for this property | Idempotent no-op (one row per user+property); confirmation shown | No duplicate row / no repeat audit |
| Eligibility query loading | verified but `getEligibility` not yet resolved | Transient loading (reuse loading affordance); do not flash `restricted` | Wait for reactive resolve |

</intent-contract>

## Code Map

- `app/convex/schema.ts` -- `eligibility` (lines 70-76) + `users` (10-16, has `kycStatus`, `regAInvestedThisYear`) + `auditLog` (19-25). Add optional `personaInquiryId` to `eligibility`, optional `regAAnnualLimit` to `users`, and a new `waitlist` table (`by_user_property`).
- `app/convex/eligibility.ts` -- **NEW** module: `getEligibility` query, `recordEligibility` + `joinWaitlist` mutations, and exported pure helpers `computeRegALimit` / `isEligibleJurisdiction`. Mirror the auth + audit structure of `users.ts:setWalletAddress` (53-97).
- `app/convex/eligibility.test.ts` -- **NEW** vitest coverage for the pure helpers (limit formula, jurisdiction allow/deny, headroom).
- `app/convex/users.ts` -- reuse `getUserIdentity()`→`by_privyId` auth pattern; `currentUser` already exposes `kycStatus`/`regAAnnualLimit`/`regAInvestedThisYear`. `writeAudit` from `./audit`.
- `app/convex/audit.ts` -- `writeAudit(ctx, {actor, action, target, meta?})`, reuse as-is; new actions `kyc.verified|kyc.failed|eligibility.recorded|acl.thawed|acl.frozen|waitlist.joined`.
- `app/app/invest/[id]/invest.helpers.ts` -- extend `InvestGateState` with `kyc | restricted | eligible` (repurpose the terminal `ready`), extend `investGateState` inputs, add `remainingRegAHeadroom` + `formatUsd`, extend `INVEST_COPY` (all pass `hasCryptoVocabulary`).
- `app/app/invest/[id]/invest.helpers.test.ts` -- extend the state matrix + copy-invariant loop for the new states/copy.
- `app/app/invest/[id]/page.tsx` -- render `kyc` (calm form → `recordEligibility`), `restricted` (explainer → `joinWaitlist`), `eligible` (limit headroom + E4 handoff); wire `useQuery(api.eligibility.getEligibility)` and the two mutations.
- `app/app/globals.css` -- token source; add minimal `.inv-*`/reuse only if existing classes are insufficient (token-guarded).

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/schema.ts` -- add `eligibility.personaInquiryId: v.optional(v.string())`, `users.regAAnnualLimit: v.optional(v.number())`, and a `waitlist` table `{ userId: v.id("users"), propertyId: v.id("properties"), jurisdiction: v.string(), createdAt: v.number() }` with index `by_user_property ["userId","propertyId"]`. All additions optional/new so no destructive migration. -- persist the KYC interface ref, computed cap, and waitlist without reshaping existing rows.
- [x] `app/convex/eligibility.ts` -- `getEligibility({ propertyId })` query returns the caller's eligibility doc (or null). `recordEligibility({ propertyId, jurisdiction, annualIncome, netWorth, verified, personaInquiryId? })` mutation: resolve caller from JWT; if `!verified` set `kycStatus="failed"` + audit `kyc.failed` and return; else set `kycStatus="verified"`, compute `regAAnnualLimit = computeRegALimit({annualIncome, netWorth})` and patch it, upsert the `eligibility` row (`eligible = isEligibleJurisdiction(jurisdiction)`, `tokenAclState = eligible ? "thawed" : "frozen"`, `personaInquiryId`), and audit `kyc.verified` + `eligibility.recorded` + `acl.thawed|acl.frozen`. `joinWaitlist({ propertyId, jurisdiction })`: idempotent insert (by_user_property) + audit `waitlist.joined`. Export pure `computeRegALimit` and `isEligibleJurisdiction`. -- authoritative eligibility record + ACL mirror, idempotent + fully audited.
- [x] `app/convex/eligibility.test.ts` -- unit-test `computeRegALimit` (10% of greater of income/net worth; zero/edge inputs), `isEligibleJurisdiction` (eligible vs restricted values), and headroom math. -- lock the Reg A+ formula and jurisdiction rule.
- [x] `app/app/invest/[id]/invest.helpers.ts` -- extend the state machine with `kyc|restricted|eligible` and the inputs to derive them (`kycStatus`, `eligibilityLoaded`, `eligible`); add `remainingRegAHeadroom(limit, invested)` and a `formatUsd` display helper; add KYC/restricted/eligible copy to `INVEST_COPY`. -- one pure source of truth for screen selection + display, DOM-lessly testable.
- [x] `app/app/invest/[id]/invest.helpers.test.ts` -- add a matrix row per new state, assert `remainingRegAHeadroom` never goes negative, and extend the `Object.entries(INVEST_COPY)` loop so every new copy string passes `hasCryptoVocabulary === false`. -- lock the state machine and the no-crypto-vocab invariant.
- [x] `app/app/invest/[id]/page.tsx` -- consume `getEligibility` + `currentUser`; render `kyc` (calm jurisdiction/income/net-worth form submitting `recordEligibility`), `restricted` (explainer + `joinWaitlist` CTA + confirmation), `eligible` (calm remaining-headroom line + disabled E4 continue handoff). No crypto vocabulary; reuse token classes. -- delivers the gated eligibility surface between provisioning and the E4 handoff.
- [x] `app/app/globals.css` -- add minimal token-driven styling only if existing classes are insufficient. -- keep the screens on-brand without inventing alternates.

**Acceptance Criteria:**
- Given a signed-up, wallet-ready user proceeding toward confirming an investment, when KYC is required, then they complete an identity check and eligibility is recorded in Convex with an `AuditLog` entry, and no crypto terminology appears on the screen.
- Given a verified, eligible user, when eligibility is recorded, then their Reg A+ per-investor limit is computed and shown calmly (as remaining dollars, not a blocking wall) and the `eligibility` row's `tokenAclState` is `thawed` (frozen-by-default otherwise).
- Given a restricted jurisdiction, when eligibility fails, then the user sees a calm explainer and can join a waitlist — never a dead-end — and the Token-ACL mirror stays `frozen`.
- Given a user who re-opens the flow after verifying, when the page loads, then no duplicate eligibility/waitlist row is written and no repeat audit entry is produced for unchanged state.

## Design Notes

- **Persona is stubbed behind an interface.** No Persona credentials/webhook exist in this harness, so `recordEligibility` *is* the Persona-result boundary: the `kyc` screen collects jurisdiction + self-reported annual income/net worth and submits `verified: true` (a `verified: false` path exists to represent an identity-check failure). The live Persona hosted flow + webhook that would call this same mutation is deferred — log it in `deferred-work.md`. This mirrors 3.1's "record in Convex, defer live infra" precedent and the epic-context "stub the vendor boundary behind an interface" guidance.
- **Token ACL is a Convex mirror here.** No Convex→chain propagation exists (reconcile is inbound-only; no signing/RPC action). `tokenAclState` is recorded as the authoritative eligibility→ACL mirror; the live on-chain Token-2022 freeze/thaw is a marked boundary deferred to when settlement/RPC infra lands (Epic 4). Do not fabricate an on-chain call.
- **Reg A+ limit formula (Tier 2, non-accredited):** `computeRegALimit = 0.10 * Math.max(annualIncome, netWorth)`. Display remaining headroom `= max(0, regAAnnualLimit − regAInvestedThisYear)`; `regAInvestedThisYear` stays 0 here (settlement in E4 feeds it). Format dollars with `Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})`.
- **Jurisdiction rule (MVP):** `isEligibleJurisdiction` treats US ("US"/United States) as eligible and any other value as restricted → waitlist. State-by-state blue-sky handling is out of scope; keep the rule a small, documented, testable allowlist so the restricted path is exercised.
- **State precedence:** loading → not-found → signup → provisioning → (`kycStatus!=="verified"` ⇒ `kyc`) → (`eligible===false` ⇒ `restricted`) → (`eligible===true` ⇒ `eligible`). While verified-but-eligibility-unresolved, show the loading affordance — do not flash `restricted`.

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (`/invest/[id]` still a dynamic route).
- `cd app && npm test` -- expected: vitest passes, including new `eligibility.test.ts` and extended `invest.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: clean (no hardcoded non-token colors).

**Manual checks (if no CLI):**
- Grep the new/extended copy constants for the forbidden crypto words and for the raw field names — expect none in consumer-visible strings.

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 1, low 5)
- defer: 3 (high 1, medium 0, low 2)
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` `page.tsx` KYC form let a US applicant submit blank income/net-worth (`Number("") || 0`), silently producing a $0 Reg A+ cap and a "You're ready to invest / $0 available" dead-end the form never re-offered (once `kycStatus === "verified"`). Added `required` to both financial inputs so an accidental blank submit is blocked at the form.
  - `[low]` `[patch]` `invest.helpers.ts` `remainingRegAHeadroom` returned the raw `limit − invested`, and `formatUsd` (maximumFractionDigits:0) could round a fractional cap UP — displaying more headroom than the true 10% allows. Now floors to whole dollars (conservative for a regulatory cap); added a floor test.
  - `[low]` `[patch]` `eligibility.ts` wrote `kyc.verified` unconditionally on every submit while `eligibility.recorded`/`acl.*` were gated behind the idempotency guard — identical re-submits produced verification audit rows with no matching eligibility rows. Moved `kyc.verified` inside the actual status/cap-change branch and added `regAAnnualLimit` to its meta.
  - `[low]` `[patch]` `eligibility.ts` `eligibility.recorded` meta carried only `{propertyId, eligible}`, so the decisive inputs of a regulated Reg A+ decision were unauditable. Added the computed `regAAnnualLimit` + `jurisdiction` to the meta (raw income/net worth deliberately kept out of the log as PII).
  - `[low]` `[patch]` `eligibility.ts` re-recording eligibility overwrote a previously stored `personaInquiryId` with `undefined` (the client omits it), severing the eligibility↔KYC-inquiry link once Persona lands. Now preserves the existing ref when the call omits it (`args.personaInquiryId ?? existing.personaInquiryId`), with the idempotency guard updated to match.
  - `[low]` `[patch]` The story's real risk surface (eligibility→ACL mirror, idempotent upsert, audit writes) had zero mutation-level coverage — only the pure helpers were tested. Added `eligibility.mutations.test.ts` (convex-test): US→thawed+eligible, restricted→frozen, `verified:false`→failed/no-row, idempotent re-submit (one row, one `eligibility.recorded`/`acl.thawed`), unauthenticated rejection, and `joinWaitlist` idempotency.

## Auto Run Result

Status: done

**Summary.** Added the KYC + Reg A+ eligibility gate to the `/invest/[id]` flow. The gate-state machine now runs KYC → eligible/restricted after the account is provisioned: a calm identity-check step (jurisdiction + self-reported income/net worth) records the result through a new Convex `eligibility` module, which sets `kycStatus`, computes the Reg A+ per-investor cap (`10% × max(income, netWorth)`), upserts the per-property `eligibility` row, mirrors the frozen/thawed Token-ACL state (frozen-by-default; self-thaws only when verified AND US-eligible), and audits every transition. Restricted jurisdictions get a calm explainer + an idempotent waitlist join — never a dead-end. Persona (KYC vendor) and the live on-chain Token-2022 freeze/thaw are stubbed behind interfaces this run and logged as deferred work; the consumer surface stays free of crypto vocabulary and of internal field names.

**Files changed:**
- `app/convex/schema.ts` — added optional `users.regAAnnualLimit`, optional `eligibility.personaInquiryId`, and a new `waitlist` table (`by_user_property`); all additions optional/new (non-destructive).
- `app/convex/eligibility.ts` — new module: `getEligibility` query, `recordEligibility` + `joinWaitlist` mutations (JWT-resolved caller, idempotent upsert, frozen-by-default ACL mirror, full audit trail), and exported pure `computeRegALimit` / `isEligibleJurisdiction`.
- `app/convex/eligibility.test.ts` — 25 pure-helper tests (Reg A+ formula, jurisdiction allowlist, headroom).
- `app/convex/eligibility.mutations.test.ts` — new convex-test coverage (6 tests) for the mutations' mirror/idempotency/audit behavior.
- `app/app/invest/[id]/invest.helpers.ts` — extended `InvestGateState` (`kyc|restricted|eligible`, replacing terminal `ready`) + inputs; added `remainingRegAHeadroom` (floored) and `formatUsd`; extended `INVEST_COPY`.
- `app/app/invest/[id]/invest.helpers.test.ts` — added state-matrix rows, headroom/floor + `formatUsd` assertions; the existing `Object.entries(INVEST_COPY)` no-crypto-vocab loop auto-covers the new copy.
- `app/app/invest/[id]/page.tsx` — wired `getEligibility` + the two mutations; renders the KYC form (required financial inputs), the restricted+waitlist screen, and the eligible headroom + E4 handoff; `userLoaded` guard prevents flashing the KYC step for a returning verified user.
- `app/app/globals.css` — minimal token-driven `.inv-*` form/headroom styles (no hex).

**Review findings breakdown:** 6 patches applied (1 medium: blank-income $0-cap dead-end → `required` inputs; 5 low: floor the regulatory cap display, gate the `kyc.verified` audit to real transitions, enrich `eligibility.recorded` audit meta, preserve `personaInquiryId` on re-record, add mutation/idempotency test coverage). 3 deferred (client-callable `recordEligibility` must become server-attested when Persona lands — the highest-consequence residual; verified-user re-enters KYC financials on a 2nd property; waitlist "joined" state is client-only). 8 rejected (the "crypto vocab not enforced" claim was false — the `INVEST_COPY` loop covers it; global `regAAnnualLimit` is correct per-investor by design; property-existence check, `acl.*` naming, unreachable waitlist fallback, `kycStatus:"pending"` path, and locale-grouping input — none real given the closed form contract and `type="number"`; swallowed client-write errors already tracked in the deferred ledger). 0 intent gaps, 0 spec repairs.

**Follow-up review recommendation:** `false`. The final-pass patches are localized and now test-covered (audit-integrity and money-display fixes are each asserted by the new mutation/helper tests); no intent-contract or architectural change occurred, and all gates are green — the story has converged.

**Verification:** `npm run build` ✓ (compiles; `/invest/[id]` present as a dynamic route), `npm test` ✓ (137 passed, 6 files — +6 eligibility mutation tests, +1 headroom-floor test), `npm run check:tokens` ✓ (clean). Re-run green after the six review patches.

**Residual risks:** The KYC verification and the Reg A+ income/net-worth figures are client-asserted (Persona stubbed) and the Token-ACL thaw is a Convex mirror with no on-chain execution — all deferred and latent because no settlement/on-chain consumer reads the thawed state until Epic 4. When that path goes live, `recordEligibility` must be gated to a server-attested source (webhook-driven internalMutation) before money can move — this is the most consequential deferred item. Live signup/KYC/waitlist flows were not exercised end-to-end (no DOM/browser harness by repo convention); the state machine, pure helpers, and mutation behavior (mirror, idempotency, audits) are covered by unit + convex-test suites, and build/typecheck pass.
