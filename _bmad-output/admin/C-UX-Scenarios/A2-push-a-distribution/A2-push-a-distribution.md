# A2: Priya Pushes a Distribution  ★

**Project:** Vesper — Admin & Supply Control Plane
**Created:** 2026-07-11
**Method:** Web Design Studio (WDS) — Admin track

---

## Transaction (Q1)

A closed month goes from *"the operator reported this month's rent and costs"* to **owners paid in USDC on-chain** — the waterfall computed (gross → costs → mgmt fee → reserve → net), escrow funded, the distribution pushed on-chain, and Convex reconciled. This is the back-office act behind the consumer's *"Rent just landed +$X"* hero.

---

## Business Goal (Q2)

**Goal:** Pay owners on-time and correctly, with no dollar moving unprovably (AO3).
**Objective:** AO3 (100% on-time, correctly-computed USDC distributions when cash flow permits; **zero** posted to Convex without on-chain confirmation) — the structural guarantee behind consumer O4 and the *"Income breakdown matches target"* promise.

---

## User & Situation (Q3)

**Persona:** Priya, the Diligence/Ops Officer (**Primary**)
**Situation:** The Monroe's month has closed; Sofia (sponsor ops) submitted the operator numbers and the monthly update. It's the 3rd — distributions are due. Priya opens the distribution console to build, fund, and push. She wants the math to match target exactly and the money to move with a provable on-chain record.

---

## Driving Forces (Q4)

**Hope:** To pay every owner on time, at the right number, with a clean receipt she can point to.

**Worry:** That the waterfall math is off, or that money moves without an on-chain settlement behind it — and the custody step she doesn't yet fully control.

---

## Device & Starting Point (Q5 + Q6)

**Device:** Desktop (primary)
**Entry:** Ops dashboard → "distributions due" → The Monroe.

---

## Best Outcome (Q7)

**Operator Success:** Priya builds the waterfall from operator data, sees it **matches the target yield**, funds the distribution escrow, pushes the on-chain distribution after a consequence/cost/finality confirm + step-up auth, and watches Helius reconcile it into the `IncomeLedger` — every owner paid, every cent traceable.

**Business Success:** An on-time, correctly-computed distribution recorded on the on-chain distribution ledger and mirrored to Convex; the consumer Home surfaces the "Rent just landed" hero and the Income breakdown matches target. AuditLog entry written. (AO3)

> ⚠️ **BLOCKED: custody vendor (B1).** The **fund-escrow** step (A2.3) depends on the undecided escrow/custody vendor. The screen is designed; the money-movement is flagged blocked until B1 resolves — exactly as consumer DD-001/DD-004 are.

---

## Shortest Path (Q8)

*Linear sunshine path — no branches.*

1. **Distributions-due queue** — opens The Monroe, due this cycle.
2. **Distribution builder** — pulls operator numbers (from Sofia's submission); computes the waterfall: gross rent → costs → **management fee (already inside net yield — not re-charged)** → reserve → net-per-token.
3. **Match-target review** — the console confirms net matches the offering's target yield (or surfaces the variance + reason before proceeding).
4. **Fund escrow** *(BLOCKED: custody)* — funds the distribution in USDC via the escrow/custody vendor.
5. **Push distribution** — consequence + cost + **finality** stated ("pays 214 owners, irreversible"); step-up auth; executes on-chain against the distribution ledger.
6. **Reconcile** — Helius confirms; Convex `IncomeLedger` mirrors; on any drift, **chain wins** and the discrepancy is logged. Completion star. ✓

---

## Trigger Map Connections

**Persona:** Priya (Primary)

**Driving Forces Addressed:**
- ✅ **Want:** Pay owners on time, correctly, with a provable record.
- ❌ **Fear:** Wrong math; money moving unprovably; the uncontrolled custody step.

**Business Goal:** AO3 (on-time, correct, on-chain-confirmed distributions).

---

## Scenario Steps

| Step | Folder | Purpose | Exit Action |
|------|--------|---------|-------------|
| A2.1 | `A2.1-due-queue/` | Triage distributions due this cycle | Opens The Monroe |
| A2.2 | `A2.2-waterfall-builder/` | Compute gross→costs→mgmt fee→reserve→net | Waterfall built |
| A2.3 | `A2.3-fund-escrow/` | Fund the distribution in USDC *(BLOCKED: custody)* | Escrow funded |
| A2.4 | `A2.4-push/` | Push on-chain (consequence+cost+finality, step-up) | Distribution pushed |
| A2.5 | `A2.5-reconcile/` | Helius confirms; IncomeLedger mirrors; chain wins | Scenario success ✓ |

**First step** (A2.1) carries the full entry context (Q3 + Q4 + Q5 + Q6).
