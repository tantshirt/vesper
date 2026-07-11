# Platform Requirements: Vesper — Admin & Supply Control Plane

> Technical Boundaries & Platform Decisions — admin surface

**Created:** 2026-07-11
**Author:** Dre
**Related:** [Admin Product Brief](./project-brief.md) · Consumer [Platform Requirements](../../A-Product-Brief/platform-requirements.md) · Architecture Spine (I1–I7) · Source: *Vesper Brief v5* §7–§9, §12, §15

> The admin side is a **desktop-first internal operations console** with a **walled external sponsor portal**, sharing the consumer's Convex backend. The stack is **locked** per v5 and the Architecture Spine — this captures the boundaries the admin UX (Freya, Phase D) must respect, plus the admin-specific decisions resolved in planning.

---

## Technology Stack

### Core Platform

**Framework:** Next.js (App Router) on Vercel — **desktop-first** responsive (dense tables, multi-pane review, document viewers). Separate application from the consumer app; **one shared Convex backend** (Architecture I1). No consumer-wallet scope reaches this surface.
**Approach:** Reactive full-stack. Convex is the **RBAC + entitlement authority**; Solana is authoritative for ownership, settlement, ACL, and the distribution ledger; the admin console issues **authoritative intent**, Convex reconciles to chain via Helius, **chain wins**.

### Key Technologies

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend (admin)** | Next.js (App Router) / Vercel — desktop-first | Dense operator UI; SSR+RSC; not mobile-optimized |
| **Styling** | Token-driven, inherits `D-Design-System` + admin data layer (Phase D) | Same tokens as consumer; extended for density, never overridden |
| **Backend / DB / realtime** | Convex (shared) | RBAC authority, review queues, scheduled functions, HTTP actions (webhooks), audit log, vector search for diligence |
| **Admin / sponsor auth** | **WorkOS** (locked) | Enterprise SSO + directory sync + fine-grained RBAC + audit — required for segregation of duties; supersedes the "Clerk/WorkOS" placeholder in Spine I1 |
| **RBAC + segregation of duties** | WorkOS roles → enforced in **Convex** per-request | Role checks and SoD conflicts (fee-vs-gate, self-approval) enforced server-side, never UI-only |
| **On-chain programs** | Anchor (Rust) — mint, DvP, Token ACL, distribution ledger | Admin is the authoritative trigger for these |
| **Token standard** | Token-2022 / Token Extensions (DefaultAccountState frozen-by-default) | Permissioned RWA; mint & metadata created in the mint console |
| **Compliance rail** | Token ACL (frozen-by-default + gated self-thaw) | Admin/compliance manages ACL eligibility state; freeze/thaw are operator actions |
| **Settlement / treasury** | USDC + atomic DvP (Anchor); on-chain distribution ledger | Distribution console funds + pushes; Convex mirrors `IncomeLedger` |
| **Oracles** | Pyth (market context only) | **Admin NAV-strike** signed off-chain, hashed on-chain — never Pyth for single-property NAV |
| **Indexing** | Helius webhooks → Convex HTTP actions | Settlement/mint/distribution events → reconciliation + reactive queues |
| **AI (diligence)** | Vercel AI Gateway (**ZDR on**) → Gemini Flash (extraction/bulk) + Claude class (judgment-adjacent summarization) | Accelerates & documents diligence; **isolated from the approval path** |
| **Embeddings / retrieval** | Gemini Embedding via gateway + Convex native vector search | Ground AI answers in sponsor docs; cite-or-refuse |
| **e-Signature** | DocuSign / Dropbox Sign | Sponsor legal docs, gate evidence packages |
| **Document storage** | Convex file storage / S3-compatible + **on-chain hashes** | Sensitive sponsor docs off-chain; integrity provable on-chain (Gate 5 binding) |

---

## Integrations

### Required (MVP)

- **WorkOS:** admin/sponsor SSO, directory, RBAC roles → Convex.
- **Diligence-gate evidence vendors:** **Middesk** (KYB/UBO — Gate 0), **Qualia** (title — Gate 1/3), **HouseCanary + ATTOM/CoreLogic** (valuation/property data — Gate 2). Results attach as gate evidence; a human still signs.
- **ComplyAdvantage** (AML/sanctions) · **TRM** (on-chain AML) — compliance console screening.
- **Persona:** investor KYC results surfaced to the compliance console for adjudication (KYC itself runs consumer-side; admin adjudicates edge cases + Reg A+ caps).
- **Securitize:** registered transfer-agent coordination / tokenized-securities rails.
- **DocuSign / Dropbox Sign:** e-signature for legal docs & gate packages.
- **Helius:** on-chain indexing → Convex (settlement/mint/distribution reconciliation).
- **Pyth:** market-context only.
- **Vercel AI Gateway → Gemini / Claude:** extraction, validation, monitoring — **never** an approver.

### Open — needs a decision
- 🔶 **Escrow / fund custody (B1 blocker):** which qualified custodian/escrow holds USDC pre-settlement and **funds distributions**. Blocks the admin **distribution-funding** and **DvP money-movement** control surfaces. Admin stories touching custody are flagged `BLOCKED: custody vendor`.
- 🔶 **MFA / step-up posture:** hardware-key / step-up auth required on signature ceremonies and irreversible on-chain actions (mint, freeze/thaw, distribute). *Recommendation: WebAuthn hardware key step-up on all I2/I3 actions.*

### Future (post-MVP)
- Light Protocol / ZK compression (mass distribution scale) · secondary-market ops surface (broker-dealer/ATS per counsel) · advanced anomaly-detection AI for monitoring (Gate 7).

---

## UX Constraints

*These bound what Freya can design in Phase D — the inverse of the consumer constraints.*

- **Desktop-first, data-dense** — tables, review queues, multi-pane doc review, diff/flag overlays. Responsive down for tablet review, but not a phone-primary surface.
- **Crypto is explicit and operated** — mint, ACL, DvP, distribution ledger, signatures, hashes are **first-class UI**, shown with exact values, finality, and cost. (Opposite of the consumer "invisible crypto" rule.)
- **Segregation of duties is visible and enforced** — role-scoped nav; SoD conflicts surface as blocks with the reason and the required second signer; fee/revenue context is **absent** from any gate-decision surface.
- **The AI never approves** — AI outputs render as *flags/extractions with source links* feeding a human signer; there is **no** auto-approve affordance anywhere. Every gate shows a named human signer.
- **Irreversible actions state consequence + cost + finality** before confirm; step-up auth gates them.
- **Evidence-first** — every gate, eligibility, and distribution state links to its source documents/on-chain refs. No claim without a source.
- **Everything writes AuditLog** — the admin is the primary writer; audit views are append-only and inspectable by compliance.

### Performance / Ergonomics Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Primary device** | Desktop | Dense review, multi-doc, multi-pane |
| **Table render** | 10k+ rows virtualized, < 100ms interaction | Ops review at scale |
| **Doc viewer** | PDF + AI-flag overlay, < 1s open | Diligence throughput |
| **On-chain action feedback** | Optimistic intent → chain confirm → reconcile, states never ambiguous | I2/I3 |
| **Offline** | Not required | Console is online-only |

### Security & Trust Headers

HSTS · strict CSP · X-Frame-Options · Referrer-Policy · Permissions-Policy. Admin-specific: **WorkOS session + per-request RBAC checks in Convex**; **step-up/MFA on signature + on-chain actions**; SoD enforcement server-side; audit logging on every state change; **ZDR** at the AI Gateway; **prompt-injection isolation** — untrusted sponsor docs reach only the read/extract agent, never a recommend/approve surface; sponsor tenancy isolation (a sponsor can never see another sponsor's data or any internal surface).

---

## Multilingual Requirements

*Single language for MVP* — `product_languages: [en]`. Admin console is **English-first**. Sponsor portal English-first for MVP.

---

## Discoverability (SEO)

**Not applicable** — the admin console and sponsor portal are **fully behind auth and not indexed**. No public surface. (robots: disallow; no OpenGraph.)

---

## Maintenance & Ownership

| Aspect | Owner | Notes |
|--------|-------|-------|
| **Console / workflows** | Founding ops + eng | Small team; workflow config owned by Platform Admin (P6) |
| **RBAC / role config** | **Platform Admin (P6)** | Configures walls; holds no operational powers |
| **Smart-contract / on-chain** | Eng + external audit | Mint/DvP/ACL/distribution programs; audits + bug bounty before mainnet |
| **Diligence AI / prompts** | Eng + compliance | Prompt versioning; injection-isolation review; human sign-off preserved |
| **Vendor/integration updates** | Eng, manual review | Avoid deep coupling; DPAs; key export retained |

---

## Development Handoff Notes

### Environment Setup
Separate Next.js/Vercel admin project; **WorkOS** org + roles; shared Convex deployment (RBAC + SoD enforced server-side); Vercel AI Gateway keys (ZDR on) with injection-isolated extract agent; Helius webhook endpoints → Convex HTTP actions; Solana devnet for mint/DvP/distribution/ACL testing.

### Deployment
Vercel (admin app) + Convex (shared backend) continuous deploy; Anchor programs devnet → audited → mainnet. **Never** ship a path where the console (or AI) can override chain state or bypass a human gate signature.

### Key Considerations
- **Segregation of duties** enforced in Convex RBAC: fee/listing powers and gate-signing powers are mutually exclusive; multi-party gates require distinct human signers; Platform Admin holds no operational powers.
- **AI approval isolation:** no code path lets the AI write an approval or signature; injection boundary between extract-agent and any signer surface.
- **Custody dependency:** distribution-funding and DvP money-movement surfaces are `BLOCKED` until the escrow/custody vendor (B1) is chosen.
- **Reconciliation:** Helius drift detection; chain wins; discrepancies logged to AuditLog and surfaced in the settlement monitor.

---

## Next Steps

- [ ] Resolve 🔶 open items: escrow/custody vendor (B1), MFA/step-up posture
- [ ] **Phase B: Trigger Mapping** — six admin personas + driving forces + feature-impact
- [ ] **Phase C+ Design (Freya):** admin scenarios → design-system extension → specs, within these constraints

---

_Generated by Web Design Studio — Admin track_
