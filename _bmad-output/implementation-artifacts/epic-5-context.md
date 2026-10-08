# Epic 5 Context: Earn & Trust

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver the retention half of the north-star: once an investor owns a share, they get paid, understand exactly what they were paid and why, and trust the operator through consistent communication. This epic builds the post-purchase surfaces (Home, Portfolio, Income, Property Updates) that turn a one-time buyer into a confident long-term owner. It makes distributions feel tangible ("Rent just landed"), makes income fully legible (gross → net, matched against target), surfaces concentration risk honestly, and guarantees a monthly operator update even in quiet months so silence never erodes trust. It reads from data produced by the invest flow (Epic 4) and the on-chain distribution ledger.

## Stories

- Story 5.1: Home — the payout is the hero
- Story 5.2: Portfolio + concentration honesty
- Story 5.3: Income breakdown + matches-target
- Story 5.4: Monthly property update (even quiet ones)

## Requirements & Constraints

- **Home hero:** When a fresh distribution exists, surface it prominently ("Rent just landed +$X") alongside portfolio value, all-time return (signed), income-to-date, and a balance sparkline. When no fresh distribution exists, show the next-distribution date instead.
- **Portfolio:** Show per-holding value and this-month income plus allocation-by-market. When any single market exceeds 35% of allocation, display a calm warning and diversify nudge — never hide the concentration.
- **Income legibility:** Each distribution itemizes gross rent → costs → management fee → reserve → net paid (in USDC), confirms whether it matches the target yield, and shows history plus the next distribution date. A missed or paused distribution must explain why and link to the relevant update — never silent.
- **Monthly updates:** Every owned property gets a monthly update from a named operator (occupancy, reserves, rent-on-time, plain note), including uneventful months. A scheduled function must flag any property overdue for an update.
- **Audit/reconciliation (cross-cutting):** Any money/ownership/eligibility change writes an immutable AuditLog entry; the read model is reconciled to chain and chain wins on conflict.
- **Performance/accessibility:** Mobile-first PWA targets (LCP < 2.5s, INP < 200ms, CLS < 0.1 — money must not shift on load). WCAG 2.2 AA: focus states, labels, 44px targets, tabular numerals, and a text-equivalent for the sparkline.
- **No crypto vocabulary** (wallet/gas/tx/mint) anywhere in these consumer surfaces; amounts shown in dollars/USDC, on-chain terms only inside a pull-only proof view.

## Technical Decisions

- **On-chain-authoritative reads:** Solana is the source of truth for ownership, balances, and distributions. These screens read Convex as the reactive mirror; Convex never self-settles or holds authoritative ownership.
- **Distribution data flow:** Distributions are recorded on an on-chain distribution ledger (Anchor) and mirrored into Convex `IncomeLedger`. Income screens read from the mirror; the mirror is kept honest by Helius webhooks → Convex HTTP actions, with chain winning on any conflict.
- **Reactive substrate:** Next.js App Router (Vercel) + Convex reactive queries + Privy auth (JWT trusted by Convex). Home/Portfolio/Income update live via Convex subscriptions.
- **Relevant seed entities:** `Holding`, `IncomeLedger`, `Distribution`, `PropertyUpdate`, `Property`, `AuditLog` (defined and seeded in Epic 1; The Monroe seed exists for downstream screens). Exact schema field shapes are owned by the code.
- **Scheduled functions:** Convex scheduled functions drive the overdue-update flag (5.4) and can back next-distribution-date logic.
- **Design tokens as code:** All UI inherits the design-system theme layer (Fraunces + Inter self-hosted, indigo/champagne palette, tabular numerals, light/dark flip). Components may not hardcode non-token colors; one champagne accent per screen.

## UX & Interaction Patterns

- **Dusk card + champagne star** treatment for the fresh-distribution Home hero; the payout is the single focal moment of the screen.
- **Signed gain/loss:** all returns and changes shown with an explicit sign and gain/loss color; money rendered in tabular figures so digits never shift.
- **Honesty over concealment:** the >35% concentration warning and any missed/paused distribution explanation are always shown with a calm, non-alarming voice and a constructive next step (diversify nudge, link to the update).
- **Build to the DD-002 ("Getting Paid") prototype and the scenario specs**; the design system is the single source of visual truth.

## Cross-Story Dependencies

- **Depends on Epic 4 data existing:** these screens render real holdings, orders, and distributions produced by the invest/settlement flow. Build against Epic 1 seed data (The Monroe) until Epic 4 output is available.
- **Depends on Epic 1 foundation:** reactive backbone (5.1–5.4), design tokens (all stories), on-chain reconciliation harness feeding `IncomeLedger` (5.1, 5.3), and core schema/seed.
- **5.3 links to 5.4:** a missed/paused distribution in Income must link to the corresponding monthly property update.
- **No new external blockers:** the readiness assessment marks E5 as GO; its open items are upstream (escrow/ownership-basis in E3/E4), not within these stories.
