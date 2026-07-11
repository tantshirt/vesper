---
title: 'Story 3.3 — Mint reconciliation (Helius; chain wins) — completes the spine list step'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 3.3)'
depends_on: ['3-2 (mintStatus minting/confirmed, listOffering)', '1-3 (audit)', 'existing reconcile.applyChainEvent + http Helius webhook']
---

## Intent

**Problem:** `3-2` mints a property (`mintStatus:"minting"`) but must NOT list it until the mint is **on-chain-confirmed** — and the Convex mirror must never diverge from chain (chain wins). The reconcile harness (`reconcile.applyChainEvent`, chain-wins, idempotent by signature) + the Helius webhook already exist for holdings/distributions. This story wires the **property mint confirmation** into that same pipeline (flipping `mintStatus` `minting`→`confirmed`, which unblocks `3-2`'s `listOffering`), plus a reconciliation-status read for the console. With no live Helius in dev, a **stubbed confirm** drives the demo.

## Boundaries & Constraints

**Always:**
- **Reuse the existing harness.** Extend `reconcile.applyChainEvent` (or add a sibling handler it dispatches to) for a mint-confirmation event — do NOT build a second reconcile path. Keep its invariants: **idempotent by `signature`**, chain-authoritative, writes a `reconciliations` row (`applied`/`unresolved`, `discrepancy` when chain overwrote a divergent Convex value).
- **Chain wins.** On a mint-confirmation event that names a property's `mint`, set that property's `mintStatus:"confirmed"`; if Convex disagreed with chain, record the `discrepancy` and log it. A duplicate signature is a no-op.
- **Stubbed confirm for the demo (no live Helius).** A `confirmMintStub` (internalMutation, or an ops `mint.execute`-gated action guarded by `requireUnsafeStubs`) synthesizes the Helius mint-confirmation → flips `mintStatus:"confirmed"` via the SAME apply path. Clearly a stub; the real webhook path is `http.ts` → `applyChainEvent`.
- **Reconciliation monitor.** A `reconciliationStatus` query (gate.sign/mint.execute or compliance.review-gated) surfaces recent `reconciliations` + any `unresolved`/`discrepancy` rows for the console banner.
- Audit `mint.confirmed` (+ `chain.discrepancy` on drift), naming the on-chain signature.

**Never:**
- Do not change `listOffering`'s rule (3-2 already refuses until `confirmed`), build distribution reconciliation beyond what exists, or weaken the gate/mint walls. Do not add a live Helius/RPC call or keys. Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*`, `vesper_dvp/`. Do NOT `git commit`.

## Code Map

- `app/convex/reconcile.ts` (extend) — handle a `mint`/`mint_confirmed` event that carries a property `mint` address (no user holding): find the property `by_mint`; set `mintStatus:"confirmed"` (from `minting`); if the prior state diverged, stamp `discrepancy`; write the `reconciliations` row + audit `mint.confirmed`. Keep idempotency by `signature`.
- `app/convex/mint.ts` (extend, from 3-2) — `confirmMintStub` (the demo confirm; `requireUnsafeStubs`/`mint.execute`, routes through the reconcile apply path so it exercises the real chain-wins code) + `reconciliationStatus` (query, permission-gated) returning recent reconciliations + unresolved/discrepancy flags.
- `app/convex/schema.ts` — ensure `properties` has a `by_mint` index (add if absent) for the reconcile lookup.
- `app/convex/mintReconcile.test.ts` (**new**) — a mint-confirmation event flips `mintStatus` `minting`→`confirmed` and audits `mint.confirmed`; a duplicate `signature` is a no-op (idempotent); after confirm, `listOffering` (3-2) succeeds (flips to `open`); a divergent Convex value is overwritten with a logged `discrepancy` (chain wins); `reconciliationStatus` surfaces an unresolved/discrepancy row; a non-permitted caller is denied the read/stub.
- `admin/app/console/mint/page.tsx` (extend, from 3-2) — a reconciliation banner (recent confirms + any discrepancy/unresolved), and the list action lighting up once `mintStatus:"confirmed"`. Reuse 1-5 primitives.

## Acceptance Criteria
- Given a minted property (`mintStatus:"minting"`), when the mint-confirmation event arrives (or `confirmMintStub` runs), then `mintStatus:"confirmed"`, audited `mint.confirmed`; a duplicate event signature is a no-op.
- Given `mintStatus:"confirmed"`, when `listOffering` runs, then the property lists (`gating`→`open`).
- Given Convex diverged from the chain-reported state, when reconciled, then chain wins and a `discrepancy` is recorded + logged.
- Given the console, when reconciliation status renders, then unresolved/discrepancy rows surface; a non-permitted caller is denied.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass (the existing holding/distribution reconcile behavior is unchanged).

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
