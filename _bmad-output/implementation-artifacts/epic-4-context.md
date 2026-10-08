# Epic 4 Context: Invest

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 4 is the write path of the investment flow (DD-001): the screens where money actually moves. An eligible, funded investor models an amount, sees the full cost with no surprises, actively acknowledges the risks, settles atomically on-chain, and lands on a confirmation that proves they now own a share. It matters because this is the moment intent becomes ownership — it must be legally sound (active consent, per-investor limits), financially exact (live projections, transparent fees), and structurally safe (payment and token delivery settle together or not at all). Comprehension and trust (north-star O3) are won or lost here.

## Stories

- Story 4.1: Calculator & live projection
- Story 4.2: Order preview & fee transparency
- Story 4.3: Rights & risk acknowledgement
- Story 4.4: Atomic DvP settlement
- Story 4.5: Confirmation ("You're an owner")

## Requirements & Constraints

- Calculator recomputes live on every amount change (input, slider, or chip): ownership %, estimated monthly income, and first-year base figure, all in tabular figures. Minimum investment is $50, enforced with an inline hint and the CTA disabled below it.
- The projection has a Downside toggle: when on, the first-year figure shows the −12% case rendered in loss color with an explicit "−" sign.
- Order preview must show, before Confirm: the investment amount, the one-time **0.9% platform fee**, and the total charged today. It must also note that the annual management fee is **already inside the quoted 6.2% net yield** and is never re-charged (no double-charging).
- Risk acknowledgement requires **three checkboxes, all actively checked**, before Confirm enables. Fewer than three → Confirm disabled.
- Settlement is **atomic DvP**: USDC payment and token delivery settle together or the entire order fails with nothing charged. On any failure, an audit entry is written. An ineligible account must be blocked from receiving tokens on-chain (not just in UI).
- Confirmation must state the investor's exact ownership %, the first-distribution date, and a DvP receipt reference, plus links to portfolio and the on-chain proof view.
- No crypto vocabulary (wallet/gas/tx/mint) in any consumer-facing copy; on-chain terms live only inside the pull-only proof view.
- Performance/accessibility bar: money must never visually shift (CLS < 0.1), tabular numerals, 44px targets, WCAG 2.2 AA.

**Blocking open decisions (must resolve before these stories leave "ready-for-dev"):**
- **B1 — Escrow / fund-custody vendor** (High): blocks Story 4.4 (DvP money movement). Build the settlement UI + Convex shells against a stubbed escrow/DvP interface and swap in the real vendor when B1 lands.
- **B2 — Ownership-% basis** (appraisal vs raise vs share count, High): blocks Stories 4.1 and 4.5 (calculator and confirmation math). Build the calculator UI, but the ownership-% formula cannot be finalized until B2 resolves.

## Technical Decisions

- **On-chain is authoritative; Convex never self-settles.** Convex holds order *intent* (pending → settled/failed) and *entitlement* (eligibility), never authoritative ownership. No path may mark an order settled without the on-chain DvP confirming.
- **Atomic DvP is an Anchor program** using USDC + Token-2022. Payment and token delivery are one atomic transaction (I2).
- **Token ACL, frozen-by-default:** eligibility gates self-thaw; an ineligible account cannot receive tokens on-chain. Reg A+ per-investor limit and KYC (from Epic 3) are the on-chain-enforced eligibility inputs (I5).
- **AuditLog is mandatory** on every money/ownership/eligibility state change, including failed settlements (actor, action, target, timestamp) — append-only in Convex.
- **Helius reconciliation:** on any Convex↔chain drift, chain wins; discrepancies are logged. The confirmation read model mirrors chain state, not the reverse.
- Relevant Convex entities (shapes owned by code / DD yamls): Order, Holding, Eligibility, plus AuditLog. Distributions/IncomeLedger are downstream (Epic 5) but the first-distribution date shown on confirmation derives from Property/offering data.
- **Recommended build order for blocked work:** stub the escrow/settlement boundary behind an interface so 4.1/4.4 UI + Convex shells build against a mock now, swapping real DvP in when B1/B2 resolve.

## UX & Interaction Patterns

- Build to the **DD-001 clickable prototype** and the 6 scenario specs; the design system (`D-Design-System/00-design-system.md`) is the single source of visual truth — Fraunces + Inter, indigo/champagne, one champagne accent per screen, tabular money, gain/loss always paired with an explicit sign, monospace eyebrows.
- Live recompute must feel instant and stable — figures update without layout shift.
- Confirmation is a celebratory "You're an owner" moment (champagne accent), but stays factual: exact ownership %, first-distribution date, receipt reference.
- On-chain proof is a low-weight *pull* affordance from confirmation, never forced into the primary path.

## Cross-Story Dependencies

- **Upstream (Epic 3):** investor must be authenticated (Privy passkey + embedded wallet), KYC-verified with Reg A+ eligibility recorded and reflected in Token ACL, and funded in USDC. Story 4.4 depends on this eligibility to allow token receipt.
- **Upstream (Epic 1):** reactive backbone (Convex + Privy JWT), design tokens, AuditLog, and Helius reconciliation harness must exist; seed data (e.g. The Monroe) provides the property being invested in.
- **Within Epic 4:** 4.1 → 4.2 → 4.3 → 4.4 → 4.5 is a linear flow; each step gates the next (Confirm in 4.3 triggers 4.4; 4.4 success renders 4.5).
- **Downstream (Epic 5):** the Holding, first-distribution date, and ownership % produced here feed Home, Portfolio, and Income surfaces.
