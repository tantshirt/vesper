---
story: "2.2"
epic: 2
title: Property Detail — the trust quartet
status: review
location: app/app/property/[id]/
---

# Story 2.2 — Property Detail (the trust quartet)

As a visitor, I want to understand exactly what a property offers, so that I can decide with confidence.

## Acceptance Criteria & status
- **AC1** What-You-Own, yield headline, liquidity honesty, layered detail — ✅ `app/app/property/[id]/page.tsx` (What-You-Own 01/02/03 referencing the live SPV name; target yield from data; honest liquidity block with no "Sell now").
- **AC2** Trust Stack shows each gate passed + a named human signer — ✅ rendered from live `diligenceGates` via `properties.getWithGates`; 8 gates, `signedByHuman` shown, never an AI (spine I4).
- **AC3** (B4) consumer-visible gate labels — ⚠️ OPEN: using seed labels; confirm final consumer copy with compliance.

## Verification (2026-07-07)
- ✅ Data path: `convex run properties:getWithGates {id}` → The Monroe · 6.2% · The Monroe LLC · funded 74% · 8 gates, all human-signed.
- ✅ `tsc --noEmit` clean.
- ✅ `next build` — `/property/[id]` generated (dynamic, 1.9 kB).
- ⏳ Visual eyeball pending (run `npx convex dev` watcher + `npm run dev`, then open a card from /explore).

## Notes
- New backend query: `properties.getWithGates` (property + sorted gates).
- Invest CTA links to `/invest/[id]` = **E4** (not built; 404 until then).
- Liquidity + yield-breakdown split are design placeholders (schema stores target net yield only); wire real secondary-market + breakdown data when those features land.
- Local Convex deployment is ephemeral across `--once` restarts — use the `convex dev` watcher or cloud deployment for persistent seed.
