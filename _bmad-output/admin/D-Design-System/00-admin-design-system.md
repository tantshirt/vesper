# Vesper Admin Design System — Data Layer (extends the canonical tokens)

> **This is an EXTENSION, not a new system.** The single source of visual truth remains [`D-Design-System/00-design-system.md`](../../D-Design-System/00-design-system.md) (from the Brand Direction Brief). The admin surface **inherits every token verbatim** — Fraunces + Inter, indigo/champagne, spacing/radii, semantic gain/loss/warning, tabular money — and adds only the **data-dense components** operators need. No admin component invents an alternate color, font, or radius. *(Architecture I7.)*

**Established:** 2026-07-11 (Freya, Admin Phase D) · **First applied:** A1 · Gate signature ceremony

---

## What changes vs. the consumer app (and what doesn't)

| Dimension | Consumer | Admin | Token impact |
|---|---|---|---|
| Density | Generous, one-question-per-screen | **Dense, multi-pane, table-first** | Same tokens; **tighter spacing scale** (below) |
| Device | Mobile-first | **Desktop-first** (≥1280px primary) | New breakpoints, same grid tokens |
| Crypto | Hidden | **Shown** — addresses, sigs, hashes, supply | New **mono-data** type role (below) |
| Champagne "star" | One earned moment per screen | **One earned moment per completed action** (gate fully signed, distribution reconciled) | Same `champagne`, same discipline |
| Semantic color | gain/loss on money | + **operational status** (Passed/Blocked/Pending/Confirmed) | Reuses gain/loss/warning + accent; **never color alone** |

**Nothing about the palette, type families, or radii changes.** The admin surface looks like Vesper — just carrying more data per square inch.

---

## Type — one addition

Inherits all three canonical roles (Fraunces display · Inter UI/numbers · monospace eyebrows). Adds one:

| Role | Family | Notes |
|------|--------|-------|
| **Mono-data** — addresses, tx sigs, mint IDs, doc hashes, gate signatures | `ui-monospace, Menlo, monospace` | 13px, `ink`, tabular; **truncate-middle** (`0x1E1B…4B4B`) with copy-on-click; full value on hover/expand |

> Rule: **all money and all on-chain values are tabular** (Inter tabular for amounts, mono-data for identifiers). An address is never set in a proportional font.

---

## Density scale (desktop ops)

A tighter spacing step-scale for tables and review panes — **derived from, not replacing, the canonical spacing**:
- **Row height:** 44px default (comfortable), 36px compact (toggle) — 44px keeps WCAG target size for interactive rows.
- **Cell padding:** 10px 14px · **Section gap:** 20px · **Pane gutter:** 24px.
- **Container:** admin overrides the 1240px max — full-width fluid with a 1440px comfortable reading column for detail panes.
- Radii unchanged (cards 20–22px, rows 11px, chips 99px, buttons 13px).

---

## Status system (the operational semantic layer)

Reuses semantic tokens; **every status pairs color + icon + label** (never color alone — same rule as consumer gain/loss):

| Status | Color token | Icon | Used for |
|---|---|---|---|
| **Passed / Signed** | gain `#2E9E6B` | ✓ | Gate signed, KYC cleared, doc validated |
| **Blocked / Failed / SoD-conflict** | loss `#C4553D` | ⊘ | SoD block, cap breach, DvP fail, ineligible |
| **Pending / Needs-you** | warning `#C99A3F` | ◷ | Awaiting review, sponsor action needed |
| **On-chain confirmed** | accent `#3F3D9E` | ⛓ | Mint/distribution reconciled with chain |
| **Draft / Neutral** | muted `#6B7280` | ○ | Unstarted, informational |
| **Complete (earned)** | champagne `#E8C88C` dot | ★ | A gate **fully** signed, a distribution **pushed + reconciled** — the rare moment only |

Status chips: `chip` lavender bg, 1px `hairline-2`, radius 99px, the status color on the icon + label text.

---

## New components (all from existing tokens)

1. **Data table / review queue** — virtualized (10k+ rows), sortable, sticky header (`rgba(251,251,253,.82)` + blur, like the consumer nav), status chips per row, 44px rows, tabular money, mono-data IDs. Row hover = `chip` lavender.
2. **Gate signature ceremony card** ★ — the signature component. Evidence summary + source links, the AI flags (rendered as *flags with citations, never approvals*), the named-signer line, and a **consequence-stated confirm** ("Signing Gate 3 attests… attributed to you, permanent in the audit log"). Champagne star only on the fully-signed state.
3. **On-chain action panel** — for mint / freeze / thaw / distribute. States exact values + **cost + finality** ("irreversible") before a **step-up-auth confirm**; shows optimistic-intent → chain-confirm → reconciled states, never ambiguous. Uses `midnight`/`dusk` framing to signal "this touches the chain."
4. **Document viewer + flag/diff overlay** — PDF pane with AI extraction overlays: highlighted source region, extracted value, confidence, and a verify/reject control. Injection-isolation is visually implicit (docs live in the review pane, never in an approve surface).
5. **SoD block state** — a loss-colored, un-dismissable inline block stating the rule violated and the required second signer ("You manage this listing's billing — a distinct signer must sign Gate 6"). Not a toast; a hard gate.
6. **Audit row** — append-only, mono-timestamp, actor (named human) · action · target · on-chain ref (mono-data, linkable). Read-only, exportable.
7. **Reconciliation banner** — surfaces chain↔Convex drift plainly ("Chain 3 holders · Convex 2 — chain wins, mirror updated, logged"), warning→confirmed states.
8. **RBAC role matrix** — roles × permissions grid with SoD-conflict cells flagged loss-red; least-privilege defaults; break-glass rendered distinctly (warning) with mandatory-reason affordance.
9. **Sponsor portal shell** — a visually *lighter, guided* variant (closer to the consumer's calm) for external users: checklist cards, upload-with-validation, status timeline. Tenant-isolated; never shows internal chrome.

---

## Voice on the admin surface (copy)

Inherits Vesper's honesty and restraint; tuned for **precision + accountability** (see Admin Product Brief §Tone). Status and actions attribute to a **named human**, state **consequence + finality** before irreversible ops, and **link every claim to evidence**. Never render the AI as approver. Never let fee/revenue context appear on a gate-decision surface.

- ✅ "Signed by Priya Desai · Gate 3 · 2026-07-11 14:22 UTC" — ❌ "Approved ✅"
- ✅ "This mints The Monroe (1,000,000 units · ACL frozen) on Solana. Irreversible." — ❌ "Deploy 🚀"

---

## Dark mode

Same flip as canonical (midnight becomes the field, champagne holds). Admin tables/panes redefine under `@media (prefers-color-scheme:dark)` + `:root[data-theme]` using the same token swaps — status colors keep their icon+label pairing in both themes.

---

## Applied in
- `C-UX-Scenarios/A1-list-a-property/` — gate signature ceremony + mint action panel (the signature screen; visual spec next).
- Extends, and must stay consistent with, the consumer prototype set. No new visual language — density only.

---

_Generated by Web Design Studio — Admin track_
