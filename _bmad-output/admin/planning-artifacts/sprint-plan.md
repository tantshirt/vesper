# Vesper Admin — Sprint Plan

> Sequences the 6 admin epics / 20 stories (`epics-and-stories.md`) into dependency-ordered sprints, with the open-blocker resolution timeline mapped to the sprints each blocker gates. Feeds Implementation Readiness → the bmad-loop dev cycle.

**Created:** 2026-07-11 · **Source:** admin epics-and-stories.md, architecture spine (AI1–AI7), DD-A01/A02, readiness-report.md
**Assumptions:** small team; sprints are **dependency waves**, not fixed calendar weeks (velocity TBD). Each wave is demoable. Stories inside a wave are parallel-safe unless noted.

---

## Dependency spine (what gates what)

```
AE1.1 scaffold+WorkOS+RBAC ──┬─> everything
AE1.3 AuditLog ──────────────┼─> every write path
AE1.5 design-system code ────┴─> every UI story
AE1.2 SoD engine ─> AE3.1 (gate signing), AE1.4
AE1.4 Platform Admin/break-glass ─(needs AE1.2)

AE2.1 AI extraction ─> AE2.2 evidence assembly ─> AE3.1 gate ceremony
AE6.1 sponsor onboard/KYB ─> AE6.2 intake/upload/status ─> (produces properties) ─> AE3.1
                                                            (or seed The Monroe to unblock AE3 early)

AE3.1 gate ceremony ─> AE3.2 mint/list ─> AE3.3 reconcile ─> AE4.*
AE5.1 KYC→ACL eligibility ─> gates token receipt at AE3.2/AE4.2

AE4.1 waterfall ─> AE4.2 fund/push ─> AE4.3 reconcile/paused
AE6.3 monthly-update composer ─> feeds AE4.1 operator numbers
AE6.4 funding/holder dashboard ─(needs a listed offering from AE3)
```

**Blocker gates:** B1 custody → AE4.2 · B2 MFA/step-up → AE3.2, AE4.2 · B3 Gate 0–7 evidence defs + multi-party rules → AE3.1/AE3.2 · B4 Reg A+ marketing limits → AE5.3.

---

## Sprints

### Sprint 0 · Foundation substrate  🟢 GO now (no blockers)
The substrate every later story inherits. Fully parallel-safe.
| Story | What | Notes |
|---|---|---|
| **AE1.1** | Admin app scaffold (desktop-first Next.js) + WorkOS SSO + per-request Convex RBAC (6 roles) | Separate app, shared Convex |
| **AE1.3** | Immutable AuditLog + append-only views/export | Cross-cutting; build early |
| **AE1.5** | Admin design-system extension as code (over canonical tokens) | Unblocks all UI |

**Demo:** log in as each role via WorkOS; role-scoped shell renders; every mutation writes an audit entry.

### Sprint 1 · Walls + evidence intake  🟢 GO
| Story | What | Depends |
|---|---|---|
| **AE1.2** | Segregation-of-duties engine (fee-vs-gate, self-approval, server-side) | AE1.1, AE1.3 |
| **AE1.4** | Platform Admin: RBAC mgmt + SoD-conflict detection + audited break-glass | AE1.2 |
| **AE2.1** | AI extraction/flag review (injection-isolated, cite-or-refuse) | AE1.1 |
| **AE6.1** | Walled sponsor onboarding + KYB/Gate 0 (tenant isolation) | AE1.1 |

**Demo:** an SoD-violating grant is blocked + logged; a sponsor onboards in an isolated tenant; AI extraction shows source-linked flags.

### Sprint 2 · Spine read + evidence assembly  🟢 GO (seedable)
| Story | What | Depends |
|---|---|---|
| **AE2.2** | Evidence verification + assembly ("assembled, not approved") | AE2.1 |
| **AE3.1** ★ | Diligence workspace + gate signature ceremony (SoD-enforced) | AE1.2, AE2.2 |
| **AE6.2** | Intake checklist + validated upload + status timeline | AE6.1 |

**Demo (signature milestone):** sign Gates 0–7 on the seeded **The Monroe** as named humans, second-signer enforced, fee-adjacent signer blocked. *This is the earliest end-to-end proof of the supply-integrity thesis.*
> **B3 must resolve during Sprints 0–2** (internal Gate 0–7 evidence defs + which gates are multi-party) so AE3.1 content is real, not placeholder.

### Sprint 3 · Spine write-to-chain  🟡 gated by B2, B3
| Story | What | Depends / gate |
|---|---|---|
| **AE3.2** | Mint & listing console (Token-2022, ACL frozen-by-default, step-up) | AE3.1 · **B2 (step-up), B3** |
| **AE3.3** | Mint reconciliation (Helius; chain wins) | AE3.2 |
| **AE5.1** | KYC/AML adjudication → Token ACL eligibility | AE1.1 |

**Demo:** a fully-gated offering mints on devnet (ACL frozen), lists to consumer Explore only after on-chain-confirmed; ineligible account can't receive tokens.
> **B2 must resolve before Sprint 3** (MFA/step-up posture). Stub step-up behind an interface if it slips.

### Sprint 4 · Settlement build (no money-movement yet)  🟢 GO for design/logic
| Story | What | Depends |
|---|---|---|
| **AE4.1** | Distribution builder + matches-target (mgmt fee inside net) | AE3.3 |
| **AE4.3** | Distribution reconciliation + paused-with-reason | AE4.1 |
| **AE6.3** | Monthly-update composer + overdue flagging (feeds AE4.1) | AE6.2 |
| **AE5.2** | Reg A+ per-investor cap enforcement (blocks) | AE5.1 |

**Demo:** build a distribution waterfall that matches target; a missing-operator-numbers case pauses with a reason (feeds consumer "why paused"); an over-cap purchase is blocked.

### Sprint 5 · Money-movement + compliance polish  🟡 gated by B1, B2
| Story | What | Depends / gate |
|---|---|---|
| **AE4.2** | Fund escrow + push on-chain (no self-settle) | AE4.1 · **B1 (custody), B2** |
| **AE5.3** | Marketing sign-off gate + audit export | AE5.1 · **B4** |
| **AE6.4** | Sponsor funding/holder dashboard | AE3 (listed offering) |

**Demo (spine complete):** gate → mint → **distribute** end-to-end on devnet; owners paid in USDC, reconciled chain-wins; regulator-ready audit export.
> **B1 must resolve before Sprint 5** (custody vendor) — same blocker as consumer DD-001. Stub the escrow/settlement boundary behind an interface so AE4.2's UI + Convex shells build against a mock and swap the real vendor in when B1 lands.

---

## Blocker resolution timeline (put these in front of owners NOW)

| Blocker | Must land before | Owner | Interim |
|---|---|---|---|
| **B3** Gate 0–7 evidence defs + multi-party rules | Sprint 2 (AE3.1) | Product + compliance | Placeholder gate defs; don't ship ceremony copy until real |
| **B2** MFA / step-up posture | Sprint 3 (AE3.2) | Eng + security | Stub step-up behind an interface (recommend WebAuthn hardware key) |
| **B1** Escrow / custody vendor | Sprint 5 (AE4.2) | Founders + counsel | Stub escrow/settlement boundary; build UI + Convex shells on a mock |
| **B4** Reg A+ marketing limits | Sprint 5 (AE5.3) | Counsel | Build the sign-off gate; gate the *content extent* on counsel |

**None block starting.** Sprints 0–2 (10 of 20 stories) are fully GO today.

---

## Definition of Done (per story — loop-ready)

A story is "done" when: all its GWT acceptance criteria pass · AuditLog entries written for every state change · SoD/RBAC enforced server-side (not UI-only) · UI uses only canonical + admin-extension tokens · on-chain actions verified on devnet with Helius reconciliation · no AI-approval path exists · tests green · verified end-to-end (not just unit).

## Demo milestones (stakeholder-facing)
1. **After Sprint 0** — role-scoped console + audit backbone.
2. **After Sprint 2** — ★ sign all 8 gates on The Monroe (supply-integrity proof).
3. **After Sprint 3** — mint + list an offering on devnet.
4. **After Sprint 5** — full ops spine: gate → mint → distribute, owners paid, provable.

---

_Feeds: Implementation Readiness (per-story) → bmad-loop dev cycle (Sprint 0 first)._
