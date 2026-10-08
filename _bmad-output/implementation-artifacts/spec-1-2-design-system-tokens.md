---
title: 'Design system tokens as code (E1.2)'
type: 'feature'
created: '2026-07-08'
status: 'done'
baseline_revision: '6fec460ac2607793f12746dff20847308faca31d'
final_revision: '767dcdf7072a32cdbc4bbd5d94392f7139f77cd0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/D-Design-System/00-design-system.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** The app declares Fraunces/Inter only as CSS `font-family` stacks — no webfont is actually delivered — and its token set is incomplete (missing `block-mid`, `champagne-soft`, and any spacing/radius scale, with brand values like `#EAD9A0` and the accent hex duplicated as literals). Dark mode is OS-preference-only with no forcible override, and nothing prevents a component from hardcoding an off-token color.

**Approach:** Self-host Fraunces (variable, optical sizing) and Inter, complete the color/spacing/radius token set verbatim from the Brand Direction Brief, layer a forcible `data-theme` override on top of `prefers-color-scheme` (the midnight-field flip), and add a review-time guard that fails when a component hardcodes a non-token color.

## Boundaries & Constraints

**Always:** All token names/values come verbatim from `D-Design-System/00-design-system.md` (single source of visual truth) — do not invent alternates or change brand hex values. Fonts are served same-origin (no runtime request to a font CDN); CSP-safe. Money/data keeps `font-variant-numeric: tabular-nums`. Champagne is a small accent only, never a fill. Gain/loss always pair color with a sign. Existing screens (Explore 2.1, Property Detail 2.2) must render visually unchanged except the intended webfont swap. Focus-visible is a 2px `accent` outline at 2px offset; respect `prefers-reduced-motion`.

**Block If:** The Fraunces/Inter variable `woff2` assets cannot be obtained to self-host (self-hosting cannot be faked). A required brand token value is genuinely absent from or contradictory within the design-system doc.

**Never:** No Tailwind or CSS-framework migration; the app stays plain global CSS. No refactor of app data/components beyond token, font, and theme wiring. No crypto vocabulary. Do not load fonts from a runtime CDN (`<link>` to `fonts.googleapis.com`). Do not restyle or restructure the 2.1/2.2 screens.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Light default | OS prefers light, no `data-theme` | Light tokens active (`bg #FBFBFD`, `ink #14142B`) | No error expected |
| Dark flip | OS prefers dark, no `data-theme` | Midnight-field flip active; champagne holds as highlight | No error expected |
| Force dark | `data-theme="dark"` on a light-OS device | Forced dark; override wins over the media query | No error expected |
| Force light | `data-theme="light"` on a dark-OS device | Forced light; override wins over the media query | No error expected |
| Money render | A dollar/percent figure renders | Equal-width tabular figures; no layout shift | No error expected |
| Off-token color | A `.tsx` component hardcodes a hex color | `check:tokens` exits non-zero naming the file | Script fails the review gate |
| Reduced motion | `prefers-reduced-motion: reduce` | Transitions/animations suppressed | No error expected |

</intent-contract>

## Code Map

- `app/app/globals.css` -- token `:root` + partial dark `@media` block today; the primary edit surface (add tokens, rename, scales, complete flip, `data-theme` overrides, bind fonts).
- `app/app/layout.tsx` -- root layout; loads no fonts today. Wires self-hosted Fraunces+Inter and exposes their CSS variables on `<html>`.
- `app/app/providers.tsx` -- Privy `appearance.accentColor` hardcodes `#3F3D9E`; the one sanctioned literal (Privy needs a string) — must be allowlisted/commented.
- `app/public/fonts/` (new) -- vendored variable `woff2` for Fraunces + Inter.
- `app/scripts/check-tokens.mjs` (new) -- the off-token-color guard.
- `app/package.json` -- add font-source dependency + `check:tokens` script.
- `_bmad-output/D-Design-System/00-design-system.md` -- token source of truth (read-only).

## Tasks & Acceptance

**Execution:**
- [x] `app/public/fonts/*.woff2` -- vendor Fraunces (variable, includes the `opsz` axis) and Inter (variable) `woff2`, e.g. copied from `@fontsource-variable/fraunces` and `@fontsource-variable/inter` -- so assets are self-hosted.
- [x] `app/app/layout.tsx` -- load both via `next/font/local` (`font-optical-sizing: auto`, `display: swap`), assign to `--font-serif`/`--font-sans` variables on `<html>`, and add `color-scheme` + `theme-color` metadata.
- [x] `app/app/globals.css` -- add `--block-mid` (+ press), `--champagne-soft`, `--midnight-press`, `--shadow`, and dusk-gradient tokens; rename `--hair`→`--hairline`, `--hair2`→`--hairline-2` and update all in-file refs; add `--space-*` and `--radius-*` scales; complete the dark `@media (prefers-color-scheme:dark)` flip for the full token set; mirror it under `:root[data-theme="dark"]` and add `:root[data-theme="light"]`, both ordered LAST so an explicit choice wins; bind `--serif`/`--sans` to the `next/font` variables (existing stacks retained as fallbacks).
- [x] `app/scripts/check-tokens.mjs` -- exit 1 if any `.tsx` under `app/app` hardcodes a hex color, allowlisting `globals.css` and the documented Privy accent literal; print each offending file:line.
- [x] `app/package.json` -- add font dependency and `"check:tokens": "node scripts/check-tokens.mjs"`.
- [x] `app/scripts/check-tokens.mjs` self-check -- confirm the guard flags a planted hex and passes on the clean tree (covers the two guard rows of the I/O matrix).

**Acceptance Criteria:**
- Given the app renders a page, when fonts load, then Fraunces and Inter are fetched from the app's own origin (no request to `fonts.googleapis.com`) as variable fonts with optical sizing bound to `--serif`/`--sans`.
- Given `globals.css`, when tokens are read, then every color in the Brand Direction Brief table (including `block-mid` and `champagne-soft`), a spacing scale, a radius scale, and `--shadow` exist as CSS variables, and no brand hex is duplicated as a literal inside a component.
- Given a user in OS dark mode or with `data-theme="dark"`, when any screen renders, then the midnight flip is active with champagne held as the highlight, and `data-theme` overrides the OS preference in both directions.
- Given the Explore and Property Detail screens, when they render after this change, then they are visually unchanged apart from the Fraunces/Inter webfonts now loading.

## Spec Change Log

(No bad_spec loopback occurred; empty.)

## Review Triage Log

### 2026-07-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 3, low 8)
- defer: 1: (high 1)
- reject: 8
- addressed_findings:
  - `[low]` `[patch]` `.avatar` hardcoded `#4A47B5` → `var(--block-mid)`, removing the last brand-color literal and letting it flip with theme; the new token was previously dead.
  - `[medium]` `[patch]` Token guard: `token-guard-allow` marker no longer suppresses the whole line — it allows exactly one sanctioned hex and still reports any additional hex on the same line (closes the smuggle hole).
  - `[medium]` `[patch]` Token guard: regex made global and extended to 4-digit `#RGBA`; every hex per line is now caught (was first-match-only, and `#f00c` slipped through).
  - `[medium]` `[patch]` Token guard: scan broadened to `.tsx/.ts/.jsx/.js` (case-insensitive) so a color moved into `theme.ts` can't bypass it.
  - `[low]` `[patch]` Token guard: `readdir`/`lstat` hardened (`throwIfNoEntry`, skip symlinks) — no crash on missing dir/broken link, no cycle recursion.
  - `[low]` `[patch]` `package.json`: `@fontsource-variable/*` moved to `devDependencies` (woff2 are vendored; nothing imports the packages at runtime).
  - `[low]` `[patch]` `layout.tsx`: dark `themeColor` `#1E1B4B` → `#141033` to match the dark `--bg` chrome.
  - `[low]` `[patch]` `layout.tsx`: added `fallback` metrics to both `localFont` calls to reduce swap-period CLS.
  - `[low]` `[patch]` `globals.css`: `--serif`/`--sans` given an inline `var(--font-*, …)` fallback so the brand stack still applies if the next/font variable is ever unset.
  - `[low]` `[patch]` `globals.css`: corrected the `[data-theme]` "placed LAST" comment to state the real reason (attribute-selector specificity 0,2,0 outranks the media block's `:root`).
  - `[low]` `[patch]` (guard self-tested against all of the above: `.ts` bypass, 4-digit hex, and marker-smuggle each fail as expected; clean tree passes.)

## Design Notes

Font wiring (golden path):
```ts
// layout.tsx
import localFont from "next/font/local";
const fraunces = localFont({ src: "../public/fonts/fraunces-variable.woff2",
  variable: "--font-serif", display: "swap" });
const inter = localFont({ src: "../public/fonts/inter-variable.woff2",
  variable: "--font-sans", display: "swap" });
// <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
```
Then in `globals.css`: `--serif: var(--font-serif), "Hoefler Text", Georgia, serif;` and `--sans: var(--font-sans), system-ui, sans-serif;`.

Theme precedence (order matters): `:root` (light) → `@media (prefers-color-scheme:dark)` → `:root[data-theme="dark"]` / `:root[data-theme="light"]` last, so an explicit choice beats the OS query. Set `color-scheme` per branch.

Guard scope: only `.tsx` files are scanned. The dusk-gradient midnight hexes live in `globals.css` and stay literal there (allowed). Refactoring the existing hardcoded radius/padding literals in `globals.css` to the new scale tokens is **out of scope** for 1.2 → record it in `deferred-work.md`.

## Verification

**Commands:**
- `cd app && npm install` -- expected: exit 0, font source package(s) resolved.
- `cd app && npx tsc --noEmit` -- expected: no new errors beyond the pre-existing `convex/_generated` ones (same baseline as Story 1.1).
- `cd app && npm run check:tokens` -- expected: exit 0 on the clean tree; non-zero when a hex is planted in a component.

**Manual checks:**
- Toggle OS appearance and set `data-theme` on `<html>`: confirm light ground ↔ midnight-field flip, and that a forced `data-theme` overrides the OS preference both ways.
- DevTools → Network: font files load from same origin (`/_next/...`); none from `fonts.googleapis.com`.
- A money figure shows equal-width (tabular) digits.
- Full `next build` needs Convex codegen (credentialed), as in Story 1.1 — treat it as a manual/credentialed check, not an automated gate here.

## Auto Run Result

Status: done

**Summary.** Implemented the Vesper design system as code: self-hosted Fraunces (variable, `opsz`) + Inter (variable) via `next/font/local` (same-origin, no runtime CDN); completed the color token set (added `--block-mid`/`-press`, `--champagne-soft`, `--midnight-press`, `--shadow`, dusk tokens), renamed `--hair`/`--hair2` → `--hairline`/`--hairline-2`, added `--space-*` and `--radius-*` scales, bound `--serif`/`--sans` to the loaded fonts; completed the light/dark flip (midnight field) under `prefers-color-scheme` and mirrored it under `:root[data-theme="dark"|"light"]` so an explicit choice overrides the OS; added a dependency-free `check:tokens` guard that fails when a component hardcodes a hex color.

**Files changed.**
- `app/app/globals.css` — token additions/renames, spacing+radius scales, completed dark flip + `data-theme` overrides, font bindings, dusk/`champagne-soft` literals tokenized, `.avatar` bound to `--block-mid`, reduced-motion block.
- `app/app/layout.tsx` — `next/font/local` for both families with `fallback` metrics, `viewport` `colorScheme`/`themeColor`, font vars on `<html>`.
- `app/app/providers.tsx` — Privy `accentColor` literal kept (Privy needs a string) with a `token-guard-allow` marker.
- `app/scripts/check-tokens.mjs` (new) — hardened token guard (global + 4-digit hex, `.tsx/.ts/.jsx/.js`, single-literal allowlist, symlink/EN0ENT-safe walk).
- `app/package.json` — `check:tokens` script; `@fontsource-variable/*` in `devDependencies`.
- `app/public/fonts/{fraunces,inter}-variable.woff2` (new) — vendored variable fonts.
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-1 (px→scale refactor) + dark-accent-contrast deferral.

**Review findings.** 0 intent_gap, 0 bad_spec, 11 patches applied (3 medium — all token-guard hardening; 8 low), 1 deferred (high — dark-mode accent/white-text contrast fails WCAG AA; pre-existing, needs a brand-token decision), 8 rejected as noise/out-of-scope. No spec loopback; all patches survived.

**Verification.** `npm install` exit 0 · `npx tsc --noEmit` exit 0 (clean) · `npm run check:tokens` exit 0 on clean tree; the guard self-test confirmed it flags a `.ts` bypass, a 4-digit `#RGBA`, and a marker-smuggled second hex, each as expected. `next build` not run — it needs Convex codegen/credentials (same constraint as Story 1.1); flagged as a manual/credentialed check. Theme flip and same-origin font loading are manual visual checks (documented under Verification).

**Residual risks.** (1) Dark-mode accent contrast (deferred) affects real dark-mode users. (2) Full `next build` and runtime rendering are unverified here (no Convex credentials) — a credentialed pass should confirm fonts serve from `/_next/` and the flip renders. (3) Existing screen radius/padding literals are not yet migrated to the new scale tokens (DW-1, intentional).
