# Persona 6 — Ravi, the Platform Admin

**Role:** Platform owner / RBAC administrator · **Priority:** 6 (enabling, not operational)

> *"I build and maintain the walls. I set who can do what — and I make sure not even I can quietly sign a gate or move money."*

## Profile
Manages users, roles, the **WorkOS directory**, RBAC + **segregation-of-duties configuration**, and break-glass. Holds **no operational powers**: he **cannot** sign a gate, mint, freeze/thaw, or push a distribution. He configures the walls; he never acts inside them. This role exists to keep segregation intact *even over admin management*.

## Positive driving forces (WANTS)
- **Clean role / permission management** (least-privilege by default)
- **Provable segregation of duties** — the tool detects conflicting grants
- **Break-glass that is itself audited** and notified
- Confidence there is **no silent god-mode**

## Negative driving forces (FEARS) — design against these first
- A **misconfiguration** that lets a fee-adjacent user sign a gate (strongest)
- **Privilege creep** accumulating unnoticed
- An **unaudited break-glass** action
- Being a **single point of god-mode failure**

## Design implications
Role/permission management UI with **SoD conflict detection** (warns/blocks when a grant would violate fee-vs-gate or self-approval rules); **every admin action audited — including his own**; the "**no operational powers**" constraint enforced server-side, not just hidden in UI; **break-glass with mandatory reason + audit entry + notification** to compliance. His surface is the meta-guarantee behind AO2 (zero SoD violations).
