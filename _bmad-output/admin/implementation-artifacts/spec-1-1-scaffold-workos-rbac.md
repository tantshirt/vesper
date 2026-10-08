---
title: 'Story 1.1 — Admin app scaffold + WorkOS auth + per-request RBAC'
type: 'feature'
created: '2026-07-11'
status: 'in-progress'
baseline_revision: '73d8feef7ba475412073d2669661d6de26eba58f'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/admin/implementation-artifacts/epic-1-context.md'
warnings: [multiple-goals, oversized]
---

<intent-contract>

## Intent

**Problem:** Vesper has only a consumer app (`app/`, Privy-authed investors) and no admin/supply control plane. There is no staff identity, no roles, and no permission check anywhere in Convex — so none of the gate → mint → distribute stories can be built safely, because "a named human with a specific role did this" is not yet representable.

**Approach:** Convert the repo to an npm workspace, add a sibling desktop-first `admin/` Next.js app on the **same Convex deployment**, trust WorkOS-issued JWTs as a **second** Convex auth provider alongside Privy, and introduce a `staff` model plus a per-request RBAC layer (`requireStaff` / `requirePermission`) that every admin query and mutation must call. Demoable end state: a WorkOS user with granted roles signs in to `admin/` and the console shell renders only the surfaces their permissions allow — while the consumer app builds, tests, and behaves exactly as before.

## Boundaries & Constraints

**Always:**
- The consumer app must keep building, linting, and passing tests. Verify it, do not assume it.
- **Do not move `app/convex/`.** Expose it to `admin/` through the workspace (`exports` on the consumer package + a workspace dependency). Both apps read the same `NEXT_PUBLIC_CONVEX_URL`.
- RBAC is decided **server-side in Convex on every request**. A UI that hides a nav item is a convenience, never the enforcement point.
- **Scope wall, enforced structurally:** a WorkOS (staff) identity must not resolve to a consumer `users` row, and a Privy (consumer) identity must not resolve to a `staff` row. Staff identity is keyed on `workosId`; consumer identity stays keyed on `privyId`.
- The `auth.config.ts` WorkOS provider entry must be **conditional on `WORKOS_CLIENT_ID` being set**. The existing file throws on a missing env var at deploy/analyze time; an unconditional entry would break the live consumer deployment and the test suite.
- Roles are exactly the six named in the role catalog. Platform-Admin gets **no operational permission** (cannot sign, mint, freeze, or distribute).
- Admin UI colors/fonts/radii come from the existing tokens in `app/app/globals.css`. The token guard must pass over the new `admin/` tree.

**Block If:**
- Sharing `app/convex/` with `admin/` cannot be made to work without physically relocating the `convex/` directory (that relocation is a larger refactor than this story authorizes).
- Making the consumer app pass its existing `npm run build` / `npm run lint` / `npm test` after the workspace conversion requires changing consumer product behavior.

**Never:**
- Do not build the segregation-of-duties engine (Story 1.2), the RBAC admin/break-glass UI (Story 1.4), the AuditLog extension and export views (Story 1.3), or the admin design-system extension — density scale, mono-data type role, status chips (Story 1.5). This story only needs the tokens to be *reachable* from `admin/`.
- Do not add Tailwind, CSS modules, or any styling stack the consumer app does not already use. Plain `className` against `globals.css` is the house idiom.
- Do not touch `vesper_dvp/` (Rust/Cargo, outside the npm build) or write to chain.
- Do not add real WorkOS credentials to the repo. Env vars are documented in `.env.local.example`, never committed with values.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Staff request, permitted | WorkOS identity; active `staff` row whose roles grant `property.read` | `requirePermission(ctx, "property.read")` returns the `staff` doc | No error expected |
| Staff request, not permitted | WorkOS identity; active staff with only `platform_admin` calling `requirePermission(ctx, "gate.sign")` | Denied | Throws `Not permitted: gate.sign`. In a **mutation**, first writes an `auditLog` entry `rbac.denied` with the named actor, the permission, and the roles held |
| Unauthenticated | No identity | Denied | `requireStaff` throws `Not authenticated` |
| Consumer token at an admin function | Privy identity (issuer `privy.io` / no WorkOS issuer) | Denied — the scope wall | `requireStaff` throws `Not authenticated as staff` |
| Staff token at a consumer function | WorkOS identity reaching `findUserByIdentity` | Resolves to **no** consumer user | Returns `null`; existing callers already throw/`return null` on a missing user |
| Known WorkOS user, no staff row | Valid WorkOS JWT, no `staff` record | Denied — staff access is grant-only, never self-provisioned | `requireStaff` throws `Not authenticated as staff` |
| Revoked staff | `staff.status === "revoked"` | Denied on every request immediately | `requireStaff` throws `Staff access revoked` |
| Existing consumer tests | `t.withIdentity({ subject: "did:privy:..." })` — subject only, **no issuer** | Still resolve to the consumer user exactly as today | No error expected — the scope wall must key off a *recognized WorkOS issuer*, not off the absence of one |
| WorkOS not configured | `WORKOS_CLIENT_ID` unset in the Convex env | Convex deploys with the Privy provider only | No throw; the consumer deployment and `npm test` stay green |

</intent-contract>

## Code Map

- `package.json` (root, **new**) -- npm workspace root: `workspaces: ["app", "admin"]`; the `overrides` block **moves here from `app/package.json`** (npm honors `overrides` only at the workspace root); delegating scripts.
- `package-lock.json` (root, **new**) -- regenerated by a root `npm install`; `app/package-lock.json` is deleted.
- `app/package.json` -- add an `exports` map so `admin/` can import `./convex/_generated/api`, `./convex/_generated/dataModel`, `./convex/roles`, and `./app/globals.css`. Remove `overrides` (moved to root).
- `app/convex/auth.config.ts` -- add the **conditional** WorkOS `customJwt` provider next to Privy.
- `app/convex/security.ts` -- widen the local `Identity` type with `issuer`; add `isWorkosIdentity()` (matching the **exact** configured issuer prefix, not the whole WorkOS host); add `requireConsumer()`; make `findUserByIdentity()` refuse WorkOS identities (consumer side of the scope wall).
- `app/convex/users.ts` -- **caller of `findUserByIdentity`.** `ensureUser` treats a `null` lookup as "not provisioned yet" and *inserts*. Once the resolver refuses WorkOS identities, a staff token would make it manufacture a fresh consumer row (and a `user.created` audit entry) on **every call**. It must reject WorkOS identities outright.
- `app/convex/onchainConfirm.ts` -- **caller of `findUserByIdentity`.** Rebuilds an identity as `{ subject, tokenIdentifier }` across an internalQuery boundary, dropping `issuer` — which silently disarms the scope wall on that path. `issuer` must be threaded through.
- `app/convex/roles.ts` (**new**) -- single source of truth: the 6 roles, the permission catalog, and the role → permissions map. Exactly ONE permission-derivation path. Imported by both Convex and the admin UI.
- `app/convex/rbac.ts` (**new**) -- `requireStaff`, `requirePermission`, `permissionsForRoles`; the `me` query; `grantRoles` as an **`internalMutation`** (never on the public `api`).
- `app/convex/schema.ts` -- add the `staff` table (`workosId`, `email`, `name`, `roles[]`, `status`, `createdAt`) with a `by_workosId` index.
- `app/convex/audit.ts` -- unchanged; reused as-is for the `rbac.denied` and `staff.granted` entries.
- `app/scripts/check-tokens.mjs` -- `SCAN_DIR` becomes a list of roots so it covers `admin/app` too; tolerate a root that does not exist.
- `app/app/globals.css` -- read-only here; the token source `admin/` imports.
- `admin/` (**new app**) -- `package.json`, `next.config.mjs` (`transpilePackages: ["vesper-app"]`), `tsconfig.json` (`@/*` → `./*`), `eslint.config.mjs`, `middleware.ts`, `app/layout.tsx`, `app/providers.tsx`, `app/globals.css`, `app/page.tsx`, `app/console/layout.tsx`, `app/console/page.tsx`, `app/components/AdminShell.tsx`, `lib/useAuthFromWorkos.ts`, `public/fonts/*`.
- `app/lib/useAuthFromPrivy.ts` -- the adapter shape (`{isLoading, isAuthenticated, fetchAccessToken}`) that `useAuthFromWorkos` must mirror.
- `app/app/components/AppShell.tsx` -- the nav-array + `isActive()` shell pattern `AdminShell` should follow.
- `app/convex/eligibility.mutations.test.ts` -- the convex-test idiom (`convexTest(schema, modules)`, `t.withIdentity`, `t.run`) to mirror in RBAC tests.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` (root) -- create the workspace root over `["app", "admin"]`; move `overrides` here verbatim from `app/package.json`; add `build`, `lint`, `test`, `check:tokens` scripts that delegate to the consumer workspace, plus `build:admin` / `dev:admin` -- one install tree, and `overrides` keeps applying.
- [ ] `app/package.json` -- add the `exports` map (convex api/dataModel/roles + `./app/globals.css`); drop `overrides` -- lets `admin/` consume the shared backend and tokens without moving `app/convex/`.
- [ ] `app/convex/roles.ts` -- define `STAFF_ROLES` (`ops_diligence`, `compliance`, `ai_reviewer`, `sponsor_principal`, `sponsor_ops`, `platform_admin`), the `PERMISSIONS` catalog, and `ROLE_PERMISSIONS`; export a Convex `roleValidator` -- one catalog shared by server enforcement and UI rendering, so they cannot drift.
- [ ] `app/convex/schema.ts` -- add the `staff` table + `by_workosId` index -- staff identity distinct from consumer `users`.
- [ ] `app/convex/auth.config.ts` -- append the WorkOS provider **only when `WORKOS_CLIENT_ID` is set**: `type: "customJwt"`, `issuer: https://api.workos.com/user_management/${WORKOS_CLIENT_ID}`, `jwks: https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}`, `algorithm: "RS256"`, **no `applicationID`** -- AuthKit access tokens carry no documented `aud`, and Convex only enforces `aud` when `applicationID` is present.
- [ ] `app/convex/security.ts` -- add `issuer` to `Identity`; add `isWorkosIdentity()` matching the **exact** issuer prefix `https://api.workos.com/user_management/` (NOT the bare host — a bare-host match would silently promote any future WorkOS-hosted issuer to a staff issuer, which fails *open*); add `requireConsumer(ctx)` returning the identity or throwing for a WorkOS one; and return `null` from `findUserByIdentity()` for WorkOS identities -- the consumer half of the scope wall, keyed on a recognized WorkOS issuer so the existing subject-only tests keep passing.
- [ ] `app/convex/users.ts` -- `ensureUser` must call `requireConsumer(ctx)` before its lookup -- **without this the scope wall inverts into a consumer-account factory**: `findUserByIdentity` now returns `null` for a staff token, and `ensureUser` reads `null` as "provision this user", inserting a fresh `users` row plus a `user.created` audit entry on every single call.
- [ ] `app/convex/onchainConfirm.ts` -- thread `issuer` through the `callerWalletAddress` internalQuery args and into the `findUserByIdentity` call -- reconstructing an identity without `issuer` makes `isWorkosIdentity` return `false`, disarming the wall on exactly the path where a manufactured colliding row would be exploited.
- [ ] `app/convex/rbac.ts` -- `requireStaff(ctx)` (WorkOS identity → active `staff` row), `requirePermission(ctx, permission)` (denies + audits `rbac.denied` on mutations), `permissionsForRoles(roles)`, and the `me` query (named human, roles, resolved permissions, or `null` — **no `status` field**, since a revoked staff member already resolves to `null`, making it dead on the wire) -- the per-request enforcement surface every later admin function calls.
- [ ] `app/convex/rbac.ts` (grant path) -- `grantRoles` MUST be an **`internalMutation`**, not a `mutation`. It takes a required `grantedBy` argument naming the human who authorized the grant, and audits `staff.granted` with **`actor: grantedBy`** (never the grantee — an entry reading "Priya granted platform_admin to Priya" names nobody). It must reject an empty `name`/`email`/`roles`, and on upsert must **preserve an existing `revoked` status** unless `status` is passed explicitly (a name or role edit must never silently reactivate revoked staff) -- see Design Notes: *The grant surface is the crown jewel*.
- [ ] `app/convex/rbac.test.ts` -- unit-test every row of the I/O matrix with `convexTest` + `t.withIdentity({ subject, issuer })`, including: a Privy-shaped identity is refused staff; a WorkOS-shaped one is refused consumer **and cannot provision one via `ensureUser`**; `grantRoles` is absent from the public `api` surface; a revoked member is not reactivated by a role edit; and the grant audit names the grantor -- the scope wall is the story's core claim and must be proven, not asserted.
- [ ] `app/scripts/check-tokens.mjs` -- scan a list of roots (`app/app`, `admin/app`), skipping any that does not exist, but **exit 1 if zero roots were found** -- a guard that passes having scanned nothing is worse than no guard, because it reports success.
- [ ] `admin/package.json` + `tsconfig.json` + `next.config.mjs` + `eslint.config.mjs` -- Next 16 App Router app named `vesper-admin`, depending on `vesper-app` (workspace) + `convex` + `@workos-inc/authkit-nextjs`; `transpilePackages: ["vesper-app"]` so the shared TS/CSS compiles -- mirrors the consumer's config so one toolchain covers both.
- [ ] `admin/lib/useAuthFromWorkos.ts` + `admin/app/providers.tsx` -- the `{isLoading, isAuthenticated, fetchAccessToken}` adapter over AuthKit, wired into `ConvexProviderWithAuth` inside `AuthKitProvider`. When the token fetch/refresh fails, the adapter must **stop reporting `isAuthenticated: true`** -- otherwise an expired or revoked WorkOS session leaves Convex retry-looping against a dead token while the console misreports it as "no staff access" instead of "sign in again".
- [ ] `admin/proxy.ts` -- the AuthKit gate, using Next 16's **`proxy`** file convention (`middleware` is deprecated and warns on every build); `/console/*` requires a session, `/` stays public. It must **degrade coherently when the WorkOS env is absent** rather than 500-ing every route — the signed-out front door claims to work without credentials, so the gate must not contradict it.
- [ ] `admin/app/globals.css` + `admin/app/layout.tsx` + `admin/public/fonts/` -- `@import "vesper-app/app/globals.css"`, re-declare the `next/font/local` Fraunces + Inter bindings, copy the two `.woff2` files -- tokens inherited verbatim, so they cannot drift. **The fonts are byte copies and therefore CAN drift; say so in the comment rather than claiming "nothing was copied".**
- [ ] `admin/app/page.tsx` -- signed-out landing with a single "Sign in with SSO" action. Do **not** swallow every `getSignInUrl()` error into a silent fallback -- a misconfigured tenant would then be indistinguishable from a working one until a human clicks.
- [ ] `admin/app/components/AdminShell.tsx` + `admin/app/console/layout.tsx` + `admin/app/console/page.tsx` -- desktop-first shell whose nav is filtered by the permissions returned from `me`, and a console home naming the signed-in human with their roles and permissions. Gate the "not staff" state on Convex's **auth-loading** state (`useConvexAuth`), not on `me === null` alone, or granted staff will see a "No staff access" flash on every load while the token is still in flight. The nav must not link to routes that do not exist yet -- render only what a later story has actually built.
- [ ] `app/.env.local.example` + `admin/.env.local.example` -- document `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `NEXT_PUBLIC_CONVEX_URL` -- names only, never values.

**Acceptance Criteria:**
- Given the workspace conversion is complete, when `npm install && npm run build && npm run lint && npm test` run from the repo root, then the consumer app builds, lints at zero warnings, and every pre-existing test still passes.
- Given `WORKOS_CLIENT_ID` is unset, when Convex analyzes `auth.config.ts`, then it deploys with the Privy provider alone and nothing throws.
- Given a staff member holding only `platform_admin`, when `me` is queried, then the returned permissions contain the RBAC-configuration permissions and **no** gate-signing, minting, freezing, or distribution permission.
- Given a signed-in staff member, when the console shell renders, then it shows only the nav entries their permissions allow, and their name — not "admin" or a system label — identifies them.
- Given any new admin Convex function, when it is called, then it resolves the caller through `requireStaff`/`requirePermission` before reading or writing any data.
- Given the admin tree contains a hardcoded hex color, when `npm run check:tokens` runs from the root, then it fails and names the offending file and line.
- Given an anonymous caller and a deployment with `VESPER_ENABLE_DEMO_SEED=true`, when they attempt to reach the role-granting function over the public API, then **no such function exists on `api`** — granting is reachable only via `internal` (Convex CLI/dashboard, which requires deployment credentials).
- Given a WorkOS staff token, when `users.ensureUser` is called, then it throws and **no `users` row and no `user.created` audit entry is created**.
- Given a staff member whose `status` is `revoked`, when `grantRoles` is called again to edit their name or roles without an explicit `status`, then they remain `revoked`.
- Given a role grant, when the `staff.granted` audit entry is written, then its `actor` is the human who **authorized** the grant, not the human who received it.
- Given a granted staff member loading the console, when the WorkOS token is still in flight, then they see a loading state — never a "No staff access" flash.

## Spec Change Log

### 2026-07-11 — Amendment 1 (triggered by review pass 1)

**Triggering findings.** Both reviewers independently found that the grant path this spec prescribed was a privilege-escalation hole, and that changing `findUserByIdentity` without auditing its callers inverted the scope wall:

1. The spec said "`grantRoles` guarded by `requireSeedWrites`". That produced a **public, unauthenticated `mutation`** whose only guard passes whenever `VESPER_ENABLE_DEMO_SEED=true` — the flag the repo's README tells you to set on the deployment to seed data. Since `NEXT_PUBLIC_CONVEX_URL` is public, any anonymous caller on such a deployment could call `api.rbac.grantRoles` and grant themselves `ops_diligence` → `gate.sign` + `mint.execute` + `distribution.execute`. Verified against `app/convex/security.ts` (`seedWritesEnabled`) and `README.md:40`.
2. The spec told the implementer to make `findUserByIdentity` refuse WorkOS identities but never told it to check that function's **callers**. `users.ensureUser` reads a `null` lookup as "not provisioned yet" and *inserts* — so a staff token made it manufacture a fresh consumer `users` row plus a `user.created` audit entry on **every call**. `onchainConfirm.ts` rebuilds the identity across an internalQuery boundary without `issuer`, disarming the wall on that path entirely.
3. Same family, smaller: the grant audit named the **grantee** as actor; a name/role edit silently **reactivated revoked** staff; `isWorkosIdentity` matched the whole `api.workos.com` host rather than the configured issuer (fails open on a future WorkOS-hosted issuer); the token guard exits 0 when zero scan roots exist; `me` returned an always-`"active"` status field; a second unused permission-derivation path shipped beside the real one.

**What was amended.** Code Map gained `users.ts` and `onchainConfirm.ts` as caller-audit targets. Tasks now mandate: `grantRoles` as an **`internalMutation`** with a required `grantedBy` actor, empty-field rejection, and revoked-status preservation; a `requireConsumer()` guard on `ensureUser`; `issuer` threaded through `onchainConfirm`; an exact-issuer-prefix match; a token guard that fails on zero roots; one permission-derivation path; no dead `status` field; a `useConvexAuth`-gated console; Next 16's `proxy` convention; and honest comments wherever a claim is aspirational. Six acceptance criteria and three Design Notes were added.

**Known-bad state avoided.** A demo deployment on which any anonymous browser can mint itself an operational role, and a scope wall that — rather than blocking staff from consumer scope — silently *manufactures* consumer accounts for staff tokens on every call.

**KEEP — these worked and must survive re-derivation:**
- The **conditional WorkOS provider** in `auth.config.ts`, including the `"WORKOS_CLIENT_ID" in process.env` membership probe. It is load-bearing and was empirically verified: Convex rejects a push for any env var the auth config *reads* but that is unset, so a plain `process.env.X` read would make every consumer deploy require a WorkOS tenant to exist first. Keep the comment explaining why.
- The **issuer-positive** scope wall (`isWorkosIdentity`) and its reasoning: an issuer-negative rule would both break the existing subject-only tests and fail open. Narrow the prefix; do not invert the polarity.
- Not moving `app/convex/` — the workspace `exports` map + `transpilePackages: ["vesper-app"]` approach works and leaves the consumer intact.
- The **`staff` table separate from `users`**, roles stored / permissions derived, grant-only access (a valid WorkOS JWT with no row is not staff), and distinct throw messages per wall.
- The consumer-safety result: root `npm install`/`build`/`lint`/`test` green, 598 tests passing with zero pre-existing tests broken, `overrides` moved to the workspace root with pinned versions verified byte-identical to baseline.
- The multi-root token guard, the shared-`globals.css` import across the workspace, and the copied `.woff2` fonts.
- The test suite's structure (one test per I/O-matrix row, both identity shapes faked) and the house-style rationale comments throughout.

## Review Triage Log

### 2026-07-11 — Review pass 1
- intent_gap: 0
- bad_spec: 12: (high 5, medium 7)
- patch: 0
- defer: 0
- reject: 4
- addressed_findings:
  - `[high]` `[bad_spec]` `grantRoles` shipped as a **public unauthenticated mutation** guarded only by `requireSeedWrites` (satisfied by `VESPER_ENABLE_DEMO_SEED=true`, which the README instructs setting) — any anonymous caller could self-grant `ops_diligence` and thus `gate.sign`/`mint.execute`/`distribution.execute`. Spec amended to mandate an `internalMutation`, off the public `api` entirely.
  - `[high]` `[bad_spec]` `users.ensureUser` turned the new scope wall into a consumer-account factory: `findUserByIdentity` returns `null` for a staff token, and `ensureUser` reads `null` as "provision me", inserting a `users` row + `user.created` audit on every call. Spec amended to require a `requireConsumer()` guard and a caller audit of the changed resolver.
  - `[high]` `[bad_spec]` `onchainConfirm.ts` reconstructs the identity without `issuer`, so `isWorkosIdentity` returns `false` and the wall is bypassed on that path. Spec amended to thread `issuer` through.
  - `[high]` `[bad_spec]` The `staff.granted` audit set `actor` to the **grantee**, making the system's most security-relevant entry self-attributing ("Priya granted platform_admin to Priya"). Spec amended to require a `grantedBy` actor.
  - `[high]` `[bad_spec]` Platform-Admin's `rbac.manage` trivially escalates to every operational permission, while a test asserted their absence as if structural. Spec amended: no public grant surface in this story, and the residual constraint (no self-grant; granting an operational role is itself SoD-checked) is named as Story 1.4's job in code rather than implied away.
  - `[medium]` `[bad_spec]` `grantRoles` upsert silently **reactivated revoked staff** when `status` was omitted from an unrelated name/role edit.
  - `[medium]` `[bad_spec]` `grantRoles` accepted empty `name`/`email`, yielding an audit entry naming no human.
  - `[medium]` `[bad_spec]` `isWorkosIdentity` matched the whole `https://api.workos.com/` host instead of the configured issuer — fails **open** for any future WorkOS-hosted issuer, contradicting its own "fails shut" comment.
  - `[medium]` `[bad_spec]` `check-tokens.mjs` exits 0 when **zero** scan roots exist — a guard that reports success having scanned nothing.
  - `[medium]` `[bad_spec]` The console flashed "No staff access" to granted staff on every load, reading `me === null` as "denied" while the WorkOS token was still in flight.
  - `[medium]` `[bad_spec]` `rbac.denied` never persists (atomic rollback; `ctx.scheduler` does not escape it either) and query-side denials cannot audit at all — yet the module header asserted "blocked attempts are evidence". Spec amended to keep the in-transaction write but require honest comments, with durable logging named as Story 1.3's job (which is why 1.2 depends on 1.3).
  - `[medium]` `[bad_spec]` Dead/duplicated surface contradicting the spec's own "no second copy of the truth": an unused `hasPermission` second derivation path, an always-`"active"` `status` field on `me`, seven nav links to routes that do not exist, the deprecated Next 16 `middleware` convention, a swallowed `getSignInUrl()` error, a `refresh()` failure leaving `isAuthenticated: true`, and a `globals.css` comment claiming "nothing was copied" when the fonts are byte copies.
  - Rejected (4): module-scope `ConvexReactClient(...!)` throwing without env (identical to the consumer app's established pattern); `WORKOS_CLIENT_ID` format validation (over-engineering); `npm install` from inside `app/` dropping root `overrides` (that is how npm workspaces work); missing CI workflow + admin test coverage (real, but pre-existing and out of this story's scope — to be re-triaged as `defer` next pass).

## Design Notes

**Why the consumer's `convex/` does not move.** 25+ backend files import `./_generated/*` relatively, `@/*` is rooted at `app/`, `convex/tsconfig.json` and `vitest.config.ts` both assume the current shape, and `npx convex dev` finds `convex/` by convention from the package root. Moving it is a high-blast-radius refactor with no payoff for this story. Exposing it through the workspace gets `admin/` the same backend at a fraction of the risk, and Story 1.4+ can revisit if a true shared package is ever warranted.

**The scope wall must be issuer-positive, not issuer-negative.** Existing consumer tests fake identity as `t.withIdentity({ subject })` with no `issuer` at all. So the rule is "*is this a recognized WorkOS issuer?*" — never "is this issuer missing or not `privy.io`?", which would break every existing test and, worse, would fail open the day a third provider appears.

```ts
// app/convex/security.ts — the wall, in one predicate.
export function isWorkosIdentity(identity: Identity): boolean {
  return Boolean(identity.issuer?.startsWith("https://api.workos.com/"));
}
```

**Permissions are derived, never stored.** `staff.roles` holds roles; permissions are computed from `ROLE_PERMISSIONS` on every request. A role change therefore takes effect immediately, and there is no second copy of the truth to fall out of sync. Story 1.4 can add a `roleGrants` table for grant history without disturbing this. Keep this literally true: expose exactly **one** permission-derivation function. A second, unused one sitting beside it (however small) is the very drift this claim denies.

**The grant surface is the crown jewel — treat it like one.** Whoever can grant roles can grant themselves `ops_diligence`, and `ops_diligence` carries `gate.sign`, `mint.execute`, and `distribution.execute`. So the grant path is *strictly more powerful than every operational permission combined*, and the platform's integrity thesis rests on it, not on the role table. Two consequences, both binding:

1. **In this story there is no public grant surface at all.** `grantRoles` is an `internalMutation`: absent from `api`, reachable only through the Convex CLI/dashboard, which already requires deployment credentials. This also resolves the bootstrap cleanly — the first `staff` row is created by whoever owns the deployment, which is the only party who could be trusted to create it. A `mutation` guarded by `requireSeedWrites` is **not** an acceptable substitute: `requireSeedWrites` passes whenever `VESPER_ENABLE_DEMO_SEED=true`, the repo's own README instructs setting exactly that flag on the deployment to seed data, and `NEXT_PUBLIC_CONVEX_URL` is shipped to every consumer browser — so on a demo deployment any anonymous caller could mint themselves an operational role. That is the known-bad state this rule exists to prevent.
2. **Platform-Admin's "no operational powers" is not yet structural, and must not be claimed to be.** It holds `rbac.manage`, which is the power to grant — so it can escalate to any operational role the moment Story 1.4 builds a grant UI. The role table alone does not make the thesis true. Story 1.4 must add the missing constraints (no self-grant; granting an operational role is itself an SoD-checked act). State that plainly in code rather than letting a passing test imply a guarantee that does not exist.

**A denial audit written inside a failing mutation does not survive.** Convex mutations are atomic: `requirePermission` writes `rbac.denied` and then throws, so the write rolls back with everything else. `ctx.scheduler` does not escape this either — scheduled jobs are part of the same transaction. A **durable** blocked-attempt record therefore cannot be produced from inside the transaction it is blocking, and that is fine here: the epic sequences durable blocked-attempt logging behind Story 1.3 (immutable AuditLog + views), which is precisely why Story 1.2 lists 1.3 as a dependency. Implement the in-transaction write as the I/O matrix specifies, but **do not let comments claim blocked attempts are durable evidence today** — say what is actually true and name the story that makes it so. The same applies to denials on a `QueryCtx`, which cannot audit at all.

## Verification

**Commands:**
- `npm install` (repo root) -- expected: one root `package-lock.json`, `node_modules/vesper-app` symlinked to `app/`, no `app/package-lock.json`.
- `npm run build` (root, consumer) -- expected: succeeds, no new warnings. **This is the "do not break the consumer" gate.**
- `npm run lint` (root, consumer) -- expected: exit 0 at `--max-warnings=0`.
- `npm test` (root, consumer) -- expected: every pre-existing test passes, plus the new `rbac.test.ts` cases.
- `npx tsc --noEmit` in `app/` **and** in `admin/` -- expected: clean (there is no `typecheck` script; run it directly).
- `npm run build:admin` (root) -- expected: the admin app compiles.
- `npm run check:tokens` (root) -- expected: clean across both `app/app` and `admin/app`.

**Manual checks (if no CLI):**
- Live WorkOS SSO cannot be exercised unattended (no WorkOS tenant or credentials exist in this repo). Verify the wiring by inspection instead: `auth.config.ts` emits a second provider when `WORKOS_CLIENT_ID` is set; `useAuthFromWorkos` returns the same three-field shape as `useAuthFromPrivy`; `middleware.ts` matches `/console/*`. The RBAC decision itself is fully covered by `rbac.test.ts`, which fakes both issuers — so the untested surface is reduced to token *delivery*, not token *authorization*.
