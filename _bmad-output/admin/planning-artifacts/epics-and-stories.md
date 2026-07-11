---
stepsCompleted: ["design-epics", "create-stories"]
inputDocuments:
  - "admin/A-Product-Brief/project-brief.md"
  - "admin/A-Product-Brief/platform-requirements.md"
  - "admin/B-Trigger-Map/ (trigger-map + 6 personas + feature-impact)"
  - "admin/C-UX-Scenarios/ (A1–A6)"
  - "admin/D-Design-System/00-admin-design-system.md"
  - "admin/E-Development/DD-A01-list-a-property.yaml"
  - "admin/E-Development/DD-A02-push-a-distribution.yaml"
  - "admin/planning-artifacts/architecture.md (admin spine AI1–AI7)"
---

# Vesper — Admin & Supply Control Plane · Epic Breakdown

## Overview

Decomposes the **admin/supply control plane** into implementable stories, derived from the Admin Product Brief, the admin Trigger Map, the admin UX scenarios (A1–A6), the admin design-system extension, the delivery contracts **DD-A01** (List a Property) and **DD-A02** (Push a Distribution), and the **admin Architecture Spine (AI1–AI7)**. The ops spine (**gate → mint → distribute**) is the backbone of the build; foundation/RBAC wraps it, and sponsor + compliance + AI-diligence feed it. This is the **supply-side counterpart** to the consumer epics (E1–E5) and shares one Convex backend.

## Requirements Inventory

### Functional Requirements
- **AFR1** WorkOS SSO; RBAC roles resolved in Convex **per-request**; one unified console with permission-scoped views; sponsor portal **walled + tenant-isolated**. *(AI1)*
- **AFR2** **Segregation of duties**: fee/listing powers and gate-signing powers mutually exclusive; multi-party gates require a distinct second signer; Platform Admin has **no operational powers**; violations blocked **and logged as attempts**. *(AI3)*
- **AFR3** Every admin money/ownership/eligibility/diligence/role change writes an **immutable AuditLog** (named actor, action, target, on-chain ref, timestamp); append-only + exportable. *(AI5)*
- **AFR4** AI diligence renders **flags/extractions with citations only** (cite-or-refuse), **injection-isolated**; evidence is *assembled, not approved*; no path lets the AI sign/approve. *(AI4)*
- **AFR5** **Gate signature ceremony**: Gates 0–7 human-signed against evidence; a property **cannot list** unless all are signed; distinct second signer where a gate is multi-party. *(AI3/AI4)*
- **AFR6** **Mint console**: Token-2022 mint with ACL **frozen-by-default**; confirm states consequence + cost + **finality** and requires **step-up auth**; list only **after on-chain-confirmed**. *(AI2)*
- **AFR7** **Reconciliation**: Helius confirms mint/distribution; on Convex↔chain drift **chain wins**, logged + surfaced. *(AI2)*
- **AFR8** **Distribution builder**: waterfall gross → costs → **management fee (inside net — not re-charged)** → reserve → net-per-token; **matches-target** check before push. *(AI2)*
- **AFR9** **Distribution fund + push**: fund escrow *(BLOCKED: custody B1)*; push with finality + step-up; **Convex never self-settles**. *(AI2)*
- **AFR10** **Compliance**: KYC/AML adjudication → **Token ACL eligibility** (ineligible stays frozen on-chain); Reg A+ per-investor caps enforced as **blocks**. *(AI6)*
- **AFR11** **Marketing sign-off gate**: public/marketing copy cannot ship without a counsel-gated sign-off. *(AI6, Reg A+)*
- **AFR12** **Sponsor intake**: walled + tenant-isolated; KYB/UBO → Gate 0; document upload with **validation**; e-sign; diligence **status timeline**. *(AI1)*
- **AFR13** **Monthly-update composer** + **overdue flagging** (scheduled fn) — authors the consumer-visible update. *(AO4)*
- **AFR14** **Sponsor funding/holder dashboard** — own deal only. *(AI1)*
- **AFR15** **Platform Admin**: RBAC/role management with **SoD-conflict detection**; **break-glass** with mandatory reason + audit + compliance notification; no operational powers. *(AI3)*

### NonFunctional Requirements
- **ANFR1** Desktop-first, data-dense; review queues virtualized (10k+ rows) with <100ms interaction.
- **ANFR2** WCAG 2.2 AA: visible focus, 44px interactive rows, tabular money, **status = color + icon + label** (never color alone), mono-data on-chain values (copyable).
- **ANFR3** On-chain authoritative; **Convex never self-settles**; **step-up auth** on irreversible on-chain actions.
- **ANFR4** The AI is **never** shown as approver anywhere; prompt-injection boundary; AI Gateway ZDR on.
- **ANFR5** Segregation of duties enforced **server-side in Convex, per-request** — never UI-only.
- **ANFR6** **Tenant isolation** for sponsors; no cross-sponsor or internal-surface leakage.
- **ANFR7** Canonical design tokens inherited **verbatim**; admin data-layer extension only (no new visual language).

### UX Design Requirements
- **AUX1** `D-Design-System/00-design-system.md` + `admin/D-Design-System/00-admin-design-system.md` are the single source of visual truth. *(AI7)*
- **AUX2** Build to the A1–A6 scenario specs and DD-A01/DD-A02 contracts.
- **AUX3** **Evidence-first, accountable-by-name**; every irreversible on-chain action states consequence + cost + finality before confirm.

### FR Coverage Map
| FR | Epic(s) | FR | Epic(s) |
|----|---------|----|---------|
| AFR1 | AE1 | AFR9 | AE4 |
| AFR2 | AE1 | AFR10 | AE5 |
| AFR3 | AE1 (cross-cutting) | AFR11 | AE5 |
| AFR4 | AE2 | AFR12 | AE6 |
| AFR5 | AE3 | AFR13 | AE6 |
| AFR6 | AE3 | AFR14 | AE6 |
| AFR7 | AE3, AE4 | AFR15 | AE1 |
| AFR8 | AE4 | ANFR1–7, AUX1–3 | AE1 (foundation) + honored in every epic |

## Epic List
1. **AE1 · Admin Foundation, RBAC & Segregation of Duties** — the substrate: WorkOS auth, per-request RBAC, SoD enforcement, AuditLog, Platform Admin, design-system extension.
2. **AE2 · Diligence & AI Evidence** — injection-isolated AI extraction/flag review; human-verified evidence assembly (A5). Feeds the gate ceremony.
3. **AE3 · Gate → Mint → List** — the supply spine write path: gate signature ceremony, mint console, listing, reconcile (A1 / DD-A01). ★
4. **AE4 · Distributions** — settlement spine: waterfall builder, fund, push, reconcile (A2 / DD-A02). Money-movement BLOCKED on custody.
5. **AE5 · Compliance & Reg A+** — KYC/AML adjudication → Token ACL, Reg A+ caps, marketing sign-off, audit export (A4).
6. **AE6 · Sponsor Portal** — walled intake, KYB/Gate 0, upload/validation, status timeline, monthly-update composer, funding/holder dashboard (A3).

---

## Epic AE1: Admin Foundation, RBAC & Segregation of Duties

Stand up the desktop-first admin app, its auth/RBAC substrate, the segregation-of-duties engine, the audit backbone, and the design-system extension — so every later admin story inherits correct roles, walls, and provability. Delivers no operator flow alone but makes all of them safe.

### Story AE1.1: Admin app scaffold + WorkOS auth + per-request RBAC
As a developer, I want the desktop-first admin app wired to WorkOS and Convex RBAC, so that every surface is role-scoped and shares the consumer backend without leaking scope.
**Acceptance Criteria:**
**Given** the admin app is scaffolded (Next.js App Router on Vercel, desktop-first, shared Convex) **When** a staff user signs in with WorkOS SSO **Then** their roles resolve in Convex and every query/mutation is checked **per-request** **And** no consumer-wallet scope is reachable from this surface. *(AFR1, AI1)*
**Given** the six roles (Ops, Compliance, AI-Reviewer, Sponsor-Principal, Sponsor-Ops, Platform-Admin) **When** a user opens the console **Then** they see only their permission-scoped views. *(AFR1)*

### Story AE1.2: Segregation-of-duties engine
As the platform, I want SoD enforced server-side, so that fee interests can never touch a gate and no one can self-approve.
**Acceptance Criteria:**
**Given** a user with a fee/listing stake in a property **When** they attempt to sign any of its gates **Then** Convex **blocks** the action with the rule + the required distinct signer **And** the attempt is written to the AuditLog. *(AFR2, AI3, AO2)*
**Given** a multi-party gate **When** the same human attempts both signatures **Then** the second is blocked as self-approval. *(AFR2)*
**Given** the Platform Admin role **When** it attempts any operational action (sign/mint/thaw/freeze/distribute) **Then** it is blocked — the role has no operational powers. *(AFR15, AI3)*

### Story AE1.3: Immutable AuditLog + views/export
As compliance, I want every admin action logged and inspectable, so that any decision is provable to a regulator.
**Acceptance Criteria:**
**Given** any admin money/ownership/eligibility/diligence/role change **When** it commits **Then** an immutable AuditLog entry is written (named-human actor, action, target, on-chain ref, timestamp) **And** it is append-only, attributable, and exportable. *(AFR3, AI5)*

### Story AE1.4: Platform Admin — RBAC management + break-glass
As a Platform Admin, I want to manage roles with conflict detection and audited break-glass, so that the walls are provably correct and I hold no god-mode.
**Acceptance Criteria:**
**Given** a proposed grant **When** it would create an SoD conflict (fee-vs-gate) **Then** the role matrix flags/blocks it with the reason. *(AFR15, AI3)*
**Given** a break-glass action **When** it is initiated **Then** it requires a mandatory reason, writes an audit entry, notifies compliance, and is time-boxed. *(AFR15)*

### Story AE1.5: Admin design-system extension as code
As a developer, I want the admin data layer implemented over the canonical tokens, so that every admin screen is consistent and inherits the brand verbatim.
**Acceptance Criteria:**
**Given** `D-Design-System` + `admin/D-Design-System` **When** the theme/components are built **Then** tables, review queues, doc viewer, gate-ceremony card, on-chain action panel, status chips (color + icon + label), and mono-data are available as tokens/components **And** a component cannot introduce a non-token color/font/radius in review. *(AUX1, ANFR2, ANFR7)*

---

## Epic AE2: Diligence & AI Evidence

The human-in-the-loop that keeps the AI out of the approval path. AI accelerates extraction; a named human (Dana) verifies every citation and assembles evidence for the gate signer.

### Story AE2.1: AI extraction + flag review (injection-isolated)
As an AI-Diligence Reviewer, I want to review AI extractions with sources, so that only verified facts reach a signer.
**Acceptance Criteria:**
**Given** uploaded sponsor documents **When** the extract agent runs **Then** every extracted field shows a **source link + confidence** and any field without a source is **not presentable as fact** (cite-or-refuse). *(AFR4, AI4)*
**Given** untrusted sponsor documents **When** they are processed **Then** they reach only the read/extract agent and **never** a recommend/approve or signing surface (prompt-injection boundary). *(AFR4, ANFR4)*

### Story AE2.2: Evidence verification + assembly
As an AI-Diligence Reviewer, I want to verify/reject flags and assemble an evidence package, so that the signer receives clean, cited evidence.
**Acceptance Criteria:**
**Given** the document viewer **When** I inspect a flag **Then** a flag/diff overlay shows the source region vs. the AI's claim **And** I can verify or **reject** it with a note; rejected items do not advance. *(AFR4, AUX3)*
**Given** verified items **When** I assemble the package **Then** it is marked **"assembled, not approved,"** I have **no sign capability**, and it routes to the gate signer. *(AFR4, AI4)*

---

## Epic AE3: Gate → Mint → List  ★ (the supply spine)

The signature journey. Sign every gate as a named human, mint the offering on-chain, list it — the act that makes the consumer Trust Stack and on-chain proof real.

### Story AE3.1: Diligence workspace + gate signature ceremony
As a Diligence Officer, I want to review evidence and sign each gate as a named human, so that only fully-diligenced property can list.
**Acceptance Criteria:**
**Given** a property with assembled evidence (AE2) **When** I open the diligence workspace **Then** I see Gates 0–7, each with its evidence + source links + AI flags rendered as flags (never approvals). *(AFR5, AI4)*
**Given** a gate **When** I sign it **Then** the signature attributes to me by name with a consequence statement **And** where the gate is multi-party a distinct second signer is required **And** a fee-adjacent signer is blocked (AE1.2). *(AFR5, AI3)*
**Given** a property **When** any gate is unsigned **Then** it cannot advance to mint/list (hard, server-enforced). *(AFR5)*

### Story AE3.2: Mint & listing console
As a Diligence Officer, I want to mint and list the offering safely, so that I never fat-finger an irreversible on-chain action.
**Acceptance Criteria:**
**Given** all gates signed **When** I open the mint console **Then** I configure a Token-2022 mint with ACL **frozen-by-default**, and the confirm states exact supply + cost + **finality** ("irreversible") and requires **step-up auth**. *(AFR6, AI2, AUX3)*
**Given** a successful mint **When** it is on-chain-confirmed via Helius **Then** the offering can be listed to the consumer Explore surface — never before confirmation. *(AFR6, AFR7)*

### Story AE3.3: Mint reconciliation
As the platform, I want the mint reconciled to chain, so that the read model can never diverge from truth.
**Acceptance Criteria:**
**Given** a mint **When** Helius reports on-chain state **Then** Convex mirrors it **And** on any Convex↔chain conflict **chain wins**, the discrepancy is logged and surfaced in the reconciliation banner. *(AFR7, AI2)*

---

## Epic AE4: Distributions

The settlement half of the ops spine: compute the waterfall, fund, push on-chain, reconcile — the back office behind "Rent just landed." **Money-movement is BLOCKED on the custody vendor (B1).**

### Story AE4.1: Distribution builder + matches-target
As a Diligence Officer, I want to compute the exact distribution waterfall, so that owners are paid the right number.
**Acceptance Criteria:**
**Given** operator numbers (from AE6 monthly submission) **When** I build a distribution **Then** it computes gross rent → costs → **management fee (shown as already inside net — not re-charged)** → reserve → net-per-token in tabular figures. *(AFR8, AI2)*
**Given** the built distribution **When** I review it **Then** it confirms net **matches target**, or surfaces the variance + reason before I can push. *(AFR8)*

### Story AE4.2: Fund + push on-chain *(BLOCKED: custody B1)*
As a Diligence Officer, I want to fund and push the distribution safely, so that no dollar moves unprovably.
**Acceptance Criteria:**
**Given** a built distribution **When** I fund the escrow *(BLOCKED: custody vendor B1)* and push **Then** the push states consequence + cost + finality and requires step-up auth **And** Convex marks it settled **only after** Helius confirms on-chain — Convex never self-settles. *(AFR9, AI2, ANFR3)*
**Given** a push failure **When** the on-chain tx fails **Then** no owner is marked paid, the failure is audited, and a clean retry is offered. *(AFR9)*

### Story AE4.3: Distribution reconciliation + paused-with-reason
As the platform, I want distributions reconciled and never silent, so that the consumer income view always has a truthful state.
**Acceptance Criteria:**
**Given** a pushed distribution **When** Helius confirms **Then** Convex `IncomeLedger` mirrors it; on drift **chain wins** + logged. *(AFR7, AI2)*
**Given** insufficient cash flow or missing operator numbers **When** a distribution cannot proceed **Then** it is paused with an explicit reason that feeds the consumer "why paused" income state — never silent. *(AFR8/AFR9 edge)*

---

## Epic AE5: Compliance & Reg A+

The legal safety net: adjudicate eligibility, enforce caps, gate marketing, keep the trail exportable.

### Story AE5.1: KYC/AML adjudication → Token ACL eligibility
As a Compliance Officer, I want to adjudicate identity/AML cases and set eligibility, so that only eligible accounts can own.
**Acceptance Criteria:**
**Given** a KYC/AML case (Persona + ComplyAdvantage/TRM) **When** I adjudicate it with a recorded reason **Then** the decision sets the investor's **Token ACL eligibility** state on-chain; ineligible accounts stay frozen and cannot receive tokens. *(AFR10, AI6)*

### Story AE5.2: Reg A+ per-investor cap enforcement
As a Compliance Officer, I want Reg A+ caps enforced as blocks, so that no investor exceeds their limit.
**Acceptance Criteria:**
**Given** an investor near/over their Reg A+ cap **When** a purchase would breach it **Then** it is **blocked** (not warned), with a calm explainer that feeds the consumer-side limit message. *(AFR10, AI6)*

### Story AE5.3: Marketing sign-off gate + audit export
As a Compliance Officer, I want to gate public copy and export the trail, so that solicitation is compliant and provable.
**Acceptance Criteria:**
**Given** public/marketing copy **When** it awaits release **Then** it cannot ship without my counsel-gated sign-off (or is blocked with notes). *(AFR11, Reg A+)*
**Given** the audit log **When** I need a regulator-ready record **Then** I can export an attributable, append-only trail. *(AFR3)*

---

## Epic AE6: Sponsor Portal

The walled, tenant-isolated external surface that feeds supply and keeps the monthly-update promise.

### Story AE6.1: Walled sponsor onboarding + KYB/Gate 0
As a Sponsor Principal, I want to onboard and pass KYB, so that I can bring a deal without exposure to other sponsors.
**Acceptance Criteria:**
**Given** a WorkOS sponsor invite **When** I sign in **Then** I see only my own tenant — no internal surfaces, no other sponsors. *(AFR12, ANFR6)*
**Given** onboarding **When** I complete KYB/UBO (Middesk) **Then** Gate 0 passes as the precondition for any listing. *(AFR12)*

### Story AE6.2: Intake checklist + validated upload + status timeline
As a Sponsor Ops Lead, I want a clear checklist with validation and status, so that I submit complete, correct docs and always know where the deal stands.
**Acceptance Criteria:**
**Given** the intake checklist **When** I upload a document **Then** it is validated on upload and the wrong/incomplete doc is rejected early with a plain reason. *(AFR12)*
**Given** a submitted deal **When** diligence proceeds **Then** a status timeline shows passed / pending / needs-you states. *(AFR12)*

### Story AE6.3: Monthly-update composer + overdue flagging
As a Sponsor Ops Lead, I want to author the monthly update with reminders, so that the consumer promise (an update every month) is kept.
**Acceptance Criteria:**
**Given** a live property **When** a month closes **Then** the composer prompts a monthly update (named operator, occupancy, reserves, rent-on-time, plain note) — including uneventful months **And** a scheduled function flags any property overdue for an update. *(AFR13, AO4)*

### Story AE6.4: Sponsor funding/holder dashboard
As a Sponsor Principal, I want to see my offering's funding and holders, so that I have visibility into my own deal only.
**Acceptance Criteria:**
**Given** my live offering **When** I open my dashboard **Then** I see funding progress + holders for my deal only — never another sponsor's, never internal data. *(AFR14, ANFR6)*

---

## Notes
- **Sequence:** AE1 (substrate) → AE6 intake + AE2 evidence (feed supply) → **AE3 (spine: gate→mint→list)** → **AE4 (distributions)** → AE5 alongside from AE3. AE3 is demoable earliest against the consumer seed (The Monroe).
- **Blocking open decisions** (from admin architecture): **custody vendor B1** (AE4 money-movement), **MFA/step-up posture** (AE3/AE4 irreversible actions), **internal Gate 0–7 evidence defs + which are multi-party** (AE3), **Reg A+ pre-auth marketing limits** (AE5). Resolve before the affected stories leave "ready."
- **Cross-cutting:** AuditLog (AE1.3) and SoD (AE1.2) are inherited by every write path; the design-system extension (AE1.5) by every screen.
- **Out of scope here:** Gate-7 continuous-monitoring/anomaly depth, mass-distribution scale (ZK compression), secondary-market ops surface, deep analytics dashboards (all COULD-tier).
- **Shared backend:** these epics share one Convex deployment with the consumer app; the admin surface is the *supply/write* side of the same entities the consumer app *reads*.
- Next Solutioning step: **Check Implementation Readiness (IR)**, then **Sprint Planning (SP)**.
