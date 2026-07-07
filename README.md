# Vesper

Premium consumer **real estate tokenization on Solana** — own income-producing property from $50, with the crypto made invisible and the trust made visible.

> *Real assets. Real returns. Real simple.*

## What's in here

| Path | What |
|------|------|
| `app/` | The consumer app — Next.js + Convex + Privy (see [`app/README.md`](app/README.md)) |
| `_bmad-output/A-Product-Brief/` | Product brief + platform requirements |
| `_bmad-output/B-Trigger-Map/` | Personas + driving forces + feature-impact |
| `_bmad-output/C-UX-Scenarios/` | 6 UX scenarios + screen specs |
| `_bmad-output/D-Design-System/` | Design tokens (source of truth: Brand Direction Brief) |
| `_bmad-output/E-Development/` | Delivery contracts (DD-001, DD-002) + dev handoff |
| `_bmad-output/planning-artifacts/` | Architecture spine · epics & stories · readiness report |
| `_bmad-output/implementation-artifacts/` | Sprint status · story files |
| `Vesper Brief v5 - Solana Research.md` | Master brief (PRD-equivalent) |
| `Vesper Brand Direction Brief/` | Brand direction (design source of truth) |

## Status

Planning + design complete (WDS + BMad Method). Build in progress:

- ✅ **E1.1** Reactive backbone — Next.js + Convex + Privy (customJwt auth, audit log)
- ✅ **E1.4** Core schema + seed (The Monroe, 8 human-signed diligence gates)
- 🟡 **E2.1** Explore — live listing screen (build-verified)
- ⏭ **E2.2** Property Detail — next

See [`_bmad-output/implementation-artifacts/sprint-status.yaml`](_bmad-output/implementation-artifacts/sprint-status.yaml).

## Run the app

```bash
cd app
npm install
npx convex dev            # login → generates types, deploys schema
npm run seed              # seed The Monroe
npm run dev               # http://localhost:3000/explore
```

## Stack

Next.js (App Router) · Convex · Privy (embedded Solana wallet) · Anchor / Token-2022 / Token ACL · USDC atomic DvP · Helius · Vercel AI Gateway. Consumer app only in this repo; admin/sponsor portal + AI diligence are a separate surface.
