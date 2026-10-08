# Vesper — Admin & Supply Control Plane Architecture Spine

> The consistency contract for the **admin surface**: only the **invariants** that keep independently-built admin units from diverging. Extends — never restates — the consumer [Architecture Spine](../../planning-artifacts/architecture.md) (I1–I7). Structural detail (full trees, exhaustive schemas) is *seed* — owned by code once it exists.

**Created:** 2026-07-11 · **Method:** BMad Method (Solutioning) — Admin track
**Inputs (foundation):** Admin Product Brief + Platform Requirements · Admin Trigger Map · Admin UX Scenarios (A1–A6) · **DD-A01 / DD-A02** · consumer Architecture Spine (I1–I7) · *Vesper Brief v5* (§7–§9, §12).
**Locked calls (from planning):** unified RBAC admin app (sponsors walled) · admin auth = **WorkOS** · build spine = **ops: gate → mint → distribute** · AI-diligence = first-class · admin = authoritative on-chain control plane · Platform Admin has **no operational powers** · custody vendor = **open blocker (B1)**.

---

## Paradigm (carries the model for free)

**Desktop-first operations console + walled sponsor portal, over the same on-chain-authoritative backend.**
- **Convex** is the **RBAC + segregation-of-duties authority** and reactive read model for the admin surface (queues, scheduled functions, HTTP actions, audit, vector search for diligence).
- **Solana** remains the **source of truth for ownership, settlement, ACL, and the distribution ledger.** The admin console issues the **authoritative intent** (mint, thaw/freeze, distribute); it is the *trigger*, never the *ledger*.
- **Convex reconciles to chain via Helius; chain always wins.** The console may hold intent (pending mint/distribution) and entitlement (roles, eligibility), never authoritative ownership.

One rule to test any admin decision: *if two admin units could implement it incompatibly and the call is non-obvious, it's fixed here.*

---

## Invariants (the load-bearing admin calls)

### AI1 · One unified admin app, RBAC-gated, sponsors walled — over the shared backend
- **Consumer app** (Privy) and **Admin console** (**WorkOS**) are separate applications sharing **one Convex** backend (consumer I1). The admin app is a **single unified console**; ops, compliance, and AI-diligence are **permission-scoped views**; the **sponsor portal is a walled, tenant-isolated subsection** with no internal visibility and no cross-sponsor access.
- No consumer-wallet scope ever reaches the admin surface. No sponsor ever sees internal chrome or another sponsor's data.

### AI2 · The admin is the authoritative on-chain trigger — not the ledger
- Mint (Token-2022, ACL frozen-by-default), Token ACL **freeze/thaw**, atomic **DvP**, and the **distribution ledger** are on-chain (Anchor). The console issues authoritative intent; **Convex never self-settles** and never marks a distribution paid or a mint complete without Helius confirming on-chain (consumer I2/I3).
- Every irreversible on-chain action (mint, freeze/thaw, distribute) states **consequence + cost + finality** and is gated by **step-up auth**. On any Convex↔chain drift, **chain wins** and the discrepancy is logged.

### AI3 · Segregation of duties is structural (the integrity wall)
- **Fee/listing powers and gate-signing powers are mutually exclusive by role.** A user with a fee/listing stake in a property **cannot** sign any of its gates. Multi-party gates require a **distinct** second human signer (no self-approval).
- **Distribution, mint, and compliance powers are distinct roles.** The **Platform Admin (P6) holds no operational powers** — cannot sign a gate, mint, thaw/freeze, or distribute; it configures RBAC and holds break-glass only.
- All of the above is enforced in **Convex, per-request** — never UI-only. Violations are blocked *and logged as attempts* (AO2 measures attempts blocked).

### AI4 · The AI never approves
- The diligence AI (extraction, validation, monitoring) runs through the **Vercel AI Gateway (ZDR on)** and is **isolated from the approval path**. It renders only **flags/extractions with citations**; **a named human signs every Gate 0–7.** No code path lets an AI (or any non-human actor) write an approval or a gate signature (consumer I4; AO5).
- **Prompt-injection boundary:** untrusted sponsor documents reach only the read/extract agent; they never reach a recommend/approve or signing surface. Evidence packages are marked *assembled, not approved*.

### AI5 · Every admin action is audited — the console is the primary writer
- All money/ownership/eligibility/diligence/role state changes write an **immutable AuditLog** entry (**named-human actor**, action, target, on-chain ref, timestamp). The admin surface is the largest writer of this log; audit views are **append-only, attributable, and exportable** (regulator-ready).

### AI6 · Compliance is structural, enforced on-chain
- **KYC/AML adjudication → Token ACL eligibility state** (ineligible accounts stay frozen on-chain, cannot receive tokens). **Reg A+ per-investor caps** are enforced as **blocks**, not warnings. **Public/marketing copy cannot ship without a counsel-gated sign-off.** (consumer I5; Reg A+/NFR6.)

### AI7 · Design foundation is fixed (inherited + extended)
- The canonical **`D-Design-System/00-design-system.md` remains the single source of visual truth**; the admin surface uses its tokens **verbatim** and adds only the **data-layer extension** (`admin/D-Design-System/00-admin-design-system.md`) — density, mono-data type, operational status system. No admin component invents color/font/radius (consumer I7).

---

## Ownership of shared data (who's authoritative — admin lens)

| Data | Authority | Notes |
|------|-----------|-------|
| Token ownership / balances | **On-chain (Token-2022)** | Console reads via Helius; chain wins |
| Mint / offering listing | Console **intent** → **on-chain mint** confirms | Convex mirrors; never lists before on-chain-confirmed |
| Distributions | Console builds → **on-chain distribution ledger** confirms → Convex `IncomeLedger` mirrors | Never self-settled; custody-blocked (B1) |
| Diligence gates (0–7) + signatures | **Convex** (+ doc hashes on-chain) | AI-assisted, **human-signed**, SoD-enforced |
| Roles / RBAC / SoD config | **Convex** (fed by WorkOS directory) | Per-request enforcement; Platform Admin owns config, not ops |
| Eligibility / KYC / Reg A+ caps | **Convex** → enforced by Token ACL on-chain | Compliance-adjudicated |
| Audit log | **Convex** (append-only) | Every admin action; exportable |
| Sponsor deal / documents | **Convex** (tenant-isolated) + on-chain hashes | Walled per sponsor |

---

## Seed (true at cold-start; owned by code thereafter)

- **Stack:** Next.js/Vercel (desktop-first admin app) · Convex (shared; RBAC/SoD authority) · **WorkOS** · Anchor/Rust · Token-2022 + Token ACL · USDC + Anchor DvP + distribution ledger · Helius · Vercel AI Gateway (ZDR, injection-isolated) + Gemini embeddings.
- **Roles:** Ops/Diligence, Compliance, AI-Reviewer, Sponsor-Principal, Sponsor-Ops, **Platform-Admin (no ops powers)**.
- **Admin-relevant Convex entities** (from DD-A01/A02): Property, DiligenceGate, EvidencePackage, Mint, Distribution, DistributionEscrow, IncomeLedger, Role/Grant, Eligibility, AuditLog, SponsorDeal. *(shape owned by code; see DD-A yamls.)*
- **Vendors** (verify terms at build): WorkOS (auth/RBAC), Middesk/Qualia/HouseCanary/ATTOM (gate evidence), Persona (KYC results), ComplyAdvantage/TRM (AML), Securitize (transfer agent), DocuSign.

---

## Deferred (not fixed here — decide at the unit that needs it)

- Admin UI component tree / file structure · exact Convex schema field types · Anchor account layouts (owned by the programs) · Gate-7 anomaly-detection depth · analytics dashboards · secondary-market ops surface.

## Open decisions (block specific units)

1. **Escrow / fund-custody vendor (B1)** → blocks DD-A02 money-movement (fund + push). *(shared with consumer DD-001.)*
2. **MFA / step-up posture** → blocks signature + irreversible on-chain actions (DD-A01/A02).
3. **Internal Gate 0–7 evidence definitions + which gates are multi-party** → gate ceremony content + SoD second-signer rules.
4. **Reg A+ pre-auth marketing limits** (counsel) → A4 marketing sign-off gate.

> Resolved calls (unified RBAC app, WorkOS, Platform-Admin-no-ops, ops spine) are ratified and should not be re-litigated downstream.

---

## Feeds

This spine + **DD-A01/DD-A02** + scenarios **A3–A6** are the inputs to the admin **Epics & Stories** (next step). Altitude: initiative → the ops spine (list + distribute) is the first two epics; foundation (RBAC/SoD/audit) is the substrate epic beneath them.
