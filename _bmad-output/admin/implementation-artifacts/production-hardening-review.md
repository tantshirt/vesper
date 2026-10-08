# Production Hardening Review

**Date:** 2026-07-12  
**Baseline:** `a90ec2d`  
**Scope:** Complete uncommitted Rust, Solana, Convex, TypeScript, consumer UX, admin UX, and supply-chain change set.

## Review Result

The adversarial review produced 13 actionable code findings. All 13 were patched and regression-tested. Four production decisions/evidence packages remain external blockers. The codebase is substantially hardened, but it is not approved for real-funds production until those blockers are resolved and the resulting deployment is reviewed again.

## Closed Findings

1. Repeated purchase POSTs could obtain multiple executable authority-signed transactions for one order. Authorization is now atomically claimed, persisted once, and reused.
2. A previously thawed Token-2022 account could remain transferable after eligibility revocation. Buyer custody is now frozen at rest; settlement performs atomic thaw, delivery, and refreeze, and public thaw fails.
3. Property mint authority remained live after initial funding. Initialization now requires revoked mint authority, exact supply, exact vault inventory, zero decimals, frozen-by-default policy, and offering-PDA freeze authority.
4. Active purchases on different properties did not reserve Reg A headroom. Same-year active principals are now reserved globally and confirmed totals are year-keyed.
5. Issued or submitted purchases could remain ambiguous without safe retry evidence. Canonical signed payload, blockhash, last-valid height, and chain are durable; only finalized expiry evidence releases the reservation.
6. Confirmation used non-finalized evidence and mapped some unknown outcomes as reconciliation. Finalized chain evidence and one exhaustive presentation mapping are now required.
7. An unresolved reconciliation row could hide a later applied slot. Ordering now checks the latest applied target projection and quarantines missing/stale/conflicting slots.
8. Quarantined webhook data could be mistaken for a completed exact RPC mirror. Evidence sources are distinguished and exact RPC evidence must apply or prove equivalence.
9. Mint and distribution events were insufficiently bound to provider operations. Exact operation signature, subject, recipient, period, and base units are checked before truth advances.
10. Eligibility provider effects could complete out of order. Submitted/unknown versions serialize newer work and stale completions cannot overwrite the desired state.
11. Distribution drafts could change after escrow funding. Funding locks the draft and push verifies scheduled, escrow, and operation totals in exact base units.
12. Local SPL helpers encoded null public-key options incorrectly and accepted unsafe JavaScript numbers. ABI encodings are fixed and unsafe numeric inputs fail closed.
13. Production KYC and admin overview UX implied capabilities or live work that did not exist. Provider availability is explicit and the overview uses permission-scoped live queues with a separate workspace directory.

## Security Assessment

- No known dependency vulnerabilities remain in `npm audit`.
- Removed `@solana/spl-token` and `bigint-buffer`; `npm ls @solana/spl-token bigint-buffer` is empty.
- Wallet linking requires a canonical Solana key plus a domain, identity, address, expiry, nonce, and Ed25519 signature bound in one serializable mutation.
- Unsafe provider seams require tests or `VESPER_RUNTIME_ENV=development` plus a dedicated flag. Missing/unknown runtime classification fails closed.
- External effects use durable reservations, leases, stable idempotency keys, submitted/unknown states, and reconciliation rather than blind replay.
- Webhook ingestion is authenticated, bounded, normalized, event-idempotent, and quarantines ambiguous evidence.
- The platform signer response must preserve the exact message and carry a valid Ed25519 authority signature.

## UX Assessment

Code-controlled UX issues were repaired: consumer IA, Market/Learn, honest target-yield and liquidity language, durable purchase recovery, production KYC unavailability, responsive admin navigation, focus/forced-color support, inline decisions, staged on-chain actions, and permission-scoped operator queues.

The requested 40/40 score is **not yet evidenced**. This session could not access the authenticated browser automation surface, and the repository does not contain completed assistive-technology or observed-user artifacts. The current honest status is: implementation target met for code-controlled criteria; final score pending authenticated browser, axe, keyboard, screen-reader, zoom, reduced-motion, and user-journey evidence.

## External Release Blockers

1. Ratify platform authority, bootstrap/rotation governance, and canonical payment mint for each cluster. The program intentionally does not invent these keys.
2. Integrate production KYC/KYB/AML, fiat funding/custody, mint signer, distribution custody/payout, and WebAuthn/passkey step-up providers.
3. Finalize CSP origins for Convex, Privy, WorkOS, RPC, wallet, signer, and custody services.
4. Run authenticated responsive and assistive-technology evidence at 320/768/1024/1440 widths, 200% zoom, reduced motion, and primary journey recovery states.
5. Obtain approval for program upgrade/devnet deployment rehearsal, then verify deployed program bytes, authority, canonical mints, webhooks, and environment flags. No deployment or transaction submission occurred in this implementation run.

## Verification Evidence

- `npm test`: 56 files, 916 tests passed.
- `npm run lint` and `npm run lint:admin`: passed with zero warnings.
- `npm run check:tokens`: passed.
- Consumer and admin production builds: passed; 11 and 14 generated routes respectively.
- `NO_DNA=1 quasar build`: passed.
- Rust unit/runtime tests: 4 unit plus 11 QuasarSVM runtime tests passed.
- `NO_DNA=1 cargo clippy --all-targets -- -D warnings`: passed.
- `npm audit --json`: 0 vulnerabilities across 1,138 dependencies.
- `git diff --check`: passed.

## Operational Disclosure

During UX integration, `convex codegen` reported uploading the current function definitions to the configured Convex development deployment. No data migration, Solana transaction, program deployment, or live-provider operation was performed.
