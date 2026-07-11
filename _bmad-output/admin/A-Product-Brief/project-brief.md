# Project Brief: Vesper — Admin & Supply Control Plane

> Complete Strategic Foundation — the *supply & operations* half of Vesper

**Created:** 2026-07-11
**Author:** Dre
**Brief Type:** Complete (accelerated — derived from *Vesper Brief v5*, the consumer Product Brief, the Architecture Spine, and the Brand Direction Brief)

> **How to read this:** Sections marked ✅ are drafted from the ratified consumer foundation and the v5 master brief and just need a nod. Sections marked 🔶 **DECISION NEEDED** are genuine open choices that change the admin build — please weigh in. This brief covers the **admin side only**; it inherits — never re-litigates — the consumer brief, the Architecture Spine (I1–I7), and the design tokens.

---

## The One Sentence

✅ The consumer app is the promise — *"a scam property cannot reach you, your payout is on time, and you can prove it."* **The admin side is the machine that makes that promise true.** It is where the eight diligence gates get signed by named humans, where an offering is minted and listed, where distributions are pushed on-chain, and where every one of those actions is walled, logged, and reconciled.

---

## Vision

✅ A control plane where **doing the right thing is the path of least resistance** and doing the wrong thing is structurally hard. Supply integrity, compliance, and honest operations should not depend on individual diligence — they should be enforced by the tool: gates that cannot be signed by the AI, listing revenue that cannot touch a gate decision, distributions that cannot post to Convex without the chain confirming.

**Mission:** Give a small, high-trust team the cockpit to admit only real property, settle only eligible ownership, pay only what the ledger supports — and to *prove* each of those to a regulator, an auditor, and an investor on demand.

The admin side exists to make one thing true from the supply direction: **no property reaches an investor without every gate human-signed, no dollar moves without an on-chain settlement behind it, and no action happens without an immutable trail.**

---

## Positioning Statement

✅ **"The diligence, settlement, and distribution cockpit for tokenized real estate — evidence-first, segregation-of-duties by design, on-chain-authoritative."**

Internal-tool positioning (not marketed), but the standard is explicit:

- **Primary Users:** Vesper's own supply, compliance, and operations staff — plus the external sponsors who bring deals.
- **Need/Opportunity:** The consumer promise (verified supply, honest payouts, provable ownership) is only as strong as the back office that produces it. Off-the-shelf admin tooling can't enforce human-signed gates, on-chain-authoritative settlement, or the AI-never-approves boundary.
- **Category:** Internal RWA operations / diligence workflow / on-chain treasury control plane.
- **Key Benefit:** Every consumer-visible guarantee has a back-office surface that *creates and proves* it — the Trust Stack, the "Rent just landed" hero, the monthly update, the on-chain proof view all originate here.
- **Differentiator vs. a generic admin panel:** structural segregation of duties, an approval path the AI is architecturally locked out of, and an on-chain control plane where the admin action *is* the authoritative trigger.

---

## What the consumer sees ⟷ what the admin does (the mirror map)

✅ This is the spine of "make the admin side make sense with the app." Every consumer guarantee traces to an admin surface that produces it.

| Consumer app surface (built) | Admin surface (to build) | Invariant |
| --- | --- | --- |
| **Trust Stack** — Gates 0–7 "passed", named human signer | **Diligence workspace** — where each gate is reviewed (AI-assisted) and **human-signed** | I4 (AI never approves) |
| **"See the on-chain proof"** — mint, holders, DvP receipts | **Mint & listing console** — creates the Token-2022 mint, ACL config, offering metadata | I2 |
| **"Rent just landed +$X"** hero on Home | **Distribution console** — computes, funds, and **pushes** the distribution on-chain | I3 |
| **Income breakdown** (gross→costs→mgmt fee→reserve→net) | **Distribution builder** — authors that exact waterfall from operator data | I3 |
| **Monthly property update** (named operator, even quiet months) | **Sponsor update composer** + **ops overdue-flagging** | FR15 |
| **Eligibility / Reg A+ limit** shown calmly at confirm | **Compliance console** — KYC/AML adjudication, Reg A+ caps, Token ACL state | I5 |
| **Concentration warning** (>35% market) | **Portfolio-risk monitor** — platform-level exposure + alerts | O5 |
| **Atomic DvP confirmation** | **Settlement monitor + reconciliation** — Helius vs Convex, chain wins | I2/I3 |

> The consumer app **hides** crypto; the admin side **operates** it in the open. This is the single biggest design inversion between the two surfaces (see Platform Strategy).

---

## Business Model context

✅ The admin side is the **supply and cost** side of the two-sided marketplace — it enables revenue rather than charging the consumer.

- **Sponsor-listing fee** is collected here (sponsor onboarding/listing).
  > ⚠️ **Integrity guardrail (load-bearing):** the listing fee creates an incentive to admit properties, which directly tensions the core differentiator (verified supply). **Mitigation is structural, in this build:** diligence sign-off (Gates 0–7) is organizationally and technically walled off from listing revenue. A user who can influence billing **cannot** sign a gate, and gate decisions render **no** fee/revenue context. This is a first-class RBAC requirement, not a policy note. *(consumer brief §Business Model; Architecture I5)*
- **Management/servicing fee** and **distribution mechanics** are operated here (the fee the consumer sees "already inside net yield" is applied in the distribution builder — never double-charged).
- The admin side has **no** consumer-wallet scope and never issues consumer entitlements outside the compliance path.

---

## Ideal User Profile (the four roles → five personas)

✅ Packaged as **one unified, RBAC-gated admin app** (decision locked): internal ops, compliance, and AI-diligence are permission-scoped views of one console; **sponsors are a walled external subsection** with no internal visibility.

**Primary: The Diligence/Ops Officer** — Vesper staff who move a property from submitted → gated → minted → listed, and who push distributions. They *are* the ops spine (the DD-A equivalent of Maya's signature journey). Highest design weight.

### The role matrix (feeds Phase B personas)

| Role | Persona (Phase B) | Surface | Can NOT do (segregation) |
| --- | --- | --- | --- |
| **Internal ops / diligence officer** | P1 — *Priya, the Diligence Officer* ⭐ | Diligence workspace, mint/listing, distribution console | Cannot sign a gate she authored the fee for; cannot self-approve multi-party gates |
| **Compliance / legal reviewer** | P2 — *Marcus, the Compliance Officer* | KYC/AML adjudication, Reg A+ caps, marketing sign-off, audit inspection | Cannot mint or push distributions |
| **AI-diligence reviewer** | P3 — *Dana, the AI-Diligence Reviewer* | AI extraction/flags review, evidence assembly | **Cannot sign** — assembles evidence for a human signer only |
| **Sponsor principal** | P4 — *Ken, the Sponsor Principal* | Sponsor portal: deal submission, KYB, e-sign, funding/holder view | No internal visibility; no access to other sponsors |
| **Sponsor ops/finance** | P5 — *Sofia, the Sponsor Ops Lead* | Sponsor portal: document upload, gate-request response, monthly update authoring | No gate sign-off; no settlement access |
| **Platform admin** | P6 — *Ravi, the Platform Admin* | User & role management, RBAC/segregation config, break-glass, WorkOS directory | **Cannot** sign a gate, mint, thaw/freeze, or push a distribution — configures the walls, never acts inside them |

✅ **RESOLVED — the "super-admin" question:** a dedicated **Platform Admin** role (P6) manages users, roles, RBAC/segregation config, and break-glass, but holds **no** operational powers (no gate signing, mint, ACL, or distribution). It configures the walls; it does not act inside them. This preserves segregation of duties even over admin management.

---

## Success Criteria

✅ **North-star (supply side):** Properties that pass **all** gates with named human signers, get minted and listed correctly, and pay **on-time, correctly-computed** distributions — with a clean audit and reconciliation record every time.

**Instrument from day one:**
- **Supply integrity:** gate pass/reject rates, time-per-gate, AI-flag precision/recall, alerts caught **before** investor impact, **zero** properties listed with an unsigned gate (hard gate).
- **Segregation integrity:** zero segregation-of-duties violations (a fee-adjacent user signing a gate; a single human self-approving a multi-party gate) — measured as *attempts blocked*, not just *incidents*.
- **Settlement/treasury:** distribution success rate & timeliness, net-vs-target variance, **zero** distributions posted to Convex without an on-chain confirmation, reconciliation drift caught & resolved (chain wins).
- **Compliance:** KYC/AML adjudication SLA, Reg A+ cap-breach attempts blocked, marketing content shipped without counsel sign-off = **zero**.
- **AI boundary:** **zero** AI-authored approvals or gate signatures in the audit log (architecturally impossible; measured as a standing assertion).
- **Sponsor operations:** deal-intake cycle time, document-completeness on first pass, **on-time monthly-update rate ≥95%** (the update the consumer is promised).

**6–12 month targets:** 3–5 offerings taken end-to-end (submitted → listed → first distribution) through this console; 100% on-time distributions when cash flow permits; ≥95% on-time property updates; zero gate/segregation violations reaching production.

---

## Constraints

✅ (Inherited and admin-specific)

- ✅ **The AI is never the approver.** Every gate is signed by a named human. No code path lets the AI (or a non-human actor) write an approval or a gate signature. Prompt-injection boundary: untrusted sponsor documents reach the *read/extract* agent only, never the *recommend/approve* surface. *(Architecture I4, NFR4/NFR5)*
- ✅ **Segregation of duties is structural.** Listing/billing powers and gate-signing powers are mutually exclusive by role; multi-party gates require distinct human signers. Enforced in Convex RBAC, not UI. *(I5)*
- ✅ **On-chain is authoritative; the admin is the trigger, not the ledger.** Mint, DvP settlement, Token ACL freeze/thaw, and the distribution ledger live on Solana. The admin console issues the authoritative *intent*; Convex reconciles to chain via Helius; **chain wins**. Convex never self-settles. *(I2/I3)*
- ✅ **Everything is audited.** Every money/ownership/eligibility/diligence action writes an immutable AuditLog entry (actor, action, target, timestamp). The admin side is the biggest writer of this log.
- ✅ **Counsel-gated compliance.** Reg A+ limits, marketing sign-off, transfer-agent (Securitize) coordination, disclosures — counsel-led, surfaced as workflow states, not hardcoded assumptions.
- ✅ **Small team; managed vendors.** Lean on Persona (KYC), ComplyAdvantage/TRM (AML), Middesk/Qualia/HouseCanary/ATTOM (gate evidence), DocuSign, Securitize. Avoid deep coupling.
- 🔶 **OPEN BLOCKER — escrow/fund-custody vendor (B1).** Undecided. Blocks the admin **distribution funding** and **DvP money-movement** control surfaces exactly as it blocks consumer DD-001/DD-004. Admin stories touching custody are planned but flagged `BLOCKED: custody vendor` until resolved. *(carried from Architecture "Open decisions")*
- ✅ **RESOLVED — admin auth vendor: WorkOS.** Enterprise SSO + directory sync + fine-grained RBAC and audit — the strongest fit for the segregation-of-duties and audit posture this build demands. Supersedes the "Clerk/WorkOS" placeholder in the Architecture Spine (I1) — carry this into the admin spine.

---

## Platform & Device Strategy

✅ **The deliberate inversion from the consumer app** — same brand, opposite ergonomics:

| Dimension | Consumer app | Admin side |
| --- | --- | --- |
| **Device** | Mobile-first PWA | **Desktop-first** (dense tables, doc review, multi-pane); responsive down, not mobile-optimized |
| **Auth** | Privy passkey + embedded wallet | **Clerk/WorkOS** SSO + RBAC + segregation of duties |
| **Crypto** | Invisible (no wallet/gas/tx/mint vocabulary) | **Explicit & operated** — mint, ACL, DvP, distribution ledger, signatures are first-class |
| **Tone** | Calm, plain-spoken, reassuring | **Precise, evidence-first, unambiguous** — an auditor's clarity |
| **Primary job** | "What do I own, how am I paid, how do I exit?" | "Is this real, is this eligible, did it settle, can I prove it?" |

**Primary Platform:** Web — **Next.js (App Router) on Vercel**, **desktop-first** responsive. Separate application from the consumer app, **one shared Convex backend** (Architecture I1). No consumer-wallet scope ever reaches this surface.

**Interaction models:** SSO login; role-scoped navigation; evidence-linked review queues; explicit multi-step signature ceremonies (with SoD checks); on-chain action panels (mint / thaw / freeze / distribute) with confirm-and-reconcile; document viewers with AI-flag overlays; append-only audit views.

**Technical requirements:** desktop-optimized data density; hardware-key/step-up auth for signature and on-chain actions (🔶 confirm MFA posture); no offline requirement.

**Development implications:** unified RBAC app with a walled sponsor subsection; Convex as the entitlement + RBAC authority; on-chain as authoritative with Helius reconciliation; the AI approval-isolation boundary is an architectural fixture.

---

## Tone of Voice (admin surface)

**For operator UI, workflow states, and system messages** — a deliberate counterpoint to the consumer voice: still Vesper (premium, honest, never hype), but tuned for **precision and accountability** over reassurance.

### Tone attributes
1. **Evidence-first:** every state shows *what it's based on* and *who is accountable*. No claim without a source link.
2. **Unambiguous:** an operator must never guess what an action will do. Irreversible/on-chain actions state their consequence and cost before confirm.
3. **Accountable by name:** actions attribute to a human. "Signed by Priya Desai · Gate 3 · 2026-07-11," never "approved."
4. **Calm under stress, loud on risk:** surface blockers, drift, and segregation conflicts immediately and plainly.
5. **Quietly premium:** the same restraint as the consumer app — dense but not cluttered, confident, never alarmist-by-default.

### Examples
- **Action confirm:** ✅ "This mints The Monroe (Token-2022, 1,000,000 units, ACL frozen-by-default) on Solana. Irreversible. Continue?" — ❌ "Deploy token 🚀"
- **Segregation block:** ✅ "You can't sign Gate 6 on a property whose listing you manage. This needs a second signer." — ❌ "Permission denied (403)."
- **Reconciliation:** ✅ "Chain shows 3 holders; Convex shows 2. Chain wins — mirror updated, discrepancy logged." — ❌ "Sync error."
- **AI flag:** ✅ "AI flagged a valuation mismatch (appraisal $4.2M vs offering $4.8M). Review the source before signing." — ❌ "AI approved valuation."

### Guidelines
**Do:** state consequences before irreversible actions; attribute every action to a named human; link every claim to evidence; show cost/finality of on-chain ops; make segregation conflicts impossible to miss.
**Don't:** ever render the AI as approver; hide finality or cost; let fee/revenue context appear on a gate-decision surface; use consumer euphemisms ("add money") where operators need exact terms ("fund distribution escrow in USDC").

---

## Brand Direction (inherited, adapted for density)

✅ Same single source of visual truth — `D-Design-System/00-design-system.md` (Brand Direction Brief). The admin surface **inherits every token** (Fraunces + Inter, indigo/champagne, spacing/radii, semantic gain/loss/warning, tabular money) and **extends** — never overrides — for data density.

- **Fraunces** for section/brand moments and page identity; **Inter** for all tables, forms, IDs, hashes, legal. Money and on-chain values always tabular.
- The **champagne "star"** stays rare — reserved for genuine completion moments (a gate fully signed, a distribution successfully pushed & reconciled), never decoration.
- Admin adds a disciplined **data layer** (Phase D): tables, review queues, evidence/doc viewers, diff/flag overlays, signature ceremony cards, RBAC/role and status chips, on-chain action panels. All from existing tokens.
- Semantic colors carry the same rule as consumer: **never color alone** — status pairs color with a label/icon (Passed / Blocked / Pending / On-chain-confirmed).

---

## Additional Context

- **The signature screen** of the admin side is the **Diligence Workspace → gate signature ceremony** (the supply-integrity heart), mirroring how Property Detail anchors the consumer app.
- **Gates 0–7** (sponsor KYB → property existence → independent valuation → legal/tax → financial integrity → on-chain binding → multi-party approval → continuous monitoring) are the ops spine's backbone; each is AI-accelerated, human-signed, evidence-linked.
- **AI** accelerates and documents diligence and monitors post-listing; it never approves (I4). AI-diligence is a **first-class epic** in this planning pass (decision locked).
- Full technical/supply/AI/roadmap detail lives in *Vesper Brief v5*; this brief is the admin strategic-design foundation, not a re-derivation of the stack.

---

## Business Context

- **Primary Goal:** Stand up the internal control plane that takes 3–5 properties end-to-end (submitted → all gates signed → minted → listed → first distribution) with zero integrity or segregation violations — proving the *supply* half of the trust model as the consumer app proved the *demand* half.
- **Solution:** A desktop-first, RBAC-gated admin console (with a walled sponsor portal) that makes supply integrity, compliance, and honest settlement structurally enforced and provable.
- **Target Users:** Vesper supply/compliance/ops staff (led by the Diligence Officer) + external sponsors.

---

## Next Steps

- [x] Audience, pipeline depth, AI-diligence, on-chain scope, portal topology, build spine, repo/custody — **locked** (see planning conversation)
- [x] Super-admin → **Platform Admin (P6), no operational powers**; admin auth → **WorkOS**
- [ ] 🔶 Still open: MFA/step-up posture (signature + on-chain actions), custody vendor (B1 blocker)
- [ ] **Phase B: Trigger Mapping** — six admin personas (Priya ⭐, Marcus, Dana, Ken, Sofia, Ravi) + driving forces + feature-impact
- [ ] **Phase C+: UX** — admin scenarios (ops spine, sponsor intake, compliance, AI-diligence), then design-system extension (Freya)

---

_Generated by Web Design Studio — Admin track_
