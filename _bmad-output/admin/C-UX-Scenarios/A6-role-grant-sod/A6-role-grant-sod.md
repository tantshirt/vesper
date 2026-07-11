# A6: Ravi Grants a Role / Catches an SoD Conflict

**Project:** Vesper — Admin & Supply Control Plane
**Created:** 2026-07-11
**Method:** Web Design Studio (WDS) — Admin track

---

## Transaction (Q1)

A permission change goes from *"a request to grant someone access"* to **granted safely — or blocked for a segregation-of-duties conflict** — with the tool detecting the conflict, forcing least-privilege, and auditing everything (including any break-glass). The meta-guarantee that makes every other scenario's walls real.

---

## Business Goal (Q2)

**Goal:** Keep segregation of duties structurally enforced (AO2) — even over admin management itself.
**Objective:** Zero SoD violations reach production (a fee/listing-adjacent user signing a gate; a single human able to self-approve a multi-party gate) — measured as **attempts blocked**, and every grant/break-glass attributable in the audit trail.

---

## User & Situation (Q3)

**Persona:** Ravi, the Platform Admin (**Priority 6 — enabling, not operational**)
**Situation:** A new ops hire needs gate-signing rights; separately, a manager has requested giving a billing-adjacent user gate-signing access (a conflict). And a genuine incident needs a break-glass grant. Ravi configures the walls — but he himself **holds no operational powers** (he cannot sign a gate, mint, thaw/freeze, or push a distribution).

---

## Driving Forces (Q4)

**Hope:** Clean least-privilege roles; provable segregation of duties; break-glass that is itself audited; no silent god-mode.

**Worry:** A misconfiguration that lets a fee-adjacent user sign a gate; privilege creep accumulating unnoticed; an unaudited break-glass action; being a single point of god-mode failure.

---

## Device & Starting Point (Q5 + Q6)

**Device:** Desktop (primary)
**Entry:** WorkOS SSO → RBAC / role management.

---

## Best Outcome (Q7)

**Operator Success:** Ravi grants the new hire least-privilege ops rights cleanly; when the conflicting grant is proposed, the tool **detects and blocks it** with the exact SoD reason ("this user manages listing billing — cannot also sign gates"); the break-glass grant requires a **mandatory reason + audit entry + compliance notification** and is time-boxed. His own account is provably non-operational.

**Business Success:** SoD is enforced by the tool, not by vigilance (AO2); every permission change and break-glass is attributable; the walls behind A1–A5 are demonstrably real. (AO2 structural)

---

## Shortest Path (Q8)

*Linear sunshine path — no branches.*

1. **Role management** — opens the RBAC surface; sees roles, grants, and current SoD posture.
2. **Grant (valid)** — selects the new ops hire; proposes least-privilege ops rights; the tool confirms no conflict; applies + audits.
3. **Grant (conflict)** — proposes gate-signing for a billing-adjacent user; **SoD conflict detection blocks it** with the reason and the rule violated (fee-vs-gate).
4. **Break-glass** — for the incident, initiates a break-glass grant; the tool **requires a reason**, writes an audit entry, **notifies compliance**, and time-boxes the grant.
5. **Self-check** — the surface shows Ravi's own account has **no operational powers** (configures walls, can't act inside them); every action here is in the AuditLog. ✓

---

## Trigger Map Connections

**Persona:** Ravi (Priority 6)

**Driving Forces Addressed:**
- ✅ **Want:** Clean least-privilege roles; provable SoD; audited break-glass; no silent god-mode.
- ❌ **Fear:** A misconfig letting fee touch a gate; privilege creep; unaudited break-glass; single-point god-mode.

**Business Goal:** AO2 (segregation of duties enforced structurally, even over admin management).

---

## Scenario Steps

| Step | Folder | Purpose | Exit Action |
|------|--------|---------|-------------|
| A6.1 | `A6.1-role-management/` | See roles, grants, SoD posture | Selects a user |
| A6.2 | `A6.2-grant-valid/` | Apply a least-privilege grant (no conflict) | Grant applied |
| A6.3 | `A6.3-grant-conflict/` | SoD conflict detection blocks a fee-vs-gate grant | Conflict blocked |
| A6.4 | `A6.4-break-glass/` | Reason + audit + compliance notify + time-box | Break-glass logged |
| A6.5 | `A6.5-self-check/` | Confirm admin has no operational powers | Scenario success ✓ |

**First step** (A6.1) carries the full entry context (Q3 + Q4 + Q5 + Q6).
