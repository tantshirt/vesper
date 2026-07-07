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
