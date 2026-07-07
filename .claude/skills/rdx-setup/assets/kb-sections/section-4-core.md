# Rust knowledge base for BMAD implementation agents


## 1. Audience layers

The final knowledge base remains one file, but its sections have distinct audiences and loading behavior.

| Layer | Audience | Loading behavior | Content boundary |
|---|---|---|---|
| Always-on core | Rust implementation agent | Loaded for every Rust implementation story | Compact architectural principles only; no tool-specific cookbook or version-sensitive recipes. |
| Risk router | Builder/router and implementation agent | Loaded before selecting conditional packs | Positive triggers, negative triggers, minimum pack, escalation triggers, and validation family. |
| Conditional risk packs | Implementation agent plus specialist reviewers when triggered | Loaded only when story, manifest, or diff signals match | Normative rules for async, unsafe, FFI, macros, public API, Cargo, data/security/I/O, DB/distributed, operations, and performance/portability. |
| Reference recipes | Implementation agent on demand | Loaded for specific diagnostics, APIs, or optimization tasks | Non-normative techniques, tool invocations, version assumptions, and narrow compiler/API recipes. |
| Builder/evaluator governance | Builder, evaluator, workflow owner | Not loaded as implementation-agent behavior by default | Protected artifacts, approval trails, required reads, transcript grading, role ownership, and behavior evals. |

Audience boundaries:

- Implementation agents get section `4` always, use section `5` to choose conditional packs, load section `6` only for matched triggers, and consult section `7` only for narrow diagnostics or techniques.
- Builder/router decisions select packs and escalation paths; they are not extra Rust coding obligations unless a story explicitly assigns that workflow role.
- Evaluator/governance rules control protected artifacts, approvals, transcript review, and behavior evaluation; they must not be rewritten as implementation-agent Rust rules.


## 2. Normative rule format

Normative rules use this shape:

```markdown
### <STABLE-ID> — <Title>

- **Layer:** CORE | RISK_PACK | GOVERNANCE
- **Importance:** CORE | COMMON | CONDITIONAL | ADVANCED | HIGH_ASSURANCE
- **Trigger:** <activation condition; CORE uses Always>
- **Risk:** <failure mode prevented>
- **Rule:** <one main requirement>
- **Required reasoning:** <what the agent must determine before acting>
- **Validation:** <how compliance is checked>
- **Exceptions:** <narrow justified exceptions>
- **Sources:** <old IDs and verified primary sources when needed>
```

`Layer` controls loading. `Importance` is the priority of a rule after its layer has been activated, not a separate loading mechanism. A rule is always-on only when `Layer: CORE` and `Trigger: Always`; `Importance: CORE` inside a risk pack means "minimum rule for that triggered pack" and must not be promoted into global behavior.

Stable ID namespaces and aliases:

- Active IDs are the heading IDs in this file. 
- IDs use these namespaces:

| Namespace | Owner |
|---|---|
| `CORE-###` | Always-on implementation rules in section `4`. |
| `RP-<PACK>-###` | Conditional risk-pack rules in section `6`, where `<PACK>` is one of `ASYNC`, `UNSAFE`, `FFI`, `MACRO`, `API`, `CARGO`, `TEST`, `DATA`, `SEC`, `IO`, `DB`, `TIME`, `OPS`, or `PERF`. |
| `REC-<DOMAIN>-###` | Reference recipes in section `7`; recipes are not normative unless an active rule or story contract calls for them. |
| `GOV-###` | Builder/evaluator governance rules in section `8`. |


Recipe entries use this shape:

```markdown
### <RECIPE-ID> — <Title>

- **Use when:** ...
- **Technique:** ...
- **Do not infer:** ...
- **Version assumptions:** ...
- **Related rules:** ...
```

## 3. Knowledge boundaries and evidence model

Boundary between normative rules and recipes:

- Use a normative rule only for a durable failure mechanism that an implementation agent must reason about after the rule's layer and trigger are active.
- Use a recipe for diagnostic-specific compiler repairs, API incantations, tool flags, version-specific workarounds, and local optimization techniques.
- A normative rule may reference a recipe as optional support, but the recipe must not create a new obligation unless a story contract or active rule calls for it.
- If an old rule mixes a principle with concrete techniques, keep the principle in the canonical rule and park the techniques in section `7` for later recipe migration.
- If a workaround depends on a crate/tool version or a generator bug, keep it out of normative rules until a primary source or local reproduction proves the exact trigger.

Boundary between correctness and performance:

- Correctness rules protect observable behavior, safety, lifecycle, data integrity, compatibility, or trust-boundary contracts; they must not be justified primarily by speed, allocation count, binary size, or compile time.
- Performance rules and recipes require an explicit target, baseline, bottleneck, or resource budget; they must not weaken correctness, validation strength, public contracts, or error semantics to make a metric improve.
- When a change affects both correctness and performance, keep the correctness invariant in the owning core or risk-pack rule and place the performance tradeoff in `6.11` or section `7`.
- Optimization techniques are not substitutes for acceptance criteria, bug reproduction, safety arguments, or boundary validation.

Boundary between language/tool contracts and project policy:

- Use language/tool contract wording only for behavior guaranteed by Rust, Cargo, rustdoc, a target, or a dependency version that has been checked for the relevant context.
- Use project-policy wording for choices such as MSRV, lockfile ownership, lint severity, dependency-source restrictions, public stability promises, docs.rs expectations, release/yank process, production observability, and approval trails.
- If a rule depends on both, state both evidence classes separately so a reviewer can tell what would still be true in another Rust project.
- Do not turn `pub`, duplicate resolved versions, native `links`, `+ Send`, docs.rs, SemVer, yank, or production operations into global requirements without the matching router trigger and policy source.

Boundary between implementation behavior and validation evidence:

- `Rule` and `Required reasoning` define what the implementation agent must do after the layer and trigger are active; `Validation` defines the evidence that lets review judge whether that behavior happened.
- Validation evidence is selected from the story contract, repository harness, active risk packs, and observed failure mode. It is not an independent loading trigger and must not turn advanced tools, release gates, transcript review, or governance artifacts into always-on coding behavior.
- A tool result is evidence only for the property the tool can exercise in the checked configuration. Do not describe compile, Miri, Loom, sanitizer, fuzz, benchmark, docs, or graph output as proof of broader semantic correctness, soundness, security, SemVer compatibility, or performance.
- Evidence records should preserve command outcomes, baseline failures, assumptions, tool/version context, and skipped checks with reasons, while redacting secrets and raw sensitive data from shared surfaces.
- Governance evidence such as approvals, protected-artifact trails, transcript grading, and behavior evals belongs in section `8`; implementation rules may point to that evidence boundary but must not require the implementation agent to act as evaluator by default.

Caveat normalization:

- State general caveats once at the owning layer, then keep individual rules focused on their specific exception or risk.
- Prefer a short cross-reference over repeating long "not active unless triggered" caveats inside every pack or recipe. Section `1` owns audience/loading behavior, section `5` owns positive and negative triggers, section `6` owns pack-specific rules, section `7` owns narrow techniques, and section `8` owns governance.
- Keep meaningful exceptions close to the rule that needs them, especially prototype/private-application mode, locally proven invariants, policy-approved release actions, target/toolchain assumptions, and explicit resource budgets.
- When an exception is only a restatement of an already-owned boundary such as "not always-on", "not proof", "not a recipe", or "not a migration", use a short cross-reference instead of duplicating the caveat.

## 4. Always-on core

This section is populated incrementally during P1. It must end with 15-22 normalized rules and target 18 rules. It must not contain active tool-specific commands, version-specific flags, or cookbook techniques.

### CORE-001 — Contract before code

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** The agent can invent missing requirements, lose protected-file boundaries, apply generic Rust defaults over local policy, or run the wrong validation when the task contract is implicit.
- **Rule:** Before editing, establish a proportionate implementation contract from the active task and authoritative repository context: the goal and acceptance criteria, relevant scope and protected boundaries, expected error behavior, active risk tags, instruction priority, and applicable validation.
- **Required reasoning:** Identify which requirements come from the active task, project context/ADR policy, approved local customizations, reusable defaults, and generic model knowledge; resolve locally verifiable gaps from authoritative repository context, and escalate same-level conflicts or missing information only when they remain unresolved and materially affect safe execution under `CORE-016`.
- **Validation:** The plan or work record lets review compare the actual diff and checks with the established contract; governance-specific evidence is required only when the task or project policy activates it.
- **Exceptions:** Very small bugfixes may use a compact inferred contract; unspecified fields do not block work unless the missing information is material and cannot be resolved safely from authoritative local context.
- **Sources:** `RUST-AGENT-002`, `RUST-AGENT-008`, `RUST-AGENT-012`; audit minimal core item 1.

### CORE-002 — Repository model before patch

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** The agent can patch the wrong crate, call a nonexistent API, miss feature-gated code, or create incompatible cross-crate type flow when the repository and dependency graph are guessed.
- **Rule:** Before implementation, reconstruct the smallest repository model sufficient for the changed behavior: the relevant workspace, package, module and type ownership, affected or observable call sites when any, and the feature/cfg/target or resolved-dependency-version boundaries material to the patch.
- **Required reasoning:** Determine which crate owns the changed type or behavior, which callers observe it when any, which feature, cfg, target, or resolved-version assumptions are material to the patch, whether multiple resolved versions affect type identity, and whether newly introduced, materially changed, or uncertain external crate behavior requires version-matched authoritative evidence.
- **Validation:** The plan identifies the affected owner, affected or observable call sites when any, and feature, cfg, version, target, or API assumptions material to the patch; newly introduced or uncertain external API behavior has authoritative version-matched evidence.
- **Exceptions:** A purely local single-module fix may use a compact model, but it still needs the owning module, affected or observable call sites when any, and any external API/version assumption it relies on.
- **Sources:** `RUST-AGENT-005`, `RUST-CARGO-002`, `RUST-CARGO-007`; audit minimal core item 2.

### CORE-003 — Ownership and lifecycle before implementation

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Move errors, hidden leaks, unclear value flow, incorrect sharing primitives, and background-work bugs appear when ownership and lifecycle are discovered only after code is written.
- **Rule:** Before implementing, identify the owner and lifecycle of each contract-relevant changed value, resource, and unit of background work; define, as applicable, how it is returned, moved, borrowed, shared, mutated, and eventually completed or released.
- **Required reasoning:** Decide whether ownership should be returned as a value, borrowed, shared, transferred, or represented as mutation of caller-owned storage; whether sharing is single-threaded or cross-thread; whether `Rc`, `Arc`, `RefCell`, locks, atomics, or message passing match the mutability domain; and which path, event, or ownership condition ends the lifecycle.
- **Validation:** Review can trace ownership and lifecycle for contract-relevant changed data, resources, and tasks, and can distinguish intentional clones, caller-owned outputs, sharing, or synchronization from mechanical compiler repairs, leaks, or globals.
- **Exceptions:** Borrow-oriented APIs, callbacks, shared state, synchronization, and explicit read/fill/write-into APIs are valid when the caller-owned storage, lifecycle, thread domain, and mutation contract are explicit.
- **Sources:** `RUST-OWN-001`, `RUST-OWN-004`, `RUST-TYPE-004`; audit minimal core item 3 and type-driven design section.

### CORE-004 — Root cause before borrow-checker cosmetics

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Blind `clone`, `Arc`, `Box`, `'static`, broad bounds, or ad hoc conversions can silence compiler feedback while making ownership, lifetime, API, or performance behavior worse.
- **Rule:** Treat compiler and borrow-checker failures as design feedback: explain the semantic cause before introducing ownership-expanding repairs, stronger lifetime bounds or requirements for longer-lived data, broad trait bounds, or conversion glue.
- **Required reasoning:** Separate confirmed facts, deductions, and hypotheses; identify the real owner and lifetime relationship; prefer scoped borrows, operation reordering, ownership transfer, or API-shape fixes when those match the domain; distinguish `T: 'static` (all lifetime parameters carried by `T` outlive `'static`; therefore `T` cannot contain non-`'static` references tracked by the type system, but a particular value of `T` need not live for the whole program) from an actual `&'static T` or leaked/global value; justify any `clone`, sharing primitive, allocation, `'static` bound, or broad bound by the actual contract.
- **Validation:** The repair record or review explains the cause, shows that any ownership-expanding construct is intentional rather than mechanical compiler appeasement, and rejects unnecessary `'static` bounds, leaks, or other stronger lifetime requirements that do not follow from the actual contract.
- **Exceptions:** Cloning, shared ownership, boxing, `'static`, and broad bounds are acceptable when they express the real API/lifecycle contract, spawn/callback/storage boundary, or a documented local invariant.
- **Sources:** `RUST-AGENT-004`, `RUST-OWN-002` principle only, `RUST-OWN-003`, `RUST-OWN-009`; audit minimal core item 4. `RUST-OWN-002` extraction and allocation techniques are split into `REC-OWN-001` and `REC-PERF-001`.

### CORE-005 — Encode invariants in types

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Primitive values, ambiguous booleans, and wildcard handling let invalid IDs, units, modes, and state transitions pass through code paths that the compiler could otherwise help constrain.
- **Rule:** Use validated newtypes, enums, and closed domain states where they actually prevent invalid combinations or ambiguous call sites.
- **Required reasoning:** Identify which invariant is being protected, where validation happens, whether constructors or fields must be private, whether the choice set is closed or externally extensible, whether each local enum match should enumerate variants or use a narrow single-branch form such as `if let`, and whether a simpler primitive remains clearer.
- **Validation:** API review and tests show invalid values are rejected at boundaries, call sites reveal semantic intent, and adding a variant to a locally owned closed enum forces review at match sites that must handle every state.
- **Exceptions:** Independent flags, bitflag-style sets, simple local primitives, tightly scoped `if let` for one-branch handling, integer or `char` ranges, external `#[non_exhaustive]` enums, and defensive unknown-state handling are valid when the invariant is not improved by a new type or exhaustive enum match.
- **Sources:** `RUST-TYPE-001`, `RUST-TYPE-002`, `RUST-TYPE-008`; audit minimal core item 5.

### CORE-006 — Choose abstractions intentionally

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Premature traits, misplaced generic bounds, `Any`-driven downcasts, coercion-driven `Deref` APIs, and wrong `dyn`/generic/`impl Trait` choices create over-constrained APIs, object-safety failures, runtime checks, hidden ownership/API boundaries, or needless layout/API churn.
- **Rule:** Prefer an abstraction already established by the task or project contract; otherwise use the simplest representation that satisfies the current contract and observed call sites. Introduce, remove, or materially change traits, generics, trait objects, opaque return types, bounds, or `Deref` only when a concrete substitution, extension, ownership, dispatch, smart-pointer/guard, or public-contract need justifies it; place bounds at the narrowest site that needs them.
- **Required reasoning:** For abstraction mechanisms introduced, removed, or materially changed, determine whether an existing project or task contract already establishes the abstraction; whether the implementation set is open or closed; whether callers must name the concrete type; whether hidden `impl Trait` constraints are caller-visible; whether runtime dispatch or dyn compatibility is required; whether `Deref` expresses actual pointer or guard semantics; and whether each bound is needed at the type, impl, or method level. Load the public API pack for public `dyn`, return-position `impl Trait`, or `Deref` contract details when its router trigger matches.
- **Validation:** API and call-site review justify the abstraction and each non-trivial bound; compile checks verify the intended generic, dyn, and call-site forms, but compile success is not evidence that an abstraction or bound is necessary.
- **Exceptions:** Struct/enum definition bounds are valid when field storage, associated types, `?Sized` relaxation, or `Drop` coherence requires them; runtime extension points can justify trait objects; smart-pointer-like wrappers and guards can justify narrow unsurprising `Deref`.
- **Sources:** `RUST-TRAIT-001`, `RUST-TRAIT-002`, `RUST-TRAIT-004`, `RUST-TRAIT-006`, `RUST-API-021`; audit minimal core item 6 and traits/generics section.

### CORE-007 — Keep the diff scoped

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Broad rewrites and unauthorized boundary changes hide regressions, invalidate review, and turn a local Rust repair into a dependency, public API, unsafe, schema, runtime, feature, toolchain, release, or governance change.
- **Rule:** Limit edits to the task contract and do not cross a high-impact boundary unless the change is required and authorized by the task contract or project policy; when applicable governance requires a separate owner or specialist approval, escalate rather than self-approve.
- **Required reasoning:** Compare the planned patch against allowed files, protected files, risk tags, public surface, dependency/toolchain policy, and validation scope; if the necessary fix exceeds the authorized contract or enters a governed boundary, do not make boundary-crossing edits until the contract or required owner decision is updated; independent, reversible diagnosis, reproduction, and validation may continue only when they cannot prejudice or assume the pending decision.
- **Validation:** Diff review can connect every changed file and behavior to the task contract, with the applicable task or project authorization or governance evidence for any boundary expansion.
- **Exceptions:** A task may intentionally authorize broader refactors or boundary changes; a separate approval trail is required only when applicable project governance says so.
- **Sources:** `RUST-AGENT-003`, `RUST-AGENT-009`, `RUST-ANTI-006`; audit minimal core item 7 and anti-pattern section 22. Boundary-escalation routing details remain deferred to router/governance phases.

### CORE-008 — Errors are part of the specification

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Stringly errors, hidden panics, erased public failures, and silently discarded `Result`s make callers unable to distinguish expected failure, programmer bugs, and operational faults.
- **Rule:** Define the error contract for the changed boundary: use typed/domain failures where callers need to react, erase errors only at appropriate outer boundaries, preserve fallible results, and do not use `unwrap` or `expect` to handle external input or ordinary recoverable production failures; panic-based extraction is acceptable only after a narrow locally established invariant.
- **Required reasoning:** Identify expected failure modes, external input boundaries, public API obligations, production versus test/example context, sensitive-data exposure in messages, whether a failure should be propagated, mapped, logged, returned, or explicitly treated as best-effort, and whether any panic path is a locally proven invariant rather than ordinary fallibility.
- **Validation:** Review and tests cover expected error paths; `Result`-producing calls are propagated, handled, logged with policy-approved context, returned, or intentionally justified as best-effort; any invariant-based production-path `unwrap` or `expect` is backed by a narrow locally established invariant, and `expect` messages avoid sensitive data.
- **Exceptions:** Application edges may use approved type-erased errors; tests and examples may use `unwrap`/`expect` under project policy; unreachable-by-construction cases are acceptable when the invariant is documented locally.
- **Sources:** `RUST-ERR-001`, rewritten `RUST-ERR-002`, `RUST-ERR-004`; audit minimal core item 8 and dangerous-rule note for `RUST-ERR-002`.

### CORE-009 — Make cleanup, cancellation, and task ownership explicit

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Correctness-critical cleanup, cancellation, or background work can be skipped, detached, or fail invisibly when it is left to `Drop`, task-body fallthrough, or an untracked handle.
- **Rule:** Treat fallible or protocol-significant `close`, `flush`, `commit`, `shutdown`, drain, join, cancellation, and task ownership as explicit lifecycle contracts when correctness depends on observing completion, failure, or accepted loss.
- **Required reasoning:** For each lifecycle dimension actually touched, identify the resource or task owner, the explicit completion path, the fallback behavior on `Drop`, what cancellation may skip, whether the operation is cancel-safe, how each relevant long-lived task is awaited, stored, supervised, aborted, or intentionally detached, and where cleanup failures become visible.
- **Validation:** When the relevant lifecycle behavior is observable and a suitable harness exists, targeted cleanup, shutdown, cancellation, or lifecycle tests exercise it; otherwise focused integration or review evidence states how failure or accepted loss is surfaced and why executable validation was not feasible.
- **Exceptions:** Ordinary RAII/`Drop` remains appropriate for infallible local resource release and as a safety fallback; best-effort detached cleanup is acceptable only when loss semantics are explicit and not correctness-critical.
- **Sources:** `RUST-ERR-003`, core parts of `RUST-ASYNC-003`, `RUST-ASYNC-004`, `RUST-ASYNC-021`, `RUST-OPS-007`; audit minimal core item 9 and merge map. Async/ops pack details remain deferred to P9/P17.

### CORE-010 — Validate external boundaries

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Invalid input, silent coercion, overflow, truncation, encoding ambiguity, or partial progress can cross a boundary and become harder to diagnose than an explicit rejection or documented lossy behavior.
- **Rule:** For each changed external or unbounded data boundary, define the applicable invalid-input, numeric overflow or conversion, text or binary encoding, and partial-progress policies before accepting, transforming, or persisting boundary data.
- **Required reasoning:** Identify which values originate outside the trusted domain; which boundary dimensions actually exist; whether invalid data should be rejected, reported, saturated, wrapped, normalized, resumed, rolled back, or accepted as lossy behavior; which integer operations can overflow or underflow; whether checked, saturating, wrapping, or ordinary arithmetic follows a proven contract; and whether a boundary-specific pack must supply stricter rules.
- **Validation:** Boundary tests or review cover representative cases only for dimensions present in the contract, such as invalid values, relevant zero or extreme values, narrowing, encoding failures, or observable partial progress; any lossy, saturating, wrapping, or checked-failure behavior is named and documented at the boundary.
- **Exceptions:** Internally bounded arithmetic, loop counters, constant expressions, and local primitives do not need extra ceremony when their bounds or overflow behavior follow from a proven local invariant or explicit project contract; explicitly lossy, saturating, or modular APIs are valid when their names and contract make that behavior clear.
- **Sources:** `RUST-TYPE-010`, `RUST-API-027`, `RUST-DATA-002`; audit minimal core item 10. Detailed parser, binary, public API, and I/O policies remain deferred to P13/P16.

### CORE-011 — Keep the compiler in the loop

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Stacking patches over a new unexplained compiler failure turns design feedback into random-walk repair and can hide the first real cause.
- **Rule:** After the smallest coherent non-trivial edit unit that can reasonably be checked, run the minimal relevant compile/check gate before compounding the change or starting an unrelated repair, and stop to understand any new red result in the story scope; if the applicable gate cannot be run, record it as `NOT RUN` with the reason and do not claim that it passed.
- **Required reasoning:** Determine the smallest coherent edit unit and compile/check target that exercise the changed code, whether failures are baseline or newly introduced, what evidence is needed before compounding the change, and whether environment, toolchain, target, or dependency constraints make the applicable gate unavailable.
- **Validation:** The work record shows the relevant compile/check outcome or an explicit `NOT RUN` with reason, preserves baseline failures as evidence, and does not continue with unrelated repairs over a new unexplained failure.
- **Exceptions:** Pure documentation-only edits or mechanical metadata changes may use a lighter check when no Rust compilation surface changed; environment, toolchain, target, or dependency unavailability does not convert a required check into `PASS` or an implicit waiver.
- **Sources:** `RUST-AGENT-001`; audit minimal core item 11.

### CORE-012 — Compilation is not semantic correctness

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** A green compile can still miss acceptance criteria, cancellation behavior, data compatibility, public contract changes, FFI/unsafe risks, and business or protocol semantics.
- **Rule:** Treat the applicable compile/check gate selected under `CORE-011` as necessary implementation evidence, not as proof that the change satisfies the story or preserves observable behavior; select story-specific behavioral, review, or active-risk-pack evidence for the properties changed.
- **Required reasoning:** Identify which acceptance criteria, externally visible behaviors, failure modes, and active risk tags require semantic validation beyond compile success.
- **Validation:** The verification plan pairs the applicable compile/check evidence from `CORE-011` with story-specific behavioral, review, or active-risk-pack evidence, or an explicit scoped reason when no additional semantic check is applicable.
- **Exceptions:** A purely syntactic or type-only refactor may need no new runtime test, but the reason must be tied to the acceptance criteria and reviewed behavior surface.
- **Sources:** `RUST-TEST-001`; audit minimal core item 12.

### CORE-013 — Derive the test oracle from the spec

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Tests that mirror the implementation, assert incidental structure, or skip failing reproduction can pass while the requested behavior remains wrong.
- **Rule:** Build test oracles from the story/spec and observable behavior; for bugfixes, reproduce the defect before the fix when feasible, and do not lock ordinary tests to incidental implementation structure when the contract is behavioral.
- **Required reasoning:** Identify the expected behavior, negative and boundary cases, plausible wrong implementations, whether the proposed assertion checks observable behavior or only code shape/internal layout, and whether the test would fail against the known broken behavior rather than simply covering the new code shape.
- **Validation:** Tests or review assertions exercise externally visible outcomes and meaningful edge cases, expose useful mismatches when they fail, and do not rely only on private structure unless that structure is itself the reviewed contract; bugfix evidence includes a fail-before-fix reproduction or a documented reason it was not feasible.
- **Exceptions:** Deterministic review checks may substitute for executable tests when the change is non-executable or the project lacks an applicable harness, but they still need a spec-derived oracle.
- **Sources:** `RUST-TEST-002`; audit minimal core item 13.

### CORE-014 — Do not make green by cheating

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Weakening tests, CI, lints, validation commands, or implementation completeness can make the result appear successful while defects remain.
- **Rule:** Do not make a story pass by weakening verification, adding vacuous tests, counting incomplete production behavior as complete, or applying suppressions outside an explicitly authorized narrow policy.
- **Required reasoning:** Determine whether a validation change is part of the requested governance or customization work or merely hides a failing implementation; for any suppression, scaffold, placeholder, or test double, identify the applicable task or governance authorization, scope, limitations, and expiry or removal path. Authorization must come from the active task or the owner mapped by applicable governance; the implementation agent's own justification is not authorization.
- **Validation:** Diff review shows that verification infrastructure and test strength were preserved or intentionally changed under the task contract; no broad suppression, vacuous assertion, or unimplemented production behavior is counted as completed behavior.
- **Exceptions:** Explicitly requested scaffolding, placeholders, or test doubles are allowed only when that artifact is itself an acceptance criterion, its limitations are explicit, and no unimplemented production behavior is reported as complete; governance or customization tasks may change validation policy, and narrow temporary suppressions require applicable authorization, reason, scope, and removal path; correcting an invalid, obsolete, or flaky test oracle is not weakening verification when the change is grounded in the authoritative contract, preserves or improves defect-detection strength, and records the prior mismatch or flake evidence. A newly green result alone is not sufficient evidence that the oracle correction was valid.
- **Sources:** `RUST-ANTI-002`, `RUST-ANTI-005`; audit minimal core item 14.

### CORE-015 — Load context by risk

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Loading irrelevant specialist guidance can dilute active constraints, while missing or under-propagated risk context can drop active risk tags, allowed files, API constraints, or validation expectations.
- **Rule:** Use the current risk router to load specialized Rust guidance only for signals tied to the story, manifests, repository, touched code, or planned or actual diff; re-evaluate routing whenever inspection or the evolving diff introduces, removes, or materially changes a router signal. When delegating, preserve the active risk tags, scope, constraints, and validation expectations needed by the worker.
- **Required reasoning:** Match the available story, manifest, repository, touched-code, and planned or actual diff signals against the current risk router rather than a duplicated category list; identify the activated packs, applicable escalation triggers, and relevant validation families, and distinguish global rules, project policy, story contract, and specialist reference material.
- **Validation:** The work record identifies the initial activated packs and matching signals, any later rerouting caused by inspection or diff changes, and the constraints and required evidence propagated into delegated work.
- **Exceptions:** Persistent core rules remain always available; context sharding is for specialized risk knowledge, not for forgetting baseline implementation behavior. After the initial router pass finds no matching positive or escalation signal in the available story, manifest, repository, touched-code, or planned-diff context, a compact recorded `no conditional pack activated` result is sufficient. Re-evaluate routing only when later inspection or the evolving diff introduces, removes, or materially changes a router signal.
- **Sources:** `RUST-AGENT-007`, context-propagation part of `RUST-ANTI-004`; audit minimal core item 15.

### CORE-016 — Make uncertainty explicit

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Hidden assumptions about safety, data loss, public contracts, dependencies, or scope can turn a local repair into an unsound or unauthorized change.
- **Rule:** Do not mask material uncertainty. Resolve or verify it from authoritative evidence when this can be done safely within the task constraints; escalate when a material uncertainty cannot be resolved without owner or specialist judgment. Otherwise record the smallest safe assumption and check it at the next relevant validation step.
- **Required reasoning:** Separate confirmed facts, deductions, hypotheses, and missing evidence; attempt available authoritative local checks before escalating, then decide whether the remaining uncertainty is harmless, locally testable, or requires owner or specialist judgment before proceeding.
- **Validation:** The work record shows each material assumption, attempted verification, resulting evidence, or escalation path instead of presenting a guess or unresolved hypothesis as fact.
- **Exceptions:** Low-impact local assumptions are acceptable when they are explicitly named, scoped, and checked by the next relevant validation step.
- **Sources:** uncertainty/escalation parts of `RUST-AGENT-004` and `RUST-AGENT-012`; audit minimal core item 16.

### CORE-017 — Require evidence for performance changes

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Folklore optimization can distort ownership, allocation strategy, crate topology, inline policy, or observable behavior without improving the measured bottleneck.
- **Rule:** When performance is a goal, acceptance criterion, or claimed justification for a code or architecture change, make that change only from an explicit target plus evidence characterizing the current behavior or constraint: a measured baseline, profiling evidence, demonstrated algorithmic complexity at the relevant input scale, or a contractually defined bottleneck or resource budget.
- **Required reasoning:** Identify the performance goal, representative workload and target environment, baseline behavior, measurement method, bottleneck or resource budget, tradeoffs, and why the proposed structural or allocation change follows from that evidence rather than style preference.
- **Validation:** Benchmarking, profiling, complexity evidence, or an explicit resource budget justifies the metric change; separate story- and risk-specific validation shows that observable behavior and correctness contracts were preserved.
- **Exceptions:** Clear algorithmic complexity defects or hard resource budgets may justify action before full profiling, but the target, expected improvement, and correctness preservation must still be stated and validated afterward. Incidental performance effects of a correctness or clarity change do not by themselves require a benchmark.
- **Sources:** `RUST-PERF-001`, principle parts of `RUST-PERF-007`, `RUST-PERF-010`; audit minimal core item 17. Portability and target-capability work is routed through `RP-PERF-001`; detailed allocation and crate-splitting techniques remain in the performance pack or recipes.

### CORE-018 — Keep sensitive data out of output surfaces

- **Layer:** CORE
- **Importance:** CORE
- **Trigger:** Always
- **Risk:** Logs, errors, panic messages, debug output, snapshots, tests, telemetry, and agent evidence can expose secrets, PII, paths, raw input, or internal diagnostics.
- **Rule:** Do not emit secrets, PII, or raw sensitive data to shared or unapproved output surfaces. Classify sensitive fields, redact or generalize outward-facing output, and route necessary raw diagnostics only to a project-approved restricted channel.
- **Required reasoning:** Identify which values are sensitive, which surfaces may display or persist them, who can read each surface, and whether detailed diagnostics must be routed to a restricted channel instead of shared output.
- **Validation:** Review and tests cover redaction-sensitive paths such as `Debug`/`Display`, logs, error responses, snapshots, and validation evidence summaries when those surfaces are touched.
- **Exceptions:** Restricted raw evidence is permitted only when the project-approved channel, readers, retention, and handling policy authorize it; shared summaries must remain redacted.
- **Sources:** `RUST-SEC-001`; audit minimal core item 18.

