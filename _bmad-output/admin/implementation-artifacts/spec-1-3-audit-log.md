---
title: 'Story 1.3 — AuditLog extension: named-human actor + on-chain ref + views/export'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 1.3)'
  - '_bmad-output/admin/planning-artifacts/architecture.md (AI5)'
---

## Intent

**Problem:** The consumer already has an append-only `auditLog` + `writeAudit()` (actor/action/target/meta/timestamp), and admin RBAC (1-1) already writes named-human actors (`staff.email`) into it. But there is (a) no place to record the **on-chain reference** an admin on-chain action produces, and (b) no **permission-gated view or export** of the trail — which AI5 (and compliance persona Marcus) require as the regulator-facing surface. This story makes the existing backbone admin-grade without disturbing the 25 existing consumer `writeAudit` callers.

**Approach:** Add an **optional** `onchainRef` to the audit entry + schema (backward-compatible), add `audit.read`/`audit.export` permissions, add a paginated/filterable `listAudit` query and an `exportAudit` surface (both permission-gated), and a permission-gated admin **Audit** console page that renders entries with the 1-5 primitives (`StatusChip`, `MonoData`, `DataTable`).

## Boundaries & Constraints

**Always:**
- The `onchainRef` field is **optional** — all 25 existing `writeAudit(...)` callers keep compiling and passing unchanged. Verify, don't assume.
- **Append-only is the invariant.** There is NO update/delete/patch on `auditLog` anywhere. Do not add one. Add a test asserting no such path is exposed on `api`.
- Every new query/export resolves the caller through `requirePermission(ctx, "audit.read"|"audit.export")` (from 1-1's `rbac.ts`) before reading. Server-side, per request.
- `audit.read`/`audit.export` are **oversight**, not operational, permissions — so `platform_admin` MAY hold them without violating "Platform-Admin has no operational powers." Grant read+export to `compliance` and `platform_admin`; grant read (not export) to `ops_diligence`.
- Admin Audit page colors/type come only from tokens + the 1-5 primitives. `check:tokens` must stay clean.

**Never:**
- Do not modify the 25 consumer callers' behavior, or `audit.ts`'s append-only contract.
- Do not build the compliance console / KYC-AML adjudication (that is Story 5-x). This story is the audit **backbone + read/export + page**, nothing more.
- Do not touch `admin/app/globals.css`, `admin/app/components/ui/*`, or `admin/app/styleguide/*` (owned by Story 1-5, landing just before you). USE the ui primitives; don't reimplement them.
- Do not touch `vesper_dvp/` or write to chain.

## Code Map

- `app/convex/schema.ts` — `auditLog`: add `onchainRef: v.optional(v.string())`; add a `by_actor` index (`["actor"]`) for filtering. Keep `by_target`, `by_timestamp`.
- `app/convex/audit.ts` — extend the `entry` type with `onchainRef?: string`; pass it through the insert. Signature stays back-compatible.
- `app/convex/roles.ts` — add `audit.read` + `audit.export` to `PERMISSIONS`; add them to `ROLE_PERMISSIONS` (compliance: read+export; platform_admin: read+export; ops_diligence: read). One derivation path only.
- `app/convex/auditQueries.ts` (**new**) — `listAudit` (query, `requirePermission "audit.read"`, `paginationOptsValidator`, optional filters: actor / action prefix / target / time range, newest-first via `by_timestamp`); `exportAudit` (query, `requirePermission "audit.export"`, returns a bounded batch of rows as JSON for a regulator-ready export — cap the row count and report truncation rather than unbounded scan).
- `app/convex/auditQueries.test.ts` (**new**) — a non-permitted staff (e.g. `sponsor_ops`) is denied `listAudit`/`exportAudit`; a `compliance` staff is allowed; `onchainRef` round-trips; there is no exposed path on `api` that patches or deletes an `auditLog` row; `exportAudit` truncation is reported.
- `admin/app/console/audit/page.tsx` (**new**) — permission-gated (`me` includes `audit.read`) Audit view: paginated `DataTable` of entries — actor (named human), action (StatusChip where the action maps to a status; plain otherwise), target, `onchainRef` (`MonoData`), timestamp; filter controls (actor/action/date). Gate the not-permitted state on `useConvexAuth` loading, not `me===null` alone (mirror 1-1's console pattern).
- `admin/app/components/AdminShell.tsx` — add exactly ONE nav entry, "Audit" → `/console/audit`, rendered only when `me` permissions include `audit.read`. (1-5 does not touch this file; you own the nav here.)

## Tasks & Acceptance

- [ ] Schema: optional `onchainRef` + `by_actor` index; existing rows/callers unaffected.
- [ ] `writeAudit`: threads optional `onchainRef`; 25 callers still compile.
- [ ] Permissions: `audit.read`/`audit.export` added and granted (compliance+platform_admin read+export; ops read).
- [ ] `listAudit`: permission-gated, paginated, filterable, newest-first.
- [ ] `exportAudit`: permission-gated, bounded, truncation reported.
- [ ] Tests: permission gating (allow compliance / deny sponsor_ops), `onchainRef` round-trip, no patch/delete path on `api`, export truncation.
- [ ] Admin Audit page + single permission-gated nav entry, using 1-5 primitives.

**Acceptance Criteria:**
- Given a `compliance` staff member, when they open the Audit page, then they see a paginated, filterable, append-only trail with named-human actors and (where present) an on-chain reference.
- Given a `sponsor_ops` staff member, when they call `listAudit`/`exportAudit`, then they are denied (`Not permitted: audit.read`/`audit.export`).
- Given any on-chain admin action later records an `onchainRef`, when the entry is written, then it round-trips into the view; and when a legacy consumer entry has none, then the view renders without it.
- Given the whole `api` surface, when scanned, then no function updates or deletes an `auditLog` row (append-only holds).
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass (the 25 callers are unaffected).

## Verify (from repo root)
`npm test` (consumer 599 + new audit tests pass) · `npm run lint` + `npx tsc --noEmit` in `app/` clean (2 pre-existing settlement.test.ts NODE_ENV errors are baseline, ignore) · `npm run lint:admin` + `admin` tsc clean · `NEXT_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run build:admin` green · `npm run check:tokens` clean.

Do NOT commit — the parent reviews + commits.
