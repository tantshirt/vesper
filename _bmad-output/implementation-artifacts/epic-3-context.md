# Epic 3 Context: Onboard & Fund

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Convert a visitor's intent to invest into a funded, legally eligible account — with the crypto entirely invisible. This epic bridges the public read path (Epic 2) and the write/settlement path (Epic 4) by standing up three things: passkey account creation with a silently pre-generated self-custodial Solana wallet, identity verification plus Reg A+ eligibility gating that Token ACL can enforce on-chain, and a fiat-like funding flow that turns card/ACH dollars into USDC. It matters because it is the compliance and money-in gate for the entire product: no investment can settle without an eligible, funded account, and every part of it must respect the "no crypto vocabulary in the consumer path" boundary.

## Stories

- Story 3.1: Passkey signup + embedded wallet
- Story 3.2: KYC + Reg A+ eligibility
- Story 3.3: Add money (fiat → USDC)

## Requirements & Constraints

- Signup uses Privy passkey/social; an embedded self-custodial Solana wallet is pre-generated invisibly, with no seed phrases surfaced. After signup the user is returned to their exact place in the invest flow.
- KYC (via Persona) is required at the confirm-investment step — not for browsing or saving. On completion, eligibility is recorded in Convex and must be reflected in the on-chain Token ACL so ineligible accounts cannot receive tokens.
- Reg A+ per-investor investment limit replaces accreditation checks; it is computed and shown calmly as information, not as a blocking wall. Jurisdiction/eligibility gates apply to every buy.
- Restricted-jurisdiction / eligibility failure must present a calm explainer plus a waitlist path — never a dead-end.
- Funding accepts card/ACH (via Privy + Bridge), converts to USDC behind a fiat-like flow, and shows all amounts in dollars.
- No crypto vocabulary (wallet, gas, tx, mint) may appear anywhere in these flows; the wallet stays abstracted. Mobile-first PWA performance and WCAG 2.2 AA targets (focus, labels, 44px touch targets, tabular numerals) apply as they do across the app.

## Technical Decisions

- Consumer surface auth is Privy; the Privy-issued JWT is trusted by Convex via `customJwt`, and the authenticated user resolves in a reactive Convex query. (Scaffolding for this lands in Epic 1; Epic 3 builds on it.)
- Eligibility is authoritative in Convex but enforced on-chain by the Token ACL (Token-2022, frozen-by-default; eligibility gates self-thaw). Recording eligibility in Convex is not sufficient — it must propagate to the on-chain ACL for that account.
- Every eligibility/KYC state change writes an immutable AuditLog entry (actor, action, target, timestamp), consistent with the platform-wide state-change discipline.
- Relevant core Convex entities: User and Eligibility (field shapes owned by code / the DD YAMLs, not fixed here).
- Convex holds intent and entitlement only; it never holds authoritative ownership or self-settles. Funding produces USDC balance available to the later DvP settlement, but token delivery itself is Epic 4.
- Vendors to wire (verify terms at build/contract time): Persona (KYC), Privy + Bridge (fiat on-ramp). AML screening (ComplyAdvantage/TRM) sits in the same compliance surface.

## UX & Interaction Patterns

- The whole onboarding experience must feel fiat-native and reassuring: signup is a passkey tap, funding shows dollars, and the wallet is never mentioned. This "consumer boundary hides crypto" rule is a hard invariant, not a preference.
- Eligibility limits and failures are communicated calmly and informationally — a shown per-investor cap, a jurisdiction explainer with a waitlist — never framed as a wall or dead-end.
- Signup is triggered from an unauthenticated "Invest" tap and must return the user to their prior position in the flow, preserving continuity into Epic 4.
- All visual styling inherits the design-system tokens (Fraunces + Inter, indigo/champagne, tabular money figures); components must not invent alternates.

## Cross-Story Dependencies

- Depends on Epic 1: the Privy↔Convex auth backbone (Story 1.1), the design-system tokens (Story 1.2), and the core schema/seed (Story 1.4) must exist first.
- Feeds Epic 4 (Invest): an eligible, funded account with Token-ACL entitlement is the precondition for atomic DvP settlement (Story 4.4); confirm-investment is where KYC (Story 3.2) is gated.
- Sequenced after Epic 2 in the overall build order (E1 → E2 → E3 → E4 → E5).
- Blocking open decision (B1): the escrow / fund-custody vendor is unresolved and blocks Story 3.3 (add money). Stories 3.1 and 3.2 are ready to build now. Recommended approach: stub the escrow/settlement boundary behind an interface so the funding UI and Convex shells build against a mock, then swap in the real vendor when B1 lands.
