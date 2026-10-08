---
title: 'Story 5.1 — Compliance: KYC/AML adjudication → Token ACL eligibility'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
context:
  - '_bmad-output/admin/planning-artifacts/epics-and-stories.md (Story 5.1)'
  - '_bmad-output/admin/C-UX-Scenarios/A4-compliance-signoff/A4-compliance-signoff.md'
depends_on: ['1-1 (RBAC, compliance.review + freeze.execute perms)', '1-3 (audit)', '1-5 (UI)', 'existing eligibility.ts + eligibilityAttest.ts']
---

## Intent

**Problem:** The consumer self-service path (`eligibility.recordEligibility`, E3.2) records a stubbed-Persona KYC result and mirrors eligibility → Token ACL. But the **compliance officer** (Marcus, `compliance.review`) needs an admin surface to **adjudicate edge cases / AML flags** and to **override** a user's eligibility with a **recorded reason** — a decision that sets the Token ACL state on-chain (ineligible ⇒ stays frozen, cannot receive tokens). This is the compliance safety net over the same `eligibility` data; it does NOT replace the consumer flow.

## Boundaries & Constraints

**Always:**
- **Reuse the existing boundary, do not fork it.** Operate on the existing `eligibility` table (`eligible`, `tokenAclState`, `personaInquiryId`) and the existing on-chain seam `internal.eligibilityAttest.attestEligibilityOnChain` (scheduled, not awaited — an async chain effect). Do NOT re-implement eligibility or a second ACL path.
- **Adjudication is compliance-gated + reason-bearing + audited.** `adjudicateEligibility` requires `requirePermission(ctx, "compliance.review")`, a **non-empty reason**, and audits `compliance.eligibility.adjudicated` naming the compliance human + reason. Ineligible ⇒ `tokenAclState:"frozen"`; eligible ⇒ `"thawed"`.
- **Freeze/thaw is the compliance ACL lever.** `setTokenAclState` (freeze|thaw) requires `requirePermission(ctx, "freeze.execute")` (compliance holds it), audits `acl.frozen`/`acl.thawed` naming the human, and schedules the on-chain attestation. (This is compliance's operational lever — freeze.execute is already an operational permission compliance holds.)
- **AML screening is a stubbed input**, mirroring the Persona/Middesk stubs: `screenAml` is `requireUnsafeStubs`-guarded and records an `amlFlag` on the case for the reviewer; do NOT integrate live ComplyAdvantage/TRM.
- The Convex `eligibility` row stays the authoritative mirror; the live Token-2022 freeze/thaw remains the deferred boundary already marked in `eligibility.ts` — the scheduled attestation + audit are the record here.

**Never:**
- Do not build Reg A+ **cap enforcement** (Story 5-2) or the marketing sign-off (5-3). This story is KYC/AML adjudication → ACL only.
- Do not touch the consumer `recordEligibility` behavior, `admin/app/components/ui/*`, `globals.css`, or `vesper_dvp/`.

## Code Map

- `app/convex/schema.ts` — add optional `amlFlag` (`v.optional(v.union(v.literal("clear"), v.literal("flagged")))`) and optional `reviewedBy`/`reviewReason` to `eligibility` (all optional → no migration break; the consumer path leaves them unset). Add a `by_property` index on `eligibility` for the queue.
- `app/convex/compliance.ts` (**new**):
  - `adjudicateEligibility` (mutation, `compliance.review`): args `{ userId, propertyId, eligible, reason }`; non-empty reason required; upsert the `eligibility` row's `eligible` + `tokenAclState` (eligible?thawed:frozen) + `reviewedBy` (compliance human) + `reviewReason`; audit `compliance.eligibility.adjudicated` (meta: eligible, reason — no PII); schedule `attestEligibilityOnChain`. Idempotent on an unchanged decision.
  - `setTokenAclState` (mutation, `freeze.execute`): args `{ userId, propertyId, state: freeze|thaw }`; patch `tokenAclState`; audit `acl.frozen`/`acl.thawed`; schedule attestation.
  - `screenAml` (mutation, `compliance.review`, `requireUnsafeStubs("AML screening")`): sets `amlFlag` on the case; audit `compliance.aml.screened`. Stub — no live vendor.
  - `listComplianceQueue` (query, `compliance.review`): eligibility rows for review (by property / flagged), joined to a display-safe user handle (no PII beyond what audit already permits). `getComplianceCase` (query, `compliance.review`).
- `app/convex/compliance.test.ts` (**new**): a `compliance.review` officer adjudicates ineligible with a reason → row `eligible:false` + `tokenAclState:"frozen"` + audit names the human + reason + attestation scheduled; empty reason throws; a non-`compliance.review` staff (e.g. ops) is denied adjudication; `setTokenAclState` needs `freeze.execute` (ops denied); `screenAml` is stub-guarded; the consumer `recordEligibility` still passes unchanged (optional fields).
- `admin/app/console/compliance/page.tsx` (**new**): `compliance.review`-gated queue (DataTable) + per-case adjudicate (eligible/ineligible + reason) + freeze/thaw + AML-flag chip (StatusChip). One "Compliance" nav entry gated `compliance.review`.

## Acceptance Criteria
- Given a compliance officer adjudicating a case ineligible with a reason, when submitted, then the `eligibility` row becomes `eligible:false`/`tokenAclState:"frozen"`, an on-chain attestation is scheduled, and `compliance.eligibility.adjudicated` names the human + reason.
- Given an empty reason, then adjudication throws.
- Given an `ops_diligence` staff, when they adjudicate or freeze/thaw, then denied (not `compliance.review`/`freeze.execute`).
- Given `setTokenAclState(freeze)`, then the row is frozen, audited, and attestation scheduled.
- Given AML screening off (no flag), when `screenAml` runs outside the stub flag, then it refuses.
- Given the consumer suite, when `npm test` runs, then all pre-existing tests (661) still pass — `recordEligibility` and its tests unaffected by the optional fields.

## Verify (from repo root)
`npm test` (661 + new) · `app`/`admin` tsc clean (2 baseline) · `lint`/`lint:admin`/`check:tokens` clean · `NEXT_PUBLIC_CONVEX_URL=… npm run build:admin` green (`/console/compliance`) · `npx convex codegen` if needed.

Do NOT commit — the parent reviews + commits.
