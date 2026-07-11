# Persona 2 — Marcus, the Compliance Officer

**Role:** Compliance / legal reviewer · **Priority:** 2

> *"My job is the part a regulator will read back to us. Eligibility, caps, marketing, the audit trail — it has to be airtight and attributable to a name."*

## Profile
Adjudicates KYC/AML edge cases, enforces **Reg A+ per-investor caps**, signs off public/marketing copy before it ships, and inspects the append-only **audit log**. **Cannot mint or push distributions** (segregation of duties). Thinks in evidence and attribution; a gap in the trail is a personal alarm.

## Positive driving forces (WANTS)
- **Airtight eligibility + Reg A+ caps** enforced structurally, not by vigilance
- A **complete, attributable audit trail** — every action tied to a named human
- Marketing/solicitation content that **cannot ship without sign-off**
- Clean, **regulator-ready exports** on demand

## Negative driving forces (FEARS) — design against these first
- An **ineligible investor slipping through** to ownership (strongest)
- A **Reg A+ cap breach** going unblocked
- **Marketing solicitation** shipped without counsel sign-off (Reg A+ exposure)
- A **gap or ambiguity in the audit trail** when it matters most

## Design implications
Compliance console with **adjudication queues**; cap-breach and ineligibility attempts surfaced as **blocks, not warnings**; a **marketing sign-off gate** on any public offering copy; **append-only audit views + exports**; **Token ACL eligibility state** visible and controllable; every compliance action attributed and logged. His powers are deliberately walled from mint/settlement.
