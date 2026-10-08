# Epic 2 Context: Discover & Understand a Property

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 2 builds the public, no-auth trust surface — the screens that let a visitor answer "is it real / where's the return / can I get out?" before ever signing up. It is the read path of the First Investment flow (DD-001) and the place where conversion and comprehension are won. Everything here must render for an unauthenticated visitor against seeded data (The Monroe), require zero KYC to browse, and hold the trust posture that makes the later invest flow credible: honest liquidity, layered risk, human-signed diligence, and crypto-verifiability available on demand but never in the way.

## Stories

- Story 2.1: Explore listing (public)
- Story 2.2: Property Detail — the trust quartet
- Story 2.3: Trust Stack (human-signed gates)
- Story 2.4: On-chain proof (provable on demand)

## Requirements & Constraints

- Explore and Property Detail are fully public: no auth, no KYC to browse. Nothing in this epic may gate reading behind signup.
- Explore shows property cards for open offerings: dusk thumbnail, funding %, target yield, tags, and a funding progress bar.
- Property Detail must present the full trust quartet: (1) the What-You-Own ownership chain (tokens → SPV → cash-flow → exit → waterfall); (2) a yield breakdown separating rent vs appreciation with fees itemized; (3) an honest Liquidity Reality Box (bids, last sale, estimated exit, spread, lockup); (4) layered risk cards.
- The Liquidity box must be honest by construction: no "Sell now" CTA, no instant-exit language.
- The Trust Stack shows Gates 0–7, each with passed status, a named human signer, and a date. No gate may ever be attributed to an AI — a human signs every gate.
- On-chain proof is reachable on demand via a low-weight affordance ("See the on-chain proof") exposing mint, holder view, DvP receipts, Token ACL disclosure, and explorer links. It is never required to browse or invest.
- Reg A+ solicitation constraints apply to all public/pre-auth offering content: only counsel-approved fields may render before auth.
- No crypto vocabulary (wallet, gas, tx, mint) anywhere in the consumer path — on-chain terms live only inside the proof view.
- Performance/accessibility budgets apply: mobile-first PWA, LCP < 2.5s, INP < 200ms, CLS < 0.1 (money must not shift), WCAG 2.2 AA (focus, labels, 44px targets, tabular numerals, sparkline text-equivalents).

## Technical Decisions

- Data comes from Convex as the reactive read model, mirrored from chain via Helius; on-chain always wins on conflict. Property Detail and Trust Stack read seeded entities — Property, DiligenceGate — with The Monroe already seeded with 8 signed gates, occupancy, and reserves.
- Convex is a mirror only: this epic renders entitlement/metadata, never authoritative ownership or settlement.
- Diligence gates are AI-assisted but human-signed; gate signatures live in Convex with document hashes anchored on-chain. There is no code path where an AI writes an approval or signature — the UI must reflect a named human signer for every gate.
- On-chain proof surfaces read-only chain facts (mint, holders, DvP receipts, Token ACL) — a pull affordance, not part of the primary render.
- The design system (`D-Design-System/00-design-system.md`, from the Brand Direction Brief) is the single source of visual truth and the only source of color/type/spacing tokens: Fraunces + Inter, indigo/champagne, one champagne accent per screen, tabular money, gain/loss always paired with a sign, monospace eyebrows, light/dark (midnight) flip. Components may not hardcode non-token colors.

## UX & Interaction Patterns

- Invisible-by-default / provable-on-demand layering: the primary Property Detail path reads clean and non-technical; verification (on-chain proof) is a deliberate, low-weight pull, never cluttering the main flow.
- Build to the DD-001 clickable prototype and the relevant scenario specs for these screens.
- Trust posture is expressed through honesty, not persuasion: surface real liquidity limits, layered risk, and named human accountability rather than reassurance copy or exit CTAs.

## Cross-Story Dependencies

- Depends on Epic 1: the reactive backbone (2.1 depends on 1.1), design tokens (1.2), reconciliation harness for chain-mirrored data (1.3), and core schema + The Monroe seed (1.4). Epic 2 is demoable earliest against that seed.
- Open decisions to resolve before the affected stories leave "ready": Reg A+ pre-auth marketing limits gate the public-content extent of 2.1 and 2.2; consumer-visible Gate 0–7 labels gate the Trust Stack copy in 2.3.
- Epic 2 is the read half of DD-001; the invest write path (Epic 4) continues directly from Property Detail.
