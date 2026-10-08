# Epic 1 Context: Admin Foundation, RBAC & Segregation of Duties

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up the desktop-first admin/supply control plane — its auth substrate, per-request RBAC, the segregation-of-duties (SoD) engine, the immutable audit backbone, and the admin design-system extension — so that every later admin story inherits correct roles, walls, and provability for free. This epic ships no operator flow by itself; it is the substrate that makes the gate → mint → distribute spine safe. The integrity thesis of the whole platform (fee interests can never touch a gate, no human can self-approve, every money/ownership/eligibility decision is attributable to a named human) is either structurally true here or it is not true anywhere.

## Stories

- Story 1.1: Admin app scaffold + WorkOS auth + per-request RBAC
- Story 1.2: Segregation-of-duties engine
- Story 1.3: Immutable AuditLog + views/export
- Story 1.4: Platform Admin — RBAC management + break-glass
- Story 1.5: Admin design-system extension as code

## Requirements & Constraints

- **Auth + roles.** Staff and sponsors sign in via WorkOS SSO. Roles resolve in Convex and are checked **per-request on every query and mutation** — never UI-only. Six roles: Ops/Diligence, Compliance, AI-Reviewer, Sponsor-Principal, Sponsor-Ops, Platform-Admin. One unified console; each role sees only its permission-scoped views. The sponsor portal is a walled, tenant-isolated subsection with no internal chrome and no cross-sponsor visibility.
- **Scope wall.** No consumer-wallet scope is reachable from the admin surface.
- **Segregation of duties (server-side, structural).** Fee/listing powers and gate-signing powers are mutually exclusive: a user with a fee or listing stake in a property cannot sign any of its gates. Multi-party gates require a *distinct* second human signer (no self-approval). Platform-Admin holds **no operational powers** — cannot sign a gate, mint, freeze/thaw, or distribute; it configures RBAC and holds break-glass only. Violations are **blocked and logged as attempts** (blocked-attempt count is a tracked success metric, so the attempt record matters as much as the block).
- **Audit.** Every money / ownership / eligibility / diligence / role state change writes an immutable AuditLog entry: named-human actor, action, target, on-chain ref, timestamp. Append-only, attributable, exportable in a regulator-ready form. The admin console is the largest writer of this log.
- **Platform Admin surface.** Role grants run through SoD-conflict detection (fee-vs-gate flagged/blocked with the reason). Break-glass requires a mandatory reason, writes an audit entry, notifies compliance, and is time-boxed. Least-privilege defaults throughout.
- **Non-functional.** Desktop-first (≥1280px primary), data-dense; review queues virtualized to 10k+ rows with <100ms interaction. WCAG 2.2 AA: visible focus, 44px interactive rows, tabular money, status conveyed as color + icon + label (never color alone). Light-first only — no dark mode.

## Technical Decisions

- **Stack:** Next.js App Router on Vercel (separate application from the consumer app) over the **same shared Convex deployment**. Convex is the RBAC + SoD authority and the reactive read model. Solana remains authoritative for ownership/settlement/ACL; nothing in this epic writes to chain.
- **Repo layout (decided).** Convert the repo to an **npm workspace**: root `package.json` with `workspaces`, the working consumer app stays at `app/`, a new **`admin/`** desktop-first Next.js app is added, the Convex backend is hoisted to a shared workspace package both apps import (or `app/convex/_generated` is exposed via the workspace), and design tokens are shared as a package. **The consumer app build must not break — verify it still builds before finishing.**
- **Auth wiring.** The admin app points at the same `NEXT_PUBLIC_CONVEX_URL` and adds **WorkOS as a second Convex auth provider** in `auth.config.ts` alongside the consumer's Privy provider. WorkOS supplies SSO + directory; the role → permission decision itself is made in Convex.
- **Admin-relevant Convex entities:** Role/Grant, AuditLog (append-only), and — for later epics but referenced by the SoD engine — Property, DiligenceGate, EvidencePackage, Mint, Distribution, Eligibility, SponsorDeal. Field shapes are owned by code.
- **Design system is an extension, not a new system.** The canonical `D-Design-System` tokens (Fraunces + Inter, indigo/champagne, spacing/radii, semantic gain/loss/warning, tabular money) are inherited **verbatim**. The admin layer adds only: a **mono-data** type role (13px monospace, tabular, truncate-middle with copy-on-click, full value on hover — for addresses, tx sigs, mint IDs, doc hashes, signatures), a tighter density scale (44px default / 36px compact rows, 10px×14px cell padding, 20px section gap, 24px pane gutter, full-width fluid container overriding the consumer's 1240px max), and an operational **status system** mapping existing semantic tokens: Passed/Signed → gain + ✓, Blocked/Failed/SoD-conflict → loss + ⊘, Pending/Needs-you → warning + ◷, On-chain confirmed → accent + ⛓, Draft → muted + ○, Complete (earned, rare) → champagne + ★. No admin component may introduce a non-token color, font, or radius — a CI token-guard already fails the build on hardcoded hex outside `globals.css`, and the admin surface is held to the same rule.
- **Components this epic must deliver as code:** data table / virtualized review queue (sticky blurred header, status chips, tabular money, mono-data IDs), audit row (mono-timestamp · named actor · action · target · linkable on-chain ref; read-only, exportable), RBAC role matrix (roles × permissions grid, SoD-conflict cells flagged loss-red, break-glass rendered distinctly with a mandatory-reason affordance), and the **SoD block state** — a loss-colored, un-dismissable *inline* block stating the rule violated and the required second signer. The SoD block is a hard gate, not a toast. The gate-ceremony card, on-chain action panel, document viewer, and reconciliation banner belong to later epics but should be anticipated by the token/component layer.

## UX & Interaction Patterns

- **Evidence-first, accountable-by-name.** Status and actions attribute to a named human, never to a system or an AI. Copy states consequence and finality before any irreversible action. Voice is precise and accountable: "Signed by Priya Desai · Gate 3 · 2026-07-11 14:22 UTC", never "Approved ✅".
- **Fee/revenue context must never appear on a gate-decision surface.** This is a UI-level expression of the SoD wall, not just a backend rule.
- **The AI is never rendered as an approver** anywhere on the admin surface — relevant here only as a constraint the component layer must not make easy to violate.
- **Platform Admin flow (the epic's demoable arc):** role management shows roles, grants, and current SoD posture → a valid least-privilege grant applies and audits cleanly → a fee-vs-gate grant is **detected and blocked** with the exact rule violated → a break-glass grant demands a reason, audits, notifies compliance, and time-boxes → a self-check surface proves the Platform Admin's own account holds no operational powers.
- **Sponsor portal shell** is a visually lighter, guided variant (closer to the consumer app's calm): checklist cards, upload-with-validation, status timeline. Tenant-isolated; never shows internal chrome. Only the shell/wall is in scope here; the flows land in Epic 6.

## Cross-Story Dependencies

- **Story 1.1 gates everything** in this epic and every later epic (auth, RBAC, workspace layout).
- **Story 1.2 (SoD engine) depends on 1.1 + 1.3** (it must be able to log blocked attempts), and in turn gates **Story 1.4** and the gate signature ceremony in Epic 3.
- **Story 1.3 (AuditLog) is cross-cutting** — every write path in every epic depends on it; build it early rather than retrofitting.
- **Story 1.5 (design system as code) unblocks every UI story** in every epic.
- Stories 1.1, 1.3, and 1.5 are parallel-safe with each other; 1.2 then 1.4 are sequential after them.
- **No open blockers gate this epic.** The known blockers (custody vendor, MFA/step-up posture, Gate 0–7 evidence definitions, Reg A+ marketing limits) all land on Epics 3–5. Note that step-up auth will be required by later on-chain actions — if the RBAC/permission layer can expose a clean interface seam for it, later stories can stub it.
