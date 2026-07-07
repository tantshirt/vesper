# Vesper Design System — Tokens

> **Source of truth: the Brand Direction Brief** (`Vesper Brand Direction Brief/Vesper Landing.dc.html` + `Vesper Brand.dc.html`). These tokens are extracted verbatim from that direction. Every app screen uses them — do not invent alternates.

**Established:** 2026-07-07 (Freya, Phase 2) · **First applied:** Property Detail (01.2)

---

## Color

| Token | Hex | Use |
|-------|-----|-----|
| `bg` | `#FBFBFD` | Page ground (light-first) |
| `ink` | `#14142B` | Primary text |
| `sub` | `#5B5B6B` | Secondary text |
| `muted` | `#6B7280` | Tertiary / captions |
| `accent` (indigo) | `#3F3D9E` | Brand, links, primary buttons, eyebrows |
| `accent-press` | `#35338A` | Pressed/hover on accent |
| `block-mid` | `#4A47B5` | Secondary indigo (bars, alt accent) · press `#3E3C9C` |
| `midnight` | `#1E1B4B` | Deepest brand · press `#15132F` |
| `chip` / lavender | `#F4F3FC` | Chips, tag pills, soft info rows |
| `champagne` | `#E8C88C` | **Small accent only** — chip dot, the one lit window, `::selection`. Never a fill. |
| `champagne-soft` | `#EAD9A0` | Champagne gradient partner |
| `hairline` | `#ECEBF6` | Section dividers |
| `hairline-2` | `#E5E4F0` | Card/component borders |
| `surface` | `#FFFFFF` | Cards on ground |
| Semantic — gain | `#2E9E6B` | Always paired with a `+`/arrow |
| Semantic — loss | `#C4553D` | Always paired with a `−`/arrow |
| Semantic — warning | `#C99A3F` | Cautions |

**Dusk hero gradient:** `linear-gradient(180deg,#26226B 0%,#1E1B4B 62%,#191637 100%)` · fg `#FBFBFD` · eyebrow `#C9C7E8` · sub `#B9B6DD` · hairline `rgba(251,251,253,.16)`.

**Dark mode = flip** (per brief): midnight becomes the field, champagne holds as the highlight. Tokens redefined under `@media (prefers-color-scheme:dark)` + `:root[data-theme]`.

**Accent variants** (brief exposes a swap): `#3F3D9E` (default) · `#4A47B5` · `#1E1B4B`.

---

## Type

| Role | Family | Notes |
|------|--------|-------|
| Display / headings / property names / wordmark | **Fraunces** (serif) | weight 500 (headings), 560 (wordmark); optical sizing `opsz` 60→144; letter-spacing −0.018 to −0.022em; `text-wrap:balance` |
| UI / body / **all numbers** | **Inter** (sans) | 400/500/600; **money & data always `font-variant-numeric:tabular-nums`** |
| Eyebrows / labels | `ui-monospace, Menlo, monospace` | 600, 12px, letter-spacing .14–.16em, UPPERCASE, color `accent` |

> Fonts must be **embedded** (woff2 data-URI) in any self-contained artifact — CSP blocks font CDNs. In production, self-host Fraunces + Inter.

**Type scale (from landing):** hero H1 `clamp(2.9rem,6.3vw,5.4rem)` · section H2 `clamp(2rem,4.6vw,3.5rem)` · big stat `clamp(2.6rem,4.5vw,3.4rem)` Inter 600 tabular · body `clamp(1.05rem,1.5vw,1.3rem)` Inter 400 line 1.55–1.6.

---

## Spacing & Shape

- **Section padding:** `clamp(64px,9vh,120px)` vertical · `clamp(20px,5vw,56px)` horizontal (web); tighter on app screens.
- **Container max-width:** `1240px`.
- **Radii:** buttons `11–13px` · info rows `11px` · glass pills `15px` · cards `20–22px` · pills/chips `99px`.
- **Buttons:** primary = `accent` bg, `#fff`, radius 13px, Inter 600 16px, padding 15px 26px. Secondary = transparent, 1px `hairline-2` border.
- **Chip:** `chip` bg, 1px `hairline-2`, radius 99px, padding 7px 13px, 6px champagne dot.
- **Tag pill:** Inter 500 11px, `accent` on `chip`, radius 99px, padding 4–5px 9–10px.
- **Glass overlay (on dusk):** `rgba(20,20,43,.72)`, blur 10px, border `rgba(251,251,253,.14)`, radius 15px.
- **Nav bar:** sticky, `rgba(251,251,253,.82)` + blur 14px, border-bottom `hairline`.
- **Image placeholder:** `repeating-linear-gradient(45deg,#ECEBF6 0 13px,#E2E0F0 13px 26px)`.

---

## Motion & Interaction

- **FAQ / expandable:** a `+` that rotates 45° → `×` on open; max-height + opacity transition.
- Respect `prefers-reduced-motion`.
- Focus-visible: 2px `accent` outline, 2px offset.

---

## Voice (copy)

Warm, calm, literary, never hype. Signature lines: *"Own the building. Not the mortgage." · "rent arrives while you sleep" · "the evening star keeps watch while you rest." · "Straight answers. Questions worth asking."*
Ownership always framed as **01 · A legal share / 02 · Monthly rent / 03 · A share of the upside** — plus an honest downside floor. Gains/losses pair colour with a sign. Never "guaranteed yield" or "instant exit".

---

## Applied in
- `C-UX-Scenarios/01-maya-first-investment/pages/01.2-property-detail/` (spec + visual prototype)
- Prototype: https://claude.ai/code/artifact/dda7bb14-c0c0-4d05-a403-f57c0a9b63e7
