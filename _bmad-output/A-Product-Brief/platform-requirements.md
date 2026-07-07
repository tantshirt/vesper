# Platform Requirements: Vesper

> Technical Boundaries & Platform Decisions

**Created:** 2026-07-07
**Author:** Dre
**Related:** [Product Brief](./project-brief.md) · Source: *Vesper Brief v5* §0, §7, §8, §12, §15

> Vesper is a **consumer fintech application** (mobile-first PWA), not a marketing site. This document adapts the WDS platform template accordingly. The stack is **locked** per v5 — this captures boundaries the UX design (Freya, Phase 2) must respect, not open technology choices.

---

## Technology Stack

### Core Platform

**Framework:** Next.js (App Router) on Vercel — SSR + RSC, mobile-first responsive / **PWA** for MVP.
**Approach:** Reactive full-stack. Convex is the entitlement authority + realtime data layer; on-chain (Solana) is authoritative for ownership & settlement; Convex reconciles to chain via Helius.

### Key Technologies

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend (consumer)** | Next.js (App Router) / Vercel | Primary framework; SSR+RSC; mobile-first PWA |
| **Styling** | *TBD by Freya* — token-driven (brand: Fraunces + Inter, indigo/champagne) | Design-system-mode = none for MVP; tokens defined in brand brief |
| **Backend / DB / realtime** | Convex | Reactive queries, scheduled functions, HTTP actions for webhooks, entitlement authority, audit logs, native vector search |
| **Consumer auth + wallets** | Privy (only) | Embedded self-custodial Solana wallets, server wallets, delegated actions, Privy+Bridge fiat rails; Convex trusts Privy JWTs (`customJwt`) |
| **Admin / sponsor auth** | Clerk (separate app) — WorkOS if sponsors require SAML SSO | Orgs, RBAC, B2B dashboards |
| **On-chain programs** | Anchor (Rust) | Speed to market, IDL for TS clients, minimal custom surface |
| **Token standard** | Token-2022 / Token Extensions | Metadata, DefaultAccountState frozen-by-default, permissioned RWA |
| **Compliance rail** | Token ACL (frozen-by-default + gated self-thaw) | Lower overhead than Transfer Hooks; preserves composability |
| **Settlement** | USDC + atomic DvP (Anchor) | Payment & asset delivery settle together or fail together |
| **Oracles** | Pyth (market data only) | SOL/USD, USDC/USD context; **never** single-property NAV (admin NAV-strike for that) |
| **Indexing** | Helius webhooks → Convex HTTP actions | On-chain events → reactive UI + reconciliation |
| **AI model access** | Vercel AI Gateway | Generation + embeddings; ZDR by default; failover; spend caps; observability |
| **Embeddings** | Gemini Embedding (`gemini-embedding-2`, 1,536-dim MRL) via gateway | Retrieval quality, long context |
| **Generation** | Gemini Flash (bulk) + Claude Opus/Sonnet class (judgment) via gateway | Cheap volume + high-stakes reasoning |
| **Vector store** | Convex native vector search | No extra infra for MVP; filter fields enforce grounding |
| **Hosting** | Vercel (app) + Convex (backend) | Managed, low-ops for a small team |
| **Storage** | Convex file storage / S3-compatible + on-chain hashes | Sensitive docs off-chain, integrity provable on-chain |

---

## Integrations

### Required (MVP)

- **Privy + Bridge (Stripe):** fiat on-ramp — card/ACH → USDC in the same flow as wallet provisioning
- **Persona:** investor KYC / identity verification
- **⚠️ Investment-limit enforcement (NOT accreditation):** Under the locked **Reg A+ (retail)** path, accredited-investor verification (VerifyInvestor / Parallel Markets) is **dropped**. Instead, enforce **Reg A+ Tier 2 per-investor caps** (non-accredited investors limited to the greater of 10% of annual income or net worth). This becomes an eligibility check recorded in Convex and gated by Token ACL. *This is the one integration change the jurisdiction decision forces.*
- **ComplyAdvantage:** AML / sanctions screening · **TRM:** on-chain AML
- **Securitize:** registered transfer agent / tokenized-securities rails
- **Diligence-gate vendors (Gates 0–3):** Middesk (KYB/UBO), Qualia (title), HouseCanary + ATTOM or CoreLogic (valuation/property data)
- **DocuSign / Dropbox Sign:** e-signature for legal docs & acknowledgements
- **Helius:** on-chain indexing → Convex · **Pyth:** market-data oracle
- **Vercel AI Gateway → Gemini / Claude:** validator, monitoring & investor-assistant AI

### Open — needs a decision
- 🔶 **Escrow / fund custody** (v5 Open Question #4): which qualified custodian or escrow-as-a-service holds USDC/fiat pre-settlement, and its treatment of USDC. Blocks the money-movement design of the Investment Flow.

### Future (post-MVP)
- Light Protocol / ZK compression (mass distribution) · additional secondary-market infra (broker-dealer/ATS per counsel) · lending integrations

---

## Support & Contact Strategy

**Primary:** in-app support (ticketing) + email. v5 tracks *support tickets per investor* as a trust KPI, so support surface quality matters.

| Channel | Priority | Implementation |
|---------|----------|----------------|
| In-app help / ticket | High | Contextual help on Property Detail, Investment Flow, Portfolio |
| Email | High | Transactional + support |
| **AI Investor Assistant (Agent D)** | Medium (MVP-capable) | Cite-or-refuse Q&A grounded in property docs; **never** gives advice or approves; escalates to human |

---

## UX Constraints

*These bound what Freya can design in Phase 2.*

- **Mobile-first, PWA** — every core flow must be excellent on a phone; no native-only interaction assumptions for MVP.
- **Crypto is invisible by default** — no wallet/gas/tx/mint language in the consumer path; Privy embedded wallet abstracts custody. *Provable on demand* (on-chain receipts) sits one layer deeper (P2 tension resolution).
- **Compliance is gated, not optional** — browse/save without KYC; **confirm-investment requires KYC**; secondary trading requires eligibility. Token ACL enforces on-chain; UI must handle frozen/thaw states gracefully.
- **Atomic DvP** — the invest action must present as one settle-or-fail moment with an explicit risk/legal acknowledgement before execution.
- **Radical transparency surfaces are mandatory**, not decorative: "What you own" card, yield breakdown, Liquidity Reality Box, risk cards + published diligence gates on every property.
- **Calm, never alarmist** — gain/loss always pairs color with a sign/arrow; one champagne "evening star" accent per screen, max.
- **The AI never approves** — any AI-surfaced diligence output must show it's human-signed; no auto-approval UI anywhere.

### Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Mobile First** | Yes — primary device | Where the money-app-native persona lives |
| **LCP** | < 2.5s (4G) | Trust erodes on slow finance apps |
| **INP** | < 200ms | Snappy interaction on the calculator / flows |
| **CLS** | < 0.1 | No layout shift near money figures |
| **Page weight** | < 3MB; hero imagery < 400KB | Mobile data budgets |
| **Offline** | Not required MVP (read-only cached views acceptable) | Not a core need |

### Security & Trust Headers

HSTS · strict CSP · X-Content-Type-Options · X-Frame-Options · Referrer-Policy · Permissions-Policy. Plus fintech-specific: strict handling of Privy JWTs, per-request entitlement checks in Convex, audit logging on every state change, ZDR enforced at the AI Gateway, prompt-injection isolation (untrusted sponsor docs never reach the recommend-agent directly).

---

## Multilingual Requirements

*Single language for MVP* — `product_languages: [en]`. Consumer app is **English-first**. (v5's multilingual notes apply to later expansion; the AI investor-assistant can be multilingual post-MVP.)

---

## Discoverability (SEO — adapted for an app)

Not a content/marketing-site SEO problem. Scope for MVP:
- Public **marketing/landing** surface (pre-auth): standard technical SEO, OpenGraph/Twitter cards, structured data (`Organization`, `Product`/`Offer` for public property teasers *only where legally permissible* — mind Reg A+ marketing/solicitation rules).
- **In-app** property pages behind auth: not indexed.
- ⚠️ **Reg A+ marketing constraint:** public solicitation content is regulated — coordinate any public offering language with counsel before indexing. This is a legal constraint on SEO, not just a technical one.

### Core Web Vitals / Infra

| Metric | Target |
|--------|--------|
| LCP | < 2.5s · INP < 200ms · CLS < 0.1 |
| Page Load (4G) | < 3s |
| Favicon | 16/32/180/192px (use the Vesper symbol — indigo field, one point of light) |

---

## Maintenance & Ownership

| Aspect | Owner | Notes |
|--------|-------|-------|
| **App / content** | Founding team (🔶 confirm) | Small team; property content flows via sponsor portal + admin |
| **Technical maintenance** | Founding eng team | Managed vendors (Vercel, Convex) reduce ops load |
| **Smart-contract / on-chain** | Eng + external audit | Small Anchor surface; audits + bug bounty before mainnet |
| **Vendor/integration updates** | Eng, manual review | Avoid deep coupling; DPAs in place; key export retained (vendor-concentration mitigation) |
| **AI models / prompts** | Eng + compliance | Prompt versioning; governance & safety review; human-sign-off preserved |

---

## Development Handoff Notes

### Environment Setup
Next.js + Vercel project; Convex deployment; Privy app (consumer) + Clerk app (admin) separate; Vercel AI Gateway keys (ZDR on); Helius webhook endpoints → Convex HTTP actions; Solana devnet for Gate-5 binding tests.

### Deployment
Vercel (app) + Convex (backend) continuous deploy; Anchor programs deployed devnet → audited → mainnet. On-chain is authoritative; never ship a path where Convex can override chain state.

### Key Considerations
- Convex ↔ chain **drift**: Helius reconciliation flags mismatches; **on-chain wins**.
- Validate **Privy Solana secondary-market parity early**; keep wallet layer abstract (Crossmint fallback).
- Segregation of duties in Convex RBAC — and keep **sponsor-listing revenue organizationally independent of Gate 0–7 sign-off** (integrity guardrail from the brief).

---

## Next Steps

- [ ] Resolve 🔶 open items: escrow/custody vendor · post-launch maintenance owner
- [ ] Confirm the Reg A+ investment-limit enforcement approach with counsel (replaces accreditation checks)
- [ ] **Phase 2 Design (Freya):** UX must design within these constraints — Outline Scenarios → Specs → Visual Design

---

_Generated by Web Design Studio_
