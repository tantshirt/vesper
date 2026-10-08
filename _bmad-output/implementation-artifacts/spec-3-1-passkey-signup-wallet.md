---
title: 'Story 3.1 — Passkey signup + embedded wallet'
type: 'feature'
created: '2026-07-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
baseline_revision: '6fa0124bac2cd12319b144bf1ea065d3058b81ed'
final_revision: '2dbab80cc8d52d6a624016fc522e83030d5887ae'
---

<intent-contract>

## Intent

**Problem:** Tapping **Invest** on a property links to `/invest/[id]`, which does not exist, and there is no auth gate or account-creation step. A first-timer cannot go from intent to a signed-up, wallet-ready account, and the Convex user is never told its embedded Solana wallet address.

**Approach:** Build the auth-gated invest-flow entry at `/invest/[id]`. When unauthenticated it presents a calm passkey/social signup (Privy — already configured); on signup Privy silently pre-generates the self-custodial Solana wallet, whose address is mirrored once into the Convex user with an audit entry. Signup happens in place, so the user stays on the same property's invest entry ("returned to my place"). The actual invest flow (calculator, order, settlement) is Epic 4 and out of scope — this page ends at a clean handoff once the account is ready.

## Boundaries & Constraints

**Always:**
- No crypto vocabulary (wallet, gas, tx, mint, seed phrase, blockchain) in any consumer-visible copy on this route (I6 / NFR3). The embedded wallet stays abstracted; never surface its address or any seed material to the user.
- Inherit design-system tokens/classes only (I7); no hardcoded non-token colors (`npm run check:tokens` must pass). Reuse existing classes (`.wrap`, `.card`, `.cta`, `.eyebrow`, `.muted`, `.row`) where possible.
- The embedded Solana wallet is self-custodial and pre-generated invisibly via the existing Privy `createOnLogin` config (FR4). Signup offers passkey/social.
- Persisting the wallet address to the Convex user is an auditable state change: write an `AuditLog` entry (I3). Wallet mirroring and user provisioning must be idempotent (no duplicate user rows, no repeated writes for an unchanged address).

**Block If:**
- The embedded Solana wallet cannot be created or read through the already-configured Privy client purely in code (i.e. it would require a Privy dashboard change or new credentials this run cannot make) — HALT with status `blocked` rather than guessing config.

**Never:**
- Do not build the invest flow proper — calculator/projection (4.1), order/fee (4.2), acknowledgement (4.3), DvP settlement (4.4), confirmation (4.5). This page ends at "account ready → continue".
- Do not add KYC or funding here — KYC is gated at confirm-investment (3.2); fiat→USDC funding is 3.3 (B1-blocked). No KYC/eligibility/funding UI on this route.
- Do not introduce a live-auth/browser test harness (no jsdom) — follow the repo's `*.helpers.ts` + vitest pattern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Privy initializing | `ready === false` | Calm loading state | No error expected |
| Unknown/invalid property id | property query returns `null` | "Property not found" + back-to-Explore link (mirror property-detail pattern) | Graceful, no throw path added |
| Unauthenticated visitor | ready, `!authenticated`, property found | Signup screen: property context + passkey/social CTA calling `login()`; zero crypto vocabulary | Cancelled/failed signup → stay on signup screen, retryable |
| Signup done, wallet not yet ready | authenticated, embedded Solana address not yet resolvable | Calm "setting up your account…" interstitial (no crypto vocab) | Wait; do not write a null/empty address |
| Wallet ready, not yet mirrored | authenticated, address resolved, `currentUser.walletAddress !== address` | `ensureUser` (if needed) then `setWalletAddress` once → ready state | Mutation failure → swallow + remain on interstitial, effect retries |
| Returning linked user | authenticated, `currentUser.walletAddress === address` | Ready state immediately; no duplicate user row / no repeat write | No error expected |

</intent-contract>

## Code Map

- `app/app/property/[id]/page.tsx` -- line 95: `<Link href={`/invest/${p._id}`} className="cta">Invest</Link>` — the entry the new route serves; not-found pattern (lines 15-16) to mirror.
- `app/app/invest/[id]/page.tsx` -- **NEW** client route: the auth-gated invest-flow entry (signup + wallet-ready gateway).
- `app/app/invest/[id]/invest.helpers.ts` -- **NEW** pure state/decision logic + copy constants, unit-testable without a DOM.
- `app/app/invest/[id]/invest.helpers.test.ts` -- **NEW** vitest coverage for the helpers (mirrors `trustStack.helpers.test.ts`).
- `app/convex/users.ts` -- add `setWalletAddress` mutation; existing `currentUser`, `ensureUser` reused. `writeAudit` from `./audit`.
- `app/convex/schema.ts` -- `users` already has `walletAddress` + `by_wallet` index (no change).
- `app/app/providers.tsx` -- Privy already configured (passkey login + Solana `createOnLogin`); reference only.
- `app/app/page.tsx` -- E1.1 reference for the Privy→Convex read pattern (`usePrivy`, `useConvexAuth`, `currentUser`, `ensureUser` effect, embedded wallet read).
- `app/app/globals.css` -- token source + existing classes; add a small `.inv-*` scoped block only if reuse is insufficient (token-guarded).

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/users.ts` -- add `setWalletAddress({ walletAddress: v.string() })` mutation: resolve the caller via `getUserIdentity()`/`by_privyId`; throw if unauthenticated or user row missing; if `existing.walletAddress === walletAddress` return without writing; else `patch` the address and `writeAudit({ actor: identity.subject, action: "user.wallet_linked", target: userId })`. -- mirror the embedded wallet into the read model, idempotently + auditably (I3).
- [x] `app/app/invest/[id]/invest.helpers.ts` -- pure helpers: (a) `investGateState({ privyReady, isAuthenticated, currentUser, walletAddress, propertyLoaded, propertyFound })` → discriminated state (`loading | not-found | signup | provisioning | ready`); (b) `shouldMirrorWallet(currentUser, walletAddress)` → boolean; (c) exported consumer-copy constants; (d) `hasCryptoVocabulary(text)` guard over the forbidden-word list. -- isolates all branching logic so it is testable without a DOM.
- [x] `app/app/invest/[id]/page.tsx` -- client route rendering per `investGateState`: loading; not-found (back to Explore); signup (property context + `.cta` calling Privy `login()`, passkey/social, no crypto vocab); provisioning interstitial; ready (handoff placeholder, clearly "next step" for E4 — no calculator). Effects: on `isAuthenticated && currentUser===null` call `ensureUser()`; when `shouldMirrorWallet` is true call `setWalletAddress({ walletAddress })` once. Resolve the embedded Solana address via Privy (see Design Notes). -- delivers the gated entry; signup-in-place keeps the user on this property's invest entry.
- [x] `app/app/invest/[id]/invest.helpers.test.ts` -- unit-test every I/O-matrix state of `investGateState`, `shouldMirrorWallet` idempotency (equal vs differing address), and assert every exported copy constant passes `hasCryptoVocabulary === false`. -- lock the state machine and the no-crypto-vocab invariant.
- [x] `app/app/globals.css` -- add minimal `.inv-*` styling only if existing classes are insufficient; all colors via tokens. -- keep the screen on-brand without inventing alternates. *(No change needed — existing `.wrap`/`.card`/`.cta`/`.eyebrow`/`.dot`/`.ok`/`.muted` classes were sufficient; check:tokens stays green.)*

**Acceptance Criteria:**
- Given an unauthenticated user on Property Detail, when they tap **Invest**, then they land on `/invest/[id]` and can sign up with a passkey or social login, and no crypto terminology (wallet/gas/tx/mint/seed phrase) appears anywhere on the screen.
- Given signup completes, when the embedded self-custodial Solana wallet is created, then its address is persisted to the Convex user exactly once and an `AuditLog` entry records the linkage, and neither the address nor any seed material is shown to the user.
- Given a user who already has a linked wallet, when they open `/invest/[id]` again, then no duplicate user row is created and no repeat wallet write occurs.
- Given signup happens on the invest entry, when it completes, then the user remains on the same property's invest entry (returned to their place) and sees the account-ready handoff.

## Review Triage Log

### 2026-07-08 — Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 3 (high 0, medium 2, low 1)
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` `page.tsx` embedded-wallet resolution kept an un-specced `?? solanaWallets?.[0]` fallback — with `"wallet"` in `loginMethods` a user with an external Solana wallet ordered first would have that external address mirrored as the settlement routing key. Removed the fallback so only the Privy-embedded wallet (`walletClientType === "privy"`) is selected; the spec-sanctioned `currentUser.walletAddress`/`user.wallet.address` chain and the `provisioning` gate cover the not-yet-resolved case.
  - `[low]` `[patch]` `investGateState` declared a `currentUser` input that was destructured away and never used (misleading state-machine API; `ready` is derived purely from `walletAddress`). Removed the dead parameter and updated the call site and tests.
  - `[low]` `[patch]` `hasCryptoVocabulary` guard list omitted likely offenders for a tokenized-real-estate surface, giving the no-crypto-vocab invariant false coverage. Added `solana`, `token`, `coin`, `web3`, `on-chain`, `onchain`, `custody`, `custodial`, `ledger` (existing `INVEST_COPY` stays clean; invariant still green).
  - `[low]` `[patch]` ready-state rendered the title in both the `<h1>` and the card (`✓ {readyTitle}`) — double screen-reader announcement — and the `✓` glyph was not hidden from assistive tech. Card now uses a distinct `readyConfirm` ("Account created") with an `aria-hidden` check mark.

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 3, low 3)
- defer: 1 (medium 1)
- reject: 7
- addressed_findings:
  - `[medium]` `[patch]` `page.tsx` mirrored `solanaWallets[0]`, which could be an external/linked wallet ordered before the pre-generated one — now selects the embedded wallet explicitly via `walletClientType === "privy"`.
  - `[medium]` `[patch]` `setWalletAddress` allowed silently repointing an already-linked account to a new address (audit churn + rewrites the reconcile routing key) — now mirror-once: rejects a change once an address is set, and `shouldMirrorWallet` stops attempting a write once the user has a linked address (test updated).
  - `[medium]` `[patch]` no uniqueness on the `walletAddress` routing key — `setWalletAddress` now rejects an address already linked to a different user (`by_wallet` lookup).
  - `[low]` `[patch]` `user.wallet_linked` audit entry now records the linked address in `meta` (I3 traceability).
  - `[low]` `[patch]` corrected the misleading "retries on the next reactive render" comment on the mirror effect to describe best-effort behavior accurately.
  - `[low]` `[patch]` added `role="status"` / `aria-live="polite"` to the transient loading and provisioning states (NFR2 assistive-tech announcement).

## Design Notes

- **Embedded Solana address read:** the E1.1 screen reads `user?.wallet?.address`, but with only Solana `createOnLogin` configured the generic `user.wallet` may be absent. Prefer Privy's Solana wallets accessor (e.g. `useSolanaWallets()` from `@privy-io/react-auth`) to get the embedded wallet address reliably; fall back to `currentUser?.walletAddress ?? user?.wallet?.address`. Never write an empty/`undefined` address — gate the mirror on a truthy address (the `provisioning` state covers the gap).
- **Return-to-place:** because `login()` opens an in-place modal on `/invest/[id]`, the user re-renders authenticated on the same route — no separate `returnTo`/redirect mechanism is needed for this story. The Property Detail CTA stays a plain `Link` to `/invest/[id]`.
- **Ready-state handoff:** keep it a thin, honest placeholder (e.g. "You're all set — continuing to your investment") that E4 will wire to the calculator. Do not fabricate calculator/fee/settlement UI.

## Verification

**Commands:**
- `cd app && npm run build` -- expected: type-check + build succeed (no `typecheck` script exists; build is the gate).
- `cd app && npm test` -- expected: vitest passes, including new `invest.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: no hardcoded non-token colors introduced.

**Manual checks (if no CLI):**
- Grep the new route + helper copy constants for the forbidden crypto words — expect none in consumer-visible strings.

## Auto Run Result

Status: done

**Summary.** Built the auth-gated invest-flow entry (`/invest/[id]`) behind Property Detail's existing "Invest" CTA. Unauthenticated visitors get a calm passkey/social signup (Privy, already configured); on signup Privy silently pre-generates the self-custodial Solana embedded wallet, whose address is mirrored once into the Convex user with an audit entry and is never surfaced. Signup happens in place, so the user stays on the same property's invest entry ("returned to my place"). The page ends at an honest "account ready → continue" handoff — the invest flow proper (calculator, order, settlement) is Epic 4 and intentionally out of scope, as are KYC (3.2) and funding (3.3).

**Files changed:**
- `app/convex/users.ts` — added `setWalletAddress` mutation: mirror-once, uniqueness-guarded against the `by_wallet` routing key, audited (`user.wallet_linked` with the address in `meta`), caller derived server-side from the JWT.
- `app/app/invest/[id]/page.tsx` — new client route rendering one screen per gate state (loading / not-found / signup / provisioning / ready); effects call `ensureUser` then `setWalletAddress` (best-effort); selects the embedded Privy wallet explicitly; `role="status"`/`aria-live` on transient states.
- `app/app/invest/[id]/invest.helpers.ts` — pure `investGateState` state machine, mirror-once `shouldMirrorWallet` guard, `INVEST_COPY` constants, `hasCryptoVocabulary` guard.
- `app/app/invest/[id]/invest.helpers.test.ts` — 39 vitest tests over every gate state, the mirror-once guard, and the no-crypto-vocabulary invariant on all copy constants.
- `app/app/globals.css` — no change (existing token-driven classes sufficient).

**Review findings breakdown:** 6 patches applied (3 medium: embedded-wallet selection, mirror-once repoint guard, address uniqueness; 3 low: audit meta, comment accuracy, a11y `role="status"`). 1 deferred (server-side address-authenticity verification + strict format validation — depends on live Privy-server verification and the not-live reconcile/settlement path; logged in `deferred-work.md`). 7 rejected (pre-existing app-wide patterns, curated-content non-issues, and self-healing/low items). 0 intent gaps, 0 spec repairs.

**Verification:** `npm run build` ✓ (compiles; `/invest/[id]` present as a dynamic route), `npm test` ✓ (71 passed, 4 files), `npm run check:tokens` ✓ (clean). Re-run green after the review patches.

**Residual risks:** The mirrored `walletAddress` is still client-supplied (authenticity verification deferred). It is latent — the reconcile/settlement consumer is not live in this harness — and mitigated now by mirror-once + uniqueness + explicit embedded-wallet selection. Live signup/passkey/wallet-creation was not exercised end-to-end (no DOM/browser test harness by repo convention); the state machine and mirror guards are covered by unit tests, and build/typecheck pass.

### Follow-up review (2026-07-08)

A fresh review pass (Blind Hunter + Edge Case Hunter) was run against the committed story. Findings deduped and triaged: **0 intent_gap, 0 bad_spec, 4 patch (1 medium, 3 low), 3 defer, 8 reject** — no spec-repair loopback.

**Patches applied this pass:**
- `[medium]` `page.tsx` — removed the un-specced `?? solanaWallets?.[0]` fallback from embedded-wallet resolution. With `"wallet"` enabled in `loginMethods`, an external Solana wallet ordered first could otherwise have been mirrored as the settlement routing key; now only the Privy-embedded wallet (`walletClientType === "privy"`) is selected, with the spec-sanctioned `currentUser.walletAddress`/`user.wallet.address` chain and the `provisioning` gate covering the not-yet-resolved case.
- `[low]` `invest.helpers.ts` — removed the dead, unused `currentUser` parameter from `investGateState` (updated call site + tests).
- `[low]` `invest.helpers.ts` — expanded `CRYPTO_VOCABULARY` (added `solana`, `token`, `coin`, `web3`, `on-chain`, `onchain`, `custody`, `custodial`, `ledger`) so the no-crypto-vocab invariant covers likely offenders; `INVEST_COPY` stays clean.
- `[low]` `page.tsx` / `invest.helpers.ts` — ready-state a11y: card now shows a distinct `readyConfirm` ("Account created") with an `aria-hidden` `✓`, eliminating the duplicate title announcement and the announced glyph.

**Deferred this pass (3 new ledger entries):** (1) provisioning/mirror effects are best-effort, client-mounted, and swallow all failures — no retry/error surface/timeout/backend reconciliation (app-wide E1.1 pattern, more consequential here); (2) rejected wallet-link attempts (collision/repoint) aren't durably recorded because a throwing Convex mutation rolls back any in-transaction audit write; (3) the Privy hosted login modal surfaces external-wallet/crypto UI outside the tested `INVEST_COPY` surface because `loginMethods` includes `"wallet"` (app-wide Privy-config/product decision).

**Rejected (8):** EVM-via-`user.wallet.address` and empty/invalid-string persistence (both subsumed by the existing address-authenticity/format-validation ledger entry); no server-side format validation (duplicate of that entry); Privy-vs-Convex auth-split deadlock (guarded by `currentUser == null` before any mutation fires; transient self-healing window); `by_wallet` read-then-write race (covered by Convex OCC); malformed-`[id]` crash (identical app-wide `as Id<>` pattern, already deferred at spec-2-4); helper-only test coverage (spec explicitly scopes out a DOM/browser test harness); `login()` double-click (Privy modal is idempotent); stale-cache mirror re-fire (idempotent server-side no-op on the same address).

**Verification (follow-up):** `npm test` ✓ (72 passed, 4 files — `readyConfirm` adds one copy-invariant assertion), `npm run check:tokens` ✓ (clean), `npm run build` ✓ (compiles; `/invest/[id]` present as a dynamic route). `followup_review_recommended: false` — the story has converged: this pass's changes are localized (a one-line narrowing on the money-routing path plus three low-severity cleanups), all remaining real concerns are latent and tracked as deferred work requiring live Privy-server/Solana infrastructure absent from this harness.
