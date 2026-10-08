# Production Hardening Agent Plan

**Status:** In progress  
**Baseline:** `a90ec2d`  
**Contract:** `spec-production-hardening.md`

This plan sequences production hardening by trust boundary. Each story has a bounded owner, an adversarial reviewer, and focused verification. Protocol and chain evidence land before any client journey can be considered complete.

## Execution Order

| Story | Primary owner | Review sub-agent | Depends on | Completion evidence |
|---|---|---|---|---|
| P1 Protocol invariants | Solana/Rust worker | Protocol edge-case hunter | None | Quasar build, Rust unit tests, LiteSVM runtime tests, ABI parity |
| P2 Chain evidence | Reconciliation worker | Transaction adversarial reviewer | P1 ABI | Exact instruction/event validation, failed-transaction rejection, idempotency tests |
| P3 Entitlement projection | Identity/eligibility worker | Security reviewer | P1, P2 schema | Signed wallet ownership, durable outbox, retry and reconciliation tests |
| P4 Mint/distribution durability | Custody state-machine worker | Concurrency reviewer | P2 schema | Intent-before-effect, idempotency keys, unknown-state recovery, exact payout tests |
| P5 Real purchase journey | Consumer transaction worker | UX + transaction reviewer | P1-P3 | Signed transaction path, durable pending state, ambiguous-outcome recovery, E2E tests |
| P6 Governance and seams | Platform security worker | Supply-chain reviewer | P1-P5 | Per-feature flags, webhook limits, script guards, clean dependency audit or documented blocker |
| P7 UX and accessibility | Consumer/admin UX workers | Sally + Freya + Maya synthesis | P2-P5 states | Responsive screenshots, axe, keyboard, zoom, reduced-motion, state-recovery evidence |
| P8 Release gate | Integrator | Blind code reviewer + edge-case hunter | P1-P7 | Full tests, lint, builds, clippy, audit, deployment checklist |

## UX Council Direction

The implementation follows the existing WDS design contract, not a new visual direction:

- Consumer information architecture: Home, Explore, Portfolio, Market, Learn.
- Admin is desktop-first but every permitted route remains usable at 320, 768, 1024, and 1440px.
- Light-first only, per the later admin design-system decision. Dark mode is not reintroduced in one surface alone.
- Fraunces headings, Inter UI and tabular financial figures, indigo primary actions, restrained champagne only for earned completion.
- Consumer language hides chain mechanics. Admin language shows exact identifiers, consequence, cost, finality, accountable human, and evidence.
- AI supplies flags and citations only. It never appears as an approver.

## UX 40/40 Gate

The score is evidence-based. Source review alone cannot earn 40/40. The first-investment, gate-signing, mint/listing, and distribution journeys must each demonstrate:

1. All expected loading, blocked, failed, submitted, unknown, confirmed, and reconciled states.
2. No blind retry after submission; ambiguous outcomes route to status checking and reconciliation.
3. Keyboard reachability, visible focus, focus return, status announcements, and no serious or critical axe findings.
4. Correct layout at mobile, tablet, and desktop widths, 200% zoom, and reduced motion.
5. Honest yield, liquidity, verification, and finality language backed by current data or explicit unavailability.
6. Named-human accountability and one safe next action in every operator state.

External custody, identity-provider, legal, or live-credential decisions remain explicit release blockers. They are never represented as completed through a stub.
