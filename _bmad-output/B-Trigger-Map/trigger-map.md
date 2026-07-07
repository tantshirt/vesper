# Trigger Map: Vesper

> Effect Mapping (Balic & Domingues, inUse) — WDS adaptation. The one-page strategic reference connecting business goals → user psychology → design focus.

**Created:** 2026-07-07 · **Author:** Dre · **Owner:** Saga (Phase 2)
**Derived from:** Product Brief (A-Product-Brief) + *Vesper Brief v5*
**Locked inputs:** Jurisdiction = US Reg A+ (retail) · Persona priority = P1 → P4 → P3 → P2

---

## 1. Vision (the WHY)

**A new standard for how young people benefit from real-world assets** — ownership that feels tangible and legible: *"You own 0.018% of this property vehicle. Your share of this month's rent: $3.42. Lifetime income: $41.80."*

Success is when a first-time investor can confidently answer **"What do I own, how do I get paid, and how do I get out?"** — and a regulator and investor trust that a scam property cannot reach the app.

---

## 2. Business Goals → SMART Objectives (the WHAT)

| # | Objective (SMART) | Type |
|---|---|---|
| **O1** | Fund **3–5** fully-diligenced property offerings end-to-end within **12 months of launch**, with **100%** of offerings having all Gates 0–7 human-signed (zero exceptions) | Supply / trust |
| **O2** | Reach **2,000–5,000 verified users** and **500–1,500 funded investors** within 12 months of launch | Growth |
| **O3** | **≥90%** of funded users correctly answer *"what do you own?"* and *"how are returns generated?"* in in-app surveys by month 12 | Comprehension ⭐ north-star |
| **O4** | Achieve **≥25% repeat-investment rate** and **100% on-time USDC distributions** (when cash flow permits) across the first 12 months | Retention / reliability |
| **O5** | **≥95%** on-time monthly property updates; **no single market >35%** of total portfolio exposure | Trust cadence / risk |

*North-star metric: funded users who receive AND understand their first payout (O3 × O4).*

---

## 3. Target Groups (the WHO) — priority order

| Rank | Persona | One-line | Why this rank |
|---|---|---|---|
| **1 · PRIMARY** | First-Job Wealth Builder (22–29) | Build wealth without a mortgage, starting at $50 | Embodies the vision; Reg A+ makes them fully addressable; comprehension proof (O3) lives here |
| **2** | Passive Income Optimizer (28–40) | Predictable income + clean reporting | Drives volume, repeat rate & distribution-reliability (O2, O4) |
| **3** | Rent-Trapped Aspirational Buyer (24–34) | Exposure before they can buy | Adjacent acquisition; shares P1's spine, widens the funnel |
| **4** | Crypto-Native Skeptic (25–35) | On-chain yield backed by real assets | Edge segment; their proof demands raise the transparency bar for everyone |

*Full persona files: [`personas/`](./personas/)*

---

## 4. Driving Forces (the psychology)

Positive = toward-motivation · **Negative = away-motivation (weighted higher — loss aversion).**

| Persona | Top WANTS (positive) | Top FEARS (negative) |
|---|---|---|
| **P1** First-Job | Own something real & tangible · build wealth without a mortgage · afford the entry | **Lose savings to a scam** · crypto complexity feeling dumb · locked out of real estate forever · hidden risk |
| **P2** Crypto-Native | On-chain yield on *real* assets · verifiable proof · self-custody + export | **Fake/synthetic "RWA"** · opaque middlemen ("TradFi cosplay") · custodial black boxes · no real exit |
| **P3** Rent-Trapped | Appreciation exposure *before* buying · "portfolio before property" · catching up | **Priced out forever** · watching others build wealth · a naive first mistake |
| **P4** Passive Income | Predictable recurring income · clean tax/reporting · diversification · set-and-forget | **Missed/unreliable distributions** · messy tax admin · yield that's risk in disguise · concentrated loss |

### ⭐ Cross-group pattern (the core design lever)

Every persona's **strongest negative driver reduces to the same three fears:**

> **"Is it real / a scam?" · "Will I actually get paid?" · "Can I get out?"**

This is v5's thesis confirmed bottom-up. Design the entire product to answer these three, visibly, on every property — because loss aversion means removing these fears moves people more than any upside promise.

**Tension to resolve by layering:** P2 wants proof *visible*; P1 wants crypto *invisible*. → **Invisible by default, provable on demand** (plain-language card up top, on-chain receipts one tap deeper).

---

## 5. Prioritization → Design Focus Statement

**Design primarily for the First-Job Wealth Builder (P1); validate with Passive Income Optimizer (P4).**

**MUST address** (universal negatives — the trust quartet):
- "Can I get out?" → honest **Liquidity Reality Box**
- "Is it a scam / is the property real?" → **risk cards + published diligence gates**
- "Do I understand the risk before I commit?" → **scenario calculator + order preview**
- "Where does my return come from?" → **yield breakdown** (never a single APY)

**SHOULD address:**
- "How am I doing / will I get paid?" → **Portfolio + income tracking**, on-time distributions, monthly update feed
- "How does any of this work?" → **Learn tab**, comprehension surfaces (O3)
- "I don't want to feel dumb about crypto" → **Privy embedded wallet, fiat-like flows**

**COULD address (later / edge):**
- On-chain receipts & external-wallet connect (P2) · tax center & auto-reinvest (P4 post-MVP) · neighborhood explainers (P3)

*Reasoning: the MUST tier is where all four personas' fears converge; serving it once serves everyone and directly moves the north-star (O3) and reliability (O4). The SHOULD tier deepens retention. The COULD tier serves single-segment wants and can wait.*

---

## 6. Feature-Impact Summary (top of the ranking)

Full scored table: [`feature-impact-analysis.md`](./feature-impact-analysis.md).

| Rank | Feature | Score |
|---|---|---|
| 1= | Liquidity Reality Box | 14 |
| 1= | Risk cards + published diligence gates | 14 |
| 3 | Scenario calculator + order preview | 12 |
| 4= | Yield breakdown | 10 |
| 4= | Portfolio + income tracking | 10 |

The top of the ranking *is* v5's differentiator spine — independent confirmation that the "trust quartet" earns MVP priority.

---

_Generated by Web Design Studio_
