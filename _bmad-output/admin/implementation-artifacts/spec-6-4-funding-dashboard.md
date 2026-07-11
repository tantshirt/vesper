---
title: 'Story 6.4 — Sponsor funding / holder dashboard (tenant-isolated) — the LAST story'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 6.4)'
  - '_bmad-output/admin/C-UX-Scenarios/A3-sponsor-intake/A3-sponsor-intake.md'
depends_on: ['6-1 (requireSponsor tenant isolation)', '6-3 (properties.operatorSponsorOrgId)', '3-2 (a listed property)', '1-5']
---

## Intent

**Problem:** A sponsor needs to see, for **their own live offering only**, its **funding progress** and **holder** picture — never another sponsor's, never internal data, and never individual investor PII. The tenant-isolation primitive (`6-1` `requireSponsor`) and the sponsor↔property link (`6-3` `operatorSponsorOrgId`) already exist; this reads funding/holdings through them. This is the **last of the 20 admin stories**.

## Boundaries & Constraints

**Always:**
- **Tenant isolation via 6-1/6-3.** Every read resolves the org through `requireSponsor` and only returns properties whose `operatorSponsorOrgId` == the caller's org. A property they don't operate is not-found; another org's data is never reachable.
- **No investor PII to sponsors.** Show funding progress (`fundedPct` / `offeringSize` / amount raised) + **holder COUNT** + aggregate distribution (e.g. total tokens, top-holding concentration %) — **never** individual investor identities, wallets, names, or amounts. A sponsor sees the shape of their cap table, not who is in it.
- `sponsor.read`-gated (both sponsor roles); a non-sponsor (internal staff) is denied. Read-only — no mutations.

**Never:**
- Do not expose consumer `users`/`holdings` identity fields to the sponsor. Do not build internal-facing holder detail (that is an internal/compliance surface, not sponsor). Do not touch `admin/app/components/ui/*`, `globals.css`, `app/app/*`, `vesper_dvp/`. Do NOT `git commit`.

## Code Map

- `app/convex/sponsorFunding.ts` (**new**):
  - `myOfferingFunding` (query, `sponsor.read`, org-scoped): for each property the caller's org operates (via `operatorSponsorOrgId`, reuse the `6-3` `myOperatedProperties` pattern), return `{ propertyId, name, status, offeringSize, fundedPct, amountRaised, holderCount, totalTokens, topHoldingPct }` — aggregates ONLY, no per-investor rows.
  - `myOfferingDetail` (query, `sponsor.read`, org-scoped): a single operated property's funding + holder AGGREGATES (holder count, ownership-concentration buckets) — still no investor identities. Not-found for a non-operated property.
- `app/convex/sponsorFunding.test.ts` (**new**): a sponsor sees funding + holder COUNT for their operated property; sponsor B cannot see sponsor A's offering (not-found); a non-sponsor (internal ops) is denied; the payload contains NO investor identity/wallet/amount (assert the returned keys are aggregates only); a property the org does not operate is not-found.
- `admin/app/sponsor/page.tsx` (extend, from 6-1/6-2/6-3) — a Funding & Holders panel per operated offering: funding progress bar (fundedPct), amount raised / offering size, holder count, concentration indicator. Walled `/sponsor` tree; 1-5 primitives.

## Acceptance Criteria
- Given a sponsor with a live operated offering, when they open the dashboard, then they see funding progress + holder count/aggregates for that offering only.
- Given sponsor B, when they request sponsor A's offering, then not-found (tenant isolation).
- Given the payload, when inspected, then it contains no individual investor identity, wallet, name, or amount (aggregates only — no PII).
- Given a non-sponsor (internal staff), when they call the funding reads, then denied.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass.

## Verify (from repo root)
`npm test` (+new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green (`/sponsor`) · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
