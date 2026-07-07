---
story: "1.1"
epic: 1
title: Reactive backbone (Next.js + Convex + Privy)
status: review
location: app/
---

# Story 1.1 — Reactive backbone

As a developer, I want the app scaffold with Convex and Privy wired, so that authenticated, reactive data flows end-to-end.

## Acceptance Criteria & status
- **AC1** Scaffold (Next.js App Router / Vercel + Convex) — ✅ `app/` (package.json, next config, tsconfig, `app/`, `convex/`).
- **AC2** Privy passkey sign-in issues a JWT — ✅ `app/providers.tsx` (`PrivyProvider`, passkey + Solana embedded wallet).
- **AC3** Convex trusts the JWT via `customJwt` — ✅ `convex/auth.config.ts` (issuer `privy.io`, per-app JWKS, ES256).
- **AC4** User resolves in a reactive query — ✅ `convex/users.ts:currentUser` + `app/page.tsx` (`useQuery`).
- **AC5** Every mutation writes AuditLog (FR16) — ✅ `convex/audit.ts:writeAudit`, invoked in `ensureUser` and `seedTheMonroe`.

## Files
- Frontend: `app/app/{layout,page,providers,globals.css}.tsx/css`, `app/lib/useAuthFromPrivy.ts`
- Backend: `app/convex/{schema,auth.config,users,audit,properties}.ts`
- Config/docs: `app/{package.json,tsconfig.json,next.config.mjs,.env.local.example,README.md}`

## Verification (done 2026-07-07)
- ✅ **Install:** `npm install` → 666 packages, exit 0. Resolved: next@15.5.20, convex@1.42.1, @privy-io/react-auth@2.25.0, react@19.2.7.
- ✅ **Typecheck (static):** `tsc --noEmit` — frontend provider/bridge (`providers.tsx`, `layout.tsx`, `useAuthFromPrivy.ts`) compile with **zero errors** against the real Privy/Convex packages. All remaining errors trace solely to the not-yet-generated `convex/_generated/` module (created by `npx convex dev`); no real defects.
- ⏳ **Runtime (requires human):** needs a Convex login + Privy app id to run `npx convex dev` (codegen + deploy) and set `PRIVY_APP_ID`. Then: sign in → confirm `currentUser` resolves reactively and an `auditLog` row is written. This is the only step blocked on credentials.

## Notes / carried context
- Seed `properties:seedTheMonroe` also created (feeds E2 read-path) — includes 8 human-signed diligence gates (spine I4).
- Design tokens seeded in `globals.css` (E1.2 will self-host Fraunces/Inter).
- Blockers B1/B2 do not affect this story.
