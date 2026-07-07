# Vesper — Design Log

Central memory for the WDS design process. Newest entries at top of each table.

## Current

| Date | Phase | Task | Owner | Status |
| --- | --- | --- | --- | --- |
| 2026-07-07 | 2 · Design Delivery (DD) | DD-001 + DD-002 packaged + handoff README for dev | Freya | ✓ |
| 2026-07-07 | 2 · Design — Scenario 02 FLOW | All 4 screens (Home/Portfolio/Income/Updates) speccd + clickable prototype | Freya | ✓ |
| 2026-07-07 | 2 · Design — Scenario 01 FLOW | All 6 screens (01.1→01.8) speccd + one clickable end-to-end prototype | Freya | ✓ |
| 2026-07-07 | 2 · Design — Calculator (01.6) | Spec + live visual prototype (in-brand) | Freya | ✓ |
| 2026-07-07 | 2 · Design System | Extracted brand tokens → D-Design-System/00-design-system.md | Freya | ✓ |
| 2026-07-07 | 2 · Design — Visual Design | Property Detail v2 — rebuilt to match Brand Direction Brief exactly (real Fraunces+Inter embedded) | Freya | ✓ v2 |
| 2026-07-07 | 2 · Design — Conceptual Specs | Property Detail specified; more screens next | Freya | ⏳ in progress |
| 2026-07-07 | 2 · Design — Outline Scenarios | 6 scenarios, 17/17 views covered | Freya | ✓ complete |
| 2026-07-07 | 1 · Platform Requirements | Tech boundaries from v5 §0/§7/§8/§12 | Saga | ✓ complete |
| 2026-07-07 | 1 · Trigger Map | Personas + driving forces + feature-impact scoring | Saga | ✓ complete |
| 2026-07-07 | 1 · Product Brief | Draft brief + both decisions resolved | Saga | ✓ complete |

## Backlog

| Priority | Phase | Task |
| --- | --- | --- |
| Next | 1 · Platform Requirements | Technical boundaries doc (mostly derivable from v5 §7) — optional, can skip to Freya |
| Then | 2 · Design | Hand off to Freya — Outline Scenarios → Specs → Visual Design |
| Watch | Scope | COULD-tier deferred: tax center, auto-reinvest, external wallet, neighborhood explainers — do not silently pull into MVP |

## Decisions

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-07 | **Jurisdiction = US Reg A+ (retail)** | Preserves the low-minimum, "anyone can own" vision and all 4 personas; accepts SEC qualification + ongoing reporting cost |
| 2026-07-07 | **Revenue = platform + management + secondary + sponsor-listing fees** | All levers in scope; sponsor-listing fee ring-fenced from diligence to protect verified-supply integrity |
| 2026-07-07 | Brief level = **complete, accelerated** | v5 master brief + brand assets already carry most strategic content; pre-fill and confirm rather than cold-interview |
| 2026-07-07 | Treat *Vesper Brief v5* as source-of-truth input | Single source of truth per its own header; brief derives from it |

## BMad Method — Implementation started

**2026-07-07 — IR → SP → E1.1 built.**
- **Readiness (IR)** → `planning-artifacts/readiness-report.md` — 🟡 CONDITIONAL GO. Full FR/NFR traceability, no orphans; 4 blockers (B1 escrow, B2 ownership-% basis, B3 Reg A+ marketing, B4 gate labels) gate specific stories, not the start.
- **Sprint Planning (SP)** → `implementation-artifacts/sprint-status.yaml` — 20 stories sequenced E1→E5; E1.1 in build, blockers annotated. Sprint-1 goal: E1 + E2 read-path against seed.
- **E1.1 Reactive backbone** → built in `app/` (Next.js 15 + Convex 1.42 + Privy 2.25). Privy→Convex customJwt auth, reactive `currentUser`, append-only `auditLog`, embedded Solana wallet, The Monroe seed (8 human-signed gates), design tokens as CSS. Install ✅ (exit 0), static typecheck clean (only pre-codegen `_generated` errors remain). Story: `implementation-artifacts/stories/1-1-reactive-backbone.md`. Runtime verify pending human Convex/Privy login.

**2026-07-07 (cont.) — Convex live + E2.1 built.**
- Convex **local deployment live** — schema + 12 indexes deployed, functions ready; `PRIVY_APP_ID` set; The Monroe seeded (via `properties:seedTheMonroe`), `listOpen` returns it. E1.1 + E1.4 = **done**.
- **E2.1 Explore** built (`app/app/explore/`) — public listing wired to `listOpen`, rendered in D-Design-System tokens (dusk cards, funding bar, yield pill, tags) matching the DD-001 prototype. `tsc` clean, `next build` ✅ (all routes). Status: review (visual eyeball pending). Cards link to `/property/[id]` = **E2.2 next**.
- ⚠️ Privy App Secret was pasted in chat → advised user to rotate (not needed by our JWKS-based verification).

## BMad Method Bridge (Solutioning)

**2026-07-07 — Transitioned WDS design → BMad Method build pipeline**, using the WDS output as the design foundation.
- **Architecture spine** → `planning-artifacts/architecture.md` — 7 invariants (paradigm: reactive full-stack, on-chain-authoritative; two surfaces/one backend; atomic DvP; AI never approves; compliance structural; crypto hidden; design system fixed) + data-ownership table + seed + open decisions. Fast-path draft (v5 + design foundation), `[ASSUMPTION]` tags to confirm.
- **Epics & Stories** → `planning-artifacts/epics-and-stories.md` — 5 epics / 20 stories with Given/When/Then AC, derived from DD-001/DD-002 + architecture. E1 Foundation+Design System · E2 Discover · E3 Onboard+Fund · E4 Invest · E5 Earn+Trust. FR/NFR/UX inventory + coverage map.
- **Next BMad Method:** Check Implementation Readiness (IR) → Sprint Planning (SP) → Create Story (CS) → Dev Story (DS). The design foundation (D-Design-System + prototypes + DD contracts) is the UX input throughout.

## Design Loop Status

**Phase 1 · Product Brief — COMPLETE.** Both decisions (jurisdiction, revenue model) resolved.
**Phase 2 · Trigger Map — COMPLETE.** Vision → 5 SMART objectives → 4 prioritized personas (P1→P4→P3→P2) → positive/negative driving forces → Must/Should/Could focus statement → feature-impact scoring. Core insight: all personas' strongest fears reduce to *"Is it real? · Will I get paid? · Can I get out?"* → the trust quartet (Liquidity Box, Diligence Gates, Calculator, Yield Breakdown) tops the feature ranking.
**Phase 1 · Platform Requirements — COMPLETE.** Tech boundaries + integrations + UX constraints from v5. Flagged: Reg A+ forces investment-limit enforcement in place of accreditation checks; escrow/custody vendor still open.

**PHASE 1 STRATEGY — DONE.** All of Saga's work complete (Brief · Trigger Map · Platform Requirements).
**Phase 2 · Outline Scenarios — COMPLETE (Freya).** 6 sunshine-path scenarios, one per priority persona, 17/17 consumer views covered.
**Phase 2 · Conceptual Specs — IN PROGRESS.** Signature **Property Detail (01.2)** fully specified: hero + champagne headline metric, What-You-Own card, yield breakdown, honest Liquidity Reality Box, layered risk cards, human-signed Trust Stack (Gates 0–7), on-chain-proof-on-demand entry, sticky invest bar. Provisional design tokens seeded inline from Brand Direction Brief (promote to D-Design-System when built). 4 open questions flagged (Reg A+ public solicitation, KYC ordering, escrow display, gate labels).
**Phase 2 · Visual Design — Property Detail v1 (HTML prototype).** Rendered in Vesper's own identity: indigo dusk hero with a single champagne lit-window (the one "evening star"), Fraunces headings / Inter tabular data, both light + dark themes (dark = midnight field per brief). Interactive: expandable What-You-Own waterfall + risk cards + signed gates, honest Liquidity Box (no "Sell now"), provable-on-demand links low-weight. Artifact: https://claude.ai/code/artifact/dda7bb14-c0c0-4d05-a403-f57c0a9b63e7

### Progress
### 2026-07-07 — Visual Design: Property Detail (01.2) — v1 then **v2 rebuilt to the Brand Direction Brief**.

**v2 (canonical):** user confirmed the Brand Direction Brief is the exact intended direction. Rebuilt Property Detail to match `Vesper Landing.dc.html` precisely — real Fraunces + Inter embedded as woff2 data-URIs (CSP blocks CDNs), monospace eyebrows, #3F3D9E on #FBFBFD, #F4F3FC chips + tag pills, dusk hero + glass pill, 01/02/03 ownership framing, FAQ "+"→"×", user's real copy (The Monroe, "rent paid overnight +$3.42"). Tokens extracted into **D-Design-System/00-design-system.md** — the standing reference for ALL future screens.
Prototype (same URL, redeployed): https://claude.ai/code/artifact/dda7bb14-c0c0-4d05-a403-f57c0a9b63e7

**Resolved v1 deviation:** champagne stays a small accent (chip dot / lit window), never a fill — matches the brief's actual applied restraint. Invest CTA = solid indigo.

### 2026-07-07 — Visual Design: **Scenario 01 complete, end-to-end clickable flow.**
All six S1 screens specced and built into ONE navigable prototype — Explore (01.1) → Property Detail (01.2) → Set up & fund (01.3–05) → Calculator (01.6) → Rights & risks (01.7) → Confirmation (01.8, "You're an owner"). Amount carries live from calculator through rights to the receipt; acknowledgement gate enforces 3 checks before atomic-DvP settle; step rail + tap-through nav. Entirely in D-Design-System tokens (real Fraunces+Inter embedded).
**Flow prototype:** https://claude.ai/code/artifact/37470475-5e16-4689-8830-1b45b817eb4a
Standalone screens: Property Detail https://claude.ai/code/artifact/dda7bb14-c0c0-4d05-a403-f57c0a9b63e7 · Calculator https://claude.ai/code/artifact/4cb09cf9-ea6c-4f1d-a20c-79142d7262f7

### 2026-07-07 — Visual Design: **Scenario 02 complete (getting paid).**
Four screens specced + built into a clickable flow — Home (payout hero "+$3.42 rent just landed" with champagne star + balance sparkline) → Portfolio (allocation + honest 71% concentration warning) → Income (July breakdown → "matches your 6.2% target" = O3 comprehension) → Updates (monthly operator note, boring-is-good, anti-RealT). Same D-Design-System tokens + embedded fonts.
**Flow prototype:** https://claude.ai/code/artifact/fe2f5c4b-adb9-4b29-b0d8-8a52061720c4

**North-star arc now complete as demos:** S1 (invest & understand) + S2 (get paid & trust) = "funded users who receive AND understand their first payout."

### 2026-07-07 — Design Delivery: **DD-001 + DD-002 packaged for development.**
`E-Development/` now holds: **00-handoff.md** (dev entry point — build order, stack, open decisions), **DD-001-first-investment.yaml** (Scenario 01 contract: data models, acceptance criteria, edge cases, testing), **DD-002-getting-paid.yaml** (Scenario 02 contract). Design→dev bridge complete for the north-star arc; developers can build DD-001 read path → write path → DD-002 in order.

**MVP core design = DELIVERED.** Remaining/optional: S4 on-chain-proof view (Kai) · S5 Learn · S6 secondary sell · S3 (mostly reuses DD-002) · admin/sponsor + AI-diligence (separate track) · visual polish (photography, motion). 5 open decisions block parts of the build (escrow vendor, ownership-% basis, Reg A+ marketing limits, gate labels, sponsor-fee independence).

**Next spec candidates:** 01.6 Calculator/order-preview · 01.8 Confirmation/rights-summary · 01.1 Explore · 02.3 Income/distributions.

### Open decisions carried into design
- Escrow / fund-custody vendor (blocks Investment Flow money-movement design)
- Post-launch maintenance owner
- Reg A+ per-investor limit enforcement — confirm with counsel
