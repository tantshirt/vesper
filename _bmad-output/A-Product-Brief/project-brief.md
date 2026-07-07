# Project Brief: Vesper

> Complete Strategic Foundation

**Created:** 2026-07-07
**Author:** Dre
**Brief Type:** Complete (accelerated — pre-filled from *Vesper Brief v5* + Brand Direction Brief, pending confirmation)

> **How to read this:** Sections marked ✅ are drafted from your v5 master brief and brand assets and just need a nod. Sections marked 🔶 **DECISION NEEDED** are genuine open choices that change downstream design — please weigh in.

---

## Vision

✅ A new standard for how young people benefit from real-world assets. Ownership should feel tangible and legible — *"You own 0.018% of this property vehicle." "Your share of this month's rent: $3.42." "Lifetime income: $41.80."*

**Mission:** Turn exclusive real estate into something anyone can own and understand — built for people who understand money apps, not token standards.

The product exists to make one thing true: a first-time investor can confidently answer *"What do I own, how do I get paid, and how do I get out?"* — and a regulator and investor can trust that a scam property cannot reach the app.

---

## Positioning Statement

✅ **"Own real estate income with the clarity of Robinhood, the polish of Wealthfront, and the proof layer of Solana."**

Tagline: **Real assets. Real returns. Real simple.**

**Breakdown:**

- **Target Customer:** Money-app-native young adults (22–40) who already use Robinhood, Cash App, Coinbase, and HYSAs, and want to build wealth without a mortgage.
- **Need/Opportunity:** Low-minimum, income-producing real-estate exposure that is legally intelligible and honest about liquidity — none of today's options are simultaneously simple, transparent, and trustworthy.
- **Category:** Consumer real-estate tokenization / fractional RWA investing.
- **Key Benefit:** Own transparent, income-producing real estate and understand exactly what you own, how returns are generated, and how to exit — with the crypto made invisible.
- **Differentiator:** A verified supply side (multi-gate, human-signed, AI-accelerated diligence) + radical legal-and-on-chain transparency + liquidity honesty. Not "more crypto" — legally serious, visually premium, operationally boring.

---

## Business Model

✅ **Type:** Two-sided marketplace — B2C investment product (demand side) + B2B sponsor supply portal (supply side).

**Revenue levers (all in scope, confirmed):**
- **Platform fee (primary):** basis-point fee on the amount invested at primary purchase — disclosed on the order preview.
- **Management / servicing fee:** ongoing bps on AUM or on distributions — must appear explicitly in the yield breakdown ("Real returns," never magic APY).
- **Secondary-market fee:** transaction fee / spread on secondary buys & sells — activates when the secondary market launches (Roadmap Phase 7).
- **Sponsor listing fee:** charged to sponsors to onboard/list.
  > ⚠️ **Integrity guardrail:** the sponsor listing fee creates an incentive to admit properties, which directly tensions Vesper's core differentiator (verified supply, no scam property reaches an investor). Mitigate by keeping diligence sign-off (Gates 0–7) organizationally independent of listing revenue, and never letting fee status influence a gate decision. Surface this in the RBAC / segregation-of-duties design.

### Business Customer Profile (B2B — supply side)

Property sponsors/operators bringing real estate to tokenize. Must pass Gate 0 (KYB + UBO) before any listing. They interact through the **separate** admin/sponsor portal (Clerk/WorkOS auth), not the consumer app.

| Role | Description |
| ---- | ----------- |
| **Buyer** | Sponsor principal / operator deciding to list on Vesper |
| **Champion** | Sponsor ops or finance lead running the intake + diligence submission |
| **User** | Sponsor staff uploading docs, responding to gate requests |

---

## Ideal Customer Profile (ICP)

✅ **Primary: The First-Job Wealth Builder (22–29).** Early career, some savings, uses Cash App, Robinhood, Coinbase, Wise. Wants to build wealth without a mortgage. Needs: $50–100 minimum, "own your first square foot" onboarding, monthly income projection, a clear "what can go wrong" section.

### Secondary Users

- **The Crypto-Native Skeptic (25–35):** owns SOL, uses Phantom/Jupiter/Kamino. Wants on-chain yield backed by real assets. Needs on-chain mint/holder view, Token ACL disclosure, DvP receipts, USDC distributions, exportable history, optional external-wallet connect via Privy.
- **The Rent-Trapped Aspirational Buyer (24–34):** rents in an expensive city, wants exposure before buying. Needs "build a property portfolio before buying property," neighborhood explainers, property risk score, plain-language downside cases.
- **The Passive Income Optimizer (28–40):** uses HYSAs, ETFs, robo-advisors. Wants predictable income and clean reporting. Needs income calendar, tax center, allocation views, auto-reinvest (post-MVP).

> ✅ **Eligibility confirmed — Reg A+ (retail).** All four personas stay in scope and the $50–100 minimum "anyone can own" vision holds. Trade-off accepted: SEC qualification + ongoing reporting mean a slower path to first listing (see Constraints & Roadmap Phase 0).

---

## Success Criteria

✅ **North-star:** Funded users who receive *and understand* their first payout.

**First 6 months — instrument these:** activation funnel (visitor→account→KYC start→approval→first investment, time-to-first-investment, per-screen drop-off); trust signals (document open rate, legal/risk engagement, calculator usage, support tickets/investor, "I understand what I own / how returns work" survey scores); investment (funded volume, funded properties, avg/median size, repeat rate, diversification); income (distribution success rate & timeliness, net vs. target); liquidity (listings, spread, time-to-fill, fill rate, active-bid coverage); supply/diligence (gate pass/reject rates, time-per-gate, AI-flag precision, alerts caught before investor impact); risk (occupancy/repair variance, reserve coverage, update punctuality, concentration).

**6–12 month targets:** 3–5 high-quality offerings funded; 2,000–5,000 verified users; 500–1,500 funded investors; ≥25% repeat rate; ≥90% of users can correctly answer "what do you own?"; ≥95% on-time property updates; 100% on-time distributions when cash flow permits; secondary market live with explicit liquidity warnings; no single market >35% of portfolio exposure; **zero properties reaching investors without all gates signed.**

---

## Competitive Landscape

✅

| Platform | Model | Vesper's lesson |
| --- | --- | --- |
| **Homebase** | Solana, property-level | Copy property-level clarity & low minimums; avoid scale-illusion & NFT mechanics |
| **MetaWealth** | Solana, EU RE bonds | Benchmark legal-packaging seriousness; beat on consumer experience |
| **Parcl** | Solana, synthetic exposure | Use its data/indices for context; reject synthetic-first, "trade cities" framing |
| **Lofty** | Algorand, LLC tokens | Steal daily-rent UX & built-in secondary; improve buyer protection & disclosures |
| **RealT** | Ethereum/Gnosis, ERC-20 | The cautionary tale (2026 liquidation) — design against opacity, concentration, silence-during-distress |

### Our Unfair Advantage

✅ A **verified supply pipeline** (Gates 0–7, each human-signed, AI-accelerated) that makes it structurally hard for a fraudulent or unfit property to reach an investor — paired with **radical transparency** (every property carries a visible legal, financial, and on-chain evidence trail plus which diligence gates it passed) and **liquidity honesty** (never implying instant exits). Defensibility is trust + supply quality, not chain features.

---

## Constraints

✅

- ✅ **Jurisdiction & investor class — LOCKED: US Reg A+ (retail).** Enables the low-minimum, broad-retail vision with all four personas. Cost of the choice: **Reg A+ qualification with the SEC and ongoing reporting obligations**, a slower path to first listing, and per-tier offering caps to design around. KYC required at confirm-investment; eligibility recorded in Convex and enforced on-chain via Token ACL. Secondary trading remains regulated product design (broker-dealer/ATS posture per counsel), not a feature toggle.
- **Liquidity is structural, not technical.** Tokenization creates transferability, not liquidity. Never market instant exits.
- **Securities/regulatory gravity.** Transfer-agent (Securitize), broker-dealer/ATS posture for secondary, disclosures — all counsel-led. Treat 2026 regulatory reads as directional; verify with counsel before filing/launch.
- **Small team.** Narrow scope; lean on managed vendors; avoid deep coupling.
- **The AI is never the approver.** Every diligence gate is signed by a named human.
- **Locked technology stack** (see below) — Next.js/Vercel, Convex, Privy (consumer), Clerk/WorkOS (admin), Anchor, Token-2022, Token ACL, USDC+DvP, Pyth (market data only), Helius, Vercel AI Gateway, Gemini embeddings.
- **Explicit "avoid" list:** native Vesper token, internal stablecoin, yield farming, synthetic city-price trading, leveraged retail trading, unpermissioned AMM pools, complex DAO governance, anonymous operators, distressed-market concentration, guaranteed-yield language, Confidential Transfers in MVP.

---

## Platform & Device Strategy

**Primary Platform:** ✅ Web — **Next.js (App Router) on Vercel**, mobile-first responsive / **PWA** for MVP.

**Supported Devices:** Mobile web (primary), desktop web (secondary). Native iOS/Android (React Native/Expo) is **post-MVP**.

**Device Priority:** Mobile-first. Every core flow must be excellent on a phone.

**Interaction Models:** Passkey / social login (Privy), embedded self-custodial wallet abstracted behind fiat-like flows, card/ACH funding to USDC, tap-through property discovery, calculator + order preview, explicit risk/legal acknowledgement before atomic DvP execution.

**Technical Requirements:**
- **Offline Functionality:** Not required for MVP (read-only cached views acceptable, not a goal).
- **Native Features:** None required at MVP; push notifications & biometric unlock are natural post-MVP wins.

**Platform Rationale:** Mobile-first PWA gets to market fastest for a small team while matching where the money-app-native persona already lives; native app deferred until retention justifies it.

**Consumer app structure (five tabs, mobile-first):** Home ("How am I doing?") · Explore ("What can I buy?") · Portfolio ("What do I own and earn?") · Market ("Can I buy or sell?") · Learn ("How does this work?"). No dedicated Wallet tab in MVP — wallet functions live in profile/settings.

**Future Platform Plans:** Native app; institutional mode; auto-reinvest via Privy delegated sessions.

**Design Implications:** Every screen answers exactly one user question; "the evening star — one premium accent moment per screen, max"; calm, never alarmist; money always tabular.

**Development Implications:** Separate admin/sponsor portal (own auth); Convex as entitlement authority + reactive layer; on-chain is authoritative with Helius reconciliation.

---

## Tone of Voice

**For UI Microcopy & System Messages**

### Tone Attributes

1. **Calm, never alarmist**: State facts plainly. Gain/loss always pairs color with a sign or arrow — never color alone.
2. **Plain-spoken, not crypto-y**: "Add money," not "fund your wallet." Explain in the language of money apps.
3. **Radically transparent**: Surface the honest answer first, then the breakdown, then the proof. Never hide risk behind polish.
4. **Quietly premium**: Confident and understated. "Own real estate income, quietly."
5. **Trustworthy under stress**: Over-communicate when things go wrong; silence kills trust faster than underperformance.

### Examples

**Error Messages:**
- ✅ "We couldn't confirm your identity yet. Nothing was charged — let's try one more time."
- ❌ "KYC verification failed (error 422)."

**Button Text:**
- ✅ "Review what you own" · "Add money" · "Confirm investment"
- ❌ "Ape in" · "Connect wallet" · "Submit tx"

**Empty States:**
- ✅ "You don't own any properties yet. Explore a few — you can start with $50."
- ❌ "No holdings found."

**Success Messages:**
- ✅ "Done. You own 0.018% of 214 Oak St. Your first rent payout is expected next month."
- ❌ "Transaction successful. 🚀"

### Guidelines

**Do:** lead with the plain answer; show a sign/arrow with every number; name the human/operator behind things; reserve the champagne "star" accent for one earned moment per screen; keep legal readable.

**Don't:** use guaranteed-yield or "instant exit" language; use color alone to signal gain/loss; use crypto jargon (wallet, gas, tx, mint) in the consumer path; add glows/hype/emoji to financial moments; imply liquidity that isn't there.

---

## Brand Direction (from Brand Direction Brief)

✅ **Mark:** the Architectural "V" — five rounded fractional blocks stepping down two arms, converging on a single gold **keystone** (fractional shares resolving to one point of light).

**Color tokens (light-first, dark-mode-ready):**
- Brand indigo `#3F3D9E` · Midnight `#1E1B4B` · Block mid `#4A47B5` · Lavender tint `#F4F3FC`
- Star / Champagne `#E8C88C` (the "evening star" — one moment per screen, max) · Star soft `#EAD9A0`
- Background `#FBFBFD` · Surface `#FFFFFF` · Text `#14142B` · Muted `#6B7280`
- Semantic (calm): gain `#2E9E6B` · loss `#C4553D` · warning `#C99A3F` — always paired with sign/arrow

**Type system:** **Fraunces** — display, headlines, wordmark, brand moments. **Inter** — UI, numbers, tables, forms, legal. *Money is always sans, always tabular.*

**Voice sample headlines:** "Own real estate income, quietly." · "Your money works in the evening." · "Real assets. Real returns. Real simple."

---

## Additional Context

- **The signature screen** is Property Detail, anchored by four differentiators: the **"What you own"** card, the **yield breakdown**, the **Liquidity Reality Box**, and the **risk cards** + published diligence gates.
- **Supply integrity** runs through Gates 0–7 (sponsor KYB → property existence → independent valuation → legal/tax → financial integrity → on-chain binding → multi-party approval → continuous monitoring), each human-signed.
- **AI** accelerates and documents diligence and answers investor questions (cite-or-refuse); it never approves.
- Full technical, AI, supply-side, and roadmap detail lives in *Vesper Brief v5* — this brief is the strategic-design foundation, not a re-derivation of the stack.

---

## Business Context

- **Primary Goal:** Get 3–5 high-quality properties funded by verified, understanding investors — proving the trust + supply model end-to-end.
- **Solution:** A mobile-first consumer app that makes fractional, income-producing real estate feel legally serious, visually premium, and operationally boring — backed by a verified supply pipeline.
- **Target Users:** Money-app-native young adults (22–40), led by the First-Job Wealth Builder.

*Full strategic analysis (business goals, personas, driving forces) is developed in [Phase 2: Trigger Mapping](../B-Trigger-Map/).*

---

## Next Steps

- [x] Jurisdiction/investor class — **Reg A+ (retail)**
- [x] Business/revenue model — **platform + management + secondary + sponsor-listing fees** (with independence guardrail)
- [ ] **Phase 2: Trigger Mapping** — map user psychology to business goals, score features against driving forces
- [ ] **Phase 3+: UX** — scenarios, specs, visual design (Freya)

---

_Generated by Web Design Studio_
