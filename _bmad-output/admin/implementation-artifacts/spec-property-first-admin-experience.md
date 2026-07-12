---
title: 'Property-first admin experience'
type: 'feature'
created: '2026-07-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a90ec2d5f0a87510bb47a9547464f8313d4f004d'
context:
  - '{project-root}/PRODUCT.md'
  - '{project-root}/_bmad-output/admin/planning-artifacts/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin console exposes Vesper's internal implementation vocabulary and nine separate tools before it tells staff which property needs attention, why, and what the safe next step is. Sparse screens, long explanations, and a flat navigation hierarchy make a high-trust workflow feel more complicated than it is.

**Approach:** Reframe the console around properties and required decisions. Add a photo-led Properties workspace, simplify Home into one prioritized action list plus property context, group navigation by operator jobs, and rewrite page-level language in plain English while retaining precise chain, audit, permission, and finality details where they are operationally necessary.

## Boundaries & Constraints

**Always:** Preserve every existing RBAC, segregation-of-duties, human-signature, AI-never-approves, audit, and on-chain-authority invariant. Use permission-scoped data only. Treat property imagery as identity/context, provide meaningful alt text, retain WCAG 2.2 AA keyboard/focus behavior, and keep status understandable without color. Keep existing URLs working even when they leave primary navigation.

**Ask First:** Any schema migration, replacement of existing property art with externally sourced photography, change to authorization rules, or removal of an existing operational capability.

**Never:** Fabricate property or queue state, hide cost/finality/consequence for irreversible actions, present AI output as approval, expose fee context in gate decisions, add decorative dashboard metrics, or use imagery in dense audit/compliance tables where it does not aid identification.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Staff has property access | Permission-scoped properties and action records | Home prioritizes actionable work; Properties shows photo, location, stage, progress, and the next allowed workflow | Loading uses clear skeleton/status copy; empty state explains that nothing needs action |
| Restricted staff role | Only a subset of permissions | Navigation, property actions, and queues show only permitted destinations | No inaccessible link or leaked record is rendered |
| Unknown property name | No dedicated artwork | Deterministic existing fallback art keeps identity stable | Never render a broken image or invented location |
| Technical/high-risk action | Mint, eligibility, distribution, or emergency access | Plain-English heading and action lead; exact technical consequence remains adjacent or under technical detail | Existing blocking and error messages remain visible and attributable |

</frozen-after-approval>

## Code Map

- `admin/app/components/AdminShell.tsx` -- permission-aware grouped navigation and mobile drawer.
- `admin/app/components/PropertyArtwork.tsx` -- shared, deterministic property imagery with meaningful alt text.
- `admin/app/console/page.tsx` -- Home queue and property overview.
- `admin/app/console/properties/page.tsx` -- new property-first workspace.
- `admin/app/console/error.tsx` -- recoverable workspace failure state.
- `app/convex/adminOverview.ts` -- permission-scoped Home/property read model.
- `app/convex/adminOverview.test.ts` -- access and property-summary contract tests.
- `app/app/components/propertyImage.ts` -- canonical deterministic property art mapping.
- `admin/app/globals.css` -- responsive shell, action list, imagery, property workspace, and shared page-header styles.
- `admin/app/console/{diligence,diligence/gates,mint,compliance,distribution,roles,break-glass,audit}/page.tsx` -- plain-English page identity and supporting copy.

## Tasks & Acceptance

**Execution:**
- [x] `app/convex/adminOverview.ts`, `app/convex/adminOverview.test.ts` -- add a permission-safe property summary and explicit property context to queue items; test role filtering and stable state mapping.
- [x] `admin/app/components/AdminShell.tsx` -- replace the flat technical menu with grouped Home, Properties, Investor reviews, Payments, Team access, Emergency access, and Activity log navigation.
- [x] `admin/app/console/properties/page.tsx` -- build a photo-led property workspace with progress, next step, and permission-aware links into existing review/publish flows.
- [x] `admin/app/console/page.tsx` -- create a focused, personalized Home with a single priority order, helpful empty states, and concise property context.
- [x] `admin/app/console/{diligence,diligence/gates,mint,compliance,distribution,roles,break-glass,audit}/page.tsx` -- replace internal page titles and long introductions with plain-English task framing; retain exact technical labels inside evidence and action details.
- [x] `admin/app/globals.css` -- implement polished responsive states, restrained imagery, consistent controls, and clear hierarchy using inherited Vesper tokens.

**Acceptance Criteria:**
- Given an authorized operator, when they open Home, then the first screen answers what needs attention, which property/person it affects, why, and the next safe action without requiring technical vocabulary.
- Given a property record, when staff open Properties, then they see a recognizable image, location, current stage, completed progress, and only actions allowed by their permissions.
- Given a restricted role, when navigation and property actions render, then inaccessible operational areas and records are absent while Home, permitted work, and account context remain understandable.
- Given an irreversible or regulated workflow, when its screen is opened, then plain English leads while exact consequence, finality, evidence, named accountability, and audit semantics remain available and unchanged.
- Given desktop and narrow viewport layouts, when the console is navigated by keyboard, then content remains legible, focus-visible, non-overflowing, and operable.

## Design Notes

Use one restrained sans-led product hierarchy; reserve Fraunces for property names and page identity. Photos belong on Home work items and property cards, not as broad hero decoration. Prefer one bordered work surface with clear rows over nested cards. Technical terms may appear after the plain answer, labeled as implementation or on-chain detail.

## Verification

**Commands:**
- `npm run lint --workspace=admin` -- expected: no warnings or errors.
- `npm run build --workspace=admin` -- expected: production build succeeds.
- `npm test -- --run convex/adminOverview.test.ts` -- expected: permission and summary tests pass.

**Manual checks (if no CLI):**
- Inspect Home, Properties, each renamed workflow, and the mobile drawer at desktop and narrow widths; verify imagery, hierarchy, empty/loading states, focus order, and permission-scoped destinations.

## Suggested Review Order

**Experience entry points**

- Home reduces the console to prioritized work and recognizable property context.
  [`page.tsx:42`](../../../admin/app/console/page.tsx#L42)

- Properties centralizes stage, progress, next steps, and permitted workflows.
  [`properties/page.tsx:30`](../../../admin/app/console/properties/page.tsx#L30)

- Navigation groups tools by staff jobs while preserving permission boundaries.
  [`AdminShell.tsx:23`](../../../admin/app/components/AdminShell.tsx#L23)

**Workflow truth and safety**

- Lifecycle-aware actions retain property context across every workflow handoff.
  [`adminOverview.ts:104`](../../../app/convex/adminOverview.ts#L104)

- Property summaries translate gates, publishing, and reconciliation into stable stages.
  [`adminOverview.ts:158`](../../../app/convex/adminOverview.ts#L158)

- Home includes evidence review, approval setup, and operational queue states.
  [`adminOverview.ts:198`](../../../app/convex/adminOverview.ts#L198)

- Failures explain that nothing was submitted and offer a safe retry.
  [`error.tsx:6`](../../../admin/app/console/error.tsx#L6)

**Visual system and language**

- Canonical property art provides stable recognition without schema changes.
  [`PropertyArtwork.tsx:13`](../../../admin/app/components/PropertyArtwork.tsx#L13)

- Responsive work rows and property layouts use the inherited Vesper tokens.
  [`globals.css:497`](../../../admin/app/globals.css#L497)

- High-risk approval language leads plainly while retaining evidence requirements.
  [`gates/page.tsx:213`](../../../admin/app/console/diligence/gates/page.tsx#L213)

**Verification**

- Tests cover permission filtering, lifecycle stages, reconciliation, and missing setup work.
  [`adminOverview.test.ts:75`](../../../app/convex/adminOverview.test.ts#L75)
