# Vesper — consumer app

Story **E1.1 · Reactive backbone** (Next.js + Convex + Privy). First slice of the build; the substrate every later epic inherits.

## Stack
- **Next.js** (App Router) — consumer PWA
- **Convex** — reactive backend + entitlement authority + append-only audit log
- **Privy** — passkey auth + pre-generated embedded self-custodial Solana wallet
- Auth bridge: Convex trusts Privy JWTs via **Custom JWT** (`convex/auth.config.ts`)

## Setup
```bash
cd app
npm install
cp .env.local.example .env.local          # fill NEXT_PUBLIC_CONVEX_URL + NEXT_PUBLIC_PRIVY_APP_ID
npx convex dev                            # first run: logs in, provisions deployment, generates convex/_generated
# In the Convex dashboard → Settings → Environment Variables, set:
# PRIVY_APP_ID = <your Privy app id>
# VESPER_ENABLE_DEMO_SEED = true           # only when intentionally seeding demo data
npm run seed                              # seed The Monroe (+ 8 signed diligence gates) for E2 read-path
npm run dev                               # http://localhost:3000
```
> Convex codegen (`convex/_generated/`) is created by `npx convex dev` — the `@/convex/_generated/api` import resolves after that.

## E1.1 acceptance criteria → where they're met
| AC | Implementation |
|----|----------------|
| Scaffold: Next.js + Convex wired | `package.json`, `app/`, `convex/`, `app/providers.tsx` |
| Privy passkey sign-in issues a JWT | `PrivyProvider` in `providers.tsx` (passkey login, Solana embedded wallet) |
| Convex trusts it via `customJwt` | `convex/auth.config.ts` (issuer `privy.io`, per-app JWKS, ES256) |
| User resolves in a reactive query | `convex/users.ts:currentUser` + `app/page.tsx` (`useQuery(api.users.currentUser)`) |
| Every mutation writes AuditLog (FR16) | `convex/audit.ts:writeAudit`, called in `users.ts:ensureUser` and `properties.ts:seedTheMonroe` |

## Architecture invariants honored (planning-artifacts/architecture.md)
- **I1** two surfaces / one backend — this is the consumer surface (Privy); admin uses Clerk separately.
- **I3** append-only `auditLog`; **I6** crypto invisible (passkey, embedded wallet, no crypto vocab in UI).
- **I7** UI uses design-system tokens (`app/globals.css`, sourced from `D-Design-System`).

## Safety switches
- `VESPER_ENABLE_UNSAFE_STUBS=true` enables demo-only KYC, funding, and DvP stubs. Leave unset for production.
- `VESPER_ENABLE_DEMO_SEED=true` enables seed mutations. The rich portfolio seed also requires an explicit `privyId` and `unsafeConfirm`.
- `VESPER_ENABLE_SOLANA_PAY=true` enables the prototype Solana Pay transaction builder route.
- `VESPER_ENABLE_PUBLIC_ONCHAIN_CONFIRM=true` enables the prototype client-triggered on-chain confirmation action.

## Next stories
- **E1.2** self-host Fraunces + Inter as `@font-face`; full token pass.
- **E1.3** Helius → Convex reconciliation (HTTP action; chain wins).
- **E1.4** finish core schema + richer seed.
- **E2.1/E2.2** Explore + Property Detail against the seed (design: DD-001 / prototypes).
