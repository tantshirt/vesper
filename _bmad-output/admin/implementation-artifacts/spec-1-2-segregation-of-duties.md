---
title: 'Story 1.2 — Segregation-of-duties engine (fee-vs-gate + self-approval walls)'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 1.2)'
  - '_bmad-output/admin/planning-artifacts/architecture.md (AI3 / AO2)'
---

## Intent

**Problem:** 1-1 gives per-request RBAC, but two integrity walls central to the whole product are not yet representable: (a) a staff member with a **fee/listing stake** in a property must not be able to **sign that property's gates** (the listing-revenue-vs-diligence wall, brief §Business Model), and (b) a **multi-party gate** must be signed by **distinct** humans (no self-approval). AO2 measures these as **attempts blocked** — so a blocked attempt must be **durably logged even though the offending mutation rolls back**. This story builds the *engine*; the gate-signing ceremony that calls it is Story 3-1.

**Approach:** A `staffPropertyInterest` model records fee/listing conflicts; a new `sod.ts` exposes `assertNoFeeConflict` and `assertDistinctSigner` (plus a combined `requireGateSigner`) that throwing paths call; and a **scheduler-based durable audit** writes the blocked attempt in a *separate* transaction so it survives the caller's rollback. The `platform_admin`-has-no-operational-power wall is ALREADY enforced by 1-1 (that role holds no operational permission), so this story does not re-implement it — it adds a test asserting it.

## Boundaries & Constraints

**Always:**
- Enforcement is server-side in Convex, per request. These helpers are the callable primitives later stories (3-1 gate ceremony; mint/distribute) invoke — this story does not build the gate ceremony UI.
- **Durable blocked-attempt logging (CORRECTED during impl):** a blocked SoD attempt must persist. In Convex, `ctx.scheduler.runAfter` is **transactional with a mutation** — a job scheduled from a mutation that then throws is **rolled back with it** (empirically verified). Only a job scheduled from an **action** commits independently and survives the action's throw. Therefore the check/entry helpers run in **`ActionCtx`**: they `ctx.scheduler.runAfter(0, internal.sod.logBlockedAttempt, {...})` then throw, and the audit persists. DB reads (permission + interest) go through internal queries so 1-1's single permission path is reused verbatim. (This is naturally where the gate ceremony lives anyway — Story 3-1 signs on-chain, so it is already an action.) Do NOT try to durably log-then-throw from a mutation.
- Fee/listing interest is recorded only via an **`internalMutation`** (never public `api`), audited, mirroring 1-1's `grantRoles` posture.
- `assertDistinctSigner` compares by the **staff identity** (workosId), not display name.

**Never:**
- Do not build the gate-signing ceremony, mint, or distribution (Stories 3-1/3-2/4-x). Only the reusable SoD primitives + their data + tests.
- Do not weaken 1-1: reuse `requireStaff`/`requirePermission`/`permissionsForRoles` and the `staff` model; do not fork a second permission path.
- Do not add a `secondSignedBy` field to `diligenceGates` here — the multi-signer storage is Story 3-1's; this story's `assertDistinctSigner` takes the existing-signer set as an argument so it is storage-agnostic.
- Do not touch `admin/app/globals.css`, `admin/app/components/ui/*` (Story 1-5), or `vesper_dvp/`.

## Code Map

- `app/convex/schema.ts` — add `staffPropertyInterest` table: `workosId` (staff), `propertyId` (`v.id("properties")`), `kind` (`v.union("listing","billing","fee")`), `recordedBy`, `createdAt`; indexes `by_staff_property` (`["workosId","propertyId"]`) and `by_property` (`["propertyId"]`). Append-only in spirit; interests are added/removed via the internalMutation only.
- `app/convex/sod.ts` (**new**):
  - `assertNoFeeConflict(ctx, staff, propertyId)` — if a `staffPropertyInterest` row exists for `(staff.workosId, propertyId)`, schedule `logBlockedAttempt` (reason `sod.fee_conflict`, actor=staff, target=propertyId, meta includes the conflicting `kind` and the required "a distinct signer with no fee interest") and throw `SoD: fee/listing interest bars signing this property`.
  - `assertDistinctSigner(ctx, staff, existingSignerWorkosIds)` — if `staff.workosId ∈ existingSignerWorkosIds`, schedule `logBlockedAttempt` (reason `sod.self_approval`) and throw `SoD: a distinct second signer is required`.
  - `requireGateSigner(ctx, propertyId, existingSignerWorkosIds)` — `requirePermission(ctx,"gate.sign")` → `assertNoFeeConflict` → `assertDistinctSigner`; returns the staff doc. The single entry point 3-1 will call.
- `app/convex/sod.ts` — `logBlockedAttempt` as an **`internalMutation`** that `writeAudit`s `action: "sod.blocked"` with `{reason, permission?, propertyId, roles}` (this is the durable record; it runs in its own txn via the scheduler).
- `app/convex/sod.ts` — `recordPropertyInterest` / `removePropertyInterest` as **`internalMutation`s** (audited `sod.interest.recorded` / `sod.interest.removed`, actor = a required `recordedBy`).
- `app/convex/sod.test.ts` (**new**) — fee-conflicted staff is blocked signing the property AND a `sod.blocked` audit row exists **after** the throw (scheduler-durable); a self-approval is blocked + audited; a clean staff with `gate.sign` and no interest passes `requireGateSigner`; `platform_admin` (no `gate.sign`) is denied at the permission step; interest mutations are absent from public `api`.
- `app/convex/roles.ts` — no new permission needed (reuse `gate.sign`); leave the catalog unchanged unless a `sod.*` action string needs no permission (it doesn't — it's an audit action, not a permission).

## Tasks & Acceptance

- [ ] `staffPropertyInterest` table + indexes.
- [ ] `sod.ts`: `assertNoFeeConflict`, `assertDistinctSigner`, `requireGateSigner`, `logBlockedAttempt` (internalMutation, scheduler-invoked), `recordPropertyInterest`/`removePropertyInterest` (internalMutations, audited).
- [ ] Durable blocked-attempt audit via `ctx.scheduler.runAfter(0, ...)` — proven to persist after the caller throws.
- [ ] `sod.test.ts` covering every wall + the durability proof + api-absence of the interest mutations.

**Acceptance Criteria:**
- Given a staff member with a recorded fee/listing interest in a property, when they call `requireGateSigner` for it, then it throws AND (after the throw) a durable `sod.blocked`/`sod.fee_conflict` audit entry naming them exists. *(AFR2, AO2)*
- Given a multi-party gate whose existing signer set includes the caller, when `assertDistinctSigner` runs, then it throws `SoD: a distinct second signer is required` and durably audits `sod.self_approval`.
- Given a staff member holding only `platform_admin`, when they call `requireGateSigner`, then they are denied at the permission check (no operational power) — proving the wall 1-1 established.
- Given a clean `ops_diligence` staff with no interest in a property, when they call `requireGateSigner` with a signer set excluding them, then it returns their staff doc.
- Given the public `api`, when scanned, then `recordPropertyInterest`/`removePropertyInterest`/`logBlockedAttempt` are NOT present (internal only).
- Given the consumer suite, when `npm test` runs, then all pre-existing tests still pass.

## Verify (from repo root)
`npm test` (consumer 609 + new sod tests pass) · `npx tsc --noEmit` in `app/` clean except the 2 baseline `settlement.test.ts` errors · `npm run lint` clean · `npm run lint:admin` + admin tsc clean · `npm run check:tokens` clean · run `npx convex codegen` if `_generated` needs the new internal functions (reads app/.env.local; does not modify the deployment).

Do NOT commit — the parent reviews + commits.
