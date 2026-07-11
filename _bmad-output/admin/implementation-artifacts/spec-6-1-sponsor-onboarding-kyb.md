---
title: 'Story 6.1 — Walled sponsor onboarding + KYB/Gate 0 (tenant isolation)'
type: 'feature'
created: '2026-07-11'
status: 'backlog'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 6.1)'
  - '_bmad-output/admin/C-UX-Scenarios/A3-sponsor-intake/A3-sponsor-intake.md'
  - '_bmad-output/admin/planning-artifacts/architecture.md (AI1 tenant isolation)'
depends_on: ['1-1 (WorkOS auth, staff model, roles, requireStaff)', '1-3 (audit)', '1-5 (UI primitives)']
---

## Intent

**Problem:** The admin app has an internal `/console` (1-1) but no **walled, tenant-isolated sponsor surface**. External sponsors (roles `sponsor_principal`/`sponsor_ops`, already in the role catalog) need to onboard, pass **KYB/Gate 0**, and land in a portal that shows only **their own** deal — never internal surfaces, never another sponsor's data. This story establishes the **tenant-isolation primitive** and the onboarding/KYB entry; the intake checklist + document upload is Story 6-2.

**Approach:** A `SponsorDeal` model keyed to a `sponsorOrgId`; a `requireSponsor(ctx)` guard (built on 1-1's `requireStaff`) that admits only sponsor roles and resolves their org; every sponsor query/mutation scoped to that org server-side; a KYB/Gate 0 step recorded like the consumer KYC (vendor **Middesk** stubbed for MVP, same posture as Persona was stubbed); and a walled `admin/app/sponsor/*` route subsection that internal staff cannot see and sponsors are confined to.

## Boundaries & Constraints

**Always:**
- **Tenant isolation is server-side and total.** A `sponsor_principal`/`sponsor_ops` identity resolves (via `requireSponsor`) to exactly one `sponsorOrgId`; every sponsor-facing query/mutation filters by it. A sponsor can NEVER read/write another sponsor's `SponsorDeal` or ANY internal (`/console`) data. Prove it with tests.
- **Two-way wall:** internal staff roles (ops/compliance/ai/platform) are barred from the sponsor mutations, and sponsor roles are barred from every `/console` (internal) function — reuse `requirePermission` for the internal side; add `requireSponsor` for the sponsor side. Neither leaks into the other (extends 1-1's scope wall to a role-partition within staff).
- **KYB/Gate 0 gates listing, not onboarding:** a sponsor can sign in and see their portal before KYB passes, but a deal cannot be **submitted** (6-2) until Gate 0 (KYB/UBO) is recorded passed. KYB is a recorded step with a stubbed Middesk seam (return + persist a result), audited — mirror `eligibility.ts`/Persona stub posture; do NOT integrate a live vendor.
- Every sponsor state change writes an audit entry (actor = the sponsor human).
- Sponsor UI uses only tokens + 1-5 primitives; `check:tokens` clean. The sponsor shell is a visually lighter, guided variant (per the design-system doc) but shares the token system.

**Never:**
- Do not build the intake checklist / document upload / status timeline (Story 6-2) or the internal review of the submission (Epic 3). Onboarding + KYB + the walled shell + tenant isolation only.
- Do not put sponsors in the consumer `users` table or give them Privy scope — they are `staff`-table rows with sponsor roles (per 1-1), partitioned by org.
- Do not touch `admin/app/console/*` internal pages, `admin/app/components/ui/*` (1-5), or `vesper_dvp/`.

## Code Map

- `app/convex/schema.ts` — `sponsorOrgs` (id, name, kybStatus: none|pending|passed|failed, kybRef, createdAt) and `sponsorMembers` linking `workosId` → `sponsorOrgId` + sponsor role; `sponsorDeals` (sponsorOrgId, propertyName, status: draft|kyb_pending|submitted, createdAt). Indexes: `sponsorMembers.by_workosId`, `sponsorDeals.by_org`.
- `app/convex/sponsor.ts` (**new**) — `requireSponsor(ctx)` (→ `requireStaff`, assert role ∈ {sponsor_principal, sponsor_ops}, resolve `sponsorMembers` → `sponsorOrgId`, throw if none); `mySponsorOrg` (query), `myDeals` (query, org-scoped), `startDeal` (mutation, `sponsor.manage`, org-scoped, audited), `recordKyb` (mutation — stubbed Middesk result, sets `kybStatus`, audited `sponsor.kyb.recorded`). Optionally `provisionSponsor` as an **internalMutation** (creates org + member for a WorkOS-invited sponsor; grant-only, like `grantRoles`).
- `app/convex/sponsor.test.ts` (**new**) — a sponsor sees only their org's deals; sponsor A cannot read sponsor B's deal; a sponsor cannot call any `/console` internal function (e.g. `listAudit`); an internal staff (ops) cannot call the sponsor mutations; KYB gates the submitted state; `provisionSponsor` absent from public `api`.
- `admin/app/sponsor/layout.tsx` + `admin/app/sponsor/page.tsx` (**new**) — the walled sponsor shell (lighter, guided) + onboarding/KYB entry; gated on `requireSponsor` via a `mySponsorOrg` read (redirect internal staff away). Uses 1-5 primitives + `StatusChip` for KYB state.
- `admin/app/components/AdminShell.tsx` — do NOT add sponsor entries to the internal nav; the sponsor shell is a SEPARATE layout tree. (Internal nav stays internal-only.)

## Tasks & Acceptance

**Acceptance Criteria:**
- Given a `sponsor_principal`, when they open `/sponsor`, then they see only their own org + deals and the KYB entry — no internal surfaces.
- Given sponsor A, when they query any deal of sponsor B (directly or via a crafted id), then they get nothing / denied (tenant isolation).
- Given a sponsor identity, when they call an internal `/console` function, then denied; given an internal staff identity, when they call a sponsor mutation, then denied.
- Given a deal whose org KYB is not passed, when submission is attempted, then it is blocked with a "complete KYB first" reason (submission itself is 6-2; the gate check lives here).
- Given a sponsor state change, when it commits, then an audit entry names the sponsor human.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass.

## Verify (from repo root)
`npm test` (consumer + new sponsor tests) · `app`/`admin` tsc clean (2 baseline settlement errors ignored) · `npm run lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green (`/sponsor` compiles) · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
