# Vesper — Admin Design → Development Handoff

**From:** WDS design (Saga + Freya) · **Date:** 2026-07-11 · **For:** the build team

This package is the contract between design and development for Vesper's **admin & supply control plane** — the supply/operations half of the product. It sits beside the consumer handoff ([`../../E-Development/00-handoff.md`](../../E-Development/00-handoff.md)); the two share one Convex backend (Architecture I1). Start here for anything admin.

---

## 1. What's delivered

Two complete, dev-ready operator flows — together they are the **ops spine** (*gate → mint → distribute*), the structural backing for the consumer north-star:

| Delivery | Flow | Spec | Status |
|----------|------|------|--------|
| **[DD-A01](./deliveries/DD-A01-list-a-property.yaml)** | List a Property (Work queue → Diligence workspace → Gate ceremony → Mint → List → Reconcile) | `admin/C-UX-Scenarios/A1-list-a-property/` | ready |
| **[DD-A02](./deliveries/DD-A02-push-a-distribution.yaml)** | Push a Distribution (Due queue → Waterfall → Fund → Push → Reconcile) | `admin/C-UX-Scenarios/A2-push-a-distribution/` | **ready — money-movement BLOCKED on custody (B1)** |

Four more scenarios feed the epics directly from their specs (as the consumer S3–S6 did): **[A3](../C-UX-Scenarios/A3-sponsor-intake/)** sponsor intake · **[A4](../C-UX-Scenarios/A4-compliance-signoff/)** compliance sign-off · **[A5](../C-UX-Scenarios/A5-ai-diligence-review/)** AI-diligence review · **[A6](../C-UX-Scenarios/A6-role-grant-sod/)** role grant / SoD.

Each DD yaml carries: user value, artifacts, tech requirements, **data models**, **acceptance criteria** (functional / non-functional / edge cases), and testing guidance.

---

## 2. The design system is the law (and it's the SAME law)

**Source of truth: the Brand Direction Brief**, via **[`D-Design-System/00-design-system.md`](../../D-Design-System/00-design-system.md)**. The admin surface uses those tokens **verbatim** and adds only a data-dense layer: **[`admin/D-Design-System/00-admin-design-system.md`](../D-Design-System/00-admin-design-system.md)**.

- **Same** palette, type (Fraunces + Inter), radii. **Added:** a mono-data type role for on-chain values, a density spacing scale, and an operational status system (Passed/Blocked/Pending/On-chain-confirmed) — **status is always color + icon + label, never color alone**.
- **Non-negotiable admin UI rules:** the AI never appears as an approver (flags + citations only); every action attributes to a **named human**; irreversible on-chain actions state **consequence + cost + finality** and require step-up auth; **fee/revenue context never appears on a gate-decision surface**; champagne "star" only on a genuinely completed action.

---

## 3. Stack (locked)

Next.js (App Router) on Vercel — **desktop-first**, separate app · Convex (shared; **RBAC + segregation-of-duties authority**, per-request) · **WorkOS** (admin/sponsor SSO + directory + roles) · Anchor + Token-2022 + Token ACL · USDC + Anchor distribution ledger · Helius reconciliation · Vercel AI Gateway (ZDR on, injection-isolated extract agent). Full detail: [`admin/A-Product-Brief/platform-requirements.md`](../A-Product-Brief/platform-requirements.md).

---

## 4. Suggested build order

1. **Admin foundation** — desktop-first Next.js app + **WorkOS** auth + Convex **RBAC/SoD** (roles: Ops, Compliance, AI-Reviewer, Sponsor, Platform-Admin) + AuditLog writer + audit views.
2. **DD-A01 read path** — work queue + diligence workspace against seeded submitted properties (reuses consumer seed: The Monroe).
3. **DD-A01 write path** — gate signature ceremony (SoD-enforced) → **mint console** (Anchor, ACL frozen-by-default, step-up) → listing → Helius reconcile. *Custody NOT required here.*
4. **A5 AI-diligence** — injection-isolated extraction/flag review feeding the gate ceremony (keeps I4 true).
5. **A3 sponsor portal** — walled, tenant-isolated intake → KYB/Gate 0 → upload/validate → status timeline → monthly-update composer (feeds AO4).
6. **A4 compliance** — KYC/AML adjudication → Token ACL eligibility → Reg A+ caps → marketing sign-off.
7. **DD-A02 distributions** — waterfall builder + reconcile design now; **money-movement when custody (B1) resolves.**
8. **A6 platform-admin** — RBAC/role management with SoD-conflict detection + audited break-glass (can be built alongside foundation).

---

## 5. Open decisions blocking parts of the build

| # | Decision | Blocks | Owner |
|---|----------|--------|-------|
| 1 | **Escrow / fund-custody vendor (B1)** | Money-movement in DD-A02 (fund + push) | Founders + counsel |
| 2 | **MFA / step-up posture** | Signature + irreversible on-chain actions (DD-A01/A02) | Eng + security |
| 3 | **Internal Gate 0–7 evidence defs + which are multi-party** | Gate ceremony content + SoD second-signer rules | Product + compliance |
| 4 | **Reg A+ pre-auth marketing limits** | A4 marketing sign-off gate | Counsel |

Resolved in planning: unified RBAC app (sponsors walled) · admin auth = **WorkOS** · Platform Admin role has **no operational powers** · build spine = ops (gate → mint → distribute).

---

## 6. What's NOT in this handoff yet

Gate-7 continuous-monitoring/anomaly-detection depth · mass-distribution scale (ZK compression) · secondary-market ops surface · deep analytics dashboards — all COULD-tier (Admin Trigger Map), deferred. The consumer app is the separate, already-delivered demand surface. DD-A01 + DD-A02 (with A3–A6) are the admin core.
