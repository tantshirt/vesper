# Trigger Map: Vesper — Admin & Supply Control Plane

> Effect Mapping (Balic & Domingues, inUse) — WDS adaptation. The one-page strategic reference connecting supply/compliance goals → operator psychology → design focus. The **supply-side companion** to the consumer trigger map.

**Created:** 2026-07-11 · **Author:** Dre · **Owner:** Saga (Admin Phase B)
**Derived from:** Admin Product Brief + Architecture Spine (I1–I7) + *Vesper Brief v5*
**Locked inputs:** Unified RBAC admin app (sponsors walled) · Admin auth = **WorkOS** · Build spine = **ops: gate → mint → distribute** · Persona priority = P1 → P2 → P3 → P4 → P5 → P6 · Custody vendor = **open blocker (B1)**

---

## 1. Vision (the WHY)

**The machine that makes the consumer promise true.** The app tells an investor *"a scam property cannot reach you, your payout is on time, and you can prove it."* The admin side is where that becomes structurally enforced: **every gate human-signed, every dollar backed by an on-chain settlement, every action walled, logged, and reconciled.**

Success is when a property goes **submitted → all Gates 0–7 human-signed → minted → listed → paying on-time distributions** with **zero** integrity or segregation violations — and every step is provable to a regulator on demand.

---

## 2. Business Goals → SMART Objectives (the WHAT)

*Supply-side objectives; each maps to a consumer objective it makes true.*

| # | Objective (SMART) | Maps to | Type |
|---|---|---|---|
| **AO1** | **100%** of listed offerings have all Gates 0–7 **human-signed** — zero exceptions (a hard, un-bypassable gate) | O1, NFR4 | Supply integrity ⭐ |
| **AO2** | **Zero** segregation-of-duties violations reach production (fee-vs-gate signer; single-human self-approval) — measured as *attempts blocked* | I5 | Integrity / trust |
| **AO3** | **100%** on-time, correctly-computed USDC distributions (cash-flow permitting); **zero** posted to Convex without on-chain confirmation | O4 | Settlement reliability |
| **AO4** | **≥95%** on-time monthly property updates authored through the sponsor portal | O5 | Trust cadence |
| **AO5** | **Zero** AI-authored approvals or gate signatures in the audit log (architecturally impossible; a standing assertion) | I4 | AI boundary |

*North-star (supply): properties taken end-to-end with zero integrity or segregation violations — the structural guarantee behind the consumer north-star.*

---

## 3. Target Groups (the WHO) — priority order

| Rank | Persona | One-line | Why this rank |
|---|---|---|---|
| **1 · PRIMARY** | Priya — Diligence/Ops Officer | Move real deals through: gate → mint → distribute | Is the build spine; the supply-integrity objective (AO1) lives on her surface |
| **2** | Marcus — Compliance Officer | Eligibility, caps, marketing, audit — airtight | Owns the legal safety net (AO2 partially, Reg A+); the regulator's-eye reviewer |
| **3** | Dana — AI-Diligence Reviewer | AI flags; a human decides — never the AI | Keeps I4/AO5 true; feeds Priya's evidence |
| **4** | Ken — Sponsor Principal | Bring a real deal; my data is mine | Supply source; front door of the funnel |
| **5** | Sofia — Sponsor Ops Lead | Upload docs, post the monthly update on time | Where AO4 (on-time updates) is won |
| **6** | Ravi — Platform Admin | Build the walls; hold no god-mode | Enabling meta-role; guarantees AO2 structurally |

*Full persona files: [`personas/`](./personas/)*

---

## 4. Driving Forces (the psychology)

Positive = toward-motivation · **Negative = away-motivation (weighted higher — accountability aversion).**

| Persona | Top WANTS (positive) | Top FEARS (negative) |
|---|---|---|
| **P1** Priya (Ops) | Move real deals fast · evidence at her fingertips · safe path = default · prove any decision later | **Signing off on something fake/unfit** · an irreversible on-chain mistake · an SoD violation on her watch · silent chain↔Convex drift |
| **P2** Marcus (Compliance) | Airtight eligibility + caps · complete attributable audit trail · marketing can't ship unsigned · regulator-ready exports | **An ineligible investor slipping through** · a Reg A+ cap breach · marketing shipped without sign-off · a gap in the audit trail |
| **P3** Dana (AI review) | Fast well-cited extraction · every flag traceable · clean handoff to signer · catch what the model missed | **A hallucinated/uncited "fact" reaching a signer** · an injected doc steering a recommendation · being mistaken for the approver · missing a red flag |
| **P4** Ken (Sponsor) | Clear checklist · fast predictable diligence · data kept private · funding/holder visibility | **Opaque/slow/goalpost-moving process** · financials leaking · nickel-and-diming · not knowing where the deal stands |
| **P5** Sofia (Sponsor ops) | Obvious what's-missing · easy upload · reminders before due · fast gate-request answers | **Submitting a wrong/incomplete doc** · missing a monthly-update deadline · a gate request she can't parse · redoing work |
| **P6** Ravi (Platform admin) | Clean least-privilege roles · provable SoD · audited break-glass · no silent god-mode | **A misconfig that lets fee touch a gate** · privilege creep · unaudited break-glass · being a single point of god-mode failure |

### ⭐ Cross-group pattern (the core design lever)

Every internal operator's **strongest negative driver reduces to the same three fears** — the **accountability mirror** of the consumer's trust quartet:

> **"Did I let something unreal / unfit through?" · "Did money move wrong, or unprovably?" · "Can we prove who decided, and why?"**

Where the consumer asks *"is it real / will I get paid / can I get out,"* the operator asks the **supply-side inverse**. Design the entire admin surface to answer these three — visibly, on every action — because accountability aversion means removing these fears moves operators more than any throughput gain.

**Tension to resolve:** **throughput vs. rigor.** Ops feels pressure to move fast; integrity demands care. → **Make the rigorous path the fast path**: evidence pre-assembled at the point of signing, the safe action as the default, and SoD enforced as a guardrail that *prevents mistakes* rather than a checkpoint that *slows work*. (The admin analog of the consumer's "invisible by default, provable on demand.")

---

## 5. Prioritization → Design Focus Statement

**Design primarily for Priya, the Diligence/Ops Officer (P1); validate with Marcus, the Compliance Officer (P2).**

**MUST address** (universal operator negatives — the integrity quartet):
- "Did I let something unfit through?" → **evidence-linked gate signature ceremony** (AI-assembled, human-signed)
- "Did I break a wall?" → **segregation-of-duties enforced as hard blocks** (fee-vs-gate, self-approval)
- "Did money move right?" → **distribution console: compute → fund → push → reconcile**, consequence+cost+finality before irreversible on-chain actions
- "Can we prove it?" → **immutable, attributable AuditLog** + reconciliation visibility (chain wins)

**SHOULD address:**
- "Is the AI staying in its lane?" → **injection-isolated AI extraction/flag review**, cite-or-refuse, never an approver (AO5)
- "Are we compliant?" → **compliance console** (KYC/AML adjudication, Reg A+ caps, marketing sign-off)
- "Is supply flowing?" → **sponsor intake** (guided, tenant-isolated) + **on-time monthly updates** (AO4)

**COULD address (later / edge):**
- Advanced anomaly-detection monitoring (Gate 7) · mass-distribution scale (ZK compression) · secondary-market ops surface · deep analytics dashboards

*Reasoning: the MUST tier is where every operator's accountability fears converge and where the build spine (gate → mint → distribute) lives; serving it directly moves AO1–AO3 and NFR4. The SHOULD tier completes the four roles. The COULD tier serves scale/edge and can wait.*

---

## 6. Feature-Impact Summary (top of the ranking)

Full scored table: [`feature-impact-analysis.md`](./feature-impact-analysis.md).

| Rank | Feature | Score |
|---|---|---|
| 1= | Gate signature ceremony (evidence-linked, human-signed) | 12 |
| 1= | Segregation-of-duties enforcement | 12 |
| 3 | Sponsor intake (guided, tenant-isolated, KYB) | 11 |
| 4 | Immutable, attributable AuditLog | 10 |
| 5 | Token ACL freeze/thaw controls | 8 |
| 6= | Mint & listing / Distribution consoles (MUST by override*) | 7 |

The top of the ranking is the spine's first step (**gate ceremony**) plus its **integrity guardrails** (SoD, audit, intake). The mint/distribute steps score mid-pack (7) — a **scoring artifact**: they're P1-concentrated, exactly like the consumer's *"What you own"* card, so they stay **MUST by override**. "Gate → mint → distribute," walled and provable, earns MVP priority regardless. *(*see [`feature-impact-analysis.md`](./feature-impact-analysis.md).)*

---

_Generated by Web Design Studio — Admin track_
