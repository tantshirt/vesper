---
story: "2.1"
epic: 2
title: Explore listing (public)
status: review
location: app/app/explore/
---

# Story 2.1 — Explore listing (public)

As a visitor, I want to browse vetted properties without signing up, so that I can explore with zero friction.

## Acceptance Criteria & status
- **AC1** Unauthenticated browse of open offerings — ✅ `/explore` uses `api.properties.listOpen` (public query, no auth). No signup/KYC required.
- **AC2** Card shows dusk thumbnail, funding %, target yield, tags, funding bar — ✅ `PropertyCard` in `app/app/explore/page.tsx`, styled from D-Design-System tokens.
- **AC3** (B3) Reg A+ public-content extent — ⚠️ OPEN: currently renders name/location/yield/funding; must confirm counsel-approved pre-auth fields before launch.

## Verification (2026-07-07)
- ✅ Backend: `convex run properties:listOpen` returns The Monroe (fundedPct 0.74, targetNetYield 0.062).
- ✅ `tsc --noEmit` clean.
- ✅ `next build` — compiled, `/explore` route generated (4.31 kB).
- ⏳ Visual eyeball in browser pending (`npm run dev` + Convex watcher running).

## Notes
- Cards link to `/property/[id]` — that route is **E2.2 (Property Detail)**, not yet built (currently 404). Build next to complete the read path.
- Matches DD-001 Explore prototype.
