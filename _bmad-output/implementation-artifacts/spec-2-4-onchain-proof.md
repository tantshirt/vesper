---
title: 'Story 2.4 — On-chain proof (provable on demand)'
type: 'feature'
created: '2026-07-08'
status: 'done'
baseline_revision: '7657e27e52577f28316ac7867a3d539c161ecd8f'
final_revision: '47c18b67d3d83b42afe9733d3090608c8b2d65b1'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Property Detail currently has no way for a skeptical, crypto-native visitor to verify the asset on-chain. Story 2.4 (FR3, UX3, NFR3) requires a low-weight "See the on-chain proof" affordance that reaches the token's mint, a holder view, DvP settlement receipts, a Token ACL disclosure, and public explorer links — without ever cluttering the primary path or being required to invest.

**Approach:** Add a dedicated public proof view at `/property/[id]/proof`, reached by a low-weight monospace link on Property Detail. A new public `getOnChainProof` query returns only real chain-mirrored facts (the property `mint`, holder count from `holdings`, settled-order DvP receipts) with honest empty/pending states when a fact isn't on-chain yet; the proof view is the one place crypto vocabulary is allowed. The seed gets a demo `mint` for The Monroe so mint + explorer links are demonstrable.

## Boundaries & Constraints

**Always:**
- The proof view is public/no-auth, reached via a low-weight "See the on-chain proof" affordance; it is never required to browse or invest, and the Property Detail Invest CTA works without ever visiting it.
- Render only real chain-mirrored facts. When a fact is not yet on-chain (no mint, zero holders, no settled receipts), show an honest pending/empty state — never fabricate a mint address, holder count, or settlement receipt at render time.
- Crypto vocabulary (mint, token, holders, DvP, Token ACL, explorer) appears **only** inside the proof view — never on Property Detail, Explore, or any other consumer screen (NFR3). The entry affordance uses the sanctioned phrase "See the on-chain proof".
- The Token ACL disclosure is structural policy (Token-2022 restricted, frozen-by-default, self-thaws on eligibility per I2/I5) — public copy, not a per-user eligibility read.
- Design tokens only (must pass `check:tokens`); tabular numerals for counts; explorer links point to the public Solana explorer.

**Block If:**
- Satisfying "reach mint / explorer links" is judged to require deploying a real on-chain token or claiming a specific live-deployed asset, rather than a disclosed demo seed mint plus honest states. (This is resolved by the seed decision below, so it must not trigger.)

**Never:**
- Never add a "Sell now"/exit CTA, and never gate browsing or investing behind the proof view.
- Never fabricate mint addresses, holder counts, DvP receipts, or signatures — seed fixtures are the only sanctioned non-live data.
- Never introduce Tailwind, CSS modules, or a new date/web3 library — plain CSS tokens + a small pure URL helper.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mint present | `mint:"6MonRoe…111"` | Show truncated address + a working explorer address link | No error expected |
| Mint absent | `mint:undefined` | Honest "Not yet anchored — the token is created when the offering closes"; no explorer link, no invented address | Guard falsy |
| Address truncation | long base58 string | `6MonR…e111` (head…tail) | Short (≤ head+tail) address rendered unchanged |
| No holders | `holderCount:0` | Honest "No positions have settled yet" | Guard zero |
| Holders present | `holderCount:3` | "3 owners on-chain" (tabular numerals) | No error expected |
| No DvP receipts | `receipts:[]` | Honest "No settlements recorded yet" | Guard empty array |
| DvP receipts present | `receipts:[{dvpTxSig:"5x…"}]` | List each receipt with an explorer transaction link | Skip receipts missing a signature |
| Token ACL disclosure | always | Frozen-by-default / eligibility-gated disclosure copy always renders | Always renderable |
| Explorer URL build | `(addr, cluster)` | `https://explorer.solana.com/address/<addr>?cluster=<cluster>` | — |
| Property not found | `getOnChainProof` returns `null` | Not-found message with a link back to Explore | No crash |

</intent-contract>

## Code Map

- `app/convex/schema.ts` -- `holdings` (62–68) indexed only `by_user`; add a `by_property` index to count holders per property without a full scan. `orders` (52–60) already has `by_property` + `dvpTxSig` (set only on on-chain DvP confirm). `properties.mint` (39) is optional.
- `app/convex/properties.ts` -- `getWithGates`/`listOpen` (public, no-auth pattern to mirror); `seedTheMonroe` (33–79) inserts The Monroe with **no `mint`**. Extend seed + add `getOnChainProof`.
- `app/app/property/[id]/page.tsx` -- Client page; Facts block ends at line 88, sticky Invest bar at 91–94. Add the low-weight proof link after Facts, before `.pd-spacer`.
- `app/app/globals.css` -- Low-weight mono link pattern (~114), `.pd-eb` mono eyebrow (~194), `.pd-blk`/`.pd-h` section wrappers. Extend here (tokens only).
- `app/app/property/[id]/trustStack.helpers.ts` + `.test.ts` -- pattern to mirror: pure helpers module + colocated vitest, one assertion per matrix row.
- `app/scripts/check-tokens.mjs` -- token guard (`npm run check:tokens`) new `.tsx/.ts` under `app/app/` must pass (no raw hex).

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/schema.ts` -- EDIT: add `.index("by_property", ["propertyId"])` to the `holdings` table -- lets `getOnChainProof` count a property's holders by index instead of scanning.
- [x] `app/convex/properties.ts` -- EDIT: (a) give `seedTheMonroe` a demo `mint` (documented seed value) on insert, and idempotently backfill it if The Monroe already exists without one; (b) add public `getOnChainProof({ id })` returning `{ name, mint, spvName, status, holderCount, receipts }` — `holderCount` from `holdings.by_property`, `receipts` from settled `orders.by_property` that have a `dvpTxSig`; return `null` if the property is missing -- the honest, chain-mirrored data source for the proof view.
- [x] `app/app/property/[id]/proof/proof.helpers.ts` -- NEW pure module: `SOLANA_CLUSTER`, `truncateAddress`, `explorerAddressUrl`, `explorerTxUrl`, `mintStateLabel(mint?)`, `holderSummary(count)` -- no JSX; isolates the formatting/URL edge-case logic for unit testing.
- [x] `app/app/property/[id]/proof/page.tsx` -- NEW client route: fetch `getOnChainProof`, render the five facets (mint + explorer link, holder view, DvP receipts each with a tx link, Token ACL disclosure, explorer links) with honest empty/pending states and a back link; loading/not-found guards -- the on-demand proof view; the only screen where crypto vocabulary appears.
- [x] `app/app/property/[id]/page.tsx` -- EDIT: add a low-weight "See the on-chain proof" `Link` to `/property/[id]/proof` after the Facts block, not gating the Invest CTA -- the provable-on-demand affordance.
- [x] `app/app/globals.css` -- EDIT: add `.proof-link` (low-weight mono accent) and proof-view styles reusing `.pd-blk`/`.pd-eb`/`.pd-h` tokens (address mono, honest-empty muted, explorer link) -- design-system consistency; must pass `check:tokens`.
- [x] `app/app/property/[id]/proof/proof.helpers.test.ts` -- NEW vitest covering every I/O matrix row (truncation incl. short input, URL building, mint present/absent label, holder summary at 0 and n) -- verify the edge-case logic.

**Acceptance Criteria:**
- Given The Monroe on Property Detail and an unauthenticated visitor, when I tap "See the on-chain proof", then I reach a proof view exposing the mint (with a working explorer link), a holder view, DvP receipts, a Token ACL disclosure, and explorer links — and I can still invest without ever opening it.
- Given the seed has no settled orders or holdings yet, when the proof view renders, then the holder view and DvP receipts show honest empty states (never a fabricated holder or receipt), while the mint and Token ACL disclosure render real facts.
- Given the design-system guard, when `npm run check:tokens` runs, then the new styles introduce no hardcoded non-token colors, and no crypto vocabulary appears anywhere on Property Detail.

## Spec Change Log

_No spec amendments — no intent_gap or bad_spec loopback occurred during review._

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 3: (high 0, medium 1, low 2)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` Proof-view intro no longer claims "every fact below mirrors the public ledger" (untrue for the disclosed demo mint, whose explorer link resolves to an empty account); reworded to an honest "verifiable on the public ledger as the offering settles" — `proof/page.tsx`.
  - `[medium]` `[patch]` `getOnChainProof` `holderCount` now counts distinct owners with a positive balance (`Set` of `userId`, `tokenAmount > 0`) instead of raw holding rows, so the "N owners on-chain" label is a true chain fact even with multiple/zeroed holdings — `properties.ts`.
  - `[low]` `[patch]` Removed the dead `mintStateLabel` helper and its two unit tests (never rendered; its string had already drifted from the page's inline copy — false coverage) — `proof.helpers.ts`, `proof.helpers.test.ts`.
  - `[low]` `[patch]` Deduped DvP receipts by signature inside the query and dropped the redundant client-side re-filter, preventing duplicate React keys / double-counted settlements from a batched DvP tx — `properties.ts`, `proof/page.tsx`.
  - `[low]` `[patch]` `SOLANA_CLUSTER` is now env-overridable (`NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet"`) so a real non-devnet mint links to the correct cluster on the trust surface — `proof.helpers.ts`.

## Design Notes

- **Why seed a mint:** The proof view must be demonstrable ("reach mint… explorer links"), and gate 5 "On-chain binding" already asserts The Monroe is bound on-chain. Seeding a disclosed demo Token-2022 mint (e.g. a base58 placeholder like `6MonRoeSeedM1nt…`) is part of the fixture layer — the same sanctioned demo data as the fictional property itself. This does **not** breach the never-fabricate rule: the frontend renders `mint` only when present, and holder/receipt data stays honest-empty until real settlement flows through the existing reconcile harness.
- **Honest empties over fake data:** `holderCount`/`receipts` derive from live tables (`holdings`, settled `orders`), which are unseeded → 0/empty → honest states now, auto-populating as chain events arrive. Do not seed holdings/orders to "fill" the view.
- **Token ACL disclosure is policy, not a per-user read:** state that the token is a restricted Token-2022, frozen-by-default, that self-thaws only for eligible accounts and blocks ineligible receipt on-chain (I2/I5). Keeps the view public/no-auth.
- Explorer link idiom (low-weight mono, reuse ~globals.css:114):
  ```tsx
  <a className="proof-ex" href={explorerAddressUrl(mint)} target="_blank" rel="noreferrer">View on explorer ↗</a>
  ```

## Verification

**Commands:**
- `cd app && npx tsc --noEmit` -- expected: no type errors.
- `cd app && npm test` -- expected: vitest passes, including the new `proof.helpers.test.ts`.
- `cd app && npm run check:tokens` -- expected: no hardcoded-color violations.
- `cd app && npm run build` -- expected: build succeeds and `/property/[id]/proof` is generated.

**Manual checks:**
- Run `npx convex dev` + `npm run seed` + `npm run dev`; open The Monroe from `/explore`: no crypto words on Property Detail; tap "See the on-chain proof" → the proof view shows the mint with a working explorer link, honest empty holder/receipt states, and the Token ACL disclosure; the Invest CTA still works without visiting proof.

## Auto Run Result

Status: done

**Summary:** Story 2.4 adds the "provable on demand" on-chain proof surface. Property Detail gains a low-weight monospace "See the on-chain proof ↗" link (no crypto vocabulary leaks onto the consumer path) that routes to a new public/no-auth `/property/[id]/proof` view — the one screen where crypto terms are allowed. The view exposes the five required facets: the token mint (truncated, with a public Solana Explorer link), a holder view, DvP settlement receipts (each with an explorer tx link), a Token ACL structural-policy disclosure, and explorer links — each rendering an honest empty/pending state rather than any fabricated fact. A new `getOnChainProof` query returns only real chain-mirrored data (property `mint`, distinct-owner count from `holdings`, deduped settled-order DvP receipts); The Monroe seed gains a disclosed demo Token-2022 mint so the mint/explorer facets are demonstrable while holder/receipt data stays honest-empty until real settlement arrives via the reconcile harness.

**Files changed:**
- `app/convex/schema.ts` — added a `by_property` index to `holdings` (count owners per property without a scan).
- `app/convex/properties.ts` — added `DEMO_MONROE_MINT`, the public `getOnChainProof` query (distinct positive-balance owners + signature-deduped settled receipts), and an idempotent seed that sets/backfills the demo mint.
- `app/app/property/[id]/proof/proof.helpers.ts` (new) — pure helpers: `SOLANA_CLUSTER` (env-overridable), `truncateAddress`, `explorerAddressUrl`, `explorerTxUrl`, `holderSummary`.
- `app/app/property/[id]/proof/proof.helpers.test.ts` (new) — 9 vitest cases across the I/O & Edge-Case Matrix.
- `app/app/property/[id]/proof/page.tsx` (new) — the client proof view with all five facets, honest empty/pending states, loading/not-found guards, and a back link.
- `app/app/property/[id]/page.tsx` — added the low-weight "See the on-chain proof" affordance after the Facts block; Invest CTA untouched and un-gated.
- `app/app/globals.css` — added `.proof-link` and `.proof-*` view styles (tokens only; passes `check:tokens`).

**Review findings breakdown:** 6 patches applied (2 medium: proof-intro over-claim reworded, `holderCount` now distinct positive-balance owners; 4 low: dead `mintStateLabel` + tests removed, receipts signature-deduped and redundant client filter dropped, `SOLANA_CLUSTER` made env-overridable). 3 deferred to `deferred-work.md` (client-only proof route with no SSR/metadata; seed idempotency breaks once Monroe leaves "open"; malformed route id throws instead of graceful not-found — the latter two pre-existing/app-wide). 5 rejected (unused-but-spec'd `status` return field; Token ACL copy is spec-intended structural policy; inert aria-hidden `↗` matches the detail-page header; demo-data truncation collision is cosmetic; base58 is URL-safe so `encodeURIComponent` adds nothing).

**Follow-up review recommended:** false — the patches were localized and low-complexity; the two medium fixes (a copy reword and a distinct-owner count that doesn't change output on the current empty-holdings seed) are simple and fully re-verified green.

**Verification:** `npx tsc --noEmit` clean; `npm test` 32 passed (proof helpers 9/9 after removing the 2 dead-code tests); `npm run check:tokens` clean; `npm run build` succeeds with `/property/[id]/proof` generated. `npm run lint` not run — the repo has no ESLint config (pre-existing condition, untouched).

**Residual risks:** The deferred items only manifest outside current data/paths (a non-"open" Monroe, a hand-crafted bad URL, or a share/unfurl use case). The demo mint's explorer link resolves to an empty account until a real token is anchored — the intro copy now states facts are "verifiable as the offering settles" rather than claiming they already mirror the ledger, keeping the honesty posture intact. Holder/receipt facets remain honest-empty until real settlement flows through the reconcile harness.
