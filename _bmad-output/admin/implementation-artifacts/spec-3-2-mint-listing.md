---
title: 'Story 3.2 — Mint & listing console (Token-2022, ACL frozen, step-up)'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 3.2)'
  - '_bmad-output/admin/C-UX-Scenarios/A1-list-a-property/A1-list-a-property.md'
depends_on: ['3-1 (allGatesSigned)', '1-1 (mint.execute)', '1-3 (audit)', '1-5 (UI)', 'existing dvp builders + server-wallet stub pattern']
blocker_note: 'B2 (step-up) → requireStepUp STUB seam (like requireUnsafeStubs). B1 not involved (no money in minting). The Token-2022 mint signs via a STUB-MINT- server-wallet seam (mirrors settlement STUB-DVP / eligibilityAttest STUB-ELIG); the real devnet-acl recipe + Privy server wallet drop in later.'
---

## Intent

**Problem:** A property whose gates are all human-signed (`3-1`) must be **minted** (Token-2022, ACL frozen-by-default) and **listed** — the irreversible on-chain act that turns diligence into an investable offering. It must be impossible to mint an incompletely-gated property, impossible to fat-finger (consequence + cost + **finality** stated, **step-up** required), and impossible to list before the mint is on-chain-confirmed.

## Boundaries & Constraints

**Always:**
- **Gate wall first.** `mintOffering` calls `allGatesSigned(ctx, propertyId)` (3-1); if any gate is unsigned it refuses — a property cannot be minted with an unsigned gate. Server-enforced.
- **Step-up on the irreversible action (B2 placeholder).** Add a `requireStepUp(ctx, "<action>")` **stub seam** in `security.ts` (mirrors `requireUnsafeStubs`) — a documented placeholder that the real WebAuthn hardware-key step-up (B2) replaces. `mintOffering` calls it. Flag it pending B2.
- **Mint via a stubbed server-wallet seam.** The Token-2022 frozen-by-default mint + `initialize_offering` sign through a `STUB-MINT-` seam (mirrors `settlement` `STUB-DVP-` / `eligibilityAttest` `STUB-ELIG-` / `distributionPush` `STUB-DIST-`). Comment the real path: `devnet-acl.ts` recipe (`createInitializeDefaultAccountStateInstruction(Frozen)` + `createInitializeMint2Instruction` + `buildInitializeOfferingInstruction`) signed by the Privy server wallet. Records `properties.mint` + a mint-intent status; audits `mint.executed` (named human + the stub sig / on-chain ref).
- **List only after on-chain-confirmed.** Listing (status `gating` → `open`) requires the mint to be reconciled/confirmed (3-3). In the stub, gate listing on a `mintStatus:"confirmed"` the stub sets — do NOT flip to `open` in the same breath as the mint call; keep the confirm step distinct (3-3 wires the real Helius confirm).
- `mint.execute`-gated (ops_diligence holds it; platform_admin does not). Reuse 1-1's requirePermission. UI states consequence + cost + finality before confirm.

**Never:**
- Do not build distribution (4-x) or weaken 3-1's gate wall. Do not add a live server wallet / real keys. Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*`, `vesper_dvp/` (Rust). Do NOT `git commit`.

## Code Map

- `app/convex/security.ts` — add `requireStepUp(ctx, action)`: STUB (a `stepUpEnabled()` flag gate mirroring `unsafeStubsEnabled`; disabled → the call is allowed-in-stub with a comment, OR requires the flag — match the `requireUnsafeStubs` posture so tests pass). Clearly a B2 placeholder.
- `app/convex/schema.ts` — `properties` + `mintStatus` (`v.optional(v.union(v.literal("none"), v.literal("minting"), v.literal("confirmed")))`) and reuse existing `mint` (address) + `status` (+`"gating"` from 3-1).
- `app/convex/mint.ts` (**new**):
  - `mintServerSeam` — the `STUB-MINT-` server-wallet stub (internalAction), returns a stub mint address + sig.
  - `mintOffering` (**action**, `mint.execute`-gated): `allGatesSigned` guard → `requireStepUp` → `mintServerSeam` → `ctx.runMutation(internal.mint.recordMint, ...)` (set `properties.mint` + `mintStatus:"minting"`, audit `mint.executed`). Irreversible; the mutation is idempotent (a property already minted refuses re-mint).
  - `recordMint` (internalMutation).
  - `listOffering` (mutation, `mint.execute`): refuse unless `mintStatus:"confirmed"`; flip `status` `gating`→`open`; audit `offering.listed`. (3-3 sets `confirmed`; a stub confirm helper may be exposed for the demo.)
  - `mintConsole` (query, `mint.execute`) — property mint state for the console.
- `app/convex/mint.test.ts` (**new**): minting a property with an unsigned gate throws (gate wall); a fully-gated property mints (records mint + `mint.executed` audit) and is idempotent (no double-mint); `requireStepUp` stub gates it; `listOffering` refuses until `mintStatus:"confirmed"` then flips to `open` + audits; `platform_admin` denied `mint.execute`.
- `admin/app/console/mint/page.tsx` (**new**) — the mint & listing console: gate-status summary, a mint action stating exact supply + cost + **finality** ("irreversible") behind a step-up confirm, and a list action enabled only when confirmed. `mint.execute`-gated "Mint" nav entry.

## Acceptance Criteria
- Given a property with any unsigned gate, when mint is attempted, then it refuses (`allGatesSigned` false).
- Given a fully-gated property, when minted (through the step-up stub), then `properties.mint` is set, `mintStatus:"minting"`, `mint.executed` audits the human; a second mint attempt refuses (idempotent, no double-mint).
- Given a minted-but-unconfirmed property, when listing is attempted, then it refuses until `mintStatus:"confirmed"`; once confirmed, listing flips `gating`→`open` + audits `offering.listed`.
- Given `platform_admin`, when they call `mintOffering`/`listOffering`, then denied.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass.

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
