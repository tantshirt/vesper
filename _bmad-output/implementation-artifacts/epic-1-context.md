# Epic 1 Context: Platform Foundation & Design System

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up the reactive substrate and the visual system that every later epic inherits: authenticated reactive data flow, on-chain-authoritative reconciliation, an immutable audit trail, the core data entities with realistic seed data, and the brand design tokens as code. This epic delivers no user-facing flow on its own, but it de-risks all of them — later stories must never re-decide auth, data ownership, reconciliation direction, or visual tokens. It is the first epic in sequence (E1 → E2 → … → E5) and has no upstream blockers, so it should be built immediately.

## Stories

- Story 1.1: Reactive backbone (Next.js + Convex + Privy)
- Story 1.2: Design system tokens as code
- Story 1.3: On-chain reconciliation harness
- Story 1.4: Core schema & seed

## Requirements & Constraints

- **Reactive auth end-to-end:** A user signing in with a Privy passkey/social login receives a Privy JWT that Convex trusts (via `customJwt`) and resolves to a user inside a reactive query. Privy also pre-generates an embedded self-custodial Solana wallet, but that wallet must stay abstracted — no crypto vocabulary (wallet/gas/tx/mint) crosses into the consumer surface.
- **Immutable audit trail:** Every backend mutation touching money, ownership, eligibility, or diligence must, on commit, write an append-only `AuditLog` entry recording actor, action, target, and timestamp. No state change of these kinds may bypass it.
- **Chain-wins reconciliation:** On any Convex↔chain conflict, chain state is authoritative and the discrepancy is logged. Convex is a read model / entitlement authority only; it may hold intent (pending orders) and entitlement (eligibility) but never authoritative ownership, and it must never self-settle.
- **Design tokens are the single source of visual truth:** Fraunces + Inter self-hosted as variable fonts (with optical sizing), the full color/spacing/radius token set, tabular numerals for all money and data, and a light/dark flip (midnight becomes the field) must all be available as tokens. Components may not hardcode non-token colors — this is enforceable in review.
- **Seed realism:** Seeding must produce at least "The Monroe" property with 8 signed diligence gates, occupancy, and reserves, so downstream read screens (E2+) build against realistic data.
- **Performance & accessibility budgets** (inherited by every UI story): mobile-first PWA, LCP < 2.5s, INP < 200ms, CLS < 0.1 (money must not shift layout); WCAG 2.2 AA (visible focus, labels, 44px targets, tabular numerals, text-equivalents for sparklines).

## Technical Decisions

- **Paradigm:** Reactive full-stack with on-chain-authoritative settlement. Convex is the reactive entitlement authority and read model (queries, scheduled functions, HTTP actions, audit, vector search). Solana is the source of truth for ownership and settlement.
- **Locked stack:** Next.js App Router on Vercel · Convex · Privy (consumer auth) · Anchor/Rust · Token-2022 + Token ACL · USDC + Anchor DvP · Pyth (market context only) · Helius (reconciliation) · Vercel AI Gateway. The consumer app and the admin/sponsor portal are separate applications sharing one Convex deployment; neither surface's auth leaks into the other.
- **Reconciliation mechanism:** On-chain events (mint, transfer, distribution) arrive via Helius webhooks calling a Convex HTTP action, which updates the Convex mirror. Distributions live on an on-chain ledger (Anchor) mirrored into Convex `IncomeLedger`.
- **Core Convex entities to define/seed:** User, Property, DiligenceGate, Order, Holding, Eligibility, IncomeLedger, Distribution, PropertyUpdate, AuditLog. Field types and exact schema shapes are owned by the code (deferred, not fixed in planning) — DD-001/DD-002 yamls carry the reference shape.
- **Data authority map:** token balances → on-chain (Convex mirrors); orders → Convex intent, on-chain DvP confirms; eligibility/KYC/Reg A+ cap → Convex, enforced on-chain by Token ACL; diligence gates + human signature → Convex (+ document hashes on-chain); income/distributions → on-chain ledger → Convex; audit log → Convex append-only.
- **Design token specifics:** light-first ground `#FBFBFD`, ink `#14142B`, indigo accent `#3F3D9E` (variants `#4A47B5`, `#1E1B4B`), champagne `#E8C88C` as a small accent only (never a fill). Semantic gain `#2E9E6B` always paired with `+`/arrow, loss `#C4553D` always with `−`/arrow. Fraunces for display/headings/property names (variable, `opsz` 60→144, negative tracking); Inter for UI/body/all numbers with `font-variant-numeric:tabular-nums` on money; monospace uppercase eyebrows in accent color. Dusk hero gradient and a dark-mode flip are defined via `prefers-color-scheme` plus a `data-theme` override. Fonts must be self-hosted in production (embedded as woff2 data-URI inside any self-contained artifact, since CSP blocks font CDNs).

## UX & Interaction Patterns

- Focus-visible is a 2px accent outline at 2px offset; all motion respects `prefers-reduced-motion`.
- Voice is warm, calm, literary — never hype. Ownership is always framed as a legal share / monthly rent / a share of the upside plus an honest downside floor; never "guaranteed yield" or "instant exit." This voice and the token rules are the substrate every later screen inherits.

## Cross-Story Dependencies

- Story 1.4 (schema & seed) gates the entire E2 read path and all downstream data screens (E2–E5 build against the seeded Monroe).
- Story 1.1 (Privy + Convex auth) is shared with E3.1 (signup/onboarding) — the embedded-wallet generation established here is reused there.
- Story 1.3 (Helius reconciliation harness) underpins settlement (E4) and income/distribution surfaces (E5), which depend on the chain-wins mirror being in place.
- The design tokens (Story 1.2) are a hard prerequisite for every UI story in E2–E5.
