# A4: Marcus Signs Off Compliance

**Project:** Vesper — Admin & Supply Control Plane
**Created:** 2026-07-11
**Method:** Web Design Studio (WDS) — Admin track

---

## Transaction (Q1)

A set of compliance decisions goes from *"flagged for review"* to **adjudicated and attributable** — an investor's KYC/AML edge case resolved, a Reg A+ per-investor cap enforced, and a piece of public/marketing copy signed off (or blocked) — each recorded to the immutable audit trail under a named human.

---

## Business Goal (Q2)

**Goal:** Keep eligibility, caps, and solicitation airtight and provable (AO2 + Reg A+).
**Objective:** Zero ineligible investors reaching ownership, zero Reg A+ cap breaches, zero marketing shipped without sign-off — each enforced as a **block**, not a warning, and each attributable in the audit trail (the structural backing for consumer I5/NFR6).

---

## User & Situation (Q3)

**Persona:** Marcus, the Compliance Officer (**Priority 2**)
**Situation:** An investor's Persona KYC returned an edge case (name-match flag) and is close to their Reg A+ cap; separately, marketing has drafted a public teaser for The Monroe that needs sign-off before it can render pre-auth. Marcus works the compliance queue. He **cannot** mint or push distributions — his lane is eligibility, caps, marketing, and the audit trail.

---

## Driving Forces (Q4)

**Hope:** Airtight, attributable decisions; regulator-ready exports; nothing slips that he'd have to explain later.

**Worry:** An ineligible investor slipping through to ownership; a cap breach going unblocked; marketing solicitation shipping without sign-off; a gap in the audit trail.

---

## Device & Starting Point (Q5 + Q6)

**Device:** Desktop (primary)
**Entry:** WorkOS SSO → compliance console → review queue.

---

## Best Outcome (Q7)

**Operator Success:** Marcus reviews the KYC/AML case with its evidence, records an adjudication (eligible/ineligible **with a reason**), which sets the investor's **Token ACL eligibility** state on-chain; the Reg A+ cap check **blocks** an over-cap purchase before it can settle; and he signs off (or blocks) the marketing copy through the sign-off gate. Every action is attributed and audited.

**Business Success:** Eligibility and caps enforced structurally and reflected on-chain via Token ACL; no marketing renders pre-auth without his sign-off; a complete, exportable audit trail exists for any regulator read. (AO2, Reg A+, NFR6)

---

## Shortest Path (Q8)

*Linear sunshine path — no branches.*

1. **Compliance console queue** — sees cases: KYC edge case, cap question, marketing sign-off.
2. **KYC/AML case review** — reads the Persona result + ComplyAdvantage/TRM screening with source evidence; adjudicates with a recorded reason.
3. **Token ACL update** — the adjudication sets the investor's eligibility state; ineligible → ACL keeps their account frozen on-chain (can't receive tokens).
4. **Reg A+ cap check** — reviews the investor's cap usage; an over-cap purchase is **blocked** with a calm explainer (feeds the consumer-side calm limit message).
5. **Marketing sign-off gate** — reviews the public teaser against Reg A+ solicitation limits; signs off or blocks with notes (counsel-gated).
6. **Audit trail** — confirms every action is attributed + timestamped; runs a regulator-ready export. ✓

---

## Trigger Map Connections

**Persona:** Marcus (Priority 2)

**Driving Forces Addressed:**
- ✅ **Want:** Airtight eligibility + caps; attributable audit trail; marketing can't ship unsigned; clean exports.
- ❌ **Fear:** Ineligible slips through; cap breach; marketing without sign-off; audit gap.

**Business Goal:** AO2 (segregation/compliance integrity) + Reg A+ enforcement.

---

## Scenario Steps

| Step | Folder | Purpose | Exit Action |
|------|--------|---------|-------------|
| A4.1 | `A4.1-console-queue/` | Triage compliance cases | Opens a case |
| A4.2 | `A4.2-kyc-aml-review/` | Adjudicate KYC/AML with evidence + reason | Decision recorded |
| A4.3 | `A4.3-acl-update/` | Eligibility → Token ACL state on-chain | ACL set |
| A4.4 | `A4.4-rega-cap/` | Enforce Reg A+ cap (block over-cap) | Cap enforced |
| A4.5 | `A4.5-marketing-signoff/` | Sign off / block public copy | Copy adjudicated |
| A4.6 | `A4.6-audit-export/` | Confirm attribution; regulator-ready export | Scenario success ✓ |

**First step** (A4.1) carries the full entry context (Q3 + Q4 + Q5 + Q6).
