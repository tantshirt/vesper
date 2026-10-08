---
title: 'Story 1.4 — Platform Admin: RBAC management + audited break-glass'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 1.4)'
  - '_bmad-output/admin/planning-artifacts/architecture.md (AI3 / AO2)'
depends_on: ['1-1 (grantRoles internalMutation, permission resolution)', '1-2 (staffPropertyInterest, sod helpers)', '1-3 (audit)']
---

## Intent

**Problem:** 1-1 deliberately left `grantRoles` as an `internalMutation` with **no public grant surface**. The Platform Admin (P6) needs a controlled surface to manage staff roles — but that surface is the single most security-relevant write in the product (whoever grants roles can grant operational power). It must (a) be gated by `rbac.manage`, (b) **detect SoD conflicts at grant time** and block/flag them with the reason, (c) never let the grantor escalate themselves, and (d) offer **audited, time-boxed break-glass** with a mandatory reason and a compliance notification. Platform Admin must gain **no operational power** in the process (AI3).

**Approach:** A public `manageStaffRoles` mutation gated by `rbac.manage` that wraps 1-1's grant logic with grant-time SoD detection + self-grant block; a `breakGlass` table + `invokeBreakGlass` mutation (mandatory reason, `expiresAt`, audit `breakglass.invoked`, compliance-visible record); permission resolution extended so an **active (non-expired)** break-glass grant confers its scope and an expired one confers nothing; and Platform-Admin console pages (role matrix + break-glass) using 1-5 primitives.

## Boundaries & Constraints

**Always:**
- The grant surface is gated by `requirePermission(ctx, "rbac.manage")` — only `platform_admin` today. Server-side, per request.
- **No self-escalation:** the caller cannot grant/modify roles for **their own** `workosId`, and cannot grant a role they do not themselves administer.
- **Grant-time SoD detection:** granting an operational (`gate.sign`-bearing) role to a staff member who holds any `staffPropertyInterest` (fee/listing) flags/blocks with the specific reason (name the properties). Reuse 1-2's data (`hasFeeInterest`/`staffPropertyInterest`); do not fork logic.
- **Durable blocked-grant logging — use the RETURN-REJECTION pattern, NOT throw+schedule.** `manageStaffRoles` is a `mutation`; a blocked grant is a *business rejection*, not a system error. So on a self-escalation / SoD / platform-admin-operational conflict: the mutation **detects it, `writeAudit`s the block (`rbac.self_grant_blocked` / `rbac.sod_grant_blocked`) inline, DOES NOT apply the grant, and RETURNS `{ blocked: true, reason }` — it does NOT throw.** Because the mutation commits normally (it just wrote an audit and no grant), the record is durable — no scheduler needed. (Contrast 1-2, where a mid-operation guard must throw to abort the operation, so it needs the action+scheduler mechanism. Do NOT scheduler-then-throw from this mutation — that rolls the audit back; see 1-2's spec correction.) Genuine validation errors (empty fields) still `throw`.
- **Platform Admin stays operationally powerless:** `manageStaffRoles` must refuse to grant `platform_admin` any operational permission, and must refuse to grant an operational role TO the platform-admin caller. Add a test asserting the role catalog still gives `platform_admin` zero operational perms.
- **Break-glass is time-boxed + audited + notified:** `invokeBreakGlass` requires a non-empty `reason`, sets `expiresAt` (a bounded max, e.g. ≤ 60 min), writes an immutable `breakglass.invoked` audit entry (durable), and creates a compliance-visible record. A break-glass grant confers permissions **only while `Date.now() < expiresAt`**.
- Reuse 1-1 `requireStaff`/`requirePermission`/`permissionsForRoles`, 1-2 sod helpers, 1-3 audit + `logBlockedAttempt` pattern. One permission path.

**Never:**
- Do not expose `grantRoles`/interest mutations more broadly than needed; `manageStaffRoles` is the only new public grant surface and it is `rbac.manage`-gated.
- Do not give `platform_admin` any money/ownership/eligibility/gate power, ever.
- Do not touch `admin/app/globals.css`, `admin/app/components/ui/*`, or `vesper_dvp/`.

## Code Map

- `app/convex/schema.ts` — `breakGlass` table: `workosId`, `scope` (array of permissions or a named elevated role), `reason`, `invokedBy`, `createdAt`, `expiresAt`, `status` (active|expired|revoked); index `by_workosId`. 
- `app/convex/rbac.ts` — extend permission resolution: `effectivePermissions(ctx, staff)` = `permissionsForRoles(staff.roles)` ∪ (active break-glass scope where `Date.now() < expiresAt`). `requirePermission`/`me` use `effectivePermissions`. Keep the single-path guarantee (still derived from `roles.ts` for role perms). Expired/revoked break-glass contributes nothing.
- `app/convex/rbacAdmin.ts` (**new**) — `manageStaffRoles` (public `mutation`, `rbac.manage`-gated): validates → self-grant block → grant-time SoD detection (fee-vs-gate, platform-admin-operational block) → delegates to the 1-1 grant logic (call the internal grant, or refactor `grantRoles` core into a shared helper both call) → audits `staff.granted` with the acting Platform Admin as `grantedBy`. `previewGrantConflicts` (query, `rbac.manage`) so the UI can show conflicts before submit.
- `app/convex/breakGlass.ts` (**new**) — `invokeBreakGlass` (public `mutation`, `breakglass.use`-gated: mandatory reason, bounded `expiresAt`, audit + compliance record), `revokeBreakGlass` (mutation), `listActiveBreakGlass` (query, `audit.read` or `rbac.manage`).
- `app/convex/rbacAdmin.test.ts` + `app/convex/breakGlass.test.ts` (**new**) — the ACs below.
- `admin/app/console/roles/page.tsx` (**new**) — Platform-Admin role matrix: list staff, grant/revoke via `manageStaffRoles`, show SoD conflicts inline (loss-red) via `previewGrantConflicts`, using 1-5 `DataTable`/`StatusChip`. Gated on `rbac.manage`.
- `admin/app/console/break-glass/page.tsx` (**new**) — invoke/list break-glass with mandatory reason; gated on `breakglass.use`.
- `admin/app/components/AdminShell.tsx` — add "Roles" (gated `rbac.manage`) and "Break-glass" (gated `breakglass.use`) nav entries.

## Tasks & Acceptance

**Acceptance Criteria:**
- Given a non-`rbac.manage` staff member, when they call `manageStaffRoles`, then denied.
- Given a Platform Admin granting a `gate.sign`-bearing role to a staff member who holds a fee/listing interest, when submitted, then it is blocked/flagged with the specific reason (naming the property) and durably audited.
- Given a Platform Admin attempting to grant any role to **their own** `workosId`, then it is blocked (no self-escalation) and durably audited.
- Given any grant, when it targets `platform_admin`, then no operational permission can be attached; and the role catalog still resolves `platform_admin` to zero operational permissions.
- Given `invokeBreakGlass` with an empty reason, then it throws; with a valid reason, then it writes a `breakglass.invoked` audit entry, creates a compliance-visible record, and sets a bounded `expiresAt`.
- Given an active break-glass grant, when `me`/`requirePermission` resolve, then the scope is conferred; given the same grant after `expiresAt`, then it confers nothing.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass.

## Verify (from repo root)
`npm test` (consumer + all new tests pass) · `app`/`admin` tsc clean (2 baseline settlement errors ignored) · `npm run lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green (`/console/roles`, `/console/break-glass` compile) · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
