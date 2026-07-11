# A5: Dana Reviews AI Diligence

**Project:** Vesper — Admin & Supply Control Plane
**Created:** 2026-07-11
**Method:** Web Design Studio (WDS) — Admin track

---

## Transaction (Q1)

A pile of sponsor documents goes from *"raw upload"* to an **assembled, cited evidence package ready for a human signer** — the AI having extracted and flagged, a human having verified every citation and rejected what doesn't hold, and the package handed to the gate signer (Priya) with the AI **never** styled as an approver.

---

## Business Goal (Q2)

**Goal:** Accelerate diligence without ever letting the AI approve (AO5 / I4).
**Objective:** Zero AI-authored approvals or uncited "facts" reaching a signer; every flag traceable to a source; the prompt-injection boundary held — so that Priya's gate signatures (A1) rest on verified evidence, not model output.

---

## User & Situation (Q3)

**Persona:** Dana, the AI-Diligence Reviewer (**Priority 3**)
**Situation:** The Monroe's documents (title, appraisal, financials, operating history) are uploaded from A3. The extraction agent has run and produced structured fields + flags. Dana opens the review surface to check the AI's work before any of it can reach a signer. She **cannot sign** — she assembles evidence.

---

## Driving Forces (Q4)

**Hope:** Fast, well-cited extraction she can trust; to catch the thing the model missed — or invented.

**Worry:** A hallucinated or uncited "fact" reaching a signer as if verified; a prompt-injected document steering a recommendation; being mistaken for the approver.

---

## Device & Starting Point (Q5 + Q6)

**Device:** Desktop (primary — document-heavy, multi-pane)
**Entry:** WorkOS SSO → AI-diligence queue → The Monroe.

---

## Best Outcome (Q7)

**Operator Success:** Dana reviews each extracted field against its **source page** with a confidence signal, opens the document viewer with **flag/diff overlays**, catches a valuation figure the model mis-extracted (an appraisal/offering mismatch), rejects it with a note, and assembles a clean, cited evidence package — handing it to the signer with an explicit *"assembled by Dana — evidence only, not an approval"* state.

**Business Success:** The gate signer (A1) receives verified, cited evidence, never raw model output; the injection boundary held (untrusted docs never reached a recommend/approve surface); the audit trail shows AI-assisted, human-verified, human-to-be-signed. (AO5, I4)

---

## Shortest Path (Q8)

*Linear sunshine path — no branches.*

1. **AI-diligence queue** — opens The Monroe's extraction results.
2. **Extraction review** — each field shows the AI's value + **source link + confidence**; cite-or-refuse (no source → not presentable as fact).
3. **Document viewer + flag overlay** — inspects a flagged valuation; the overlay shows exactly where the number came from vs. what the AI claimed.
4. **Verify / reject** — confirms the good flags; **rejects the mis-extracted valuation** with a note; nothing unverified advances.
5. **Assemble evidence package** — bundles verified, cited items per gate; the surface makes clear this is **evidence, not approval**, and Dana has **no sign capability**.
6. **Hand to signer** — routes the package to Priya's diligence workspace (A1.3). ✓

---

## Trigger Map Connections

**Persona:** Dana (Priority 3)

**Driving Forces Addressed:**
- ✅ **Want:** Fast well-cited extraction; catch what the model missed; clean handoff to the signer.
- ❌ **Fear:** Uncited/hallucinated fact reaching a signer; injected doc steering a recommendation; being mistaken for the approver.

**Business Goal:** AO5 (zero AI approvals) + I4 (AI isolated from the approval path).

---

## Scenario Steps

| Step | Folder | Purpose | Exit Action |
|------|--------|---------|-------------|
| A5.1 | `A5.1-diligence-queue/` | Open extraction results for a property | Opens results |
| A5.2 | `A5.2-extraction-review/` | Field + source link + confidence; cite-or-refuse | Reviews flags |
| A5.3 | `A5.3-doc-viewer/` | Flag/diff overlay on the source document | Inspects a flag |
| A5.4 | `A5.4-verify-reject/` | Confirm good flags; reject mis-extractions | Evidence verified |
| A5.5 | `A5.5-assemble-package/` | Bundle cited evidence — "evidence, not approval" | Package assembled |
| A5.6 | `A5.6-handoff/` | Route to the human signer (A1.3) | Scenario success ✓ |

**First step** (A5.1) carries the full entry context (Q3 + Q4 + Q5 + Q6).
