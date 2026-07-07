# Vesper — Design → Development Handoff

**From:** WDS design (Saga + Freya) · **Date:** 2026-07-07 · **For:** the build team

This package is the contract between design and development for Vesper's **consumer app MVP**. Start here.

---

## 1. What's delivered

Two complete, dev-ready user flows — together they are the north-star (*funded users who receive AND understand their first payout*):

| Delivery | Flow | Clickable prototype | Spec |
|----------|------|---------------------|------|
| **[DD-001](./deliveries/DD-001-first-investment.yaml)** | First Investment (Explore → Property → Set up → Calculator → Rights → Confirm) | [walk it](https://claude.ai/code/artifact/37470475-5e16-4689-8830-1b45b817eb4a) | `C-UX-Scenarios/01-maya-first-investment/` |
| **[DD-002](./deliveries/DD-002-getting-paid.yaml)** | Getting Paid & Trust (Home → Portfolio → Income → Updates) | [walk it](https://claude.ai/code/artifact/fe2f5c4b-adb9-4b29-b0d8-8a52061720c4) | `C-UX-Scenarios/02-maya-checkin-payout/` |

Single-screen references: [Property Detail](https://claude.ai/code/artifact/dda7bb14-c0c0-4d05-a403-f57c0a9b63e7) · [Calculator](https://claude.ai/code/artifact/4cb09cf9-ea6c-4f1d-a20c-79142d7262f7)

Each DD yaml carries: user value, artifacts, tech requirements, **data models**, **acceptance criteria** (functional / non-functional / edge cases), and testing guidance.

---

## 2. The design system is the law

**Source of truth: the Brand Direction Brief.** All tokens are in **[`D-Design-System/00-design-system.md`](../D-Design-System/00-design-system.md)** — colors, type (Fraunces + Inter), spacing, radii, components, voice. Build to these verbatim.

- **Fonts:** self-host **Fraunces** (variable, with `opsz` axis) + **Inter**. The prototypes embed static weights as woff2 data-URIs because artifacts can't call a font CDN — production should self-host the variable fonts.
- **Non-negotiable UI rules:** one champagne accent per screen (small); gains/losses pair color with a sign/arrow; money is always Inter tabular; monospace uppercase eyebrows; no crypto vocabulary in the consumer path; the AI never appears as an approver.

---

## 3. Stack (locked, from v5 / Platform Requirements)

Next.js (App Router) on Vercel · Convex (entitlement authority + reactive) · Privy (consumer auth + embedded Solana wallet) · Anchor + Token-2022 + Token ACL · USDC atomic DvP · Helius indexing · Vercel AI Gateway (diligence/assistant, separate surface). Full detail: [`A-Product-Brief/platform-requirements.md`](../A-Product-Brief/platform-requirements.md).

---

## 4. Suggested build order

1. **Foundation** — Next.js/Vercel + Convex schema (User, Property, Order, Holding, Eligibility, IncomeLedger, DiligenceGate, AuditLog) + Privy auth trusted by Convex.
2. **DD-001 read path** — Explore + Property Detail (public, SSR) against seeded property data.
3. **DD-001 write path** — Set up/KYC/fund → Calculator → Rights → **atomic DvP** (Anchor) → Confirmation. On-chain authoritative; Helius reconciliation.
4. **DD-002** — distributions (Anchor ledger) → Income/Portfolio/Home reactive views + monthly-update cadence (Convex scheduled fns).
5. Supply side (admin/sponsor portal + Gate 0–7 + AI diligence) delivers properties into this app — separate track, separate auth (Clerk/WorkOS).

---

## 5. Open decisions blocking parts of the build

| # | Decision | Blocks | Owner |
|---|----------|--------|-------|
| 1 | **Escrow / fund-custody vendor** | Money-movement in DD-001 set-up & settle | Founders + counsel |
| 2 | **Ownership-% basis** (appraisal vs raise vs share count) | Calculator + confirmation math | Product |
| 3 | **Reg A+ pre-auth marketing limits** | What Explore/Property render publicly | Counsel |
| 4 | **Consumer-visible Gate 0–7 labels** | Trust Stack content | Product + compliance |
| 5 | **Sponsor-listing-fee ↔ diligence independence** | RBAC / segregation of duties | Compliance |

---

## 6. What's NOT in this handoff yet

S3 (Priya diversify — mostly reuses DD-002 surfaces) · S4 (on-chain proof view — Kai) · S5 (Learn) · S6 (secondary-market sell). The **admin/sponsor portal + AI diligence** is a separate design track. These extend the MVP; DD-001 + DD-002 are the core.
