---
stepsCompleted: ["design-epics", "create-stories"]
inputDocuments:
  - "Vesper Brief v5"
  - "planning-artifacts/architecture.md"
  - "E-Development/DD-001-first-investment.yaml"
  - "E-Development/DD-002-getting-paid.yaml"
  - "D-Design-System/00-design-system.md"
  - "C-UX-Scenarios/ (6 scenarios)"
---

# Vesper — Epic Breakdown

## Overview

Decomposes the **consumer app MVP** into implementable stories, derived from *Vesper Brief v5*, the **Architecture Spine**, the **WDS design foundation** (Design System + Scenarios), and the delivery contracts **DD-001** (First Investment) and **DD-002** (Getting Paid). The two delivered flows are the spine of the build; foundation and onboarding wrap them. Admin/sponsor portal + AI diligence are a **separate track** (not in this breakdown).

## Requirements Inventory

### Functional Requirements
- **FR1** Browse Explore + Property Detail with no auth/KYC (public).
- **FR2** Property Detail shows What-You-Own, yield breakdown, honest Liquidity Reality Box, layered risk cards, and human-signed Gates 0–7.
- **FR3** On-chain proof reachable on demand (mint, holders, receipts) — never required in the primary path.
- **FR4** Privy passkey/social signup with embedded self-custodial Solana wallet pre-generated; JWT trusted by Convex.
- **FR5** KYC (Persona) at confirm-investment + Reg A+ per-investor limit enforcement (replaces accreditation); eligibility in Convex + Token ACL.
- **FR6** Fund via card/ACH → USDC (Privy + Bridge) in-flow.
- **FR7** Calculator recomputes ownership %, monthly income, first-year base **and** downside live; min $50 enforced.
- **FR8** One-time platform fee (0.9%) disclosed before confirm; management fee stated as already in net yield (never double-charged).
- **FR9** Three risk acknowledgements must be actively checked before Confirm enables.
- **FR10** Settlement is atomic DvP (Anchor): payment + token delivery settle together or fail together; Token ACL blocks ineligible accounts on-chain.
- **FR11** Confirmation states ownership %, first-distribution date, DvP receipt; offers portfolio + on-chain proof.
- **FR12** Home surfaces a fresh distribution as the hero ("Rent just landed +$X") + balance card + sparkline; else next-distribution date.
- **FR13** Portfolio shows holdings + allocation-by-market + a visible warning when any market > 35%.
- **FR14** Income itemizes a distribution (gross→costs→mgmt fee→reserve→net) + "matches target" confirmation + history + next date.
- **FR15** Every property has a monthly update (named operator), including uneventful months.
- **FR16** Every money/ownership/eligibility/diligence change writes an immutable AuditLog; Helius reconciles Convex↔chain (chain wins).

### NonFunctional Requirements
- **NFR1** Mobile-first PWA; LCP < 2.5s, INP < 200ms, CLS < 0.1 (money must not shift).
- **NFR2** WCAG 2.2 AA (focus, labels, 44px targets, tabular numerals, sparkline text-equivalent).
- **NFR3** No crypto vocabulary (wallet/gas/tx/mint) in the consumer path; on-chain terms only inside the proof view.
- **NFR4** AI never shown as approver; every diligence gate shows a human signer (spine I4).
- **NFR5** AI Gateway ZDR on; prompt-injection isolation for sponsor docs (spine I4).
- **NFR6** Reg A+ solicitation constraints respected on any public/pre-auth offering content.
- **NFR7** On-chain authoritative; Convex never self-settles (spine I2/I3).

### UX Design Requirements
- **UX1** `D-Design-System/00-design-system.md` (from the Brand Direction Brief) is the single source of visual truth — Fraunces+Inter, indigo/champagne, one champagne accent per screen, tabular money, gain/loss paired with a sign, monospace eyebrows. (spine I7)
- **UX2** Build to the DD-001/DD-002 clickable prototypes and the 6 scenario specs.
- **UX3** Invisible-by-default / provable-on-demand layering on shared screens (Property Detail).

### FR Coverage Map
| FR | Epic(s) | FR | Epic(s) |
|----|---------|----|---------|
| FR1–FR3 | E2 | FR10 | E4 |
| FR4 | E1, E3 | FR11 | E4 |
| FR5–FR6 | E3 | FR12–FR15 | E5 |
| FR7–FR9 | E4 | FR16 | E1 (cross-cutting) |
| NFR1–NFR7, UX1–UX3 | E1 (foundation) + honored in every epic | | |

## Epic List
1. **E1 · Platform Foundation & Design System** — the substrate everything is built on.
2. **E2 · Discover & Understand a Property** — the public trust surface (DD-001 read path).
3. **E3 · Onboard & Fund** — Privy account, KYC/Reg A+, USDC funding.
4. **E4 · Invest** — calculator → acknowledgement → atomic DvP → confirmation (DD-001 write path).
5. **E5 · Earn & Trust** — get paid and understand it (DD-002).

---

## Epic 1: Platform Foundation & Design System

Stand up the reactive substrate and the visual system so every later story inherits correct auth, data ownership, reconciliation, and tokens. Delivers no user-facing flow alone but de-risks all of them.

### Story 1.1: Reactive backbone (Next.js + Convex + Privy)
As a developer, I want the app scaffold with Convex and Privy wired, so that authenticated, reactive data flows end-to-end.
**Acceptance Criteria:**
**Given** the repo is scaffolded (Next.js App Router on Vercel, Convex deployment) **When** a user signs in with a Privy passkey **Then** a Privy JWT is issued and **And** Convex trusts it via `customJwt` and resolves the user in a reactive query.
**Given** any backend mutation to money/ownership/eligibility/diligence **When** it commits **Then** an immutable `AuditLog` entry is written (actor, action, target, timestamp). *(FR16)*

### Story 1.2: Design system tokens as code
As a developer, I want the Brand Direction Brief tokens implemented as the theme, so that every screen is visually consistent by default.
**Acceptance Criteria:**
**Given** `D-Design-System/00-design-system.md` **When** the theme layer is built **Then** Fraunces + Inter self-hosted (variable, opsz), the color/spacing/radius tokens, tabular numerals, and the light/dark flip (midnight field) are all available as tokens **And** a component can't hardcode a non-token color in review. *(UX1, NFR1)*

### Story 1.3: On-chain reconciliation harness
As the platform, I want Helius events to reconcile Convex to chain, so that the read model can never diverge from truth.
**Acceptance Criteria:**
**Given** an on-chain event (mint, transfer, distribution) **When** Helius webhooks a Convex HTTP action **Then** Convex updates its mirror **And** on any Convex↔chain conflict, chain state wins and the discrepancy is logged. *(FR16, spine I2/I3)*

### Story 1.4: Core schema & seed
As a developer, I want the core Convex entities defined and seedable, so that read screens can be built against realistic data.
**Acceptance Criteria:**
**Given** the entities User, Property, DiligenceGate, Order, Holding, Eligibility, IncomeLedger, Distribution, PropertyUpdate, AuditLog **When** seed runs **Then** at least The Monroe (with 8 signed gates, occupancy, reserves) exists for downstream stories.

---

## Epic 2: Discover & Understand a Property

The public, no-auth trust surface — the screens that answer "is it real / where's the return / can I get out?" This is where conversion and comprehension (O3) are won.

### Story 2.1: Explore listing (public)
As a visitor, I want to browse vetted properties without signing up, so that I can explore with zero friction.
**Acceptance Criteria:**
**Given** I am unauthenticated **When** I open Explore **Then** I see property cards (dusk thumbnail, funding %, target yield, tags, funding bar) for open offerings **And** no signup/KYC is required to browse. *(FR1)*
**Given** Reg A+ marketing constraints **When** public offering content renders **Then** only counsel-approved fields are shown pre-auth. *(NFR6)*

### Story 2.2: Property Detail — the trust quartet
As a visitor, I want to understand exactly what a property offers, so that I can decide with confidence.
**Acceptance Criteria:**
**Given** a Property Detail **When** it renders **Then** I see the What-You-Own chain (tokens→SPV→cash-flow→exit→waterfall), the yield breakdown (rent vs appreciation, fees itemized), the Liquidity Reality Box (bids, last sale, est. exit, spread, lockup) **and** layered risk cards. *(FR2)*
**Given** the Liquidity box **When** it renders **Then** there is **no** "Sell now" CTA and no instant-exit language. *(FR2, UX)*

### Story 2.3: Trust Stack (human-signed gates)
As a visitor, I want to see who verified this property, so that I trust the supply.
**Acceptance Criteria:**
**Given** a property that passed diligence **When** I view the Trust Stack **Then** each Gate 0–7 shows passed status **and** a named human signer + date **And** no gate is ever attributed to an AI. *(FR2, NFR4)*

### Story 2.4: On-chain proof (provable on demand)
As a skeptical (crypto-native) user, I want to verify the asset on-chain, so that I know it's real — without it cluttering the primary path.
**Acceptance Criteria:**
**Given** Property Detail **When** I tap "See the on-chain proof" **Then** I reach mint, holder view, DvP receipts, Token ACL disclosure, and explorer links **And** this affordance is low-weight and never required to invest. *(FR3, UX3, NFR3)*

---

## Epic 3: Onboard & Fund

Convert intent into a funded, eligible account with the crypto invisible.

### Story 3.1: Passkey signup + embedded wallet
As a first-timer, I want to create an account with a passkey, so that I'm ready without seed phrases.
**Acceptance Criteria:**
**Given** I tap Invest while unauthenticated **When** I sign up with Privy (passkey/social) **Then** an embedded self-custodial Solana wallet is pre-generated invisibly **And** I'm returned to my place in the flow. *(FR4, NFR3)*

### Story 3.2: KYC + Reg A+ eligibility
As an investor, I want a quick identity check, so that I can legally invest.
**Acceptance Criteria:**
**Given** I proceed to confirm an investment **When** KYC (Persona) is required **Then** I complete it and eligibility is recorded in Convex **And** my Reg A+ per-investor limit is computed and shown calmly (not a wall) **And** Token ACL reflects my eligibility on-chain. *(FR5, I5)*
**Given** a restricted jurisdiction **When** eligibility fails **Then** I see a calm explainer + waitlist, never a dead-end.

### Story 3.3: Add money (fiat → USDC)
As an investor, I want to add money from my card, so that I can fund without touching crypto rails.
**Acceptance Criteria:**
**Given** I need funds **When** I add money via card/ACH (Privy + Bridge) **Then** it converts to USDC behind a fiat-like flow **And** amounts are shown in dollars. *(FR6, NFR3)*

---

## Epic 4: Invest

The write path: model, acknowledge, settle atomically, celebrate. The screens where money moves.

### Story 4.1: Calculator & live projection
As an investor, I want to set an amount and see what I'd get, so that I can decide with full information.
**Acceptance Criteria:**
**Given** the calculator **When** I change the amount (input, slider, or chip) **Then** ownership %, est. monthly income, and first-year base recompute live in tabular figures **And** the minimum is $50 (enforced with an inline hint, CTA disabled below it). *(FR7, NFR1)*
**Given** the projection **When** I toggle Downside **Then** the first-year figure shows the −12% case in loss color with a "−". *(FR7)*

### Story 4.2: Order preview & fee transparency
As an investor, I want the full cost shown before I confirm, so that there are no surprises.
**Acceptance Criteria:**
**Given** an amount **When** I view the order **Then** I see investment, the one-time 0.9% platform fee, and total today **And** a note that the annual management fee is already inside the 6.2% (not re-charged). *(FR8)*

### Story 4.3: Rights & risk acknowledgement
As an investor, I want to actively confirm I understand the risks, so that my consent is real.
**Acceptance Criteria:**
**Given** the acknowledgement screen **When** fewer than all three checkboxes are checked **Then** Confirm is disabled **And** when all three are checked Confirm enables. *(FR9)*

### Story 4.4: Atomic DvP settlement
As an investor, I want my purchase to settle safely, so that I never pay without receiving my share.
**Acceptance Criteria:**
**Given** I confirm **When** the Anchor DvP executes **Then** payment (USDC) and token delivery settle together **And** if either fails the whole order fails with nothing charged and an audit entry. *(FR10, I2)*
**Given** an ineligible account **When** settlement is attempted **Then** Token ACL prevents token receipt on-chain. *(FR10, I5)*

### Story 4.5: Confirmation ("You're an owner")
As a new owner, I want a clear receipt, so that I understand what I got.
**Acceptance Criteria:**
**Given** settlement succeeds **When** the confirmation renders **Then** I see my exact ownership %, first-distribution date, and a DvP receipt reference **And** links to portfolio and on-chain proof. *(FR11)*

---

## Epic 5: Earn & Trust

The retention half of the north-star — get paid, understand it, and trust the operator.

### Story 5.1: Home — the payout is the hero
As an owner, I want to see my income at a glance, so that I feel my money working.
**Acceptance Criteria:**
**Given** a fresh distribution **When** I open Home **Then** it surfaces "Rent just landed +$X" as the hero (dusk card, champagne star) **and** shows portfolio value, all-time return (signed), income-to-date, and a balance sparkline **And** if no fresh distribution, it shows the next-distribution date. *(FR12, UX1)*

### Story 5.2: Portfolio + concentration honesty
As an owner, I want to see my holdings and allocation, so that I understand my exposure.
**Acceptance Criteria:**
**Given** my holdings **When** I view Portfolio **Then** I see per-holding value + this-month income and allocation-by-market **And** if any single market exceeds 35% a calm warning + diversify nudge appears (never hidden). *(FR13, O5)*

### Story 5.3: Income breakdown + matches-target
As an owner, I want to understand each payout, so that I trust the number.
**Acceptance Criteria:**
**Given** a distribution **When** I open Income **Then** it itemizes gross rent → costs → management fee → reserve → net paid in USDC **and** confirms whether it matches the target yield **And** shows history + the next distribution date. *(FR14, O3)*
**Given** a missed or paused distribution **When** I view Income **Then** it explains why and links to the update — never silent.

### Story 5.4: Monthly property update (even quiet ones)
As an owner, I want a monthly update from the operator, so that silence never erodes my trust.
**Acceptance Criteria:**
**Given** any property I own **When** a month closes **Then** a monthly update is available with a named operator, occupancy, reserves, rent-on-time, and a plain note — including uneventful months **And** a scheduled function flags any property overdue for an update (O5). *(FR15)*

---

## Notes
- **Sequence:** E1 → E2 → E3 → E4 → E5 (matches the DD build order; E2 is demoable earliest against seed).
- **Blocking open decisions** (from architecture): escrow vendor (E3/E4), ownership-% basis (E4), Reg A+ marketing limits (E2), gate labels (E2). Resolve before the affected stories leave "ready."
- **Out of scope here:** S3 Priya (reuses E5 surfaces), S4 full proof view depth, S5 Learn, S6 secondary sell, and the entire admin/sponsor + AI-diligence track.
- Next Solutioning step: **Check Implementation Readiness (IR)**, then **Sprint Planning (SP)**.
