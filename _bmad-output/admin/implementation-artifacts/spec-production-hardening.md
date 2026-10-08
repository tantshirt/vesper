---
title: 'Production hardening and UX completion'
type: 'refactor'
created: '2026-07-12'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'a90ec2d'
context:
  - '{project-root}/PRODUCT.md'
  - '{project-root}/_bmad-output/A-Product-Brief/project-brief.md'
  - '{project-root}/_bmad-output/admin/A-Product-Brief/project-brief.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Vesper's Quasar program, transaction confirmation, reconciliation, custody seams, and operator UX contain security and correctness gaps that prevent safe use with real funds. Runtime Solana coverage was also lost during the Anchor-to-Quasar migration, while the active purchase UI still settles through synthetic Convex state.

**Approach:** Harden the system in trust-boundary order: enforce program authority and eligibility, decode chain evidence exactly, introduce durable idempotent operation state, wire real signed settlement, restore runtime tests, and then bring consumer/admin workflows to WCAG 2.2 AA and a measured 40/40 heuristic target where code-controlled.

## Boundaries & Constraints

**Always:** Preserve the deployed program ID; treat Solana as ownership/payment truth and Convex as intent plus a verified mirror; fail closed on ambiguous confirmation, KYC, ACL, mint, payout, and evidence states; use integer/base-unit money arithmetic at chain boundaries; preserve named-human attribution and segregation of duties; add tests for every repaired exploit path.

**Ask First:** Any devnet redeployment or program upgrade; any mainnet action; any live vendor credential, wallet, custody, webhook, or irreversible data migration; any change to legal/economic policy rather than its enforcement.

**Never:** Sign or submit transactions during implementation; enable unsafe stubs in production; accept client-supplied identity or unverified chain event shape as authority; silently discard ambiguous transactions; claim 40/40 without authenticated responsive browser evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Offering creation | Approved authority, canonical mints, funded vault, valid terms | Unique offering stores validated immutable configuration | Unauthorized, malformed, zero, unsupported-extension, or underfunded input fails before initialization |
| Purchase | Eligible buyer, exact settle instruction, sufficient funds/inventory | One atomic payment/delivery and one verified mirror event | Revoked, failed, expired, spoofed, or ambiguous transaction creates no settled truth and is safely retryable |
| Chain event | Successful expected instruction/event with unique event identity and monotonic slot | Exactly the matching holding or payout row updates once | Duplicates no-op; stale/multi-event input is processed deterministically; mismatch is quarantined |
| External operation | Mint or holder payout requested concurrently/retried | One durable intent and one provider idempotency key execute once | Partial/unknown outcomes enter reconciliation, never automatic replay |
| Operator workflow | Mobile/desktop, keyboard/screen reader, high-stakes decision | Current stage, subject, consequence, blocker, and next safe action remain visible | Inline validation and recovery preserve context; no native prompt/alert |

</frozen-after-approval>

## Code Map

- `vesper_dvp/src/` -- Quasar accounts, authorization, ACL, lifecycle, and settlement invariants.
- `app/lib/solana/` and `app/scripts/` -- ABI builders, wallet confirmation, cluster safety, and client tests.
- `app/convex/onchainConfirm.ts`, `reconcile.ts`, `http.ts` -- verified event ingestion and monotonic idempotent projection.
- `app/convex/eligibility*.ts`, `users.ts`, `schema.ts` -- proof-bound wallet/eligibility state and durable attestation outbox.
- `app/convex/mint.ts`, `distribution*.ts`, `gates.ts` -- evidence validation and externally idempotent operation state machines.
- `app/app/` and `admin/app/` -- real purchase wiring, responsive workflows, accessibility, and clear recovery.

## Tasks & Acceptance

**Execution:**
- [x] **P1 Protocol story:** `vesper_dvp/src/**`, IDL/client builders, and runtime tests -- validate platform/mint authority, Token-2022 policy, nonzero terms/inventory, buyer Eligibility, and authority pause/close.
- [x] **P2 Chain-evidence story:** `onchainConfirm.ts`, `reconcile.ts`, `http.ts`, schema/tests -- require successful decoded instructions/events, event-level keys, monotonic slots, bounded payloads, and exact holder/payout matching.
- [x] **P3 Entitlement story:** `eligibility*.ts`, `users.ts`, schema/tests -- revoke on failed recheck, prove wallet control, and persist retryable on-chain attestation states.
- [x] **P4 Custody story:** `mint.ts`, `distribution*.ts`, schema/tests -- reserve intents before external effects, lease concurrent work, checkpoint each result, and reconcile unknown outcomes.
- [x] **P5 Purchase story:** investment UI, `usePurchase.ts`, settlement/order model/tests -- replace synthetic settlement with signed chain flow and pending-to-confirmed projection; isolate all demos from production.
- [x] **P6 Governance story:** `gates.ts`, offering lifecycle, Reg A tracking, security headers/scripts/tests -- bind evidence to property/gate, enforce regulatory year, add cluster guards, and fail closed on deployment misconfiguration.
- [x] **P7 UX story:** consumer/admin shells and workflows -- responsive navigation, staged journeys, inline decisions, precise trust/liquidity copy, consistent controls/states, AA contrast/touch/focus, and actionable operator overview.

### Review Findings

- [x] [Review][Patch] Prevent repeated authority-signed transactions for one purchase operation.
- [x] [Review][Patch] Keep property token custody frozen at rest and prevent revocation bypass through previously thawed accounts.
- [x] [Review][Patch] Revoke mint authority and require exact initial supply and vault inventory.
- [x] [Review][Patch] Reserve Reg A headroom across active same-year orders and preserve year-keyed totals.
- [x] [Review][Patch] Require finalized purchase evidence and prove blockhash expiry before safe retry.
- [x] [Review][Patch] Enforce latest-applied monotonic slots and quarantine missing, stale, conflicting, or malformed events.
- [x] [Review][Patch] Bind mint and payout reconciliation to exact reserved operations and signatures.
- [x] [Review][Patch] Serialize eligibility effects across submitted/unknown versions and prevent stale completion drift.
- [x] [Review][Patch] Lock funded distribution drafts and verify exact escrow and payout base units.
- [x] [Review][Patch] Correct SPL `COption<Pubkey>` wire encoding and reject unsafe numeric ABI inputs.
- [x] [Review][Patch] Verify the platform Ed25519 signature over the unchanged transaction message.
- [x] [Review][Patch] Remove silent real-purchase network fallbacks and map confirmation states truthfully.
- [x] [Review][Patch] Replace production KYC dead-end UI and static admin pseudo-queues with honest provider/queue states.
- [ ] [Review][Decision] Ratify governed platform authority, rotation/bootstrap policy, and canonical payment mint per cluster before deployment.
- [ ] [Review][Decision] Select and integrate production KYC/KYB/AML, funding/custody, mint signer, payout, and step-up providers.
- [ ] [Review][Decision] Complete authenticated responsive, keyboard, screen-reader, zoom, reduced-motion, axe, and observed-user evidence before claiming UX 40/40.
- [ ] [Review][Decision] Finalize production CSP origins and deployment configuration, then perform an approved program upgrade/deployment rehearsal.

**Acceptance Criteria:**
- Given every audit exploit and edge case, when its regression test runs, then the unsafe state is rejected or quarantined without money, ownership, compliance, or audit drift.
- Given production configuration with stubs disabled, when a purchase/mint/distribution is attempted, then only verified provider or chain evidence can advance truth.
- Given supported mobile and desktop viewports plus keyboard/reduced-motion modes, when primary consumer and admin journeys are exercised, then all ten Nielsen heuristics have code evidence for 4/4 or an explicit external blocker prevents the claim.

## Spec Change Log

## Design Notes

Workers own disjoint stories. P1 lands before P2/P5 ABI integration; P2 lands before P4/P5 projection; P3 and P4 may run in parallel after schema coordination; P7 begins with shared tokens/navigation and integrates only after workflow state contracts stabilize. Every worker must preserve unrelated edits and return changed files plus verification evidence.

## Verification

**Commands:**
- `NO_DNA=1 quasar build && NO_DNA=1 cargo test && NO_DNA=1 cargo clippy --all-targets -- -D warnings` -- program builds and exploit-path runtime tests pass.
- `npm test && npm run lint && npm run lint:admin && npm run check:tokens` -- unit, backend, frontend, and token checks pass.
- `npm run build && NEXT_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run build:admin` -- both production bundles compile.
- `npm audit --json` -- no unaccepted production vulnerability remains.
- Browser screenshots and keyboard journeys at mobile/tablet/desktop -- no overlap, missing navigation, inaccessible decision, or misleading status remains.
