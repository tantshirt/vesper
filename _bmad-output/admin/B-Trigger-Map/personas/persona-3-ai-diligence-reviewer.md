# Persona 3 — Dana, the AI-Diligence Reviewer

**Role:** AI-diligence reviewer (human-in-the-loop) · **Priority:** 3

> *"The AI reads a thousand pages so I don't have to — but I decide what's worth a human's signature. It flags; it never approves. And neither do I."*

## Profile
Works the **AI extraction / flag** surface: reviews what the model pulled from sponsor documents, checks every citation, and **assembles the evidence package** that a human signer (Priya) will act on. **Cannot sign a gate** — she is the human that keeps the AI-never-approves invariant (I4) true, and the boundary that keeps prompt-injected documents away from the approval path.

## Positive driving forces (WANTS)
- **Fast, well-cited extraction** she can trust
- Every flag **traceable to a source page** with a confidence signal
- A **clean handoff** of assembled evidence to the human signer
- To **catch the thing the model missed** (or hallucinated)

## Negative driving forces (FEARS) — design against these first
- A **hallucinated or uncited "fact"** reaching a signer as if verified (strongest)
- A **prompt-injected sponsor document** steering a recommendation
- Being **mistaken for the approver** — her review read as sign-off
- **Missing a real red flag** under document volume

## Design implications
Extraction review with **source links + confidence + cite-or-refuse**; an **injection-isolated** document pipeline (untrusted docs reach only the read/extract agent, never a recommend/approve surface); an explicit role state — **"assembles evidence, cannot sign"** — shown on every surface; **flag/diff overlays** on the document viewer; nothing the AI produces is ever styled as an approval.
