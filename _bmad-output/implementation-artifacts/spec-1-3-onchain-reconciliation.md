---
title: 'On-chain reconciliation harness (E1.3)'
type: 'feature'
created: '2026-07-08'
status: 'done'
baseline_revision: '0f5611c8f856229b5fbf238d494dab861aab754c'
final_revision: 'e4dc108560c001e5deba95ef6d484702627d43b6'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/E-Development/deliveries/DD-001-first-investment.yaml'
  - '{project-root}/_bmad-output/E-Development/deliveries/DD-002-getting-paid.yaml'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Convex is the reactive read model, but nothing keeps it in sync with Solana — which is authoritative for token ownership and distributions (spine I2/I3, FR16). There is no webhook endpoint, no chain-wins reconciliation path, and no discrepancy log, so the Convex mirror can silently diverge from on-chain truth.

**Approach:** Add a Convex HTTP action (`POST /helius/webhook`, served at the deployment's `.convex.site` host) that authenticates Helius callbacks, normalizes on-chain mint/transfer/distribution events to an internal event contract, and dispatches each to an **idempotent** internal mutation that applies the chain-authoritative values to the Convex mirror (`holdings`, `incomeLedger`) — overwriting any divergent Convex state and recording every discrepancy to an append-only reconciliation log plus `AuditLog`.

## Boundaries & Constraints

**Always:** Chain wins on every conflict — the event's amounts overwrite Convex; Convex values never win. Every applied event calls the existing `writeAudit(ctx, …)` (actor `"helius"`) and writes a `reconciliations` row. Reconciliation is **idempotent** — an event already seen (by on-chain tx signature) is a no-op. Match existing Convex conventions: `query`/`mutation`/`internalMutation` from `./_generated/server`, `v` validators from `convex/values`, audit via `MutationCtx`. The webhook secret is read from `process.env` inside the action (set in the Convex dashboard) and documented as a commented line in `.env.local.example`. Unresolved references (unknown mint or wallet) are logged, never thrown.

**Block If:** The only viable implementation would force Convex to self-settle or treat Convex state as authoritative over chain (contradicts I2/I3). OR adding the mint identifier / reconciliation store requires renaming or removing an existing schema field rather than an additive optional field/table.

**Never:** No Anchor/Solana program work, no real Helius account provisioning, no live Solana RPC calls. No order-settlement (DvP) reconciliation — `orders` stay Convex-intent, settled on-chain in E4 (design the event handler extensibly, but do not implement order flips here). No UI, no consumer-facing crypto vocabulary. Do not make the mirror authoritative. Additive schema changes only (no breaking edits to existing tables).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mint event | Authed webhook, `{type:"mint", signature, mint, owner, tokenAmount}` for a known property + user (by `walletAddress`) | `holdings` upserted to the chain `tokenAmount`/`ownershipPct`; `AuditLog` `holding.reconciled`; `reconciliations` row `status:"applied"` | Unknown mint/wallet → `reconciliations` `status:"unresolved"`, no throw, 200 |
| Transfer w/ conflict | Post-transfer balance differs from the Convex `holding` | Convex holding **overwritten** to chain amount; `{before,after}` recorded in `reconciliations.discrepancy` + `AuditLog` `chain.discrepancy` | Same unresolved handling |
| Distribution event | `{type:"distribution", period, txSig}` matching `incomeLedger` rows | Matching `incomeLedger` rows set `status:"paid"` + `txSig`; `AuditLog` `income.reconciled` | No matching rows → `unresolved` logged |
| Duplicate delivery | Event whose `signature` already in `reconciliations` | No-op; mirror unchanged | Idempotent; returns 200 |
| Bad / missing auth | POST without the valid `Authorization` secret | 401; nothing processed | Reject |
| Malformed payload | Body not JSON, or missing required fields | 400; no partial writes | Reject |

</intent-contract>

## Code Map

- `app/convex/schema.ts` -- add optional `mint` (token address) to `properties` for mint→property routing; add a `reconciliations` table (idempotency + discrepancy store) with a `by_signature` index. Additive only.
- `app/convex/http.ts` (new) -- `httpRouter` with the `POST /helius/webhook` `httpAction`: auth against `process.env.HELIUS_WEBHOOK_SECRET`, parse→normalize the payload, dispatch each event via `ctx.runMutation(internal.reconcile.applyChainEvent, …)`, respond 200/4xx. First HTTP action in the repo.
- `app/convex/reconcile.ts` (new) -- `internalMutation applyChainEvent` (chain-wins apply + idempotency check + `writeAudit` + `reconciliations` insert); a `normalizeHeliusEvent` helper mapping the enriched Helius shape to the internal event contract; exported event types.
- `app/convex/audit.ts` -- reuse `writeAudit` unchanged.
- `app/convex/reconcile.test.ts` (new) -- `convex-test` cases covering every I/O row.
- `app/package.json` -- add devDeps `convex-test`, `vitest`, `@edge-runtime/vm`; add `"test": "vitest run"`.
- `app/vitest.config.ts` (new) -- `environment: "edge-runtime"`, `server.deps.inline: ["convex-test"]`.
- `app/.env.local.example` -- document `HELIUS_WEBHOOK_SECRET` as a Convex-dashboard secret (commented, like `PRIVY_APP_ID`).

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/schema.ts` -- add `properties.mint: v.optional(v.string())` and a `reconciliations` table `{signature, eventType, mint?, slot?, status, discrepancy?, raw?, processedAt}` indexed `by_signature` -- enables event→property routing, idempotency, and the discrepancy record.
- [x] `app/convex/reconcile.ts` -- `internalMutation applyChainEvent`: check `by_signature` (skip duplicates); resolve property by `mint` and user by `walletAddress`; apply chain-authoritative amounts to `holdings`/`incomeLedger`; capture `{before,after}` on any divergence; call `writeAudit` and insert the `reconciliations` row. Add `normalizeHeliusEvent`.
- [x] `app/convex/http.ts` -- `httpRouter` + `POST /helius/webhook` `httpAction`: 401 on missing/invalid secret, 400 on malformed body, else normalize and dispatch each event, return 200.
- [x] `app/package.json` + `app/vitest.config.ts` -- add test deps, edge-runtime vitest config, and the `test` script.
- [x] `app/convex/reconcile.test.ts` -- one test per I/O row: mint apply, transfer-with-discrepancy overwrite, distribution paid, duplicate no-op, bad-auth 401 (via `t.fetch`), malformed 400. Assert mirror state, `auditLog`, and `reconciliations` after each.
- [x] `app/.env.local.example` -- add a commented `HELIUS_WEBHOOK_SECRET` line noting it is set in the Convex dashboard.

**Acceptance Criteria:**
- Given a valid authenticated webhook for a mint/transfer/distribution event, when it hits `/helius/webhook`, then the relevant mirror table is updated to the chain-authoritative values and both an `AuditLog` and a `reconciliations` entry are written.
- Given the automated suite, when `npm test` runs, then every reconciliation case passes and `npx tsc --noEmit` is clean against the same `convex/_generated` baseline as Story 1.1.

## Design Notes

HTTP action wiring (new to this repo):
```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
const http = httpRouter();
http.route({ path: "/helius/webhook", method: "POST", handler: httpAction(async (ctx, req) => {
  if (req.headers.get("authorization") !== process.env.HELIUS_WEBHOOK_SECRET)
    return new Response("unauthorized", { status: 401 });
  // parse → normalizeHeliusEvent → for each: await ctx.runMutation(internal.reconcile.applyChainEvent, ev)
})});
export default http;
```
Chain-wins core: read the current `holding`; set it to the event amount; if they differ, record `{before, after}` as the discrepancy — never keep the Convex value. Idempotency: the `reconciliations.by_signature` lookup is the first thing `applyChainEvent` does. Helius enriched webhooks are an external shape — normalize to the internal event contract and keep parsing tolerant. The registration URL is `<deployment>.convex.site/helius/webhook` (from `NEXT_PUBLIC_CONVEX_SITE_URL`); registering it in a live Helius account is a manual/credentialed step, not part of this harness. `convex-test`: `t.fetch("/helius/webhook", …)` drives the route; `t.run`/`t.query` assert mirror + audit; pass `import.meta.glob("./**/*.*s")` to `convexTest(schema, …)` for module discovery.

## Verification

**Commands:**
- `cd app && npm install` -- expected: exit 0 (`convex-test`, `vitest`, `@edge-runtime/vm` resolved).
- `cd app && npm test` -- expected: all reconciliation tests pass.
- `cd app && npx tsc --noEmit` -- expected: no new errors beyond the pre-existing `convex/_generated` baseline (same as Story 1.1/1.2).

**Manual checks (credentialed, not an automated gate — same treatment as `next build` in prior stories):**
- `npx convex dev` to deploy, set `HELIUS_WEBHOOK_SECRET` in the Convex dashboard, register `<deployment>.convex.site/helius/webhook` in Helius, then POST a sample enriched event and confirm the mirror updates and an `auditLog` + `reconciliations` row appear.

## Spec Change Log

(No bad_spec loopback occurred; empty.)

## Review Triage Log

### 2026-07-08 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 5: (medium 3, low 2)
- reject: 11
- addressed_findings:
  - none

Follow-up pass (Blind Hunter + Edge Case Hunter, no prior context) on the shipped diff. No new defects fixable inside this harness's scope surfaced; the substantive findings are real-Helius-feed fidelity and webhook-layer hardening. Eight of the reviewers' findings (transfer sender not decremented, transfer delta treated as balance, multi-`tokenTransfers` dropped, u64/2^53 precision, partial-distribution recipient matching, `UNKNOWN`-type/`includes()` classification, per-logical-event idempotency granularity, and permanently-`unresolved` churn) are already tracked by the two prior E1.3 ledger entries and were **not** re-appended (orchestrator owns existing entries). Five genuinely-new items were appended as defer: fabricated `ownershipPct`, the append-only-vs-delete-on-redrive doc contradiction, 400-on-unactionable retry semantics, batch non-atomicity/poison-event, and the missing request-body-size cap. Rejected 11: the 8 already-ledgered duplicates, plus `chain.discrepancy`-instead-of-`holding.reconciled` audit action (spec I/O matrix defines these as distinct by design), a no-op distribution writing `income.reconciled rows:0` (harmless audit noise), and a non-constant-time secret compare (network timing attack on a full-string shared secret is impractical; edge runtime lacks a guaranteed timing-safe primitive).

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 1, medium 2, low 2)
- defer: 2: (high 1, medium 1)
- reject: 7
- addressed_findings:
  - `[high]` `[patch]` Idempotency poisoning: an event that first resolved `unresolved` (target not yet in Convex — a normal ordering race) was later rejected as `duplicate` on redelivery and never reconciled. The `seen` check now treats only `applied` rows as terminal duplicates and deletes a stale `unresolved` row so redelivery re-drives to a real apply. New test covers the race.
  - `[medium]` `[patch]` Full-table scans (`.collect().find()`) for mint→property and wallet→user replaced with indexed lookups; added `properties.by_mint` and `users.by_wallet` indexes. Removes the O(n)-per-event reliability cliff and matches Convex query guidance.
  - `[medium]` `[patch]` A mint/transfer event with a missing or negative `tokenAmount` no longer writes a bogus `0`/negative holding marked `applied`; it is recorded `unresolved` and writes no holding. New test covers the missing-amount case.
  - `[low]` `[patch]` Distribution no longer clobbers an already-`paid` row's on-chain `txSig` when a later, distinct-signature distribution hits the same period (skips rows already `paid`).
  - `[low]` `[patch]` The `by_signature` seen-check uses `.first()` instead of `.unique()`, so a stray duplicate row can never make every future event with that signature throw.

## Auto Run Result

Status: done

**Summary.** Implemented the on-chain reconciliation harness (E1.3): a Convex HTTP action (`POST /helius/webhook`, served at the deployment's `.convex.site` host) authenticates Helius callbacks against `process.env.HELIUS_WEBHOOK_SECRET`, normalizes enriched mint/transfer/distribution events to an internal contract, and dispatches each to an idempotent `internalMutation` that applies chain-authoritative values to the Convex mirror — chain always wins, every apply is audited via the existing `writeAudit`, and every processed event is recorded (append-only) in a new `reconciliations` table for idempotency and discrepancy tracking. Convex is never made authoritative over chain and never self-settles. No live Helius/Solana provisioning and no Anchor program work (out of scope).

**Files changed.**
- `app/convex/schema.ts` — added `properties.mint` + `properties.by_mint` index and `users.by_wallet` index (event routing); added the append-only `reconciliations` table (idempotency + discrepancy store) indexed `by_signature`.
- `app/convex/reconcile.ts` (new) — `internalMutation applyChainEvent` (idempotent chain-wins apply, discrepancy capture, `writeAudit`, unresolved handling) + defensive `normalizeHeliusEvent`.
- `app/convex/http.ts` (new) — first HTTP action in the repo: the authenticated Helius webhook route.
- `app/convex/reconcile.test.ts` (new) — 12 `convex-test` cases covering every I/O row plus the two review-driven behaviors (unresolved re-drive, missing-amount guard).
- `app/vitest.config.ts` (new) — edge-runtime vitest config for `convex-test`.
- `app/package.json` — `test` script + `convex-test`/`vitest`/`@edge-runtime/vm` devDeps.
- `app/.env.local.example` — documented `HELIUS_WEBHOOK_SECRET` (Convex-dashboard secret).
- `_bmad-output/implementation-artifacts/deferred-work.md` — 2 review deferrals (live-payload normalizer/idempotency hardening; unresolved re-drive sweep + dead-letter).

**Review findings.** 0 intent_gap, 0 bad_spec, 5 patches applied (1 high — idempotency poisoning of unresolved events; 2 medium — indexed lookups replacing full-table scans, missing/negative amount guard; 2 low — distribution txSig clobber, `.unique()`→`.first()`), 2 deferred (live-Helius normalizer/idempotency hardening; unresolved re-drive sweep), 7 rejected (constant-time/HMAC secret, Bearer-prefix, 400-on-empty, mid-batch try/catch, first-sync-not-a-discrepancy, raw-storage size, duplicate-mint invariant). No spec loopback.

**Verification.** `npm install` exit 0 · `npx convex codegen` regenerated types for the new indexes · `npm test` → 12/12 passed · `npx tsc --noEmit` exit 0 (clean, no new errors beyond the pre-existing `_generated` baseline). Live webhook registration + a real enriched-event POST remain a manual/credentialed check (needs a Helius account + Convex dashboard secret), documented under Verification — same treatment as `next build` in prior stories.

**Residual risks.** (1) `normalizeHeliusEvent` is a defensive placeholder over an assumed enriched shape; the real Helius payload (multi-transfer, from/to accounting, burn/swap, bigint amounts) is unverified and deferred to live wiring. (2) An `unresolved` event only re-drives if Helius redelivers; a durable re-drive sweep/dead-letter is deferred. (3) `ownershipPct` for a fresh holding starts at 0 (no supply oracle in this foundation story); accurate percentage requires total-supply context arriving with settlement (E4). (4) Runtime behavior of the HTTP action against a live deployment is unverified here (no credentials).

### Follow-up review pass — 2026-07-08

A second, independent review pass (Blind Hunter + Edge Case Hunter, no prior context) ran against the shipped diff. **No code changes were made** — no patch was fixable inside this harness's deliberately-scoped boundaries and no spec deviation warranted a loopback. The reviewers re-surfaced the real-Helius fidelity concerns already captured by the two prior E1.3 ledger entries (not re-appended), and five genuinely-new items were appended to the deferred-work ledger: fabricated `ownershipPct`, the append-only-vs-delete-on-redrive documentation contradiction, 400-on-unactionable retry semantics, webhook batch non-atomicity, and the missing request-body-size cap. 11 findings were rejected (8 already-ledgered duplicates + `chain.discrepancy` audit action being spec-defined + no-op distribution audit noise + impractical non-constant-time secret compare). **Verification:** `npm test` → 12/12 passed. Since this pass made no review-driven code changes, `followup_review_recommended` is set to `false`.
