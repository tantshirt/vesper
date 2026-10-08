# UX Scenarios: Vesper — Admin & Supply Control Plane

> Admin Phase C (Freya) — linear "sunshine path" scenarios that expose every admin/sponsor view for design scrutiny. Each scenario = one persona + one goal + one outcome, tied to the admin Trigger Map driving forces. The **supply-side companion** to the consumer scenario set.

**Created:** 2026-07-11 · **Author:** Dre · **Owner:** Freya
**Prerequisites:** [Admin Product Brief](../A-Product-Brief/project-brief.md) · [Admin Trigger Map](../B-Trigger-Map/trigger-map.md) · [Admin Platform Requirements](../A-Product-Brief/platform-requirements.md)
**Surface type:** Desktop-first internal console + walled sponsor portal · **Scale:** ~24 views, comprehensive coverage

---

## Scenarios

| # | Scenario | Persona (priority) | Core operator fear answered | Serves |
|---|----------|--------------------|-----------------------------|--------|
| [A1 ★](./A1-list-a-property/A1-list-a-property.md) | Priya lists a property (gate → mint → list) | P1 Ops (**primary**) | "Did I let something unfit through?" + fat-finger the mint | **AO1**, AO5 |
| [A2 ★](./A2-push-a-distribution/A2-push-a-distribution.md) | Priya pushes a distribution | P1 Ops (primary) | "Did money move wrong / unprovably?" | **AO3** |
| [A3](./A3-sponsor-intake/A3-sponsor-intake.md) | Ken & Sofia bring a deal | P4 + P5 Sponsor | "Opaque, slow, will my data leak?" | Supply funnel, AO4 setup |
| [A4](./A4-compliance-signoff/A4-compliance-signoff.md) | Marcus signs off compliance | P2 Compliance | "Ineligible slips / cap breach / audit gap" | AO2, Reg A+ |
| [A5](./A5-ai-diligence-review/A5-ai-diligence-review.md) | Dana reviews AI diligence | P3 AI-review | "Uncited fact reaches a signer / injected doc" | **AO5**, I4 |
| [A6](./A6-role-grant-sod/A6-role-grant-sod.md) | Ravi grants a role / catches an SoD conflict | P6 Platform admin | "A misconfig lets fee touch a gate" | **AO2** (structural) |

> The three operator fears (unfit? · money-wrong? · provable?) each get a dedicated journey: **A1** (unfit?), **A2** (money-wrong?), and provability runs through all three via the AuditLog + reconciliation. **A1 is the deep signature journey** — the admin analog of consumer Property Detail — where supply integrity is enforced and made real.

---

## View Coverage Matrix

Every admin/sponsor view appears in at least one scenario (comprehensive coverage). **Bold** = the scenario that owns the view's primary design.

| View | A1 | A2 | A3 | A4 | A5 | A6 |
|------|:--:|:--:|:--:|:--:|:--:|:--:|
| WorkOS SSO login | ● | | ● | | | |
| Ops dashboard / work queue | **●** | ● | | | | |
| Property submission review | **●** | | ● | | | |
| Diligence workspace (gate list + evidence) | **●** | | | | ● | |
| **Gate signature ceremony ★** | **●** | | | | | |
| SoD second-signer prompt | **●** | | | | | ● |
| Mint & listing console | **●** | | | | | |
| Token ACL config (frozen-by-default) | **●** | | | ● | | |
| Distribution builder (waterfall compute) | | **●** | | | | |
| Distribution funding / escrow *(BLOCKED: custody)* | | **●** | | | | |
| Distribution push + on-chain confirm | | **●** | | | | |
| Reconciliation / settlement monitor | ● | **●** | | | | |
| Compliance console (KYC/AML adjudication) | | | | **●** | | |
| Reg A+ cap check | | | | **●** | | |
| Marketing sign-off gate | | | | **●** | | |
| Audit log viewer / export | | ● | | **●** | | ● |
| Sponsor: intake checklist | | | **●** | | | |
| Sponsor: KYB / Gate 0 | | | **●** | | | |
| Sponsor: document upload (validation) | | | **●** | | ● | |
| Sponsor: diligence status timeline | | | **●** | | | |
| Sponsor: monthly-update composer | | ● | **●** | | | |
| Sponsor: funding / holder dashboard | ● | | **●** | | | |
| AI extraction / flag review | | | | | **●** | |
| Document viewer + flag/diff overlay | ● | | | | **●** | |
| RBAC / role management (SoD-aware) | | | | | | **●** |
| Break-glass (reason + audit + notify) | | | | | | **●** |

**Coverage: 26/26 views** ✓ · No orphan views · The Diligence Workspace + gate ceremony is the multi-faceted hub (A1), the admin equivalent of Property Detail.

---

## Design inversions to honor (from the brief)

Every scenario is designed against the consumer defaults, deliberately:
- **Desktop-first, data-dense** (not mobile-first).
- **Crypto explicit & operated** — mint, ACL, DvP, distribution, hashes shown with exact values, finality, cost (not hidden).
- **Evidence-first & accountable-by-name** — every state links to a source and a named human (not "calm reassurance").
- **Irreversible actions** state consequence + cost + finality and require step-up auth before confirm.
- **The AI never approves** — it flags/extracts with citations feeding a human signer.

---

## Out of scope (this pass)

- **Consumer app** — separate surface (Privy), already specified in the consumer scenario set.
- **COULD-tier deferred** (from Admin Trigger Map): Gate-7 anomaly-detection depth, mass-distribution scale (ZK compression), secondary-market ops surface, deep analytics dashboards — represented lightly, flagged not-MVP-critical; do not let specs silently expand them.
- **Custody-dependent surfaces** (distribution funding/escrow in A2) are designed but flagged `BLOCKED: custody vendor (B1)`.

---

## Next: Admin Phase D (Design-System extension) → Delivery Contracts

Freya extends the canonical design system for admin density (tables, review queues, doc viewers, signature ceremony, on-chain action panels, RBAC/status chips), beginning with **A1 · the gate signature ceremony** (the signature screen). All from existing tokens — no new visual language.

---

_Generated by Web Design Studio — Admin track_
