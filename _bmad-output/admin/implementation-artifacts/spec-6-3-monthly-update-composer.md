---
title: 'Story 6.3 — Sponsor monthly-update composer (+ operator link; overdue-flagging already exists)'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 6.3)'
  - '_bmad-output/admin/C-UX-Scenarios/A3-sponsor-intake/A3-sponsor-intake.md'
depends_on: ['6-1 (requireSponsor, sponsor roles)', '1-3 (audit)', '1-5 (UI)', 'existing propertyUpdates + updates.flagOverdueUpdates']
---

## Intent — SCOPE NOTE (read first)

`propertyUpdates` (period, occupancy, reservesMonths, rentOnTime, note, operator, publishedAt) and the **overdue-flagging `updates.flagOverdueUpdates` (internalMutation) already exist** (consumer E5.4). This story adds the **sponsor AUTHORING composer** — the walled-portal surface where a sponsor (Sofia/`sponsor_ops`) publishes a property's monthly update, including uneventful months — plus the **sponsor↔property operator link** that scopes it. The link is *populated at listing* (Epic 3); here we model it and gate the composer on it (tests seed it). Overdue-flagging is reused, not rebuilt.

## Boundaries & Constraints

**Always:**
- **Operator link + tenant isolation.** Add `operatorSponsorOrgId` (optional) to `properties`. A sponsor may publish an update ONLY for a property whose `operatorSponsorOrgId` equals their `requireSponsor`-resolved org. A property they don't operate is not-found — never trust a client-supplied org.
- **Every month, including quiet ones.** `publishUpdate` requires the full set (period, occupancy, reservesMonths, rentOnTime, operator name, note) — an uneventful month still needs occupancy/reserves/rent-on-time + a plain note; do NOT allow a "nothing happened" empty publish. Audited to the sponsor human (`sponsor.update.published`).
- **Reuse, don't rebuild, overdue-flagging.** `updates.flagOverdueUpdates` already flags overdue properties; do NOT reimplement it. (If it needs the operator link to attribute the overdue property to a sponsor, extend read-only; otherwise leave it.)
- Gate authoring on a `sponsor.updates` permission granted to BOTH sponsor roles (Sofia authors); reads `sponsor.read`.

**Never:**
- Do not build the internal ops overdue *dashboard* beyond what `flagOverdueUpdates` already does, the listing flow that populates `operatorSponsorOrgId` (Epic 3), or change consumer `updates.summary`. Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*`, `vesper_dvp/`.

## Code Map

- `app/convex/schema.ts` — `properties` + optional `operatorSponsorOrgId` (`v.optional(v.id("sponsorOrgs"))`) + index `by_operator`.
- `app/convex/roles.ts` — add `sponsor.updates` permission; grant to BOTH sponsor roles.
- `app/convex/sponsorUpdates.ts` (**new**) — `myOperatedProperties` (query, `sponsor.read`, org-scoped via `operatorSponsorOrgId`); `publishUpdate` (mutation, `sponsor.updates`: assert the property's `operatorSponsorOrgId` == caller org; require all fields non-empty/valid; insert `propertyUpdates`; audit `sponsor.update.published`); `listMyUpdates` (query, `sponsor.read`, org-scoped).
- `app/convex/sponsorUpdates.test.ts` (**new**) — a sponsor publishes an update for a property their org operates (incl. an uneventful month — all fields still required; an empty note/partial fields throw); a sponsor cannot publish for a property they don't operate (not-found); a non-sponsor cannot publish; `sponsor_ops` CAN publish; `flagOverdueUpdates` still runs and flags an overdue operated property (reused, unchanged behavior).
- `admin/app/sponsor/page.tsx` (extend, from 6-1/6-2) — a monthly-update composer for the caller's operated properties (period, occupancy, reserves, rent-on-time toggle, operator, note) + a list of published updates. Walled `/sponsor` tree.

## Acceptance Criteria
- Given a property the sponsor operates, when they publish a complete monthly update (even for a quiet month), then a `propertyUpdates` row is created and audited to the human; a partial/empty submission throws.
- Given a property the sponsor does NOT operate, when they publish, then not-found (tenant isolation).
- Given `sponsor_ops` (Sofia), then she can publish; a non-sponsor cannot.
- Given `flagOverdueUpdates`, when it runs, then it still flags an operated property overdue for an update (reused behavior intact).
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass.

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green (`/sponsor`) · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
