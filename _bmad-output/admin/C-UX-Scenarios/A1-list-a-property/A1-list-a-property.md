# A1: Priya Lists a Property  ★ signature journey

**Project:** Vesper — Admin & Supply Control Plane
**Created:** 2026-07-11
**Method:** Web Design Studio (WDS) — Admin track

---

## Transaction (Q1)

A submitted property goes from *"a sponsor's deal has cleared intake"* to a **live, investable offering** — with **every gate human-signed**, the Token-2022 mint created (frozen-by-default), and the offering listed. This is the supply spine: the back-office act that makes the consumer's Trust Stack and on-chain proof real.

---

## Business Goal (Q2)

**Goal:** Admit only real, fully-diligenced property (AO1) while keeping the AI out of the approval path (AO5).
**Objective:** AO1 (100% of listed offerings have all Gates 0–7 human-signed — zero exceptions) — the supply north-star runs through this scenario, and it is the structural guarantee behind consumer O1.

---

## User & Situation (Q3)

**Persona:** Priya, the Diligence/Ops Officer (**Primary**)
**Situation:** The Monroe cleared sponsor intake (A3) and Dana has assembled the AI-diligence evidence (A5). It's in Priya's work queue, "ready for gating." She has 40 minutes before her next review block and wants to move it through — but she's the name that will sit on every gate, so she won't sign anything she can't stand behind.

---

## Driving Forces (Q4)

**Hope:** To take a real, well-evidenced deal live quickly — the evidence already at her fingertips, the safe action the default.

**Worry:** That she signs off on something unfit, or fat-fingers an irreversible mint (wrong supply, wrong ACL) that can't be undone.

---

## Device & Starting Point (Q5 + Q6)

**Device:** Desktop (primary — dense, multi-pane review)
**Entry:** WorkOS SSO → ops dashboard work queue → taps The Monroe, "ready for gating."

---

## Best Outcome (Q7)

**Operator Success:** Priya reviews each gate's evidence, signs Gates 0–7 as a named human (with a distinct second signer where a gate requires it), mints the offering with ACL frozen-by-default after an explicit consequence/cost/finality confirm + step-up auth, and lists it — calm, certain, and able to prove every decision later.

**Business Success:** An offering that is 100% gated (AO1), correctly minted, and listed; the consumer Trust Stack now shows the signed gates, and "See the on-chain proof" resolves to the real mint. Every action is in the AuditLog, attributed and timestamped.

---

## Shortest Path (Q8)

*Linear sunshine path — no branches.*

1. **Ops dashboard** — opens the work queue; taps The Monroe (ready for gating).
2. **Property submission review** — confirms scope, sponsor, and that AI-diligence evidence is assembled (from A5).
3. **Diligence workspace ★** — the gate list (0–7), each with its evidence package, source links, and AI flags surfaced (never as approvals).
4. **Gate signature ceremony ★** — per gate: reviews evidence → signs as a named human. Where a gate is multi-party (e.g. Gate 6), a **distinct second signer** is required; a signer with a fee/listing stake is **blocked** (SoD).
5. **Mint & listing console** — configures the Token-2022 mint (supply, metadata, **ACL frozen-by-default**); the confirm states consequence + cost + **finality** ("irreversible") and requires step-up auth.
6. **Listing** — sets offering parameters; publishes to the consumer Explore surface.
7. **Reconciliation check** — Helius confirms the mint on-chain; Convex mirror matches; the champagne "star" marks a genuinely completed listing. ✓

---

## Trigger Map Connections

**Persona:** Priya (Primary)

**Driving Forces Addressed:**
- ✅ **Want:** Move a real, evidenced deal live fast; evidence at her fingertips; safe path = default; prove it later.
- ❌ **Fear:** Signing off on something unfit; an irreversible on-chain mistake; a segregation violation on her watch.

**Business Goal:** AO1 (gates human-signed) + AO5 (AI never approves) — the supply north-star.

---

## Scenario Steps

| Step | Folder | Purpose | Exit Action |
|------|--------|---------|-------------|
| A1.1 | `A1.1-work-queue/` | Triage what's ready for gating | Opens The Monroe |
| A1.2 | `A1.2-submission-review/` | Confirm scope + evidence assembled | Enters diligence workspace |
| A1.3 | `A1.3-diligence-workspace/` | The gate list + evidence hub (signature screen) | Opens a gate |
| A1.4 | `A1.4-gate-ceremony/` | Review evidence, sign as a named human; SoD second-signer where required | All gates signed |
| A1.5 | `A1.5-mint-console/` | Create Token-2022 mint, ACL frozen-by-default (consequence+cost+finality, step-up) | Mint confirmed |
| A1.6 | `A1.6-listing/` | Configure + publish the offering | Offering live |
| A1.7 | `A1.7-reconcile/` | Helius confirms mint; Convex matches; completion star | Scenario success ✓ |

**First step** (A1.1) carries the full entry context (Q3 + Q4 + Q5 + Q6).
