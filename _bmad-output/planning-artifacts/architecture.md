# Vesper — Architecture Spine

> The consistency contract: only the **invariants** that keep independently-built units from diverging. Structural detail (full trees, exhaustive schemas) is *seed* — true at cold-start, owned by the code once it exists. Rationale lives in v5 + the memlog, not here.

**Created:** 2026-07-07 · **Method:** BMad Method (Solutioning) · Fast-path draft — correct `[ASSUMPTION]` tags in review.
**Inputs (foundation):** *Vesper Brief v5* (§0, §7–§9, §12) · Product Brief · Trigger Map · **WDS design foundation** (D-Design-System, Scenarios, DD-001/DD-002) · Platform Requirements.

---

## Paradigm (carries the model for free)

**Reactive full-stack with on-chain-authoritative settlement.**
- **Convex** is the reactive **entitlement authority + read model** (queries, scheduled functions, HTTP actions, audit, vector search).
- **Solana** is the **source of truth for ownership and settlement**. Money and ownership only change on-chain, atomically.
- **Convex reconciles to chain via Helius; on-chain always wins.** Convex may hold *intent* (pending orders) and *entitlement* (eligibility), never authoritative ownership.

One rule to test any decision below: *if two units one level down could implement it incompatibly, and the call is non-obvious, it's fixed here.*

---

## Invariants (the load-bearing calls)

### I1 · Two separate surfaces, one backend
- **Consumer app** (Next.js/Vercel PWA, **Privy** auth) and **Admin/Sponsor portal** (**Clerk**/WorkOS auth) are *separate applications* sharing one **Convex** backend. Neither surface's auth leaks into the other. RBAC + segregation of duties enforced in Convex.
- **[ASSUMPTION]** one Convex deployment, two frontends; sponsor portal never gains consumer-wallet scope.

### I2 · Settlement is atomic, on-chain, and authoritative
- Every ownership transfer is **atomic DvP** (Anchor): payment (USDC) and token delivery settle together or the whole order fails. No path exists where Convex marks an order settled without the on-chain DvP confirming.
- **Token-2022 + Token ACL**, frozen-by-default; eligibility gates self-thaw. An ineligible account *cannot* receive tokens — enforced on-chain, not just in UI.
- **Pyth** is market-context only; **never** single-property NAV (admin NAV-strike, signed off-chain, hashed on-chain).

### I3 · State-change discipline
- All money/ownership/eligibility/diligence state changes write an **immutable AuditLog** entry (actor, action, target, timestamp).
- Convex↔chain drift is reconciled by **Helius** webhooks → Convex HTTP actions; **chain wins** on conflict.
- Distributions are recorded on an on-chain **distribution ledger** (Anchor) and mirrored to Convex `IncomeLedger`.

### I4 · The AI never approves
- The diligence AI (extraction, validation, monitoring, investor assistant) runs **through the Vercel AI Gateway (ZDR on)** and is **isolated from the approval path**. It accelerates and documents; **a named human signs every Gate 0–7**. No code path lets an AI write an approval or a gate signature.
- **Prompt-injection boundary:** untrusted sponsor documents reach the *read/extract* agent only; they never reach a *recommend/approve* surface directly.

### I5 · Compliance is structural, not UI polish
- **KYC required before confirm-investment**; browse/save require none. Eligibility recorded in Convex, enforced on-chain by Token ACL.
- **Reg A+**: per-investor investment-limit enforcement (replaces accreditation checks). Jurisdiction/eligibility gates every buy and secondary transfer.
- **Sponsor-listing revenue is organizationally walled off from diligence sign-off** (segregation of duties in RBAC) — fee status must never influence a gate.

### I6 · The consumer boundary hides crypto
- No crypto vocabulary (wallet/gas/tx/mint) crosses into the consumer surface; wallet is Privy-embedded and abstracted. On-chain proof is a *pull* affordance ("provable on demand"), never required in the primary path.

### I7 · Design foundation is fixed
- **`D-Design-System/00-design-system.md` (sourced from the Brand Direction Brief) is the single source of visual truth.** All UI inherits its tokens (Fraunces+Inter, indigo/champagne, spacing/radii, voice rules). No component invents alternates.

---

## Ownership of shared data (who's authoritative)

| Data | Authority | Notes |
|------|-----------|-------|
| Token ownership / balances | **On-chain (Token-2022)** | Convex mirrors via Helius; chain wins |
| Orders (pending → settled/failed) | Convex intent → **on-chain DvP** confirms | Convex never self-settles |
| Eligibility / KYC / Reg A+ cap | **Convex** → enforced by Token ACL on-chain | |
| Diligence gates (0–7) + human signature | **Convex** (+ document hashes on-chain) | AI-assisted, human-signed |
| Income / distributions | **On-chain ledger (Anchor)** → Convex `IncomeLedger` | |
| Property / offering metadata | Convex (+ on-chain TokenMetadata) | |
| Audit log | Convex (append-only) | every state change |

---

## Seed (true at cold-start; owned by code thereafter)

- **Stack** (locked, v5 §0): Next.js App Router / Vercel · Convex · Privy (consumer) · Clerk/WorkOS (admin) · Anchor/Rust · Token-2022 + Token ACL · USDC + Anchor DvP · Pyth · Helius · Vercel AI Gateway + Gemini embeddings.
- **Core Convex entities** (from DD-001/002): User, Property, DiligenceGate, Order, Holding, Eligibility, IncomeLedger, Distribution, PropertyUpdate, AuditLog. *(shape owned by code; see DD yamls)*
- **Vendors** (verify terms at build): Persona (KYC), ComplyAdvantage/TRM (AML), Middesk/Qualia/HouseCanary/ATTOM (gates 0–3), Securitize (transfer agent), DocuSign, Privy+Bridge (fiat).

---

## Deferred (not fixed here — decide at the unit that needs it)

- UI component tree / file structure · exact Convex schema field types · Anchor account layouts (owned by the program) · caching/CDN specifics · non-critical vendor swaps.

## Open decisions (block specific units — from Delivery handoff)

1. **Escrow / fund-custody vendor** → blocks DvP money-movement (DD-001).
2. **Ownership-% basis** (appraisal vs raise vs share count) → blocks calculator/confirmation math.
3. **Reg A+ pre-auth marketing limits** (counsel) → blocks public Explore/Property content.
4. **Consumer-visible Gate 0–7 labels** → Trust Stack content.

> `[ASSUMPTION]` tags and open decisions above are the only non-ratified calls. Everything else is inherited from v5 + the design foundation and should not be re-litigated downstream.

---

## Feeds

This spine + **DD-001/DD-002** are the inputs to **Epics & Stories** (next Solutioning step). Altitude: initiative → the two delivered flows are the first two epics.
