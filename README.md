<p align="center">
  <img src="app/public/brand/app-icon.svg" alt="Vesper logo, a stacked block mark on a dusk-blue tile" width="64" height="64">
</p>

<h1 align="center">Vesper</h1>

<p align="center"><strong>Real assets. Real returns. Real simple.</strong></p>

Vesper lets everyday investors own a fraction of an income-producing property, starting at $50. Ownership is a token on Solana, but the investor never has to see the crypto. They sign up with a passkey, pay in dollars, and get monthly rental income. Every claim about the property can be checked: each diligence step was signed by a named person, and the ownership record is on-chain.

The repo has two apps that share one backend. One is the **consumer app** investors use. The other is the **admin control plane** that staff and property sponsors use to vet, mint, list, and pay out each offering.

[How it works](#how-it-works) · [What's done](#whats-done) · [What's not done yet](#whats-not-done-yet) · [Run it locally](#run-it-locally) · [Under the hood](#under-the-hood)

**Project status: unfinished, in active development.** The app code and the on-chain program run end to end, using test tokens on Solana devnet and stand-in versions of outside services like identity checks and payments. This is not a live investment product and nothing here is an offer of securities.

## How it works

### For an investor

**Explore → Check the proof → Invest → Earn**

1. **Explore.** Browse listed properties. Each one shows its target yield, what's driving the income, the risks, and how cashing out works. The page states the downsides plainly; it doesn't hide them.
2. **Check the proof.** Every property carries a stack of diligence gates (title, appraisal, inspection, and so on). Each gate was signed by a named human reviewer. Anyone who wants to can open the on-chain proof: the token mint, the holder record, and the settlement transaction.
3. **Invest.** Sign up with a passkey. Vesper creates an embedded Solana wallet behind the scenes. Identity and eligibility checks run next (Reg A+ investment limits, restricted states). Then the investor adds money, previews the order, accepts the rights disclosures, and confirms.
4. **Earn.** Rental income is paid out monthly. Home, Portfolio, and Income screens show what was paid, what's coming, and why any payment was paused.

**Example:** buying 10 tokens at $50 each costs $500 of principal plus a one-time 0.90% platform fee ($4.50), so $504.50 in total. The on-chain program moves the USDC and the property tokens in one atomic transaction. Either the buyer gets the tokens and the payment lands, or nothing moves at all.

### For the platform (the admin "spine")

**Sponsor intake → AI drafts, humans verify → Signed gates → Mint → List → Distribute**

- A **sponsor** (the property operator) onboards, passes a business-verification check, and uploads the required documents.
- **AI extracts** facts from those documents, and every fact must cite its source. AI can only draft. It cannot sign, approve, or mint anything, and the code is built so it has no path to do so.
- **Human reviewers** verify the extracted facts and sign each diligence gate. Separation of duties is enforced: the same person can't sign twice, and anyone with a fee conflict is blocked.
- Only after every gate is signed can an operator **mint** the property token, and minting needs a second confirmation step. The offering is **listed** only after the chain confirms the mint.
- **Distributions** are calculated, funded, and pushed. A payout is marked paid only after the on-chain transfer is confirmed, never just because the app sent it.
- Every privileged action writes to an **append-only audit log**, and blocked attempts are logged too.

## What's done

| Area | Status |
| --- | --- |
| **Consumer app**: Explore, Property detail, on-chain proof view, Invest flow, Home, Portfolio, Income, Updates, Market, Learn | Built against seeded demo data |
| **Signup and eligibility**: passkey signup, embedded wallet, identity check, Reg A+ cap, restricted-jurisdiction waitlist | Built (identity provider stubbed) |
| **Order flow**: return calculator, order preview with fee, rights acknowledgement, confirmation | Built |
| **Atomic settlement program** (`vesper_dvp/`): delivery-versus-payment, fee to treasury, frozen-at-rest tokens | Built, tested, and run on devnet |
| **Chain reconciliation**: Helius webhooks feed Convex, and the chain's record wins when they disagree | Built |
| **Admin control plane**: staff roles and permissions, audit log, separation of duties, break-glass access | All 6 admin epics done (26 stories) |
| **Admin workflows**: AI extraction, gate signing, minting, distributions, compliance review, sponsor portal | Built end to end on the devnet path |

**Devnet proof:** a scripted end-to-end purchase (`app/scripts/devnet-e2e.ts`) creates a property mint and an offering, funds a buyer, and settles a purchase of 10 tokens for 500 test USDC. The run's transaction signatures are recorded in `app/scripts/devnet-e2e.out.json`.

## What's not done yet

These are the honest gaps, roughly in order of importance.

| Gap | Why it's open |
| --- | --- |
| **Real money movement** | Needs a decision on which escrow or custody vendor to use. That's a founders-plus-lawyer call, not a code problem, so funding and settlement run on stubs. |
| **Production chain config** | The program has no approved platform authority key or production USDC mint yet. Don't deploy it to mainnet until that design is ratified. See [`vesper_dvp/README.md`](vesper_dvp/README.md). |
| **Outside services** | Identity checks (Persona), business verification (Middesk), AML screening, AI extraction, and the second-confirmation step use stand-ins. They're behind development-only flags that refuse to run in production. |
| **Legal and compliance inputs** | Still waiting on lawyers for the ownership-percentage basis, Reg A+ marketing limits, and the wording of gate labels shown to investors. |
| **Launch hardening** | Content Security Policy, a final visual review of two consumer screens, and a production deploy. |

## Run it locally

You'll need Node 22+, a [Convex](https://convex.dev) account, and a [Privy](https://privy.io) app ID. The admin app also needs a [WorkOS](https://workos.com) client, or a local preview login (see `admin/.env.local.example`).

```bash
npm install                                   # installs both apps (npm workspaces)
cp app/.env.local.example app/.env.local      # add NEXT_PUBLIC_CONVEX_URL + NEXT_PUBLIC_PRIVY_APP_ID
npm run convex                                # first run logs in and creates a Convex deployment
```

In the Convex dashboard (Settings → Environment Variables), set `PRIVY_APP_ID`. Set `VESPER_ENABLE_DEMO_SEED=true` if you want demo data. Then:

```bash
npm run seed --workspace vesper-app           # seeds "The Monroe" with 8 signed diligence gates
npm run dev                                   # consumer app → http://localhost:3000/app/explore
npm run dev:admin                             # admin app → http://localhost:3001
```

The full list of development-only flags and what each one unlocks is in [`app/README.md`](app/README.md#safety-switches).

### On-chain program

The settlement program is written with [Quasar](https://github.com/blueshift-gg/quasar). It also needs Rust and the Solana CLI.

```bash
cd vesper_dvp
NO_DNA=1 quasar build
NO_DNA=1 cargo test
```

## Under the hood

| Component | What it does |
| --- | --- |
| [`app/`](app/) | Consumer app: Next.js (App Router), React, TypeScript, Privy passkeys and embedded Solana wallet |
| [`app/convex/`](app/convex/) | Shared backend for both apps: schema, permissions, audit log, gates, minting, distributions, reconciliation |
| [`admin/`](admin/) | Admin and sponsor app: Next.js with WorkOS sign-in |
| [`vesper_dvp/`](vesper_dvp/) | Solana program for atomic settlement, Token-2022 property tokens, Token ACL eligibility |
| [`_bmad-output/`](_bmad-output/) | Product brief, UX scenarios, design system, architecture, epics and stories, sprint status |

**Program ID (devnet):** [`CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2`](https://explorer.solana.com/address/CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2?cluster=devnet)

**Stack:** Next.js · Convex · Privy · WorkOS · Solana (Quasar, Token-2022, Token ACL) · USDC · Helius · Vercel AI Gateway

**Design rules the code follows:**

- **Hide the crypto, show the trust.** Investors never see wallet or token jargon unless they open the proof view.
- **AI drafts, humans sign.** Nothing reaches investors without every required human-signed gate.
- **The chain is the source of truth.** When Convex and Solana disagree, Solana wins.
- **Fail closed.** Stand-in services refuse to run in production, and missing config blocks the action instead of guessing.

## Checks

```bash
npm test                 # backend + app unit tests (Vitest)
npm run lint && npm run lint:admin
npm run build && npm run build:admin
npm run check:tokens     # design-token guard
```

## Find your next step

| I want to… | Start here |
| --- | --- |
| Understand the product and who it's for | [`PRODUCT.md`](PRODUCT.md) · [Product brief](_bmad-output/A-Product-Brief/) · [Master brief](Vesper%20Brief%20v5%20-%20Solana%20Research.md) |
| See the system design | [Consumer architecture](_bmad-output/planning-artifacts/architecture.md) · [Admin architecture](_bmad-output/admin/planning-artifacts/architecture.md) |
| See what's planned and what's built | [Consumer stories](_bmad-output/planning-artifacts/epics-and-stories.md) · [Consumer sprint status](_bmad-output/implementation-artifacts/sprint-status.yaml) · [Admin sprint status](_bmad-output/admin/implementation-artifacts/sprint-status.yaml) |
| Look at the brand and design system | [Brand direction](Vesper%20Brand%20Direction%20Brief/) · [Design tokens](_bmad-output/D-Design-System/) |
| Work on the Solana program | [`vesper_dvp/README.md`](vesper_dvp/README.md) · [Quasar notes](vesper_dvp/QUASAR_NOTES.md) |
| Have a coding agent work on the repo | [`app/AGENTS.md`](app/AGENTS.md) |
