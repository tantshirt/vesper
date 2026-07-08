# Deferred Work Ledger

Tracks intentionally out-of-scope follow-ups surfaced during story implementation.

| ID | Origin story | Item | Rationale | Status |
|----|-------------|------|-----------|--------|
| DW-1 | 1.2 (Design system tokens as code) | Refactor the existing hardcoded radius/padding literals in `app/app/globals.css` (e.g. `border-radius: 18px/20px/14px/13px/99px`, ad-hoc paddings) to consume the new `--radius-*` / `--space-*` scale tokens. | Story 1.2 adds the scale tokens but per its Design Notes the mechanical refactor of existing screen literals to those tokens is out of scope, to keep the 2.1/2.2 screens visually unchanged. | Open |

## Review deferrals (bmad-dev-auto step-04)

- source_spec: `spec-1-2-design-system-tokens.md`
  summary: In dark mode the accent flips to light lavender `--accent #9B98EA`, but `.cta`, `.chip.on`, and `.avatar` still paint white text/fg on it (~2.2:1), below WCAG 2.2 AA (NFR2).
  evidence: The dark `--accent` value and the white-on-accent component rules predate this story (shipped in E1.1/E2.1); E1.2 only makes the state more reachable by adding the forced `data-theme="dark"` override. A fix requires re-deciding a brand token (darker dark-mode accent or dark text on the accent), which is a product/brand decision out of this story's scope.

- source_spec: `spec-1-3-onchain-reconciliation.md`
  summary: Harden `normalizeHeliusEvent` + the idempotency-key granularity against the real enriched Helius payload when the live webhook is wired — multiple `tokenTransfers` per tx, dual-sided from/to balance accounting (decrement the sender, not just credit the recipient), burn/swap event types, bigint/decimal amount precision beyond 2^53, per-(signature, logical-event) idempotency, and a distribution amount-vs-`netPaid` discrepancy check.
  evidence: Real for live Solana/Helius data, but the harness deliberately excludes live Helius/Solana provisioning (spec `Never`), so the exact enriched payload shape is unknown and untestable here. The current normalizer is a defensive placeholder over an internal event contract; getting multi-transfer/from-to/bigint right requires the live payload contract from the E4 settlement / E5 income wiring. Signature-only idempotency is correct for the one-event-per-tx model shipped here; finer granularity is only needed once one tx carries multiple logical events.

- source_spec: `spec-1-3-onchain-reconciliation.md`
  summary: Add a re-drive sweep + dead-letter/alerting for reconciliation rows that stay `unresolved` (a scheduled Convex function that retries unresolved events once their property/user exists and surfaces any stuck past a threshold).
  evidence: This pass fixed the poisoning bug so a redelivered `unresolved` event re-drives to `applied` on the next Helius delivery; but if Helius does not redeliver, an event whose target never materialized in time sits `unresolved` forever with no retry or alert. A scheduled sweep is the durable fix and pairs naturally with the E5 scheduled-function work (distribution runs, update-cadence reminders), which is out of this foundation story's scope.

- source_spec: `spec-1-3-onchain-reconciliation.md`
  summary: `applyOwnership` writes a `holdings.ownershipPct` it cannot know authoritatively — a first-seen (mint) holding is stored at `ownershipPct: 0`, and existing holdings have their pct linearly scaled by the balance ratio, so any UI reading ownership % shows 0% for real new holders and drift on every event.
  evidence: A chain-authoritative ownership % needs `tokenAmount / totalSupply`, but a supply oracle requires a live Solana RPC read, which this harness explicitly excludes (spec `Never`: no live Solana RPC calls). The code writes a knowingly-approximate value rather than leaving it derived/unset; correcting it depends on the supply source wired in a later story. Distinct from the existing normalizer-hardening deferral (that entry is about payload/amount fidelity, not the pct derivation source).

- source_spec: `spec-1-3-onchain-reconciliation.md`
  summary: The reconciliation store is documented "append-only" (schema comment, `reconcile.ts` header, and the intent-contract phrase "append-only reconciliation log"), yet `applyChainEvent` deletes a prior `unresolved` row on re-drive — an internal contradiction. Needs adjudication: either keep the log truly append-only (supersede rather than delete) or relax the wording to match the deliberate delete-on-redrive design.
  evidence: The delete-on-redrive is intentional and tested (`unresolved event re-drives to applied` asserts exactly one row remains), so behavior and docs genuinely disagree. Resolving which side is authoritative is an intent/spec decision (the "append-only" claim lives inside the frozen `<intent-contract>`), not a trivial code patch, so it is deferred for the orchestrator to decide rather than unilaterally rewritten.

- source_spec: `spec-1-3-onchain-reconciliation.md`
  summary: The webhook returns 400 whenever nothing normalizes (`normalizeHeliusEvent` yields `[]`), including well-formed batches whose event types this harness does not model. A real Helius integration treats non-2xx as delivery failure and will redeliver indefinitely / auto-disable the webhook. Well-formed-but-unactionable payloads should be 200-acked (drop-and-ack), reserving 400 for genuinely malformed (non-JSON) bodies.
  evidence: Matches the spec I/O matrix ("missing required fields → 400"), so the code is spec-compliant; the retry-storm consequence only manifests against a live Helius feed, which the harness excludes (spec `Never`). Revisit the ack semantics when the live webhook is provisioned. Not covered by the existing normalizer-hardening entry, which concerns payload parsing, not HTTP status semantics.

- source_spec: `spec-1-3-onchain-reconciliation.md`
  summary: `http.ts` dispatches each normalized event as its own `ctx.runMutation` with no per-event error isolation; if event k throws an unexpected DB error, events 1..k-1 are already committed, the handler throws → 500 → Helius redelivers the whole batch. A poison event can wedge an entire batch. Consider per-event try/catch with a processed/failed summary, or a single wrapping mutation.
  evidence: Applied events are idempotent so most redelivery is self-healing, but an `unresolved` event in the batch is deleted-and-re-driven on each retry, and there is no partial-success reporting. Low-to-medium robustness gap that only bites under real batched delivery with an erroring event; deferred with the other live-webhook hardening. Distinct from the unresolved-sweep entry (that is about durability of unresolved rows, not batch atomicity).

- source_spec: `spec-1-3-onchain-reconciliation.md`
  summary: The httpAction calls `await req.json()` with no maximum content-length check, parsing arbitrary-size JSON before any semantic validation — a memory-pressure/DoS lever for anyone who obtains the shared secret.
  evidence: Real but low severity and gated behind knowing `HELIUS_WEBHOOK_SECRET`; the spec does not require a size cap and no real endpoint is provisioned here. Cheap to add (reject bodies over a fixed byte/element cap before parsing) when the live webhook is wired.

- source_spec: `spec-2-3-trust-stack-signed-gates.md`
  summary: The Trust Stack header copy ("A named human signed every gate." / "signed by people.") is an absolute claim rendered whenever any gates exist, but the schema permits `status: "pending" | "failed"` with `signedByHuman` optional — so a property with unsigned/pending/failed gates would still proclaim every gate was human-signed.
  evidence: Real overclaim on a trust surface, but the live/seed data (The Monroe) has all 8 gates passed and human-signed, so it never triggers today; the assurance wording is also compliance-governed under blocker B4 (consumer gate copy, owner product+compliance), making unilateral rewrite inappropriate. Revisit when non-all-passed properties become renderable and B4 copy is finalized.

- source_spec: `spec-2-3-trust-stack-signed-gates.md`
  summary: A `failed` gate is visually indistinguishable from a `pending` one — both render the same muted "•" glyph; only the low-emphasis `--muted` text label differs ("Not passed" vs "In review"). A `--loss` token exists and is unused, so a material negative diligence signal has no distinct visual treatment.
  evidence: The text-equivalent (WCAG) requirement is met, so this is a visual-hierarchy enhancement, not an a11y defect; it also never manifests on seed data (all gates pass) and is beyond this story's scope (passed-gate trust display). Distinct failed-state styling should be designed when failed/pending gates can actually occur on a live property.

- source_spec: `spec-2-3-trust-stack-signed-gates.md`
  summary: The load-bearing invariant "no gate is ever attributed to an AI" and the empty-state/heading behavior live in `TrustStack.tsx`, which has no test coverage — only the four pure helpers are unit-tested. A render-level test asserting the invariant (and empty/pending rendering) is missing.
  evidence: The invariant is structurally guaranteed in code today (the component only ever emits `signerText(signedByHuman)` plus static human copy, with no AI code path), so risk is low, but it is asserted only by comments. Adding a component render test requires new dev tooling (jsdom + @testing-library/react + vitest config) that is out of scope for this story; track as its own focused task.

- source_spec: `spec-2-4-onchain-proof.md`
  summary: The on-chain proof route (`app/property/[id]/proof/page.tsx`) is a `"use client"` view backed by `useQuery`, with no SSR and no `generateMetadata`/`<title>`/OG tags — a "verify it yourself" trust artifact that renders blank without JS and cannot be unfurled when shared.
  evidence: Real for a public, shareable proof surface, but it faithfully mirrors the app-wide client-rendered Convex pattern (property detail is client-only too); moving to a server component or adding route metadata is an app-wide rendering-strategy decision beyond this story. Revisit if the proof view is meant to be a first-class shareable/link-unfurlable artifact.

- source_spec: `spec-2-4-onchain-proof.md`
  summary: `seedTheMonroe` finds the existing property via `by_status("open")`, so once The Monroe leaves "open" (status `funded`/`closed`) the idempotency + mint-backfill check can no longer see it and a re-seed would insert a duplicate "open" Monroe.
  evidence: Pre-existing in the original seed (the `by_status("open")` lookup predates this story); no code path currently flips The Monroe off "open", so it never triggers today. Robust fix is to look the property up by name or by `mint` (`by_mint`) rather than by status; track with seed-hardening.

- source_spec: `spec-2-4-onchain-proof.md`
  summary: A malformed `[id]` route param (e.g. `/property/garbage/proof`) makes `getOnChainProof`'s `v.id("properties")` arg validator throw server-side; `useQuery` re-throws and the only handled states are `undefined` (loading) and `null` (not-found), so the visitor hits an uncaught render error instead of the graceful "Property not found" screen.
  evidence: Real robustness gap, but identical to the pre-existing pattern on `property/[id]/page.tsx` (same `as Id<>` cast, same two-state handling); a proper fix (id-shape guard or route-level error boundary) is an app-wide concern. Only reachable via a hand-crafted bad URL, not a normal navigation path.

- source_spec: `spec-3-1-passkey-signup-wallet.md`
  summary: `setWalletAddress` (convex/users.ts) trusts a client-supplied `walletAddress` string as the account's on-chain reconciliation routing key (reconcile.ts `by_wallet`) — it verifies *who* calls (JWT `sub`) but not that the address genuinely belongs to the caller's Privy embedded wallet, so an authed user could first-claim an as-yet-unlinked address they don't own. This story added mirror-once + uniqueness + embedded-wallet-selection guards, but not server-side proof of ownership or strict base58/length format validation.
  evidence: A correct authenticity check requires reading the embedded wallet address from a trusted source (Privy server API / verified token claims), and the routing consumer (E1.3 reconciliation) plus E4 settlement are not live in this harness (live Helius/Solana provisioning is itself deferred), so the exploit is latent — no real holdings can be mis-routed today. The residual "pre-claim an unused address" vector should be closed when live Privy-server verification and reconciliation/settlement are wired, alongside base58/length validation of the address before it is persisted.

- source_spec: `spec-3-1-passkey-signup-wallet.md`
  summary: The Convex-provisioning and wallet-mirror effects on `/invest/[id]` (mirroring the app-wide E1.1 `page.tsx` pattern) are best-effort and client-mounted — both `ensureUser()` and `setWalletAddress()` swallow every rejection via `.catch(() => {})`, there is no error surface, no retry beyond React's dependency-change re-fire, and no provisioning timeout, so a transient `ensureUser` failure (deps stay unchanged → effect never re-runs) can strand the user on the "Setting up your account" interstitial indefinitely, and navigating away before the mirror completes leaves the embedded address unmirrored until the user happens to revisit an invest route.
  evidence: Confirmed against the code: the `ensureUser` effect gates on `currentUser === null` with deps `[isAuthenticated, currentUser, ensureUser]`, so a swallowed failure leaves `currentUser` null and the effect does not re-fire (this is a never-retry, not a retry-storm). Identical to the accepted app-wide swallow pattern in `app/app/page.tsx` (E1.1), so not caused by this story, but more consequential on this money-adjacent route. A durable fix is a backend/reconciliation-driven mirror plus a user-facing error/retry + provisioning timeout, which is broader than this story's scope; distinct from the existing address-authenticity/format-validation deferral (that concerns *what* is written, this concerns *failure handling and durability* of the write).

- source_spec: `spec-3-1-passkey-signup-wallet.md`
  summary: Rejected wallet-link attempts in `setWalletAddress` — the "already linked to another account" collision guard and the "already linked" repoint guard — throw with no durable record, so the security-interesting events (an attempt to hijack or repoint the reconciliation routing key) leave no trace; only successful links are audited.
  evidence: Real observability gap on a money-routing mutation, but non-trivial to fix: a Convex mutation that throws rolls back the entire transaction, so a `writeAudit` call placed before the throw would be rolled back with it — recording a *rejected* attempt requires a separate, non-transactional logging path (e.g. a scheduled/async logger or a distinct table written via a nested action). Latent because reconciliation/settlement is not live in this harness. Distinct from the authenticity deferral (that is about verifying the address; this is about auditing *rejected* attempts).

- source_spec: `spec-3-1-passkey-signup-wallet.md`
  summary: The consumer signup on `/invest/[id]` hands off to Privy's hosted login modal, which — because `providers.tsx` `loginMethods` includes `"wallet"` — surfaces external-wallet / crypto-native UI and vocabulary outside the story's tested `INVEST_COPY` surface, partially undercutting the "no crypto vocabulary on this route" boundary (I6/NFR3); relatedly, `sms` is an enabled login method while the signup copy promises only "a passkey or your email".
  evidence: Verified in `app/app/providers.tsx` (`loginMethods: ["email","sms","passkey","wallet"]`). The `hasCryptoVocabulary` invariant only scans `INVEST_COPY`, so the Privy modal's copy is outside the tested surface. The `loginMethods`/Privy appearance config predates this story (Code Map lists `providers.tsx` as reference-only), and trimming `"wallet"` or theming the modal is an app-wide Privy-config + product decision, so it is out of this story's scope. Revisit when the consumer login surface is hardened for the no-crypto-vocab boundary.
