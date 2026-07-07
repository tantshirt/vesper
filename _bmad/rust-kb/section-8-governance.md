## 8. Builder and evaluator governance

Governance rules belong here when they control BMAD builder/evaluator behavior rather than implementation-agent Rust coding behavior.

Governance may require approvals, protected-file handling, required-read audits, transcript grading, or behavior evals. Implementation rules may reference those records only as escalation or evidence boundaries; they do not replace story-specific validation.

### GOV-001 — Govern boundary and instruction-artifact changes

- **Layer:** GOVERNANCE
- **Importance:** COMMON
- **Trigger:** A fix would cross an unapproved high-impact boundary, or the work changes agent instructions, templates, skills, protected governance artifacts, or reusable BMAD guidance.
- **Risk:** A local implementation repair can become an unreviewed API, dependency, unsafe, schema, runtime, feature, release, governance, or global-prompt change, and instruction edits can regress other Rust failure modes by bloating the wrong layer.
- **Rule:** Builder/router/evaluator workflows must route boundary expansion and instruction-artifact changes through the smallest correct governed artifact with explicit owner approval, review, and behavior/regression evidence appropriate to that artifact.
- **Required reasoning:** Decide whether the change is implementation scope, risk-router scope, protected artifact work, reusable instruction policy, or evaluator/governance work; identify the owning artifact, required approval, regression surface, and whether the implementation agent should stop at escalation.
- **Validation:** Approval trail, artifact diff, and relevant behavior/regression evidence show the change was reviewed at the right layer and not silently smuggled through an implementation patch.
- **Exceptions:** A task may explicitly authorize a boundary or instruction-artifact change, but the authorization and artifact owner still need to be recorded before the broad change is made.
- **Sources:** `RUST-AGENT-009`, `RUST-AGENT-010`; audit section 3.

### GOV-002 — Grade agent behavior, not only product results

- **Layer:** GOVERNANCE
- **Importance:** COMMON
- **Trigger:** Agent instructions, prompts, customizations, protected workflows, delegated-context rules, or recurring Rust-agent failure modes are being evaluated or changed.
- **Risk:** Product tests can pass while the agent skipped required reads, attempted forbidden writes, ignored risk tags, fabricated validation, or regressed into process failures that are visible only in behavior and transcript evidence.
- **Rule:** Evaluator workflows must grade agent behavior with transcript-aware or runner-equivalent evidence, including required-read behavior and forbidden-write attempts, rather than relying only on final diffs or product tests.
- **Required reasoning:** Identify which behavior is under evaluation, which required reads and protected artifacts apply, what forbidden attempts must be detected, which transcript or runner evidence is available, and which product tests remain necessary for code correctness.
- **Validation:** Behavior eval cases or transcript grading show both positive compliance and adversarial failures for required reads, protected-write attempts, risk-tag propagation, validation honesty, and final-diff correctness where applicable.
- **Exceptions:** Product tests remain the primary evidence for product behavior; behavior evals are added when the task changes agent governance or targets agent-specific failure modes.
- **Sources:** `RUST-AGENT-013`, `RUST-AGENT-016`; audit duplicate-merge guidance.

### GOV-003 — Keep specialist approval tied to real owners

- **Layer:** GOVERNANCE
- **Importance:** COMMON
- **Trigger:** A governed workflow requires security, architecture, release, advanced validation, public API, unsafe, FFI, privacy, toolchain, or policy approval.
- **Risk:** An implementation agent can appear to self-approve high-risk Rust changes or fabricate owner review, letting category-specific risks bypass the mapped specialist.
- **Rule:** Governance workflows must map each approval category to a real owner and prevent implementation agents from satisfying that approval or validation-owner role by assertion.
- **Required reasoning:** Identify the risk category, mapped owner or fallback escalation path, required evidence, whether the implementation agent is only requesting review or also changing the protected surface, and how self-waiver is prevented.
- **Validation:** Approval trails and role-boundary evals show the correct owner reviewed the change or that the workflow stopped/escalated when no owner evidence existed.
- **Exceptions:** Local role names and approval mechanisms may differ by repository, but the responsibility mapping must be explicit and category-specific.
- **Sources:** `RUST-AGENT-014`; audit section 3.

### GOV-004 — Protect governance artifacts with metadata and controls

- **Layer:** GOVERNANCE
- **Importance:** COMMON
- **Trigger:** CI, eval, instruction, release, security, validation-governance, or other protected non-product artifacts are created, categorized, changed, or waived.
- **Risk:** Protected artifacts can be changed without auditable ownership, waiver semantics, escalation requirements, or enforcement beyond prompt text.
- **Rule:** Protected-artifact governance must record structured ownership metadata and use repository, CI, runner, or runtime controls where available to enforce approval, waiver, immutability, and eval expectations.
- **Required reasoning:** Identify protected file/category, approval owner, waiver owner, escalation requirement, expected eval behavior, available enforcement mechanism, and how changes are audited.
- **Validation:** Schema/contract review, ownership metadata, policy checks, protected-artifact immutability checks, and transcript or runner evidence show protected boundaries were enforced.
- **Exceptions:** Exact metadata fields and enforcement mechanisms are project-specific; prompt-only instructions are acceptable only as a fallback when stronger controls are unavailable.
- **Sources:** `RUST-AGENT-015`; audit section 3.

### GOV-005 — Do not self-waive assigned checks or risk tags

- **Layer:** GOVERNANCE
- **Importance:** COMMON
- **Trigger:** A story, router, or governed workflow assigns risk tags, high-assurance checks, specialist review, or tool-specific validation that an implementation agent cannot satisfy as originally planned.
- **Risk:** An implementation agent can silently downgrade required Miri, Loom, fuzz, SemVer, security, or other risk-tagged validation to `N/A`, or drop active risk tags, without owner review.
- **Rule:** Governance workflows must preserve assigned risk tags and required checks until an authorized owner explicitly waives, replaces, or retargets them with justification; implementation agents may escalate tool unavailability or scope mismatch, but they may not silently self-waive.
- **Required reasoning:** Identify which tags and checks were assigned by the story or router, which owner can waive or replace them, whether the issue is tool unavailability, baseline failure, scope mismatch, or repo limitation, and what replacement evidence or escalation path is acceptable.
- **Validation:** Task contracts, router records, approval trails, or evaluator evidence show that assigned tags and checks stayed active or were explicitly waived or replaced by the mapped owner, and implementation traces do not silently drop them.
- **Exceptions:** Checks that were never activated by the story or router need not be invented, and an approved equivalent evidence path may replace the original tool when the same risk is still covered.
- **Sources:** `RUST-ANTI-003`; audit anti-pattern section 22.
