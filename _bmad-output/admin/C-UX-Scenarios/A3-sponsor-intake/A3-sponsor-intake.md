# A3: Ken & Sofia Bring a Deal (Sponsor Intake)

**Project:** Vesper — Admin & Supply Control Plane
**Created:** 2026-07-11
**Method:** Web Design Studio (WDS) — Admin track

---

## Transaction (Q1)

An external sponsor goes from *"I have a real building I want to list"* to a **submitted, diligence-ready deal** in Vesper's pipeline — KYB (Gate 0) passed, required documents uploaded and validated, legal docs e-signed, and a live diligence status timeline. All inside the **walled sponsor portal**, tenant-isolated.

---

## Business Goal (Q2)

**Goal:** Feed the supply funnel with real, complete deals (front of AO1) and set up the on-time monthly-update habit (AO4).
**Objective:** Clean, first-pass-complete submissions that let the internal gate work (A1) proceed without back-and-forth — and a sponsor who trusts the process enough to keep bringing deals.

---

## User & Situation (Q3)

**Personas:** Ken, the Sponsor Principal (**decides/ signs**) + Sofia, the Sponsor Ops Lead (**does the legwork**)
**Situation:** Ken has decided to list The Monroe on Vesper and got an invite. Sofia will actually assemble and upload the documents. Neither can see any internal Vesper surface or any other sponsor — they see only their own deal.

---

## Driving Forces (Q4)

**Hope (Ken):** A clear checklist, a fast predictable process, and his sensitive financials kept private.
**Hope (Sofia):** Obvious what's-missing, easy upload with validation, and reminders before anything is due.

**Worry:** An opaque, slow, goalpost-moving process; a data leak to competitors; submitting the wrong/incomplete document and not knowing.

---

## Device & Starting Point (Q5 + Q6)

**Device:** Desktop (sponsor portal)
**Entry:** WorkOS SSO from an emailed sponsor invite → guided onboarding.

---

## Best Outcome (Q7)

**Sponsor Success:** Ken passes KYB/UBO (Gate 0), Sofia uploads every required document against a checklist that validates on upload, Ken e-signs the legal docs, and they submit — then watch a **diligence status timeline** that always tells them where the deal stands. Their data stays tenant-isolated.

**Business Success:** A complete, first-pass-clean submission enters the gate pipeline (A1) with evidence ready for AI-diligence (A5); the monthly-update composer is primed for AO4 once live. The listing fee is collected — and is **structurally walled from any gate decision** (I5); Ken never sees gate internals.

---

## Shortest Path (Q8)

*Linear sunshine path — no branches.*

1. **Invite + SSO** — accepts the WorkOS invite; lands in the walled sponsor portal (own tenant only).
2. **KYB / Gate 0** — completes KYB + UBO (Middesk); passes Gate 0 (the pre-condition for anything listing).
3. **Intake checklist** — sees the explicit list of what's required (title, valuation inputs, financials, legal, operator history).
4. **Document upload** — Sofia uploads each item; **validation on upload** rejects the wrong/incomplete doc early with a plain reason.
5. **E-sign** — Ken e-signs the legal package (DocuSign).
6. **Submit** — the deal enters the pipeline; a **diligence status timeline** shows passed / pending / needs-you states.
7. **Monthly-update primer** — the monthly-update composer is introduced with its cadence + reminders (sets up AO4). ✓

---

## Trigger Map Connections

**Personas:** Ken (Principal) + Sofia (Ops)

**Driving Forces Addressed:**
- ✅ **Want:** Clear checklist, fast predictable diligence, private/tenant-isolated data, obvious what's-missing, reminders.
- ❌ **Fear:** Opaque/slow/goalpost-moving; data leak; submitting a wrong/incomplete doc; not knowing where the deal stands.

**Business Goal:** Supply funnel (feeds AO1) + AO4 setup (monthly updates).

---

## Scenario Steps

| Step | Folder | Purpose | Exit Action |
|------|--------|---------|-------------|
| A3.1 | `A3.1-invite-sso/` | Enter the walled, tenant-isolated portal | Onboarded |
| A3.2 | `A3.2-kyb-gate0/` | KYB/UBO → pass Gate 0 (pre-condition) | Gate 0 passed |
| A3.3 | `A3.3-intake-checklist/` | Show exactly what's required | Starts uploading |
| A3.4 | `A3.4-doc-upload/` | Upload with validation; reject wrong docs early | Docs complete |
| A3.5 | `A3.5-esign/` | E-sign the legal package | Signed |
| A3.6 | `A3.6-submit-status/` | Submit → diligence status timeline | Deal in pipeline |
| A3.7 | `A3.7-update-primer/` | Introduce monthly-update cadence + reminders | Scenario success ✓ |

**First step** (A3.1) carries the full entry context (Q3 + Q4 + Q5 + Q6).
