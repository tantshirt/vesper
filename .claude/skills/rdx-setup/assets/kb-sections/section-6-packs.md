## 6. Conditional risk packs

Pack ownership guardrails:

- `RUST-API-*` material belongs in `6.5 Public API, SemVer, and documentation` or in section `7` recipes, even if the extracted source placed some of those IDs near Cargo content.
- `RUST-CARGO-*` material belongs in `6.6 Cargo, features, workspace, toolchain, and dependencies`; it may cross-link to the API pack when manifest, feature, docs.rs, or release behavior changes public surface.
- Correctness invariants stay with their owning pack even when the implementation also has a performance concern; the performance pack owns measurement, resource budgets, target capability, and optimization tradeoffs.
- Language/tool, policy, validation-evidence, and caveat-normalization boundaries from section `3` apply to every pack rule.
- Cross-pack links should name the owning pack instead of duplicating normative text.
- Pack rules use `Layer: RISK_PACK` with concrete triggers; their `Importance` values are local to the activated pack.

### 6.1 Async and concurrency

Pack activation is controlled by the router row in section `5`; this pack is not part of always-on core. The minimum async/concurrency slice is: blocking boundaries (`RP-ASYNC-003`), lock/await and `!Send` scope (`RP-ASYNC-004`), cancellation contracts (`RP-ASYNC-005`; core cross-link `CORE-009`), task ownership and supervision (`RP-ASYNC-006`; core cross-link `CORE-009`), bounded channels/concurrency (`RP-ASYNC-007`), same-task and structured concurrency (`RP-ASYNC-008`; core cross-link `CORE-009`), future execution (`RP-ASYNC-008`), async-aware channels (`RP-ASYNC-003`), and channel-send lifecycle semantics (`RP-ASYNC-009`). Custom `Future`/`Waker`/`RawWaker` mechanics, `select!` control-flow edge cases, async block or closure boundary traps, collected-future pinning, and runtime-specific sync-wrapper details are not minimum pack behavior and remain in `REC-ASYNC-*` reference recipes.

### RP-ASYNC-001 — Async trait future contract

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff introduces or changes `async fn` in a trait, a trait method returning `impl Future`, an associated-future trait pattern, boxed/erased trait futures, or a reusable/public async abstraction.
- **Risk:** Trait async methods can hide returned-future auto-trait, lifetime, object-safety, allocation, and runtime-spawn contracts, creating `dyn Trait` incompatibility or downstream API traps.
- **Rule:** Choose an async-trait strategy whose future contract is explicit for the intended use: private/static dispatch may use opaque futures when accepted by the local call sites, while reusable or public traits must document and validate `Send`, lifetime, object-safety, boxing/allocation, and runtime boundary expectations.
- **Required reasoning:** Determine whether the trait is private or reusable/public, whether callers need dynamic dispatch, whether futures cross multi-threaded spawn boundaries, which lifetimes are captured, whether allocation/boxing is acceptable, and whether project MSRV or dependency policy allows helper patterns.
- **Validation:** Compile checks exercise the intended trait use patterns, including static dispatch, `dyn` use when promised, and spawn-boundary `Send` requirements when the future is spawned; API review records the selected future strategy.
- **Exceptions:** Private traits with only local static-dispatch call sites can keep simpler opaque async forms when the future bounds are not part of an external contract.
- **Sources:** `RUST-TRAIT-005`; audit traits/generics/conversions section.

### RP-ASYNC-002 — Spawned async trait futures need Send contract

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** A trait method's returned future is intended to cross a multi-threaded runtime spawn boundary, such as a generic worker or reusable async trait method passed to `spawn`.
- **Risk:** A trait async method can hide a `!Send` returned future until a spawn call site fails, leading agents to add shared-state wrappers or lifetime widening instead of expressing the actual future contract.
- **Rule:** When an async trait future must be spawned on a multi-threaded runtime, make the `Send` requirement explicit in the trait future contract using the project-supported async-trait strategy.
- **Required reasoning:** Determine whether the future is actually spawned on a multi-threaded executor or only used locally/single-threaded, which borrows are captured by the returned future, whether implementing types can satisfy `Send`, and which syntax or helper pattern is supported by the repository MSRV and dependency policy.
- **Validation:** Compile/check exercises the intended spawn call site and at least one representative implementation; review shows the `Send` bound is part of the trait contract rather than a mechanical repair for unrelated shared state.
- **Exceptions:** Do not add `Send` for single-threaded runtimes, runtime-documented local task use, private non-spawned async traits, or implementations whose legitimate contract requires `!Send` state; route the broader strategy choice through `RP-ASYNC-001`.
- **Sources:** downgraded `RUST-TRAIT-013`; audit traits/generics/conversions section and special-correction row for `RUST-TRAIT-013`.

### RP-ASYNC-003 — Keep blocking work off async workers

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** Async code performs or waits on synchronous I/O, sleep, blocking channel receive, CPU-heavy work, synchronous receive loops, runtime bridging, or work submitted from async tasks to another executor/thread pool.
- **Risk:** Blocking an async worker thread can starve unrelated tasks, hide deadlocks, exhaust a runtime blocking pool, or turn async progress into a thread-capacity bug.
- **Rule:** Keep async workers available for cooperative async progress: use async-native APIs when available; isolate sync-only blocking work behind a bounded blocking or dedicated-thread policy; route long-lived blocking loops and heavy parallel CPU work to a project-approved non-worker design; and use async-aware channels on the async side instead of blocking receives.
- **Required reasoning:** Determine what blocks, how long it can block, whether the work is sync-only or CPU-bound, which runtime/executor owns progress, whether a synchronous bridge must keep timers, spawned tasks, or connection maintenance progressing while the caller blocks, what concurrency bound applies, how results return to the async task, and whether a synchronous bridge has its own lifecycle and shutdown policy.
- **Validation:** Review changed async contexts for blocking calls and blocking channel receives; run compile/check plus behavior or load/shutdown tests appropriate to the touched runtime path; use tracing or overload evidence when runtime starvation is the risk being fixed.
- **Exceptions:** Short bounded CPU work can use a runtime-approved blocking mechanism when capacity is explicit; synchronous send operations whose channel contract is documented non-blocking may be used from async code; synchronous channels remain appropriate between OS-thread-only components with no async worker involvement.
- **Sources:** `RUST-ASYNC-001`, `RUST-ASYNC-024`; audit async/concurrency section.

### RP-ASYNC-004 — Do not carry sync guards or !Send state across await

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** An async block/function/future uses `Rc`, `RefCell`, raw pointers, synchronous lock guards, async-runtime lock blocking methods, RAII guards, control-flow scrutinee temporaries, or spawn boundaries where `Send` is required.
- **Risk:** State kept alive across `.await` can make a future `!Send`, deadlock a runtime, starve worker threads, or preserve a lock/borrow longer than the code visually suggests.
- **Rule:** End synchronous guard, borrow, and `!Send` lifetimes before suspension points; do not carry synchronous lock guards or implicit borrows across `.await`, and use async locks only when the guarded state truly must be held across an await and the critical section contract is bounded.
- **Required reasoning:** Identify every value live across each `.await`, whether the future crosses a multi-threaded spawn boundary, whether a lock is synchronous or async-aware, whether control-flow temporaries extend guard lifetimes, whether contention can block runtime progress, and whether a single-threaded/local executor is an explicit architecture choice.
- **Validation:** Compile/check the intended spawn boundary when `Send` matters; manually review lock/borrow scope around awaits, `match`/`if let` scrutinees, and RAII parameters; add concurrency or shutdown tests when lock ordering, contention, or runtime progress is part of the behavior.
- **Exceptions:** Explicit single-threaded/local executors can permit `!Send` futures at the runtime boundary, but they do not make synchronous locks across `.await` safe; short synchronous critical sections inside async code are acceptable when no await occurs while held and contention is bounded; third-party guard `Send` implementations still require runtime-progress review.
- **Sources:** `RUST-ASYNC-002`; related reference `REC-OWN-002`; audit async/concurrency section.

### RP-ASYNC-005 — Cancellation safety and async cleanup are explicit

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** Async code uses `select!`, timeout/deadline racing, shutdown cancellation, dropped futures, abortable tasks, futures reused across loop iterations, or async resources that require close/commit/flush/rollback after partial progress.
- **Risk:** Dropping a future can silently lose partial logical progress, skip `.await`-dependent cleanup, or repoll a completed one-shot future in a way that panics or violates the event-loop contract.
- **Rule:** State whether each cancellation-relevant operation is cancel-safe, not cancel-safe, or intentionally lossy; keep partial-progress state and cleanup ownership outside discardable branch futures when loss is not allowed; and provide an explicit recovery, shutdown, or accepted-loss path for futures that may be dropped before completion.
- **Required reasoning:** Determine which state changes before each suspension point, what is lost if the future is dropped, whether retryability also preserves partial progress, whether a one-shot future can be polled again, where async cleanup is guaranteed, and whether a spawned owner, explicit `close`/`shutdown`, synchronous fallback, or caller-visible error is the right lifecycle contract.
- **Validation:** Cancellation, timeout, and shutdown tests drop or abort the relevant future before normal completion; tests or review verify preserved partial progress, replacement of completed one-shot futures, and the documented cleanup guarantee or accepted loss.
- **Exceptions:** Not every future must be cancel-safe when dropped work is explicitly acceptable; recreating a fresh future per loop iteration is valid when restart semantics are intentional; runtime/API-specific claims about cancel-safe operations must be checked against the active runtime or trait documentation before becoming project policy.
- **Sources:** `RUST-ASYNC-003`, async-specific part of `RUST-ASYNC-021`; related `CORE-009`; audit async/concurrency section.

### RP-ASYNC-006 — Spawned tasks have owners and supervision

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** A change introduces or modifies `spawn`, `spawn_local`, long-lived workers, task handles, task groups, background result delivery, runtime callbacks, or stored async work.
- **Risk:** Spawned work can detach, panic, stall, violate `Send`/`'static` expectations, or lose errors when the owner, handle policy, and supervision path are implicit.
- **Rule:** Give every spawned or stored async task an explicit lifecycle: awaited, stored, supervised, aborted, joined, or intentionally detached; classify critical tasks and make failure visibility, restart/shutdown behavior, and spawn-boundary `Send`/`'static` requirements part of the contract.
- **Required reasoning:** Determine who owns the task handle, whether dropping the handle detaches or cancels under the active runtime, whether the task is critical or best-effort, how panics/errors are observed, how shutdown reaches the task, whether captured state must be `Send` and `'static`, and whether a local executor is an explicit design rather than a repair.
- **Validation:** Compile/check exercises the intended spawn boundary; lifecycle review accounts for every handle; shutdown and panic/error-observation tests cover critical workers or document accepted detachment for best-effort tasks.
- **Exceptions:** Intentional detachment is acceptable for best-effort work only when loss, shutdown, and error visibility semantics are explicit; single-threaded/local executors can relax `Send` only when the runtime contract says so; `RP-ASYNC-008` owns broader structured-concurrency shape.
- **Sources:** `RUST-ASYNC-004`, `RUST-ASYNC-009`, `RUST-ASYNC-011`; related `CORE-009`; audit async/concurrency section and special-correction row for `RUST-TRAIT-013`.

### RP-ASYNC-007 — Bound async queues and fan-out

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** Async code introduces or changes channels, producer/consumer queues, task fan-out loops, accept loops, worker dispatch, background work queues, or overload handling.
- **Risk:** Unbounded queues and unthrottled spawn loops hide overload until memory, latency, or downstream capacity fails under load.
- **Rule:** Define backpressure for async message and fan-out paths: prefer bounded queues or bounded worker/concurrency designs unless producers are provably bounded and unbounded growth is an accepted contract; handle full queues and fan-out limits explicitly.
- **Required reasoning:** Determine producer and consumer rates, maximum in-flight work, queue capacity rationale, full-queue behavior, memory budget, fairness/starvation concerns, cancellation behavior for queued work, and whether overload should wait, drop, shed, coalesce, retry, or surface an error.
- **Validation:** Queue/concurrency tests or load tests exercise overload behavior; review verifies a concrete capacity or bounded-producer proof and checks that `try_send`, drop, retry, or wait semantics match the story contract.
- **Exceptions:** Unbounded channels remain acceptable when the producer set and message count are inherently finite or when unbounded growth is a documented non-production/test-only tradeoff; non-blocking send with drop/coalesce behavior is valid when loss is part of the domain contract.
- **Sources:** `RUST-ASYNC-005`; audit async/concurrency section.

### RP-ASYNC-008 — Prefer same-scope execution and structured task ownership

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** Async code introduces or changes concurrent orchestration, request-scoped parallel work, `join!`/`select!`/future collections, background task trees, explicit shutdown paths, or async calls whose returned futures might be ignored, stored, spawned, or run later.
- **Risk:** Agents can add `Arc<Mutex<_>>`, clones, `'static` bounds, or detached task trees to satisfy ownership errors when the work could stay in one async scope, or they can construct a future that never runs because it is neither awaited, polled, nor spawned.
- **Rule:** Prefer same-scope async concurrency when the work does not need independent task ownership; when spawning is required, keep child work in an owning scope, task group, join path, or approved supervisor, and make future execution explicit by awaiting, polling through a combinator, storing under a documented later-poll contract, or spawning under `RP-ASYNC-006`.
- **Required reasoning:** Determine whether the operations need true parallelism, detached lifetime, or only cooperative same-task concurrency; whether branch futures can borrow local state without overlapping mutable borrows; who owns any child task group; what happens on parent cancellation or shutdown; whether a returned future is executed now, stored for later polling, or intentionally submitted to an executor; and which runtime-specific handle/drop semantics are authoritative.
- **Validation:** Control-flow and lifecycle review shows no discarded future or accidental detached work; compile/check exercises the intended borrow and spawn boundaries; async behavior, cancellation, shutdown, or error-propagation tests cover the changed orchestration path when observable behavior depends on it.
- **Exceptions:** Detached service loops are valid when `RP-ASYNC-006` records supervision, failure visibility, and shutdown ownership; same-task combinators do not replace true CPU parallelism or independent service lifetime; storing a future without immediate polling is valid only when the later poll/await owner is explicit.
- **Sources:** `RUST-ASYNC-013`, `RUST-ASYNC-014`, `RUST-ASYNC-027`; related `CORE-009`, `RP-ASYNC-005`, `RP-ASYNC-006`; audit async/concurrency section.

### RP-ASYNC-009 — Channel send errors are lifecycle outcomes

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** Async or task-coordination code sends results, notifications, work items, shutdown signals, or responses through `oneshot`, `mpsc`, `broadcast`, `watch`, or another channel whose receiver can close independently.
- **Risk:** Blindly discarding send errors can hide lost results, while blindly propagating or unwrapping them can turn an expected receiver drop into a panic or incorrect upstream failure.
- **Rule:** Treat receiver closure as part of the channel lifecycle contract: ignore a send error only when loss of that message is explicitly acceptable; otherwise propagate, log with approved context, return, retry, or surface the failure according to the boundary contract.
- **Required reasoning:** Determine who owns the receiver lifecycle, whether receiver drop means cancellation, timeout, client disconnect, shutdown, invariant violation, or data loss; whether the failed send returns a payload that must be recovered; whether full-channel/backpressure errors are separate from receiver-closed errors; and whether the channel is best-effort, request-critical, or operationally monitored.
- **Validation:** Cancellation, timeout, shutdown, and receiver-drop tests exercise the relevant send sites; code review verifies that `let _ =`, `.unwrap()`, `.expect()`, `?`, retry, logging, and recovery choices match the documented lifecycle semantics.
- **Exceptions:** Best-effort notifications and result delivery to an independently cancelled receiver may intentionally discard closed-receiver errors; channel-full or backpressure failures require their own overload policy under `RP-ASYNC-007`; panicking on receiver closure is acceptable only for a narrow invariant violation with non-sensitive diagnostics.
- **Sources:** rewritten `RUST-ASYNC-031`; related `CORE-008`, `CORE-009`, `RP-ASYNC-007`; audit special-correction row for `RUST-ASYNC-031`.

### 6.2 Unsafe and memory

Pack activation is controlled by the router row in section `5`; this pack is not part of always-on core. The minimum unsafe/memory slice starts with the unsafe gate (`RP-UNSAFE-001`) and then loads the touched unsafe-mechanism owners from this pack: raw-pointer provenance and aliasing (`RP-UNSAFE-002`, `RP-UNSAFE-007`), unsafe extern/attribute syntax when that unsafe contract changes (`RP-UNSAFE-003`), manual destruction/init and invariant ownership (`RP-UNSAFE-004`, `RP-UNSAFE-008`), manual auto-traits (`RP-UNSAFE-005`), atomic ordering (`RP-UNSAFE-006`), pinning (`RP-UNSAFE-009`), representation-changing layout conversions (`RP-UNSAFE-010`), and raw allocation/slice construction (`RP-UNSAFE-011`). Recipe-style details such as UB pattern catalogs, Miri/tool flags, layout tricks, pointer arithmetic techniques, inline-assembly specifics, and target-specific caveats stay in section `7` reference recipes; they are not promoted into global implementation behavior.

### RP-UNSAFE-001 — Unsafe requires approval and local SAFETY reasoning

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff introduces or changes `unsafe`, an `unsafe fn` body, an unsafe attribute, a raw-pointer operation, manual memory lifecycle code, or a manual `unsafe impl`.
- **Risk:** `unsafe` can enter as a compiler-silencing shortcut, widen the UB-relevant surface, or get used as a label for ordinary panic, deadlock, leak, or ergonomics risk that does not justify unsafe code.
- **Rule:** Add or change unsafe only when the task contract requires it, the boundary is approved, the unsafe operations are kept in the smallest reviewable scope, and each scope has a local `SAFETY` contract explaining the invariants that make the operation sound, including any temporal preconditions that remain in force until an unsafe operation or unsafe-returned future is fully complete.
- **Required reasoning:** Identify why safe Rust or an existing reviewed safe abstraction is insufficient, which operation can cause UB, which caller or module invariant makes it valid, which safe code can mutate the trusted state, whether `unsafe fn` still needs smaller internal unsafe blocks under project lint policy, whether an unsafe call returns a future whose preconditions must stay valid across suspension until completion, and which validation evidence is relevant without overstating it.
- **Validation:** Unsafe review can match every unsafe operation to a local `SAFETY` explanation; compile/lint checks exercise the changed scope; Miri, sanitizer, target, or model-check evidence is used only where the executed path and tool scope actually cover the risk.
- **Exceptions:** Existing reviewed unsafe wrappers may be consumed through their safe APIs without loading the whole unsafe pack when their invariants are untouched; unsafe syntax for FFI or attributes can route through FFI first, but the UB-relevant contract still follows this gate when changed.
- **Sources:** `RUST-UNSAFE-001`; audit unsafe/memory section. Related global controls: `CORE-007`, `CORE-016`.

### RP-UNSAFE-002 — Preserve pointer provenance in address manipulation

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** Unsafe code manipulates raw-pointer addresses, stores pointer addresses in integers, performs pointer tagging or bit packing, reconstructs pointers, implements custom allocators or low-level containers, or crosses FFI boundaries that carry opaque pointer handles as integers.
- **Risk:** Pointer-to-integer round trips, transmute-based reinterpretation, and out-of-context reconstruction can lose allocation provenance or create pointers whose aliasing and validity cannot be justified under Rust's memory model.
- **Rule:** Treat provenance as part of the unsafe contract: preserve the original allocation provenance when deriving related pointers, avoid bare pointer-integer round trips by default, keep provenance-stripping boundary exceptions local and explicit, and do not use `transmute` as pointer-address conversion glue.
- **Required reasoning:** Determine which allocation authorizes the pointer, whether the derived address remains within that allocation or is only an opaque external token, whether the code needs address arithmetic, provenance-preserving reconstruction, or exposed-provenance fallback, whether `const`/`static` evaluation imposes stricter limits, and which project MSRV/toolchain APIs are available.
- **Validation:** Unsafe review checks raw-pointer casts, address storage, reconstruction sites, allocation-boundary proofs, and const-evaluation paths; executable pure-Rust paths may use Miri or stricter provenance diagnostics as evidence, but review remains responsible for the full invariant.
- **Exceptions:** Legacy FFI or hardware interfaces may require opaque integer handles or exposed-provenance patterns, but the exception must be confined to the boundary, documented in the `SAFETY` contract, and not generalized into default pointer-arithmetic style.
- **Sources:** merged `RUST-UNSAFE-016`, `RUST-UNSAFE-033`; concrete API technique moved to `REC-UNSAFE-001`; audit unsafe/memory section and merge map.

### RP-UNSAFE-003 — Match unsafe syntax to edition and symbol contract

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff changes unsafe `extern` or foreign-item syntax or safety classification, touches unsafe exported attributes such as `#[no_mangle]`, `#[export_name]`, or `#[link_section]`, or changes a crate/workspace edition or toolchain boundary that can require those forms.
- **Risk:** Edition-specific unsafe syntax can be generated for the wrong crate, and exported names or foreign-item safety can hide linker or call-site contracts that are independent of the syntax form.
- **Rule:** Verify the owning crate edition before choosing unsafe extern or unsafe-attribute syntax; for Rust 2024 crates use the edition-required forms, classify each foreign item as safe or unsafe by its real call preconditions, and route exported-symbol namespace or ABI-boundary contract review through `RP-FFI-003` when that symbol becomes part of the foreign interface.
- **Required reasoning:** Determine the crate edition, MSRV/toolchain policy, whether the item is imported or exported, whether callers must uphold memory-safety preconditions, whether a symbol can collide with C/runtime/other-crate symbols, and whether that namespace or ABI contract belongs in `RP-FFI-003`.
- **Validation:** Manifest/toolchain review and the relevant compile gate exercise the edited crate; exported-symbol changes also receive the owning `RP-FFI-003` ABI/boundary review when the symbol is part of the contract; call sites compile with the intended safe or unsafe foreign-item classification.
- **Exceptions:** Pure ABI-boundary work that does not change the unsafe syntax or call-safety contract routes through the FFI/plugin ABI pack first. Rust 2021 and earlier crates keep legacy syntax while preserving the same safety review; mixed-edition workspaces are checked per crate; syntax conformance does not replace `RP-UNSAFE-001` or FFI ABI review.
- **Sources:** `RUST-UNSAFE-009`, downgraded `RUST-UNSAFE-027`; related `RP-UNSAFE-001` and FFI/plugin ABI pack.

### RP-UNSAFE-004 — Manual initialization and temporary invariants need recovery paths

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff uses `MaybeUninit`, `ManuallyDrop`, unions, manual drop flags, staged initialization, manual destruction, `mem::forget`, intentional leaks, drop-order-sensitive fields, or unsafe code that temporarily breaks an invariant.
- **Risk:** Reading uninitialized or invalid typed values, duplicating ownership, relying on accidental drop order, or letting a panic expose a broken logical invariant can make the unsafe boundary unsound.
- **Rule:** Keep invalid or partially initialized state out of ordinary typed values, document the initialized/active/owned state, restore logical invariants before safe observation, and provide a panic/early-return recovery path whenever unsafe code temporarily breaks an ownership, initialization, or bookkeeping invariant.
- **Required reasoning:** Distinguish immediate value-validity invariants from logical invariants that may be temporarily broken; identify which fields are initialized, which variant is active, who owns each resource, what drops in what order, which operations can panic before restoration, and which safe code can observe the state.
- **Validation:** Unsafe review checks initialization state, drop paths, drop order, and panic recovery; targeted tests or review exercise early-return and unwind paths where executable; Miri or sanitizers are evidence only for covered paths.
- **Exceptions:** Ordinary safe initialization and compiler-managed drop need no extra unsafe protocol; intentional leaks still need a lifecycle justification but are not a substitute for initialization validity.
- **Sources:** `RUST-UNSAFE-003`, `RUST-UNSAFE-004`, `RUST-UNSAFE-014`; related `CORE-009`, `REC-DIAG-001`, `REC-UNSAFE-002`.

### RP-UNSAFE-005 — Manual Send and Sync impls preserve the real auto-trait contract

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff adds or changes `unsafe impl Send`, `unsafe impl Sync`, a raw-pointer or `NonNull`-backed concurrent wrapper, a generic smart pointer, lock-free node, FFI handle type, or another type whose auto traits are not compiler-derived.
- **Risk:** Manual auto-trait impls can silence thread-boundary errors while allowing safe code to move `!Send` or unsynchronized state across threads.
- **Rule:** Add manual `Send` or `Sync` only with a `SAFETY` contract that proves the ownership, aliasing, synchronization, and generic bounds match the wrapper's real access model.
- **Required reasoning:** Determine whether compiler-derived auto traits would be correct, which fields suppress auto traits, whether each generic parameter is stored, dereferenced, shared, or only transformed, what bounds are required on inner types, and whether an unconditional impl has a structural proof independent of `T`.
- **Validation:** Unsafe review checks the `SAFETY` proof and generic bounds; compile-pass and compile-fail probes or auto-trait assertions exercise representative `Send` and `!Send` inner types at thread/spawn boundaries; Loom/Miri are optional evidence for modeled/executed synchronization paths only.
- **Exceptions:** Auto-derived `Send`/`Sync` from safe fields is preferred when it matches the contract; omitting inner bounds is acceptable only when the abstraction structurally prevents access to the inner value and the proof is local and explicit.
- **Sources:** `RUST-UNSAFE-007`, `RUST-UNSAFE-042`, `RUST-UNSAFE-043`; related async/concurrency spawn-boundary rules.

### RP-UNSAFE-006 — Atomic ordering needs a synchronization proof

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff adds or changes atomics, memory orderings, fences, CAS loops, lock-free structures, custom refcounts, optimistic shared-state reads, busy-wait loops, atomic bounded counters, or atomic values used to justify unsafe memory access.
- **Risk:** Relaxed or over-broad orderings can fail to establish the happens-before edge that the unsafe code relies on, while wrapped counters, double-loaded snapshots, or racy optimistic payload reads can turn an apparently checked path into out-of-bounds access, premature free, or stale-data UB.
- **Rule:** State the synchronization relationship before choosing atomic orderings, and map every unsafe access that depends on an atomic value to one checked snapshot plus the exact acquire/release edge, fence, or stronger ordering that makes it valid; if atomics model bounded ownership or index invariants, keep overflow, retry, and final-drop semantics explicit rather than relying on wrapping arithmetic or a second unchecked load.
- **Required reasoning:** Identify which data is synchronized by which atomic operation, whether an atomic is only a counter or publishes/guards other memory, whether CAS retry behavior has side effects, which reclamation or ownership scheme keeps reused or freed nodes valid, how ABA is prevented or tolerated, whether a bounded counter or refcount can wrap, whether check and unsafe use share the same loaded snapshot, whether any optimistic reader races a non-atomic payload access, whether a spin loop is truly short enough to stay CPU-local, and whether final-drop or deallocation paths have an acquire edge.
- **Validation:** Concurrency/unsafe review checks the happens-before argument, bounded-counter/refcount limits, and single-snapshot proofs; targeted tests exercise boundary values, retry and final-drop paths, and check-versus-use races; Loom or similar schedule exploration is relevant for modeled algorithms; Miri can expose executed-path issues but is not a weak-memory proof.
- **Exceptions:** `Relaxed` remains valid for independent counters or flags that guard no other memory; wrapping arithmetic remains valid for intentionally cyclic counters whose wraparound is part of the documented contract; `SeqCst` can be a valid stronger ordering when justified, but it does not remove the need to state the synchronization edge, snapshot proof, or final-drop ownership.
- **Sources:** `RUST-UNSAFE-010`, `RUST-UNSAFE-018`, `RUST-UNSAFE-022`, `RUST-UNSAFE-035`, `RUST-UNSAFE-036`; related `REC-UNSAFE-002` and async/concurrency validation guidance.

### RP-UNSAFE-007 — Raw-pointer aliasing preserves reference contracts

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff reborrows raw pointers as references, casts through `UnsafeCell`, derives writable pointers from references, stores raw aliases to container elements, or mixes safe container methods with raw element pointers.
- **Risk:** Forged or overlapping references and stale raw aliases can violate `&mut` exclusivity, shared-reference immutability, or container aliasing assumptions that the optimizer relies on.
- **Rule:** Do not use raw pointers to manufacture reference permissions the owner does not have; keep raw-pointer access patterns bounded by an explicit owner/lifetime, and ensure safe reference or container operations do not invalidate raw aliases that will be used later.
- **Required reasoning:** Identify the owner of the allocation, which references or raw pointers are live, whether mutation is allowed through `UnsafeCell`, whether a safe method asserts exclusive access to the whole container, whether a safe container or owner method semantically ends the raw alias even without reallocation, and where the raw access pattern ends.
- **Validation:** Unsafe review checks alias lifetimes and owner boundaries; compile lints, focused tests, and Miri aliasing diagnostics can provide executed-path evidence; alternate checker modes are diagnostic aids, not a license to weaken reference invariants.
- **Exceptions:** Correctly split disjoint regions, reviewed `UnsafeCell`-based interior mutability, and raw-only access regions are valid when the aliasing model is local and explicit.
- **Sources:** `RUST-UNSAFE-011`, `RUST-UNSAFE-025`; related `RP-UNSAFE-001`, `RP-UNSAFE-002`, `REC-UNSAFE-002`.

### RP-UNSAFE-008 — Safe APIs around unsafe code defend their soundness boundary

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** Unsafe code backs a safe abstraction, trusts user-provided safe traits, stores persistent invariant-carrying fields, or relies on `Drop` to preserve memory safety.
- **Risk:** Safe code can provide buggy trait behavior, mutate private fields in the same module, or leak/destruct values differently from the happy path, causing UB through unsafe code that assumed those conditions away.
- **Rule:** Design safe wrappers so memory safety does not depend on untrusted safe trait behavior, guaranteed destructor execution, or same-module safe code preserving hidden fields outside an explicit invariant boundary; if unsafe code must rely on implementor behavior for soundness, that contract belongs in an explicit `unsafe trait` or another reviewed unsafe boundary rather than an ordinary safe trait.
- **Required reasoning:** Identify which safe inputs can be adversarial, which unsafe invariants are persistent across calls, which module or visibility boundary prevents invalid field mutation, whether broken traits can be rejected instead of trusted, whether the implementor contract is truly soundness-critical enough to justify `unsafe trait`, and whether leaks or skipped `Drop` can violate soundness.
- **Validation:** Unsafe architecture review checks defensive validation, module/privacy boundaries, leak paths, and safe-method access to invariant-carrying fields; adversarial trait tests, leak-path tests, or field-visibility review are used where the boundary is material.
- **Exceptions:** Safe trait bugs may still cause panics or logical errors when the unsafe boundary defensively prevents UB; `Drop` remains appropriate for ordinary non-soundness cleanup and fallback release.
- **Sources:** `RUST-UNSAFE-020`, `RUST-UNSAFE-021`, `RUST-UNSAFE-023`, `RUST-UNSAFE-037`; related `CORE-009`.

### RP-UNSAFE-009 — Pinning is a storage-lifetime contract

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff uses `Pin`, `Pin::new_unchecked`, `PhantomPinned`, self-referential storage, intrusive structures, custom `Future` internals, pinned drop, or manual pin projection.
- **Risk:** Treating a pin wrapper as a temporary borrow or moving structurally pinned fields during projection/drop can violate the self-reference or address-stability invariant that unsafe code relies on.
- **Rule:** Treat pinning as a contract over the pointee's storage for the relevant lifecycle; decide structural pinning per field, prevent moves of pinned fields, and keep manual projection/drop behind a local `SAFETY` proof or reviewed helper.
- **Required reasoning:** Determine whether the pointee is `Unpin`, which fields are structurally pinned, which aliases can move or replace the value, whether any `Cell`/`RefCell`-style safe replacement path makes a field non-structural, whether `Drop` can move pinned fields, whether closure/async capture can move the storage after pinning, and which helper or macro is approved by project policy.
- **Validation:** Unsafe review checks the storage owner, projection, drop, aliasing, and `Unpin` bounds; compile checks and focused cancellation/move tests exercise representative paths; Miri evidence is limited to executed paths.
- **Exceptions:** `Unpin` values and safe pinning APIs remain valid when their documented contract matches the design; helper macros can reduce manual unsafe reasoning but do not remove the need to understand the generated contract for public or high-assurance boundaries.
- **Sources:** `RUST-UNSAFE-015`, `RUST-UNSAFE-029`; related `RP-UNSAFE-004`, `REC-UNSAFE-002`.

### RP-UNSAFE-010 — Representation-changing conversions need explicit layout and validity contracts

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff adds or changes `mem::transmute`, `transmute_copy`, union punning, whole-value reinterpretation of generic compounds, raw-parts reconstruction into a different element type, or another representation-changing conversion whose soundness depends on layout compatibility and immediate value validity.
- **Risk:** Equal size can be mistaken for soundness, allowing invalid references, enums, fat pointers, or generic layouts to be fabricated immediately, or letting ownership and deallocation invariants drift during zero-copy reinterpretation.
- **Rule:** Use representation-changing conversions only when the layout contract, immediate destination validity, and ownership or deallocation invariants are explicit; do not transmute whole `repr(Rust)` generic compounds across type parameters, and do not rely on inference or raw bit reinterpretation to justify a conversion boundary.
- **Required reasoning:** Identify the exact source and destination types, which `repr` or API contract guarantees compatibility, whether the destination can contain invalid references, enum discriminants, pointer metadata, or lifetime state immediately, whether the conversion crosses generic type parameters, and whether a raw-parts reconstruction preserves allocation, initialization, drop, and deallocation ownership for the new type.
- **Validation:** Unsafe review checks layout and immediate-validity assumptions, explicit source and destination typing, and raw-parts ownership reconstruction; compile-time assertions or focused tests verify size and representation assumptions where possible; Miri or target-aware diagnostics provide executed-path evidence only for covered conversions.
- **Exceptions:** Reviewed `repr(C)` or `repr(transparent)` boundaries with explicit validity and ownership proofs may use narrower conversion techniques; safe library conversions remain preferred when they preserve the same contract without raw reinterpretation.
- **Sources:** `RUST-UNSAFE-012`, `RUST-UNSAFE-032`; related `RP-UNSAFE-004`, `RP-UNSAFE-007`.

### RP-UNSAFE-011 — Raw allocation and slice construction keep zero-size, alignment, and range invariants explicit

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff adds or changes raw allocator calls, `Layout` handling, deallocation or typed reconstruction of erased pointers, `slice::from_raw_parts(_mut)`, manual buffer or collection internals, pointer offsets/add/sub across raw regions, foreign null-plus-empty buffers, or ZST-aware unsafe storage paths.
- **Risk:** Zero-sized allocation calls, mismatched deallocation layouts, null or misaligned empty-slice or ZST-reference placeholders, oversized spans, or slice formation across allocation boundaries can look harmless in tests while violating immediate allocator, reference-validity, or slice invariants.
- **Rule:** In raw allocation, deallocation, and slice-construction code, special-case zero-sized layouts and zero-length slices, use reviewed non-null aligned sentinels before forming typed references or slices when the API contract requires placeholders, preserve the exact allocation layout for matching deallocation or typed reconstruction, and prove that every constructed span stays within one allocation and within Rust's byte-range limits before forming the slice or derived pointer.
- **Required reasoning:** Determine whether `size_of::<T>()` or `layout.size()` is zero, which non-null sentinel or dangling pointer is valid for the typed API, whether foreign inputs can supply null plus zero length, whether deallocation or reconstruction still uses the original size and alignment, whether length or capacity arithmetic can overflow, whether the total byte span stays within `isize::MAX`, and whether pointer arithmetic or slice formation would cross more than one allocation.
- **Validation:** Unsafe review checks ZST, empty, null, alignment, layout-match, capacity, and byte-range cases; targeted zero-sized and empty-buffer tests cover constructor, grow, reconstruction, and drop paths; Miri or equivalent executed-path diagnostics validate representative raw allocation and slice formation paths.
- **Exceptions:** Safe standard-library abstractions already encode these invariants; ordinary safe slices and containers do not activate this rule unless their internals are being reimplemented or rewrapped unsafely.
- **Sources:** `RUST-UNSAFE-013`, `RUST-UNSAFE-028`, `RUST-UNSAFE-031`, `RUST-UNSAFE-039`, `RUST-UNSAFE-040`, `RUST-UNSAFE-041`; related `RP-UNSAFE-002`, `RP-UNSAFE-004`, `RP-FFI-001`.

### 6.3 FFI and plugin ABI

Loaded only through the FFI/plugin router row. This pack owns cross-language and dynamic-library contracts; general Rust ownership, cleanup, and unsafe approval remain in `CORE-003`, `CORE-009`, and `RP-UNSAFE-001`. Do not load it for pure Rust module boundaries, public Rust API/SemVer work with no foreign or dynamic-library ABI, generated Rust code that does not cross an ABI boundary, or ordinary dependency linking without exported or imported foreign symbols. The minimum FFI/plugin slice is: panic and unwind boundary (`RP-FFI-002`), allocator and ownership symmetry (`RP-FFI-001`), ABI/layout/version contract plus opaque-handle type identity (`RP-FFI-003`, with `RP-FFI-001` owning cross-boundary lifetime and free contracts), dynamic-library/plugin lifetime (`RP-FFI-006`), callbacks (`RP-FFI-005`), strings/buffers (`RP-FFI-004`), and generated-binding review (`REC-FFI-001`) when generated bindings are in scope. Foreign static-link runtime topology (`RP-FFI-007`) stays touched-surface-specific when the story links multiple Rust `staticlib` artifacts into one foreign host or restructures crate types for that host.

### RP-FFI-001 — Cross-boundary ownership is explicit

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** An FFI, plugin, or dynamic-library boundary passes allocated memory, opaque handles, raw pointers, resource-owning wrappers, callbacks that carry user data, or any value whose creator and destroyer can be on different sides of the boundary.
- **Risk:** Mismatched allocators, double free, leaked foreign resources, type confusion, or use-after-free appear when Rust and the foreign/plugin side each infer a different owner.
- **Rule:** Define symmetric acquire/create/borrow and release/destroy/free contracts at the boundary, including which side allocates, which side frees, which handles are nullable or typed, and which thread or plugin instance may use them.
- **Required reasoning:** Identify the allocator or resource owner for every cross-boundary pointer; decide whether the value is borrowed, transferred, reference-counted, or caller-owned storage; define nullability, thread-safety, and opaque-handle type identity; and ensure Rust does not reconstruct `Box`, `Vec`, or `String` from memory owned by a foreign allocator unless the ABI contract explicitly makes that Rust allocation.
- **Validation:** FFI API review can pair every create/acquire path with the matching release path; integration or lifecycle tests exercise success and failure cleanup; sanitizer/leak evidence is used where the project tooling supports the boundary.
- **Exceptions:** Borrow-only inputs, caller-allocated output buffers, and shared ownership are valid when lifetime, mutation, free function, and thread-domain rules are explicit in the ABI; aligning allocators can be an implementation detail but does not remove the need for a symmetric ownership contract.
- **Sources:** `RUST-FFI-002`, `RUST-FFI-007`; cross-links `CORE-003`, `CORE-009`, `RP-UNSAFE-001`, `REC-OWN-006`.

### RP-FFI-002 — FFI boundaries contain panic and unwind behavior

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** An `extern` function, callback, plugin entrypoint, or dynamically loaded Rust/C/C++ boundary can panic, throw, unwind, or call code whose panic strategy is not controlled by the current crate.
- **Risk:** Unwinding through a non-unwind ABI is undefined behavior for native foreign unwinds, Rust panics at non-unwind boundaries may abort, host/plugin `libstd` splits can make Rust panics behave like foreign exceptions, and destructor execution near the boundary is not a recovery contract.
- **Rule:** State the panic strategy and ABI unwind policy; keep non-unwind ABI boundaries non-unwinding by containing or redesigning failures, and use unwind-capable ABIs only when the project toolchain, foreign runtime, and boundary contract explicitly support them.
- **Required reasoning:** Determine whether the crate is built with `panic=abort` or `panic=unwind`; whether the ABI is `extern "C"`, `extern "C-unwind"`, `extern "system"`, or another header-declared convention; whether the foreign side can legally unwind; whether host and plugin share the same Rust runtime instance; and where cleanup/failure becomes visible without relying on unwinding side effects.
- **Validation:** Boundary review identifies every panic/exception crossing path; panic-containment or abort-policy tests cover the relevant entrypoints; plugin architectures verify whether host and plugin link to the same or distinct Rust standard-library instances.
- **Exceptions:** `catch_unwind` is useful only for Rust panics under an unwinding panic strategy inside a supported containment boundary; `panic=abort` is valid when process abort is the documented failure mode; foreign exceptions are handled only through an ABI/runtime contract that explicitly supports them.
- **Sources:** `RUST-FFI-001`; cross-links `CORE-008`, `CORE-009`, `RP-UNSAFE-001`.

### RP-FFI-003 — ABI, version, and layout are explicit contracts

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** A boundary exposes or consumes plugin entrypoints, function tables, `#[repr(C)]` types, C enum values, opaque pointee types, variable-width C primitives, target OS APIs, or independently built dynamic-library interfaces.
- **Risk:** Ordinary Rust types, unvalidated foreign enum values, wrong calling conventions, platform-dependent C primitive widths, opaque-type marker mistakes, and C++ layout mismatches can compile while producing incompatible ABI or memory corruption.
- **Rule:** Use stable ABI shapes for the raw boundary and negotiate version, size, and capabilities before rich plugin use; model layout with header-compatible `repr` types, `core::ffi::c_*` primitive and calling-convention choices, `core::ffi::c_void` for raw `void*` boundaries, explicit unknown-value policy, and layout assertions where offsets or sizes matter.
- **Required reasoning:** Decide which ABI is declared by the foreign header or plugin contract; which structs/enums are stable across independently built artifacts; whether a minimal version/capability entrypoint is required; how C enum integers become Rust enums safely; how opaque pointee `Send`/`Sync`/`Unpin` contracts are represented without fabricating uninhabited value-level stand-ins for `void*`; and whether C++ empty-type, target-width, or calling-convention differences apply.
- **Validation:** ABI/layout review compares Rust declarations to headers or generated bindings; integration tests cover compatible and incompatible plugin versions; `size_of`/offset checks or cross-target checks are used when layout is part of the contract; compile success alone is not treated as ABI proof.
- **Exceptions:** Ordinary Rust types may remain behind the safe facade when they do not cross an independently built ABI; generated bindings can own exact declarations when their generator, header inputs, target matrix, and drift policy are reviewed; `extern "system"` is used for platform APIs only when the header declares the system convention.
- **Sources:** `RUST-FFI-004`, `RUST-FFI-005`, `RUST-FFI-008`, `RUST-FFI-009`, `RUST-FFI-010`, `RUST-FFI-011`, `RUST-FFI-013`, `RUST-FFI-014`, `RUST-FFI-016`; cross-links `CORE-010`, `RP-UNSAFE-003`.

### RP-FFI-004 — Strings and buffers have encoding, length, and ownership policy

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** An FFI or plugin boundary reads or returns C strings, byte buffers, serialized data, pointer+length pairs, caller-provided output buffers, or Rust-owned variable-length data exposed to foreign callers.
- **Risk:** Out-of-bounds reads, invalid UTF-8 assumptions, missing terminators, truncation, cross-allocator frees, and ambiguous required-size behavior appear when string and buffer APIs rely on Rust string semantics across the raw ABI.
- **Rule:** Specify encoding, termination, length/capacity, partial-write, required-size, and ownership/free policy for every cross-boundary string or buffer; prefer caller-allocated buffers for variable-length Rust-to-foreign returns unless a matched Rust-side destructor is part of the ABI.
- **Required reasoning:** Decide whether the boundary value is borrowed or owned; whether it is NUL-terminated, pointer+length, fixed-size, or caller-allocated; whether bytes must be UTF-8 or may be opaque/non-UTF-8; how malformed input, embedded NUL, missing termination, insufficient capacity, and required-size discovery are reported; and which side frees any returned allocation.
- **Validation:** FFI review covers pointer validity, length/capacity, termination, encoding, and free path; integration or adversarial tests cover invalid UTF-8, malformed termination, zero/short buffers, required-size reporting, and release of any Rust-owned allocation through the matched destructor.
- **Exceptions:** Fixed-size scalars, opaque handles, and borrow-only inputs do not require caller-allocated output-buffer patterns; returning a Rust-owned allocation is valid only when the ABI includes a typed matching destructor and documents that foreign callers must not use their own `free`.
- **Sources:** `RUST-FFI-012`, `RUST-FFI-018`; cross-links `CORE-010`, `RP-FFI-001`, `RP-FFI-003`.

### RP-FFI-005 — Callbacks have lifecycle, thread, and signature contracts

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** An FFI, plugin, or dynamic loading boundary accepts, stores, invokes, unregisters, or returns callbacks, function pointers, callback context pointers, or dynamically loaded callable symbols.
- **Risk:** Callback panics, reentrancy surprises, wrong-thread execution, unload races, dangling context pointers, and ABI-signature mismatches can corrupt host/plugin state, abort the process, or crash under CFI even when ordinary Rust compilation succeeds.
- **Rule:** Define callback panic containment, reentrancy, thread affinity, context-pointer ownership, deregistration, shutdown/unload ordering, and exact ABI signature before exposing or invoking the callback.
- **Required reasoning:** Determine which side owns and may mutate callback context; when registration ends; whether callbacks may run concurrently, recursively, after shutdown, or on foreign threads; how callback errors are reported without unwinding across an unsupported ABI; whether function-pointer signatures exactly match the foreign ABI including pointer mutability and C integer widths; and whether the callback can outlive the library or object that registered it.
- **Validation:** Callback lifecycle review pairs registration with deregistration and unload ordering; integration tests cover invocation, panic/error containment, deregistration, and shutdown paths; CFI or sanitizer evidence is used when the project build supports it, but compile success alone is not ABI-signature proof.
- **Exceptions:** Synchronous one-shot callbacks that cannot escape the call stack can use a narrower lifecycle proof, but still need panic, reentrancy, and signature policy; `catch_unwind` is only Rust-panic containment under the crate panic strategy, not foreign-exception handling.
- **Sources:** `RUST-FFI-006`; cross-links `RP-FFI-001`, `RP-FFI-002`, `RP-FFI-003`, `RP-FFI-006`.

### RP-FFI-006 — Dynamic libraries and plugin objects unload in dependency order

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** A host loads, stores, reloads, unloads, or late-binds a dynamic library/plugin, library handle, symbol, function table, vtable-like object, callback registration, or plugin instance whose executable code or data belongs to the loaded artifact.
- **Risk:** Releasing the library handle before dependent symbols, callbacks, function tables, or plugin objects are dead can leave callable pointers into unloaded memory, causing crashes, state corruption, or use-after-unload even when the ABI and ownership rules were otherwise correct.
- **Rule:** Make the library handle outlive every symbol, function pointer, callback registration, plugin instance, and foreign-owned object that may execute code or access data from that library; define shutdown and unload ordering so those dependent values are deregistered or destroyed before the handle is released.
- **Required reasoning:** Determine which component owns the library handle; which symbols or objects borrow executable code, vtables, static data, or callback trampolines from it; whether callbacks can race unload or fire after deregistration starts; whether plugin objects must run destructors while the library is still loaded; and whether the intended policy is explicit unload, reference-counted unload, reload after quiescence, or process-lifetime pinning.
- **Validation:** Lifecycle review demonstrates the order load, symbol lookup, object creation, callback registration, quiescence, deregistration, object destruction, symbol invalidation, and library release; integration tests cover normal unload and failed/partial initialization cleanup, with concurrency or stress tests when callbacks or background foreign threads can race shutdown.
- **Exceptions:** A plugin library may be intentionally pinned for process lifetime when unload cannot be proven safe and the leak is documented as lifecycle policy; static linking or ordinary dependency linking does not activate this rule; a foreign loader's reference-counted handle guarantee can satisfy the ordering only when the guarantee is part of the reviewed API contract.
- **Sources:** `RUST-FFI-003`; cross-links `RP-FFI-001`, `RP-FFI-003`, `RP-FFI-005`, `CORE-009`.

### RP-FFI-007 — Foreign static linking uses one Rust runtime owner

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** A C/C++ or other foreign build links more than one Rust `staticlib`, exposes multiple Rust subsystems as separate static archives, or restructures crate types for a foreign host binary.
- **Risk:** Multiple independently linked Rust `staticlib` artifacts can duplicate allocator, panic, standard-library, or compiler-builtins symbols and split the runtime contract at foreign link time even when each individual crate compiles and tests correctly.
- **Rule:** When a foreign binary must consume multiple Rust subsystems, export one reviewed aggregate Rust boundary artifact and keep the internal Rust crates as ordinary Rust dependencies; do not link multiple independent Rust `staticlib` outputs into the same foreign binary unless a reviewed runtime-topology proof shows that the chosen no-std/runtime surface cannot conflict.
- **Required reasoning:** Determine which crate type the foreign host actually needs, whether the linked crates bring `std`, `alloc`, panic handlers, global allocators, or compiler-builtins overlap, whether a facade `staticlib` or `cdylib` can own the foreign boundary instead, and whether any claimed no-std exception truly avoids duplicate runtime symbols on the target link path.
- **Validation:** Foreign-link integration checks run on the real target build topology; symbol/linker review confirms the foreign binary links one Rust runtime-bearing static artifact or an explicitly reviewed exception; crate-type and workspace review show which crate owns the exported ABI.
- **Exceptions:** A `cdylib` or other single reviewed boundary artifact can satisfy the same contract without the aggregate-`staticlib` pattern; narrow no-std cases may justify a different topology only when allocator, panic, and builtins ownership is reviewed explicitly rather than assumed.
- **Sources:** `RUST-FFI-019`; cross-links `CORE-002`, `RP-FFI-002`.

### 6.4 Macros, build scripts, and generated code

Owns macro, proc-macro, build-script, and generated-artifact rules only when the router sees a real macro/build/codegen signal. Ordinary function, module, trait, or builder design stays with `CORE-006`; scoped edits and compile/check evidence stay with `CORE-007` and `CORE-011`; specialized tool commands and generator-version workarounds stay in section `7` unless the active story requires them.

Minimum macro/build slice is: smallest compile-time mechanism (`RP-MACRO-001`); declarative macro hygiene, grammar, diagnostics, and supported invocation scopes (`RP-MACRO-002`); proc-macro emitted tokens, spans, helper attributes, and diagnostic behavior (`RP-MACRO-003`); and, only for build-script or generated-artifact signals, build-script rerun inputs, `OUT_DIR`, host-vs-target split, hermeticity, and generated-artifact ownership/drift (`RP-MACRO-004`). Generated bindings that cross an ABI also route through `REC-FFI-001` and the FFI pack.

### RP-MACRO-001 — Use the smallest compile-time mechanism

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds, changes, or proposes a declarative macro, procedural macro, build-time code generation step, generated artifact, or macro-like API surface.
- **Risk:** Macro and code-generation machinery can hide control flow, worsen diagnostics, expand the review surface, and create public API commitments when ordinary Rust constructs would express the behavior directly.
- **Rule:** Use the smallest mechanism that satisfies the compile-time contract: prefer functions, modules, constructors, builders, or traits unless macro expansion or build-time generation materially improves the API, eliminates impossible runtime states, or is required by an external schema/ABI/tool boundary.
- **Required reasoning:** Identify the compile-time capability that ordinary Rust cannot express as clearly; whether the generated surface is public or shared; which inputs are accepted or rejected; how diagnostics reach the caller; and whether the mechanism crosses API, Cargo, FFI, generated-code, or toolchain boundaries owned by another pack.
- **Validation:** API and expansion review show that the macro/codegen mechanism is justified by a real compile-time contract, and compile-pass or compile-fail coverage exercises representative accepted and rejected uses without relying on hand-waved expansion behavior.
- **Exceptions:** Private helper macros may be appropriate for local repetition when they reduce error-prone duplication without becoming public API; external schema, ABI, or generated binding requirements can justify code generation, but persisted/wire/config DTO boundaries still need `RP-DATA-005` and `RP-DATA-006` when schema compatibility or canonical serialization is part of the contract, and ABI-crossing generated bindings still need the narrower FFI rules when those boundaries are active.
- **Sources:** `RUST-MACRO-001`; audit macros/build/generated section; router row for macros/build/generated code.

### RP-MACRO-002 — Declarative macros preserve hygiene and grammar contracts

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes `macro_rules!` macros, exported declarative macros, item-generating declarative macros, matcher fragments, `$crate` paths, visibility forwarding, or macro invocation forms.
- **Risk:** Declarative macros can accidentally depend on caller scope, violate fragment follow-set restrictions, reject valid syntax, widen or hide visibility, or work only in one invocation scope.
- **Rule:** Design `macro_rules!` surfaces around Rust's macro-by-example contract: use `$crate::` for internal crate items, pass caller locals explicitly, choose fragment kinds that match the accepted syntax, respect follow-set restrictions, forward caller visibility when generating exported items, and test every supported invocation scope.
- **Required reasoning:** Determine whether the macro is public/shared or private, which names must resolve at the definition site versus invocation site, which fragment kind is semantically correct, whether `$t:ty` must accept primitive/path/generic forms, whether `$vis:vis` belongs in the surface, and whether module-scope, item-scope, block-scope, or expression-scope invocation is promised.
- **Validation:** Compile-pass or compile-fail macro tests cover representative caller scopes, visibility forms, `$crate` path use, explicit caller-local arguments, valid type/path inputs, and invalid matcher grammar; expansion review is used when the emitted item or control-flow surface is non-trivial.
- **Exceptions:** Purely private macros with fixed local call sites may use a narrower surface when the limitation is documented by nearby tests or callers; expression-only macros need not support item-generation scopes; caller-like control flow is acceptable only when it is explicit in the macro contract.
- **Sources:** `RUST-MACRO-003`, `RUST-MACRO-011`, `RUST-MACRO-012`, `RUST-MACRO-014`, `RUST-MACRO-016`, `RUST-MACRO-019`; audit macros/build/generated section.

### RP-MACRO-003 — Proc macros control emitted tokens, spans, and errors

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes a proc-macro, derive macro, attribute macro, token-generation helper, helper attributes consumed by a macro, emitted `impl` blocks, or diagnostics for user-supplied macro input.
- **Risk:** Procedural macros are largely unhygienic token generators; caller-scope assumptions, leaked helper attributes, poor spans, panics on user input, or unmarked generated impls can create brittle downstream compiler UX and false lint/tool feedback.
- **Rule:** Treat emitted tokens as a public compiler-facing contract: use explicit paths for dependency-critical items, avoid accidental local-name collisions in caller expression context, convert user-input errors into diagnostics with useful spans, remove or deliberately forward consumed helper attributes, and mark derive-generated impls with `#[automatically_derived]` or a documented project/tool-specific marker when that is part of the diagnostic/tool contract.
- **Required reasoning:** Identify which emitted names depend on `std`, `core`, external crates, caller imports, or `no_std` policy; whether emitted bindings enter caller expression scope; which input errors need span-attached diagnostics rather than panic; which helper attributes are consumed or forwarded to a later macro stage; and whether generated impls should be distinguished from handwritten code for downstream diagnostics.
- **Validation:** Downstream compile-pass and compile-fail tests exercise shadowed caller names, missing imports, invalid user input, helper-attribute paths, and generated impl output; span and expanded-output review confirm errors point at user-owned tokens and derive-generated impls carry `#[automatically_derived]` or the documented project/tool-specific marker expected by that contract.
- **Exceptions:** Item-level output that does not introduce local bindings may not need mangled local names; preserving a helper attribute is valid when a documented later macro stage consumes it; exact path choices depend on the crate's `std`/`core` and dependency contract; tool-specific diagnostic behavior is evidence, not a substitute for the token/span contract.
- **Sources:** `RUST-MACRO-004`, `RUST-MACRO-010`, `RUST-MACRO-013`, `RUST-MACRO-020`; audit macros/build/generated section.

### RP-MACRO-004 — Build scripts and generated artifacts are reproducible

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes `build.rs`, build-time code generation, generated Rust/binding/schema artifacts, custom `cfg` emitted by a build script, Cargo directive output, host-vs-target decisions, checked-in generated files, or generated types shared across crates.
- **Risk:** Build scripts and generators can produce stale, non-reproducible, host-specific, target-wrong, or nominally duplicate artifacts when inputs, outputs, rerun boundaries, target metadata, and generated-type ownership are implicit.
- **Rule:** Treat build scripts as production build infrastructure: write normal build outputs under `OUT_DIR`, declare rerun inputs and relevant environment inputs explicitly, use Cargo-provided target metadata for target decisions, keep checked-in generated artifacts refreshed through an explicit drift-checked workflow, give shared generated types one canonical owner or facade, route generated persisted/wire/config DTO compatibility through `RP-DATA-005` and canonical-serialization or duplicate-key contracts through `RP-DATA-006` when those boundaries are active, route build-script-emitted custom `cfg` and MSRV/toolchain compatibility questions through `RP-CARGO-002` and the Cargo pack policy, and route emitted native-link directives through `RP-CARGO-003` when they control linker inputs.
- **Required reasoning:** Identify every file, environment value, header, schema, tool version, feature, and target property that affects generation; which outputs are transient `OUT_DIR` artifacts versus reviewed checked-in artifacts; whether host and target differ; whether generated public/shared types cross crate, FFI/API, or persisted/wire/config DTO boundaries; and whether any emitted custom `cfg` or native-link directive also activates the owning Cargo or Data pack review.
- **Validation:** Build-script review covers declared rerun inputs, `OUT_DIR` writes, target metadata, checked-in artifact ownership, and drift boundaries; generated-artifact drift checks compare checked-in outputs with freshly generated ones when those files are part of the contract; cross-target checks are used when host/target behavior matters; generated persisted/wire/config DTO surfaces route compatibility and canonical-serialization questions to the Data pack; Cargo-specific emitted `cfg`/MSRV questions are validated through `RP-CARGO-002`, emitted native-link directives through `RP-CARGO-003`; generated FFI surfaces route ABI, allocator, ownership, layout, and raw-binding lint questions to the FFI pack.
- **Exceptions:** Private crate-local generated artifacts may be regenerated independently when they never cross crate boundaries; a reviewed developer workflow may refresh checked-in artifacts outside the normal Cargo build graph; trivial handwritten FFI declarations or generator-free code may stay in the FFI/API pack when no build-script or generated-artifact behavior changes.
- **Sources:** `RUST-MACRO-002`, `RUST-MACRO-005`, `RUST-MACRO-006`, `RUST-MACRO-008`, `RUST-MACRO-009`, `RUST-MACRO-017`; audit macros/build/generated section; cross-links `RP-FFI-001`, `RP-FFI-003`.

### 6.5 Public API, SemVer, and documentation

Owns public-surface, SemVer, rustdoc, re-export/import API ergonomics, return-position `impl Trait`, public derive/auto-trait, `#[must_use]`, `repr`, public trait feature behavior, deprecation, public release-response policy, and downstream-consumer rules. This is also the destination for `RUST-API-012` through `RUST-API-030` unless a later migration deliberately moves a narrow technique to recipes or a generic abstraction principle to core.

SemVer, docs.rs, deprecation, yank and downstream-compatibility requirements remain policy-triggered; Rust visibility alone is not that policy.

Source-placement rule for this pack: all `RUST-API-*` IDs from the extracted Cargo-adjacent block are API inventory, not Cargo/toolchain rules. Section `6.6` may cross-link to them only when a manifest, feature, target, docs.rs, dependency, or release action changes the public surface; completion still requires a migration-map row naming the actual destination.

The minimum public-API slice is: conversion trait semantics (`RP-API-001`), rustdoc and examples as contract (`RP-API-005`), private fields and constructors for invariants (`RP-API-006`), public derives, auto traits, and dependency types as commitments (`RP-API-007`), return-position `impl Trait` lifetime capture (`RP-API-008`), downstream compatibility and strict public-boundary validation (`RP-API-009`), public trait extension and object-safety policy (`RP-API-010`), and feature/target docs (`RP-API-012`); other API-owned mechanisms stay touched-surface-specific.

Application-mode policy: for a private application, prototype, or unpublished internal tool whose real consumers are all visible in the repository, use local call-site evidence instead of downstream release process. Load only the API-pack slice that matches the touched mechanism, such as conversion semantics, public-looking docs that users read, local construction invariants, derives/debug output, trait method resolution, or RPIT call-site captures. Do not require SemVer review, docs.rs metadata, yanks, deprecation windows, publish dry-runs, or downstream compatibility tooling unless the story or repository policy names a stable external contract, reusable crate, SDK, stable CLI surface, or known downstream consumer. Validation in this mode is focused call-site review plus the relevant compile/check and behavior tests for affected local callers.

### RP-API-001 — Conversion traits match semantic contracts

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff implements, changes, or relies on `From`, `Into`, `TryFrom`, `TryInto`, `AsRef`, `Borrow`, textual parsing, narrowing conversion, or map/set lookup behavior.
- **Risk:** A convenient conversion trait can hide fallibility, lossy behavior, panics, allocation or normalization cost, or lookup semantics that callers and collections rely on.
- **Rule:** Choose conversion traits and named conversion helpers by their semantic contract: `From`/`Into` only for infallible non-lossy conversions, `TryFrom`/`TryInto` for fallible or narrowing conversions, `AsRef` for cheap borrowed views, `Borrow` only when equality, hashing, and ordering semantics match the owned key, and `FromStr` for ordinary string parsing. For named methods, use `as_` for cheap borrowed or primitive views, `to_` for borrowed-to-owned conversions that may allocate or clone, and `into_` for consuming owned-`self` conversions; when those prefixes would misdescribe the cost or ownership semantics, choose a more specific verb instead.
- **Required reasoning:** Identify whether the conversion can fail, narrow, normalize, allocate, clone, panic, or change identity/order; whether callers observe ownership transfer or a borrowed view; whether collection lookup semantics require owned and borrowed keys to compare identically; and whether a method name accurately communicates the ownership and cost model at the call site.
- **Validation:** API review and tests cover invalid or narrowing inputs when `TryFrom` is used, collection lookup behavior when `Borrow` is implemented, method naming against `wrong_self_convention` and call-site semantics where applicable, and call sites that would be misled by a lossy or panic-prone `From`.
- **Exceptions:** Local helper functions or explicitly named methods may express domain-specific conversions when trait semantics would overpromise; performance-sensitive borrowed views still need separate evidence before optimizing allocation behavior.
- **Sources:** `RUST-TRAIT-003`, `RUST-API-017`, `RUST-API-023`; audit traits/generics/conversions section and API/Cargo split note.

### RP-API-002 — Deref wrapper method-resolution collisions

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes inherent receiver methods on a smart-pointer-like, guard-like, public, or reusable wrapper that implements `Deref` or `DerefMut`, or changes the deref target's observable method surface.
- **Risk:** Inherent receiver methods on a deref wrapper can shadow target methods, alter method resolution at call sites, or create public API surprises when either the wrapper or target method set evolves.
- **Rule:** For `Deref` wrappers, add inherent receiver methods only when method-resolution review shows they are part of the wrapper's own API and unlikely to collide with the target; prefer associated functions or explicitly named helper methods when collision risk is material.
- **Required reasoning:** Determine whether the wrapper is public/reusable or strictly local, which target methods and deref coercions are visible at affected call sites, whether a future target-method addition would change behavior, and whether the operation semantically belongs to the wrapper or the deref target.
- **Validation:** API and call-site review cover representative method calls on the wrapper and target; public/reusable wrappers record why receiver methods are non-confusing or why associated functions are used instead.
- **Exceptions:** Non-`Deref` types are outside this rule; private wrappers with fixed local call sites may keep receiver methods when review shows no meaningful method-resolution ambiguity; `CORE-006` remains the rule that decides whether `Deref` itself is justified.
- **Sources:** rewritten `RUST-TRAIT-007`; audit dangerous-rule note for `RUST-TRAIT-007`.

### RP-API-003 — Trait impls need a legal local boundary

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds, changes, or proposes a trait implementation involving external crates, integration adapters, wrapper types, or a trait/type pair where either the trait or the self type may be foreign.
- **Risk:** Attempting a foreign-trait-for-foreign-type implementation wastes repair cycles and can lead to accidental wrapper or API changes that do not address Rust's coherence boundary.
- **Rule:** Before adding a cross-crate trait impl, identify the local trait or local self type that makes the impl legal; when the desired impl has no legal local boundary, introduce a deliberate local newtype/adapter or choose another reviewed design.
- **Required reasoning:** Determine which crate owns the trait, which crate owns the self type and any covering local type, whether a fundamental-wrapper exception or existing local boundary applies, and whether a new wrapper changes API, ownership, conversion, or SemVer behavior.
- **Validation:** Compile/check and trait-surface review confirm the impl is legal for the actual crate graph and that any wrapper or adapter is intentional rather than a mechanical orphan-rule workaround.
- **Exceptions:** If an existing local covering type already makes the impl legal, do not add a new wrapper; private integration adapters may use a narrow local newtype when its conversion and ownership behavior are contained.
- **Sources:** `RUST-TRAIT-008`; audit traits/generics/conversions section.

### RP-API-004 — Public error types are caller contracts

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes a reusable crate, SDK, public async-facing API, exported error type, public error conversion, or rustdoc-visible error contract.
- **Risk:** Public error types that are erased, stringly, non-composable, or accidentally expose internal dependency errors make callers unable to inspect failures and can turn implementation details into stable API commitments.
- **Rule:** For public or reusable boundaries, choose an error representation that states the caller contract: prefer typed/domain errors when callers must react, avoid `()` and bare `String` as public error types, document any intentionally non-`Send`, non-`Sync`, or non-`'static` error model, and expose foreign error conversions only when the dependency is an intentional public commitment.
- **Required reasoning:** Determine whether the boundary is an application edge or reusable/public API, whether callers need pattern matching, downcasting, source chaining, cross-thread/task use, or stable rustdoc-visible conversions, and whether `From<ForeignError>`/`#[from]` would expose an internal dependency.
- **Validation:** API/rustdoc review and compile checks show the intended public error contract, including source chaining or conversion behavior where relevant, and no accidental foreign-error conversion appears in the public surface.
- **Exceptions:** Application edges may use approved type-erased errors; standard-library or intentionally stable public dependency errors may be exposed; narrower thread-local or borrowed error models are valid when documented as part of the API.
- **Sources:** public API portion of `RUST-ERR-001`; audit error-handling section.

### RP-API-005 — Rustdoc examples expose the public contract

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes public rustdoc, doctests, examples, feature-gated examples, `# Errors`/`# Panics`/`# Safety` sections, or example harness setup for a reusable API.
- **Risk:** Public docs can omit fallibility, panic, safety, feature, import, setup, or reproduction requirements, causing downstream users and later agents to rely on a false contract even when code compiles.
- **Rule:** Keep rustdoc and examples aligned with the actual public contract: document errors, panics, safety and feature/setup requirements where they matter; keep examples runnable where practical; use hidden rustdoc lines only for non-essential boilerplate; and prefer fallible example harnesses over panic-shaped `.unwrap()` examples unless the panic is the subject.
- **Required reasoning:** Identify which public behavior the docs promise, whether examples compile under the documented features/targets, which hidden lines are essential contract versus boilerplate, whether intra-doc links and examples are part of acceptance, and whether a panic or `unwrap` in an example is intentional.
- **Validation:** Rustdoc review, doctests or example reproduction under the relevant feature/target surface, and link/lint checks under the project's rustdoc policy show that visible documentation matches the real API contract.
- **Exceptions:** Private implementation examples, intentionally non-runnable snippets, and hidden boilerplate are acceptable when the visible contract still states required imports, features, setup, safety preconditions, and error behavior.
- **Sources:** `RUST-API-002`, `RUST-API-012`; audit public API/documentation section.

### RP-API-006 — Public construction controls preserve invariants

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes public fields, constructors, accessors, re-exports, `#[non_exhaustive]`, public struct/enum construction, or a stable/shared DTO whose field visibility controls domain invariants.
- **Risk:** Public fields, glob re-exports, retroactive extensibility attributes, or hidden-public escape hatches can make invalid states constructible, widen the stable surface by accident, and block later invariant-preserving refactors.
- **Rule:** For stable or reusable public types, expose construction deliberately: prefer targeted re-exports, private fields plus constructors/accessors for validated invariants, and `#[non_exhaustive]` only for public surfaces intentionally designed to evolve from the start.
- **Required reasoning:** Determine whether downstream users must construct or pattern-match the type directly, which invariants require a private constructor path, whether a field-level contract is intentionally public, whether the type is conceptually closed or extensible, and whether hidden-public items would still be public compatibility commitments.
- **Validation:** API/rustdoc review and downstream-style compile checks cover construction, pattern matching, and re-export paths; invariant tests show invalid states cannot be constructed through the public surface.
- **Exceptions:** Internal binaries, explicit wire-only DTOs, and shared test fixtures may use public fields when the contract is documented; conceptually closed public enums should avoid unnecessary `#[non_exhaustive]`; retroactive `#[non_exhaustive]` or field privatization needs compatibility review.
- **Sources:** `RUST-API-007`, `RUST-API-008`; related reference `REC-API-001`; audit public API/documentation section.

### RP-API-007 — Public traits and dependency types are API commitments

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes a public type, public signature, public derive/manual trait impl, auto-trait-affecting field, cross-thread/task-facing public type, exposed dependency type, or dependency re-export in a reusable library/API surface.
- **Risk:** Internal fields, derives, and dependency choices can silently change caller-visible `Debug`, `Clone`, `Eq`, `Hash`, `Default`, `Send`, `Sync`, `Unpin`, dependency-version, and downstream compile contracts.
- **Rule:** Expose only trait impls, auto traits, and dependency types that are intended API commitments: compile-test expected public auto traits, derive or manually implement public traits only when their semantics are true, keep optional ecosystem derives behind an intentional reviewed feature boundary rather than treating them as default surface, make manual `Debug` output visibly informative for empty/default states when callers can observe it, follow `CORE-018` when public `Debug` or `Display` can expose sensitive data, and wrap dependency types unless exposing and re-exporting the dependency is an intentional public-version contract.
- **Required reasoning:** Identify which public trait impls and auto traits callers can observe, whether `Debug`/`Display`/logs can expose sensitive fields or become empty and non-diagnostic, which fields define equality/hash/default/clone semantics, whether an ecosystem derive would create an unnecessary default dependency commitment, whether the type crosses thread or async task boundaries, whether any third-party type becomes part of the public signature, and whether the surface is private/prototype, explicitly unstable, or stable/publishable.
- **Validation:** API and rustdoc review cover public trait semantics and dependency exposure; compile assertions or downstream compile checks exercise expected `Send`, `Sync`, `Unpin`, and exposed dependency import paths where relevant; tests or review verify non-empty manual `Debug` output for empty/default states when applicable, `CORE-018`-owned redaction behavior when sensitive output is part of the surface, equality/hash identity, and feature-on/feature-off behavior for optional ecosystem derives where those are part of the contract.
- **Exceptions:** The application-mode policy in `6.5` applies to private applications, prototypes, and explicitly unstable internal surfaces; `std` and `core` types need no re-export; deriving is acceptable when field structure exactly matches the public contract; exposing a dependency type is acceptable when the library policy treats that dependency as public semver surface.
- **Sources:** `RUST-API-003`, `RUST-API-009`, `RUST-API-022`, `RUST-API-028`; related `CORE-018`, `RP-CARGO-002`, `RP-DATA-003`, `RP-UNSAFE-005`; audit public API/documentation section.

### RP-API-008 — Return-position impl Trait captures are caller contracts

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes a public/reusable function, inherent method, trait method, or async function returning `impl Trait`, edits in-scope generics/lifetimes around that return type, changes crate edition/MSRV, or migrates code to Rust 2024 lifetime-capture rules.
- **Risk:** Hidden return-type captures can over-constrain caller borrows, change `'static` compatibility, alter trait-method or async future contracts, and break downstream code even when the function body still compiles.
- **Rule:** For public or reusable return-position `impl Trait`, determine the crate edition, toolchain support, and intended capture set before changing the signature; preserve or intentionally change captures with the edition-appropriate capture rules and reviewed precise-capturing support where applicable, and do not confuse RPIT's callee-chosen hidden concrete type with a caller-chosen generic return type.
- **Required reasoning:** Identify all in-scope type, const, and lifetime parameters, whether the returned hidden type or future actually needs each capture, whether the item is a free/inherent function, trait method/RPITIT, trait impl method, or `async fn`, which Rust edition and MSRV semantics apply, and which downstream borrow patterns, `'static` bounds, or SemVer promises are part of the API contract.
- **Validation:** Public API and SemVer review cover the signature; compile call-site tests hold returned values alongside relevant borrows and exercise expected `'static` or non-`'static` use; edition migration uses a reviewed capture-migration path suited to the active toolchain; downstream compile checks run when the public surface is stable or published.
- **Exceptions:** Private local functions can rely on local call-site evidence; broader captures are acceptable when intended and documented; pre-2024 free/inherent RPIT lifetime capture rules differ from Rust 2024, while type and const generics are still captured implicitly in all editions; precise-capturing support has toolchain and item-form constraints that must be checked before prescribing it.
- **Sources:** merged `RUST-API-014`, `RUST-API-020`; Rust Reference `impl Trait` capturing and precise-capturing rules; Rust 2024 Edition Guide RPIT lifetime-capture chapter; audit public API/documentation section and duplicate merge map.

### RP-API-009 — Public compatibility changes are downstream work

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff changes a published, publishable, SDK, stable CLI, or known-downstream public surface: public item signatures, re-exports, feature/default-feature support, generic bounds, lifetimes, `unsafe` contract, `no_std`/`std` support, `repr`, public dependency surface, migration notes, or release compatibility policy.
- **Risk:** Local tests can stay green while downstream crates break through SemVer-incompatible signatures, cfg/feature surfaces, portability promises, inference changes, layout expectations, or tooling blind spots.
- **Rule:** Treat stable public compatibility as downstream work: identify the promised surface and compatibility policy, review likely downstream call sites and target/feature matrices, document migration impact, and use SemVer tooling only as scoped evidence rather than final proof.
- **Required reasoning:** Determine whether the surface is stable, unstable, private, or application-only; which downstream users, targets, feature subsets, `no_std`/`std` promises, generic/lifetime bounds, lint fallout, and migration notes are in scope; and which compatibility taxonomy the project follows for minor versus breaking changes.
- **Validation:** API review, downstream-style compile checks, feature/target matrix checks where relevant, release-note or migration-note review, and any project-approved SemVer tooling with its skipped-feature and blind-spot limits recorded.
- **Exceptions:** The application-mode policy in `6.5` applies to private applications, prototypes, and explicitly unstable internal surfaces; MSRV bump policy, additive `std` feature strategy, exact SemVer taxonomy, and tool invocation details are project policy and must not be universalized.
- **Sources:** `RUST-API-001`; audit public API/SemVer section; cross-links `RP-API-007`, `RP-API-008`, `RP-API-014`, `CORE-012`.

### RP-API-010 — Public traits have an extension policy

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes a public trait, required method, associated item, default method, blanket impl, sealing pattern, object-safety surface, or feature-gated method on a reusable/public trait.
- **Risk:** Public trait changes can break downstream implementors, break `dyn Trait` users, or make unrelated Cargo feature unification add required methods to implementations that never opted into that feature.
- **Rule:** Decide whether each public trait is open for downstream implementation or intentionally sealed; keep the required primitive surface as small as the real contract allows, provide derivable convenience behavior as default methods where that preserves clarity, add new required surface only under the compatibility policy, keep object-safety changes explicit when `dyn Trait` is supported, and put feature-specific behavior in extension traits or defaulted methods rather than cfg-gating required base-trait methods.
- **Required reasoning:** Identify downstream impl expectations, sealing status, existing blanket impls, object-safety contract, feature/additivity behavior, whether convenience behavior can be derived from a smaller required primitive surface, whether trait-bound failures are predictable enough to justify reviewed diagnostic guidance, and whether new methods should be required, defaulted, extension-only, or placed on a new trait.
- **Validation:** API review and downstream compile checks exercise representative external impls, minimal implementations that only define the intended required primitives, `dyn Trait` use when supported, and feature combinations with and without the relevant feature; when compile-fail diagnostic UX is part of the contract, pair it with reviewed tool-specific checks rather than hand-waving compiler output.
- **Exceptions:** New traits can choose their initial extension model; traits explicitly limited to static dispatch need not preserve object safety, but that limitation must be documented; cfg-gating the entire trait is different from adding cfg-gated required methods to an existing base trait.
- **Sources:** `RUST-API-004`, `RUST-API-024`, `RUST-API-026`, `RUST-API-029`; audit public API/SemVer section; related Cargo feature behavior stays in the Cargo/toolchain pack.

### RP-API-011 — Deprecation and behavioral breaks need migration paths

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff removes, replaces, deprecates, renames, or behaviorally changes a stable public API, SDK method, stable CLI argument/output contract, or other downstream-visible surface.
- **Risk:** Immediate removal gives downstream users no migration path, while silently changing behavior behind the same type signature lets old call sites compile with wrong runtime semantics.
- **Rule:** Add the replacement and migration note before removal when normal release policy applies; for incompatible behavioral changes that could keep the same signature, force an explicit type, name, or call-site change so downstream code fails to compile instead of silently adopting new semantics.
- **Required reasoning:** Determine the old documented behavior, replacement path, deprecation window, compatibility policy, whether the change is a bugfix restoring the original contract or a new behavior, and whether existing call sites would still compile unchanged.
- **Validation:** Release, docs, changelog, and migration-note review cover the transition; downstream-style compile checks verify that behavior-breaking changes require an explicit caller edit.
- **Exceptions:** The application-mode policy in `6.5` applies to internal or explicitly unstable surfaces; emergency release response may bypass ordinary deprecation timing under `RP-API-013`; pure bugfixes that restore the documented contract do not require artificial type or name changes.
- **Sources:** `RUST-API-005`; audit public API/SemVer section.

### RP-API-012 — docs.rs reflects the supported public surface

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff changes feature-gated, target-gated, `cfg(doc)`/`doc_cfg`, `no_std`/`std`, optional-dependency, or docs.rs metadata behavior for a public/publishable crate.
- **Risk:** Published documentation can omit supported APIs, advertise impossible feature combinations, or make examples appear valid for targets/features the crate does not support.
- **Rule:** Define the docs.rs policy for the actual supported public surface: document cfg-gated APIs, configure docs.rs metadata only for real supported feature/target combinations, and keep README, rustdoc, examples, and package metadata aligned.
- **Required reasoning:** Identify which features and targets are part of the supported documentation contract, whether `all-features` is valid, which APIs are hidden by cfg, how `std`/`alloc`/`no_std` support is presented, and whether docs.rs metadata is a Cargo packaging concern or an API documentation concern for this change.
- **Validation:** Rustdoc/docs.rs review or equivalent docs build covers the relevant feature/target surface, doctests/examples match the documented configuration, and broken-link/lint policy is applied under project tooling.
- **Exceptions:** The application-mode policy in `6.5` applies to private crates, unpublished prototypes, and docs-only local examples; exact metadata keys, lint levels, and docs.rs build command details are Cargo/toolchain policy and must be verified locally before prescribing commands.
- **Sources:** `RUST-API-010`; audit public API/SemVer section and Cargo/API placement note; cross-links `RP-API-005` and section `6.6`.

### RP-API-013 — Yank is a release response, not a default fix

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** A published crate version may need public release-response guidance because of a yank decision, accidental publish, severe compatibility/correctness break, or another released-artifact incident.
- **Risk:** Using yank or another public release response without a reviewed downstream plan can leave consumers on a broken contract or without clear migration/advisory guidance.
- **Rule:** Treat yank as a reviewed public release-response decision, not the default fix: keep maintainer approval, expected downstream effect, and any replacement release, advisory, or migration communication explicit; route resolver, lockfile, registry-action, and incident-containment mechanics through `RP-CARGO-005`.
- **Required reasoning:** Determine whether the version is published, who can approve the public release response, what downstream users need to know or do, whether a replacement release or advisory is required, and whether resolver, lockfile, registry, or containment mechanics also activate `RP-CARGO-005`.
- **Validation:** Release review references the governing approval trail for the required maintainer approval, records expected downstream effect, replacement/advisory/migration communication where applicable, and any `RP-CARGO-005` evidence needed for resolver, lockfile, registry, or containment impact.
- **Exceptions:** Emergency incidents may compress the normal communication sequence, but published story-level yanks still need release-owner approval and an explicit downstream communication plan; the application-mode policy in `6.5` applies to ordinary internal-only fixes.
- **Sources:** `RUST-API-011`; audit public API/SemVer section; cross-link `RP-CARGO-005` for Cargo resolver/yank semantics.

### RP-API-014 — Public repr and layout are compatibility contracts

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds, removes, changes, or relies on `repr` for a public, publishable, FFI-facing, ABI/layout-sensitive, binary-format, or bytemuck/serialization-style type.
- **Risk:** Representation changes can break downstream layout assumptions, FFI, alignment, binary formats, or pattern of safe wrappers even when the Rust field list still compiles.
- **Rule:** Treat public representation as a compatibility contract: do not remove or change established public `repr`, reorder `repr(C)` fields, or add packed/ABI-sensitive representation without explicit compatibility and boundary review; additive representation attributes are reviewed against the project's SemVer policy and the actual downstream layout contract.
- **Required reasoning:** Identify whether callers rely on layout, ABI, FFI, serialization, alignment, transparent wrapper behavior, or only ordinary Rust construction; whether the type is private or public/stable; and whether FFI/plugin ABI review owns the raw boundary.
- **Validation:** Public API and downstream-layout review cover the changed type; FFI/layout checks, size/offset assertions, or cross-target checks are used only when layout is part of the contract; SemVer tooling is supporting evidence, not a complete layout proof.
- **Exceptions:** Private types and purely internal refactors are outside this rule unless they cross a documented layout boundary; raw cross-language ABI details remain owned by `RP-FFI-003`, and edition/exported-symbol syntax remains owned by `RP-UNSAFE-003`.
- **Sources:** `RUST-API-015`; audit public API/SemVer section; cross-links `RP-FFI-003`, `RP-UNSAFE-003`, `CORE-010`.

### RP-API-015 — Meaningful ignored-result contracts use reviewed `#[must_use]`

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes a builder, iterator, future, state-transition helper, pure computational API, or another return type whose value can be silently discarded while the program still compiles.
- **Risk:** Callers can drop meaningful work on the floor, and function-only `#[must_use]` can be bypassed when the call is wrapped in `if`, `if let`, or `match` expression forms.
- **Rule:** Apply `#[must_use]` only when ignoring the result is realistically a bug, and prefer annotating the returned type itself over relying only on a function-level annotation when the type is local and represents the real contract.
- **Required reasoning:** Determine whether the API's main effect is in the returned value or in side effects, whether callers legitimately ignore the result in normal use, whether the returned type is local and can carry the annotation, and whether adding `#[must_use]` on a stable public API is a reviewed compatibility change rather than an incidental patch.
- **Validation:** API review and compiler or Clippy `unused_must_use` feedback cover representative direct discard sites; do not assume either function-level or type-level `#[must_use]` catches control-flow scrutinee uses such as `if`, `if let`, or `match` without extra reviewed lint/tooling support.
- **Exceptions:** Side-effect-first APIs, intentionally ignorable best-effort helpers, and foreign or standard-library return types that cannot be annotated directly may use no annotation or a function-level annotation when that is the only available reviewed boundary.
- **Sources:** `RUST-API-013`; audit API section and Cargo/API split note.

### RP-API-016 — Borrowed-view and I/O parameter forms match actual ownership needs

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes public or reusable parameters or return types involving owned strings/vectors/boxes, `Cow`, generic `Read`/`Write` bounds, or async I/O traits with equivalent blanket impl behavior.
- **Risk:** Over-specific borrowed forms such as `&String`, `&Vec<T>`, or `&mut R` can force unnecessary allocations, indirection, or call-site borrowing friction, while `Cow` on always-borrowed or always-owned paths obscures the true storage contract.
- **Rule:** Use borrowed view types for strictly read-only access, reserve `Cow` for boundaries that usually borrow but sometimes must own due to normalization, escaping, mutation, or lifetime extension, and take generic `Read`/`Write`-style bounds by value when the trait's blanket impls already let callers pass either owned values or `&mut` references.
- **Required reasoning:** Determine whether the boundary only reads, mutates, stores, or takes ownership; whether the common path borrows or owns; whether `Cow` removes a real conditional-allocation branch instead of adding type noise; and whether the chosen I/O trait actually has the blanket impl coverage that makes a by-value generic parameter more ergonomic than `&mut R`.
- **Validation:** API review, call-site compile checks, and allocation/performance review where relevant show that representative callers can pass the intended borrowed or owned forms cleanly and that the chosen parameter shape matches the actual storage and mutation contract.
- **Exceptions:** Always-mutating or always-storing APIs may use owned values or mutable borrows directly; plain borrowed views are simpler than `Cow` on always-read-only paths; boxed/shared ownership parameters remain valid when recursion, pinning, ABI, or lifecycle semantics require them; and traits without the relevant blanket impls should not cargo-cult the by-value `Read`/`Write` pattern.
- **Sources:** `RUST-API-016`, `RUST-API-019`; audit API/Cargo split note.

### RP-API-017 — External import surfaces keep provenance explicit

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes `use` imports from external crates or broad library modules in shared, reusable, review-sensitive, or public-facing code.
- **Risk:** Wildcard imports hide name provenance, complicate review, and can create brittle collisions when an upstream dependency later adds a symbol that silently overlaps a local name.
- **Rule:** Import external items explicitly by name instead of using wildcard imports, unless the imported module is a reviewed prelude intentionally designed for glob use.
- **Required reasoning:** Identify whether the import comes from an external crate or a deliberately glob-friendly prelude, whether the scope is a localized test module or a broader shared surface, and whether the convenience of a glob import outweighs the provenance and collision cost in that module.
- **Validation:** Code review and compiler name-resolution checks confirm that symbol origins remain legible and that the import style does not depend on accidental upstream namespace stability.
- **Exceptions:** Standard or ecosystem preludes explicitly designed for glob import, and localized `use super::*` inside test modules, remain acceptable; generated code or macro expansion internals can use the owning mechanism's reviewed import strategy when hand-written explicit imports would not be the real source of truth.
- **Sources:** `RUST-API-018`; audit API/Cargo split note.

### RP-API-018 — Collection-like public types support standard iterator construction

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes a public or reusable collection, buffer, accumulator, or aggregator type whose primary contract is to hold a set, sequence, bag, or stream of items.
- **Risk:** Omitting standard iterator-construction traits breaks ordinary `.collect()` and incremental-extension ergonomics, pushing callers toward bespoke loops and reducing interoperability with normal Rust collection code.
- **Rule:** When a type semantically behaves like a collection, implement `FromIterator` for bulk construction and `Extend` for incremental addition unless the API intentionally rejects unconstrained bulk ingestion as part of its documented contract.
- **Required reasoning:** Determine whether the type's primary semantics are collection-like rather than merely containing an internal collection field, whether item ingestion has a reviewed ordering or validation policy, and whether rejecting generic bulk extension is an intentional surface constraint rather than an accidental omission.
- **Validation:** API review and compile checks show that representative `iter.collect::<Type>()` and `value.extend(iter)` call sites work for the intended item type, or that the omission is explicitly documented and justified by the contract.
- **Exceptions:** Domain types that only incidentally contain a collection, builders that require staged validation before insertion, or types whose contract intentionally forbids arbitrary bulk extension do not need these traits merely for style symmetry.
- **Sources:** `RUST-API-030`; audit API section.

### 6.6 Cargo, features, workspace, toolchain, and dependencies

Owns manifest, resolver, feature, workspace, lockfile, MSRV/toolchain, dependency-source, native-link, and package-resolution rules. Do not place public API rules here solely because the extracted source grouped them under or near a Cargo heading; `RUST-API-012` through `RUST-API-030` are routed through section `6.5` or section `7` unless a later migration records a narrower destination.

Keep Cargo behavior separate from repository policy: feature resolver behavior, `links`, target cfg, `[lints]`/`[workspace.lints]` scope, `[patch]`/`[replace]` root scope, and version-selection mechanics are tool contracts; MSRV, lockfile ownership, lint severity, duplicate-version tolerance, source allowlists, patch strategy, and release/yank response are policy decisions that need repo or story evidence.

The minimum Cargo slice is: resolved dependency versions before external APIs (`RP-CARGO-001`), feature/cfg/workspace/MSRV graph scoping (`RP-CARGO-002`), dependency-resolution and yanked-version response (`RP-CARGO-004`, `RP-CARGO-005`), lockfile and lower-bound policy (`RP-CARGO-006`), lint configuration scope (`RP-CARGO-007`), and root-only source overrides (`RP-CARGO-008`); native-link ownership (`RP-CARGO-003`) and publish boundaries (`RP-CARGO-009`) stay touched-surface-specific.

### RP-CARGO-001 — Resolved dependency versions before external APIs

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The story or diff uses, adds, updates, removes, gates, or troubleshoots an external crate API, dependency source, lockfile entry, workspace dependency, or path/git/registry dependency.
- **Risk:** Agents can call APIs that do not exist in the resolved version, rely on features enabled only in another graph, or assume one dependency edge proves another edge's resolved API surface without checking the selected package version and source.
- **Rule:** Before using or changing an external dependency API, identify the resolved package version and source that the affected crate will compile against, then verify the API and enabled features against an approved authoritative source for that version.
- **Required reasoning:** Determine which package owns the dependency edge; whether `Cargo.lock`, workspace inheritance, path/git replacement, target-specific dependencies, dev/build dependency isolation, or feature resolver behavior changes the resolved package; whether multiple versions of the same crate also create a duplicate-version or cross-crate type-identity issue that belongs in `RP-CARGO-004`; and which local source, generated docs, vendored code, registry docs, or repository example proves the API.
- **Validation:** Review the manifest/lockfile or resolved dependency metadata, name the version/source evidence used for each new or changed external API call, and run the smallest relevant compile/check gate for the package/feature/target graph touched by the dependency.
- **Exceptions:** Standard-library APIs, crate-local modules, and already-verified unchanged dependency calls in the same resolved package version, source, and enabled feature surface do not need a fresh version lookup; private vendored/path crates may use local source or generated rustdoc instead of registry documentation.
- **Sources:** `RUST-AGENT-005`, resolved-version part of `RUST-CARGO-007`, type-identity part of `RUST-CARGO-002`; audit Cargo section and minimal core item 2; cross-link `CORE-002`.

### RP-CARGO-002 — Feature, cfg, workspace, toolchain, and MSRV changes are graph-scoped

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff changes `[features]`, optional dependencies, `cfg(feature = ...)`, build-script-emitted custom `cfg` that changes which Rust cfg branches compile, target-specific dependency tables, `rust-toolchain` channel/component/target/profile pinning, resolver/MSRV/`rust-version`, workspace membership tables such as `members`, `default-members`, or `exclude`, workspace dependency or metadata inheritance, workspace lint inheritance, dev/build/proc-macro dependency edges, or mutually exclusive feature/backend selection.
- **Risk:** Cargo features are additive and resolver-scoped; a change that passes one local build can fail for another target, feature set, workspace member, MSRV, dev/build graph, or downstream user when graph boundaries are assumed instead of verified.
- **Rule:** Treat feature, cfg, workspace, toolchain, resolver, target, and MSRV edits as graph changes, including build-script-emitted custom `cfg` that changes which Rust items or dependency edges compile: define the activated graph slices, keep feature behavior additive unless an explicit compile-time incompatibility is required, and validate the relevant package/target/feature/MSRV combinations under repository policy.
- **Required reasoning:** Identify whether the change affects public surface or internal implementation; which features are defaults, optional dependency names, or `dep:`-hidden implementation details; which resolver is active; whether `rust-toolchain` changes alter the selected channel, components, targets, or profile for the affected graph; whether dev/build/proc-macro features are isolated from normal library builds; whether build-script-emitted custom `cfg` changes which Rust items, impls, or dependency edges participate in the selected graph; whether `rust-version` filters dependency resolution; which workspace members enter or leave the selected graph; which workspace metadata or lint policy is inherited explicitly; and whether a target-specific dependency header is using only predicates Cargo evaluates there.
- **Validation:** Manifest review plus relevant compile/check or metadata evidence for the touched feature/target/workspace slices; include no-default/default/all-target or feature-matrix checks only when those slices are part of the contract or repository policy.
- **Exceptions:** Code-only changes with no manifest, feature, cfg, target, workspace, or MSRV effect do not activate this rule; feature-gated public API compatibility still routes through the API pack; exact matrix commands remain project/toolchain policy rather than always-on Cargo behavior.
- **Sources:** `RUST-CARGO-001`, `RUST-CARGO-003`, `RUST-CARGO-006`, `RUST-CARGO-010`, `RUST-CARGO-012`, `RUST-CARGO-013`, `RUST-CARGO-015`, `RUST-CARGO-016`, `RUST-CARGO-024`; audit Cargo section.

### RP-CARGO-003 — Native links are graph-wide singletons

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The story or diff touches a `-sys` crate, native-library wrapper, `links` package key, build script that links a native library, dependency upgrade involving a crate with `links`, or publish/release work for a native-binding crate.
- **Risk:** Cargo permits only one resolved package per `links` value in a dependency graph; missing or conflicting `links` declarations can turn small dependency changes into unresolvable graphs, duplicate native linkage, or ecosystem-wide breakage for published native-binding crates.
- **Rule:** For native-linking packages, make the native-library ownership explicit with the correct `links` contract and review the resolved graph so only one provider owns each native library boundary.
- **Required reasoning:** Determine which crate actually links the native library; whether the `links` value is present and correct; whether upgrades introduce parallel major versions or multiple wrappers for the same native library; whether the change is private workspace maintenance or a published `-sys` crate release; and whether remediation belongs in local dependency alignment, upstream coordination, or a release/semver strategy.
- **Validation:** Manifest and build-script review plus resolved-graph/build evidence for the affected workspace or downstream test graph; published-crate major-version plans require downstream compatibility review rather than relying on a local build alone.
- **Exceptions:** Pure Rust crates, ordinary dependencies with no native link step, and FFI declarations that do not own Cargo native linking route through their own packs; multiple native libraries are acceptable when their `links` values and ownership boundaries are genuinely distinct.
- **Sources:** `RUST-CARGO-011`; audit Cargo section; cross-links `RP-FFI-003` and `RP-MACRO-004`.

### RP-CARGO-004 — Dependency resolution changes need graph evidence

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The story, build failure, lockfile diff, dependency upgrade, duplicate-version report, `[patch]`/source override, yanked-version incident, or cross-crate type mismatch requires changing dependency resolution.
- **Risk:** Treating duplicate resolved versions or lockfile churn as automatically wrong can force an invalid graph, tighten semver ranges, hide feature incompatibility, or replace a deliberate multi-version boundary with an accidental one.
- **Rule:** Change dependency resolution only after analyzing the dependency graph, semver requirements, feature compatibility, source overrides, and expected selected version; choose lockfile update, precise update, manifest-range change, patch/source override, adapter boundary, or no change according to that evidence.
- **Required reasoning:** Determine why the current resolution is a problem; whether versions are semver-compatible, strictly incompatible, intentionally coexisting, or linked by public type identity; which features and targets are enabled on each candidate version; whether `[patch]` or source replacement applies from the workspace/root policy; and whether the intended resolution can actually satisfy every relevant requirement.
- **Validation:** Review the resolved graph before and after the change, confirm the intended package version/source and feature set, and run the relevant package/workspace compile gate; a graph command is evidence of selection, not proof that SemVer, behavior, or security compatibility is correct.
- **Exceptions:** Multiple versions may remain valid when they are semver-incompatible, type-isolated, behind explicit adapters/re-exports, needed for staged migration, or irrelevant to size/native-link/policy constraints; `cargo update --precise`, `[patch]`, and manifest edits are techniques, not default fixes.
- **Sources:** `RUST-CARGO-020`; duplicate-version policy part of `RUST-CARGO-002`; lockfile/update policy part of `RUST-CARGO-007`; audit Cargo section; Cargo Book `cargo update` and dependency override documentation.

### RP-CARGO-005 — Yank response separates normal migration from emergency containment

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** A maintainer may yank or un-yank a published crate version, a release pipeline handles `cargo yank`, or a security, compromise, legal, credential, accidental-publish, or severe regression incident affects a released crate.
- **Risk:** Yanking before a compatible replacement can break fresh dependency resolution for downstream users, while delaying emergency action for security, compromise, legal, or credential incidents can preserve a harmful version in new graphs longer than necessary; in all cases, yanking does not remove existing lockfile use or downloaded artifacts.
- **Rule:** For normal bugs and compatibility fixes, provide a migration path such as a semver-compatible replacement, advisory, and communication before or alongside yanking; for security, compromise, legal, accidental-publish, or credential emergencies, immediate yank or registry action may be justified before a replacement, but it must be paired with the actual containment action and communication required by the incident.
- **Required reasoning:** Determine whether the release action is normal maintenance or emergency response; whether a compatible un-yanked version exists; whether existing lockfiles or downloaded artifacts remain affected; which governing approval trail or registry-owner workflow applies; whether credentials, personal data, or legal exposure require revocation or registry-maintainer contact; and whether downstream users need an update command, advisory, or migration note.
- **Validation:** Release evidence records the governing approval trail, registry action, replacement/advisory/migration communication when applicable, and incident-specific containment such as credential revocation or registry contact; dependency-resolution checks cover only new resolution behavior.
- **Exceptions:** Private registries, pre-release versions, unpublished/internal packages, and crates with no active downstream consumers may use a lighter communication process under project policy, but the normal-vs-emergency decision and expected resolver effect still need to be explicit.
- **Sources:** `RUST-CARGO-023`; audit Cargo section; Cargo Book `cargo yank` documentation; cross-link `RP-API-013` and `RP-CARGO-004`.

### RP-CARGO-006 — Lockfile and lower-bound policy must be explicit

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff changes `Cargo.lock`, a dependency version requirement, publishability/release expectations, exact pins or upper bounds, latest-dependency or minimum-dependency validation, or a story claims compatibility with a minimum dependency API.
- **Risk:** Cargo's default behavior does not decide whether a repository should commit `Cargo.lock`, how often it should refresh dependencies, or whether a declared version requirement actually matches the minimum API the code uses; agents can universalize local folklore into the wrong repository policy.
- **Rule:** Treat lockfile ownership, dependency lower-bound claims, exact pins, wildcard bans, and upper-bound restrictions as explicit repository or release policy; keep version requirements consistent with the minimum API the code actually uses, and validate the chosen policy with the relevant locked/latest/minimum-dependency workflow instead of Cargo folklore.
- **Required reasoning:** Determine whether the crate is an application, internal workspace member, published library, or mixed workspace; whether the repository expects a committed root lockfile; whether it verifies latest dependencies, minimum supported dependency versions, or both; whether exact pins or narrower upper bounds are justified by security, vendor, or deployment policy; and whether the declared version requirement documents a tested floor or only a compatibility range.
- **Validation:** Manifest and lockfile review confirm declared ranges, root lockfile handling, and any publish/release policy; when those claims changed, run the repository-approved locked, latest-dependency, or minimum-dependency validation family and record which contract was exercised.
- **Exceptions:** Internal unpublished workspaces may choose broader or looser dependency-range policy if that choice is explicit; Cargo's general guidance to check `Cargo.lock` in when unsure is a default starting point, not a substitute for repository policy; exact command techniques for minimum-version drills belong in reference recipes.
- **Sources:** policy part of `RUST-CARGO-007`; audit Cargo section; Cargo Book `Cargo.toml vs Cargo.lock`; cross-links `RP-CARGO-001` and `RP-CARGO-004`.

### RP-CARGO-007 — Lint configuration scope is local and policy-owned

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff changes `[lints]`, `[workspace.lints]`, lint severity, `#[allow]`, `#[expect]`, workspace lint inheritance, or attempts to suppress warnings emitted from a dependency.
- **Risk:** Agents can weaken lint policy with broad suppressions, or edit manifest lint tables expecting them to affect registry or git dependencies that Cargo does not control through the local package's lint configuration.
- **Rule:** Treat lint severity and suppressions as explicit local policy at the owning package or opted-in workspace-member scope; keep exceptions narrow, owned, and reviewable, and do not use Cargo manifest lint tables as a fix for warnings originating in external non-path dependencies.
- **Required reasoning:** Determine whether the warning originates in local code, a workspace path dependency, or an external registry/git dependency; whether the affected member crate opted into `workspace = true`; whether the suppression is temporary or durable policy; and who owns its scope, reason, and expiry.
- **Validation:** Lint review shows narrow scope and owner/expiry; manifest review confirms lint configuration is applied at the intended package or workspace boundary; when a warning comes from an external dependency, the chosen fix is an approved upstream, patch, or build-configuration path rather than a no-op local `[lints]` edit.
- **Exceptions:** Workspace path dependencies can inherit `workspace.lints` when they opt in; project-approved build configuration such as capped dependency lints or a local root patch may be valid when recorded explicitly; `CORE-014` still forbids broad suppressions used only to make green.
- **Sources:** policy part of `RUST-CARGO-009`; tool-scope part of `RUST-CARGO-017`; audit Cargo section; Cargo Book manifest and workspaces references; cross-links `CORE-014` and `RP-CARGO-002`.

### RP-CARGO-008 — Source overrides apply only at the effective root

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes `[patch]`, `[replace]`, dependency source overrides, local fork testing, or a published library/member manifest that tries to redirect transitive resolution.
- **Risk:** Agents can place a source override in a member or library manifest and believe consumers will inherit it, while Cargo ignores non-root override tables and downstream resolution stays unchanged.
- **Rule:** Put dependency source overrides only where Cargo actually reads them: the effective workspace or package root manifest, or an approved local Cargo config for non-committed experiments. Non-root library or workspace-member manifests must express supported dependency policy through ordinary dependency requirements rather than hidden override tables.
- **Required reasoning:** Determine which manifest is the effective workspace or package root; whether the override is local-only, workspace-scoped, or intended for downstream consumers; whether a published library needs a dependency-range change or upstream fix instead of an override; and whether a deprecated `[replace]` entry is legacy debt or newly proposed behavior.
- **Validation:** Manifest review confirms override scope; resolved-graph review or a downstream consumer repro shows the intended source is actually selected; publish/package checks confirm no hidden member-manifest override is being relied on.
- **Exceptions:** Local `.cargo/config.toml` or CLI config overrides are valid for temporary local testing when repository policy allows them; `[replace]` is deprecated and should only remain for explicitly justified legacy constraints.
- **Sources:** `RUST-CARGO-018`; audit Cargo section; Cargo Book overriding-dependencies and workspace references; cross-link `RP-CARGO-004`.

### RP-CARGO-009 — Publish boundaries for internal workspace crates are explicit

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The story or diff prepares a crate for packaging or publishing, changes `publish = false`, introduces or removes internal path dependencies in a release graph, or uses placeholder versions to mark internal-only workspace crates.
- **Risk:** Local builds can stay green while package or publish flows fail, or internal crates can leak into release graphs because publish boundaries were implied by convention instead of enforced by manifest policy.
- **Rule:** For publishable workspace crates, make internal-versus-publishable package boundaries explicit: release dependencies must not rely on unpublished internal path crates, and placeholder internal versions such as `0.0.0` are valid only when paired with an explicit internal publish policy instead of serving as an implicit release guard.
- **Required reasoning:** Determine which crates are genuinely publishable, which dependencies are release versus dev/build-only, whether any internal crate is intentionally unpublished, whether placeholder versions are only local markers or part of a reviewed internal release policy, and whether the publish flow needs a facade, split package, or promoted dependency instead of a hidden workspace edge.
- **Validation:** Manifest review confirms release-dependency boundaries and internal publish policy; package or publish dry-run evidence covers the affected crate graph and shows that publishable crates do not package unpublished internal release dependencies.
- **Exceptions:** Purely internal workspaces with no packaging or publishing contract can use lighter conventions if the boundary is explicit; dev-dependency and test-only exceptions are repository policy decisions and must not be inferred from release rules.
- **Sources:** `RUST-CARGO-004`, `RUST-CARGO-008`; audit Cargo section.

### 6.7 Testing beyond the core loop

Owns risk-activated validation beyond the always-on loop. `CORE-012` still requires semantic validation beyond a green compile, and `CORE-013` still owns ordinary spec-derived oracles, boundary/negative-case selection, fail-before-fix bug reproduction, and rejection of tests that only snapshot incidental implementation structure. This pack activates only when the contract needs dedicated failure-mode harnesses or advanced validation gates such as fuzzing, property tests, compile-fail diagnostics, schedule/model checking, sanitizers, or layout/auto-trait assertions for an observable boundary. The active minimum slice for the router row is deterministic negative/failure-path oracles (`RP-TEST-001`), fuzz/property/mutation scope plus preserved or minimized repros (`RP-TEST-002`), compile-fail diagnostics and other advanced-tool or formal/high-assurance gates (`RP-TEST-003`), and layout or auto-trait compile-time assertions where the contract is observable (`RP-TEST-004`). Assertion-helper choice and MSRV-compatible diagnostic style remain outside this pack unless the story already has an advanced-testing trigger.

### RP-TEST-001 — Complex failure modes need deterministic negative oracles

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The story or defect depends on timeout, deadlock, livelock, crash-only, partial-failure, retry-exhaustion, or explicit rejection behavior where a generic pass/fail test would not prove the contract.
- **Risk:** Tests that only hang until global CI timeout or merely assert internal steps can miss the actual failure-mode contract and regress silently.
- **Rule:** Encode the negative or failure-path contract as a deterministic, spec-derived oracle with explicit outcome, bounded time source, and useful failure evidence; do not treat "it hung" or "it crashed" as sufficient proof by itself.
- **Required reasoning:** Identify the observable failure or rejection result, whether ordinary `CORE-013` tests already cover it, which clock/runtime/harness can bound it deterministically, and what trace, error, exit, or state transition proves the contract.
- **Validation:** Negative and failure-path tests fail quickly with an explicit oracle, preserve the relevant trace or state when timing/scheduling matters, and would detect the known broken behavior rather than only checking code shape.
- **Exceptions:** Ordinary boundary and edge cases already covered by `CORE-013` do not need a special harness; a coarse global timeout is fallback containment evidence only when no tighter deterministic oracle is feasible and the reason is documented.
- **Sources:** `RUST-TEST-005`; related `CORE-013`.

### RP-TEST-002 — Fuzz, property, and mutation work need a risk-defined oracle

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The story touches untrusted parsers or decoders, hostile or high-volume input space, normalization or equivalence invariants, large state spaces, oracle-strength concerns, preserved incident repros, or bug classes where fixed examples alone cannot cover plausible failures.
- **Risk:** Running fuzzing, property tests, or mutation checks without a contract wastes time, while skipping them on risky boundaries leaves broad input spaces and weak oracles under-validated.
- **Rule:** Use fuzzing, property tests, or mutation checks only when the risk justifies them, and define the invariant, generator or corpus scope, failure triage, and deterministic regression path before treating the run as evidence.
- **Required reasoning:** Identify the exact invariant or oracle under test, why the boundary is too large or adversarial for examples alone, whether the generator or corpus reflects the real contract, how failing inputs will be minimized and classified for secrecy, whether mutation is checking oracle strength rather than replacing acceptance tests, and when a minimized case should become an always-on deterministic regression.
- **Validation:** The validation plan names the invariant and selected tool family; preserved or minimized failures become deterministic regression evidence when useful; review rejects stochastic runs that only increase coverage counts without a contract or triage path.
- **Exceptions:** Narrow deterministic acceptance tests remain sufficient when the input space and failure modes are small and already covered by `CORE-013`; exact commands, corpora paths, seed persistence, and budget or timeout choices remain project policy.
- **Sources:** fuzz/property/mutation gate portion of `RUST-TEST-003`, `RUST-TEST-004`; related `CORE-013`.

### RP-TEST-003 — Advanced test tools need explicit scope and proof limits

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The story proposes Miri, Loom, sanitizers, compile-fail diagnostics, formal verification/model checking for explicitly high-assurance scope, or another model/interpreter/instrumented test tool as evidence for unsafe behavior, schedule-sensitive concurrency, raw-buffer or FFI memory handling, target-sensitive layout assumptions, or public diagnostic contracts.
- **Risk:** Tool output can be overstated as full proof, while silently dropping the tool because of FFI, target, or harness limits can leave the intended unsafe or concurrency boundary under-validated.
- **Rule:** Use advanced test tools only for the boundary they actually model or instrument, and record both the covered path and the remaining blind spots before treating a green run as evidence.
- **Required reasoning:** Determine which risk is being checked, whether Miri, Loom, sanitizers, compile-fail tests, or another tool actually matches that risk, what path/target/harness the tool exercises, which gaps remain because of FFI, MMIO, OS I/O, weak-memory, optimizer, or instrumentation limits, and what fallback evidence is required when the preferred tool is blocked.
- **Validation:** The validation plan or review record names the selected tool, the exact boundary it covers, the stated blind spots, and any compensating tests or reasoning; no review claim treats a green run as proof beyond the modeled scope.
- **Exceptions:** Ordinary stories do not load these tools; if the project lacks the required toolchain or the boundary is inherently unmodeled, use the narrowest approved alternative evidence and state what remains unproved instead of pretending ordinary tests prove the same thing.
- **Sources:** remaining tool-scope portion of `RUST-TEST-003`; related `REC-UNSAFE-002`, `REC-TEST-001`, `REC-TEST-002`, `RUST-TEST-007`, `RUST-TEST-008`.

### RP-TEST-004 — Compile-time assertions lock only contract-relevant structure

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The change depends on a public or cross-boundary layout/ABI contract, target-independent size/alignment/offset invariants, or a documented auto-trait contract such as `Send`/`Sync` for a public or cross-thread type.
- **Risk:** Missing compile-time assertions can let ABI or thread-safety regressions escape until a distant use site, while asserting private structure or target-dependent internals can freeze harmless refactors and create false universal guarantees.
- **Rule:** Encode layout or auto-trait checks as compile-time assertions only when they protect an observable ABI, API, concurrency, or target contract; keep target-dependent checks cfg-aware and do not snapshot private implementation structure.
- **Required reasoning:** Decide whether size, alignment, offset, representation, or auto-trait behavior is part of an external or reviewed internal contract, whether the invariant is truly target-independent, which owning pack holds the semantic reason for the assertion, and whether a behavior test or review is more appropriate than a structural assertion.
- **Validation:** `cargo check` or a compile-fail gate trips when the contract is broken; assertions live in unconditional compile paths, are cfg-scoped when target-dependent, and are colocated with the type or boundary they protect.
- **Exceptions:** Private refactors, internal field order, or optimizer/layout details with no contract should stay out of compile-time assertions; runtime checks remain valid when the invariant depends on target, feature, or execution state rather than one compile-time shape.
- **Sources:** `RUST-TEST-010`, `RUST-TEST-014`; related `CORE-013`, `RP-FFI-003`, `RP-API-014`, `RP-ASYNC-002`, `RP-UNSAFE-001`.

### 6.8 Serialization, parsers, numeric data, binary formats, security, and external I/O

Pack activation is controlled by the router row in section `5`. The minimum data/security/I/O slice loads the touched owner rules from this pack: DTO compatibility (`RP-DATA-005`), canonical serialization and duplicate-key policy (`RP-DATA-006`), binary framing when binary contracts are active (`RP-DATA-007`), bounded regex work and grammar ambiguity or malformed-input handling when parsing contracts are active (`RP-DATA-008`, `RP-DATA-009`), cryptographic randomness (`RP-SEC-001`), security-sensitive path/URL/crypto/TLS policy (`RP-SEC-002`), outbound target allow-or-deny policy (`RP-SEC-006`), and CLI/file/subprocess/network/archive/stream lifecycle and resource policy for the touched boundary (`RP-IO-001`-`RP-IO-008`). Outside that minimum slice, load `RP-DATA-001`-`RP-DATA-004` when the touched contract depends on float-key or manual `Eq`/`Hash` identity, shared process-wide boundary state, or recursive or adversarially deep owned parsed/generated data, and load `RP-SEC-004` when the story changes a default hasher or introduces attacker-influenced map/cache hashing. `CORE-010` already owns generic numeric conversion, exact-quantity, and text-boundary policy, and `CORE-018` already owns sensitive-output redaction; this pack activates when a story changes persisted or wire schemas, config schema compatibility, canonical serialized forms, untrusted parsing behavior, binary framing, security-sensitive path/URL/crypto/TLS behavior, subprocess/filesystem/network/archive boundaries, or other external I/O contracts. Build-time or source-policy dependency changes route through the Cargo pack first and additionally load `RP-SEC-003` when the story changes a supply-chain trust boundary. Load `RP-SEC-005` only when certificate rotation, expiry policy, or in-process TLS reload is part of the touched boundary, and route live-reload lifecycle through `RP-TIME-003` and `RP-TIME-005`. Untrusted input alone does not automatically load persistence-compatibility, grammar-ambiguity, binary-format, TLS-rotation, or durable-write rules unless the touched contract actually depends on them.

### RP-DATA-001 — Float identity and ordering policy

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The story, API, or diff uses `f32`/`f64` as map/set keys, cache keys, deduplication identity, sorting/ranking order, persisted identifiers, or any contract requiring `Eq`, `Ord`, or `Hash`-like total semantics.
- **Risk:** Bare floating-point values have partial equality and ordering behavior; `NaN`, signed zero, and wrapper choices can break trait bounds, collection semantics, cache identity, or domain ordering.
- **Rule:** Define an explicit float identity and ordering policy before using floating-point values where total equality, total ordering, hashing, or stable deduplication semantics are part of the contract.
- **Required reasoning:** Decide whether `NaN` is allowed, rejected, canonicalized, or ordered; how signed zero is handled; whether exact bit identity or numeric equivalence is intended; and whether a reviewed wrapper, canonical newtype, integer representation, or domain-specific comparator owns the policy.
- **Validation:** API review and tests cover representative `NaN`, signed-zero, equality, ordering, and hashing cases when those semantics are observable.
- **Exceptions:** Plain arithmetic, approximate comparison, local `PartialEq`/`PartialOrd` checks, and non-key numeric processing do not activate this rule unless identity or total ordering becomes part of the contract.
- **Sources:** `RUST-TYPE-005`; audit type-driven design section.

### RP-DATA-002 — Shared global lifecycle needs one instance

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff introduces or changes module-level shared state, lazy singleton state, locks/cells, reusable global resources, shared configuration holders, or a value whose correctness depends on one stable process-wide instance or address.
- **Risk:** Modeling stateful or resource-owning globals as `const` can create fresh instances at use sites and hide lifecycle, address, synchronization, or drop behavior that the design expects to be shared.
- **Rule:** Use a shared-lifecycle mechanism such as `static`, one-time initialization, or a project-approved lazy global only when the design requires one stable instance; do not use `const` to represent shared mutable, interior-mutable, lazy, locked, or resource-owning state.
- **Required reasoning:** Determine whether the value is pure constant data or shared state; whether one instance, one address, lazy initialization, synchronization, or cleanup behavior matters; which MSRV/project dependency policy controls initialization helpers; and whether a boundary-specific pack needs stricter rules.
- **Validation:** Code review can distinguish pure constants from shared lifecycle; tests or review cover initialization and mutation behavior when state is observable; toolchain/MSRV evidence supports any chosen helper API.
- **Exceptions:** Plain immutable scalar constants and small pure compile-time values remain good `const` candidates; per-use value materialization is valid when sharing, address identity, mutation, and resource lifecycle are not part of the contract.
- **Sources:** lifecycle portion of `RUST-TYPE-006`; audit type-driven design section and special correction note for `RUST-TYPE-006`.

### RP-DATA-003 — Manual Eq and Hash preserve identity

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff manually implements or changes `PartialEq`, `Eq`, `Hash`, key identity, borrowed-key lookup, or use of a type as a `HashMap`/`HashSet` key.
- **Risk:** Values that compare equal but hash differently break hash-collection lookup and deduplication semantics without compiler help.
- **Rule:** When equality or hash behavior is manual or observable, ensure the equality relation and hash inputs describe the same identity contract.
- **Required reasoning:** Identify the fields or normalized values that define identity, whether derived and manual impls are mixed, whether collection/tuple-like hashing needs an unambiguous boundary such as length or separators, and whether float or borrowed-key semantics require a stricter data/API rule.
- **Validation:** Tests or review cover equal-value hash equality and representative hash-map/hash-set lookup; derived impls are accepted only when they match the intended identity contract.
- **Exceptions:** Deriving both equality and hashing together is acceptable when all fields participate in identity; non-hash collection use may not need a hash-specific check; float identity/order concerns route through `RP-DATA-001`.
- **Sources:** `RUST-TRAIT-010`; audit traits/generics/conversions section.

### RP-DATA-004 — Deep recursive destruction needs bounded drop policy

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff introduces or changes recursive or effectively unbounded-depth owned structures such as linked lists, recursive ASTs/trees, graph-like ownership chains, generated nested data, or adversarially sized parsed structures.
- **Risk:** Compiler-derived recursive destruction can overflow the stack on deeply nested values even when construction and ordinary behavior tests pass.
- **Rule:** For recursive or unbounded-depth owned structures, decide whether default structural drop can recurse deeply enough to threaten stack safety; when it can, use a reviewed iterative destruction path or another bounded-depth ownership design.
- **Required reasoning:** Determine whether depth is externally controlled or effectively unbounded, which ownership edges are followed during destruction, whether the type has manual `Drop`, and whether changing destruction affects cleanup ordering, panic behavior, unsafe invariants, or public API expectations.
- **Validation:** Deep-structure or adversarial-size tests and destructor-path review cover the relevant shape; manual destruction paths are checked against `CORE-009` so they do not hide fallible or panic-prone correctness work.
- **Exceptions:** Shallow, statically bounded, or domain-bounded structures do not need custom destruction; ordinary RAII cleanup remains valid when recursive stack growth is not a material risk.
- **Sources:** `RUST-ERR-005`; audit error-handling section.

### RP-DATA-005 — Serialized DTO schemas are compatibility contracts

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff changes a Serde-serialized or deserialized type, schema attribute, field name/default, enum representation, flattening behavior, or unknown-field handling for persisted, queued, cached, config, or wire data.
- **Risk:** Casual DTO shape changes can break stored data, rolling upgrades, queue replay, config loading, or cross-service compatibility even when local round trips still compile.
- **Rule:** Treat serialized DTO shape as a compatibility contract: decide defaults, unknown-field policy, enum representation, field-name stability, and migration or cutover behavior before changing the schema.
- **Required reasoning:** Determine who produces and consumes old and new payloads, whether forward and backward compatibility are both required, whether unknown fields should reject, ignore, or preserve data, which defaults are safe, whether enum tagging is stable enough for the boundary, and whether the change is a synchronized cutover, a staged migration, or an external contract.
- **Validation:** Compatibility tests or golden fixtures cover representative old and new payloads; review records the migration or cutover path and shows that round-trip-only tests are not being mistaken for compatibility proof.
- **Exceptions:** Internal transient structs that never cross persistence, wire, queue, config, or cache boundaries do not activate this rule; synchronized disposable formats may use a simpler change policy when the one-shot cutover and failure behavior are explicit.
- **Sources:** `RUST-DATA-001`; audit serialization/parsers/Unicode/numeric/binary section.

### RP-DATA-006 — Canonical serialization and duplicate-key policy are explicit

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** Serialized data participates in signatures, MACs, cache keys, deduplication, replay control, idempotency keys, policy evaluation, or any contract where byte-for-byte or field-order stability matters.
- **Risk:** Implicit map ordering, duplicate-key handling, or serializer differences can break signatures, replay safety, cache identity, or compatibility-sensitive behavior without changing the logical data model.
- **Rule:** Define canonical serialization and duplicate-key behavior before using structured serialized data as a security-, identity-, or replay-relevant contract.
- **Required reasoning:** Decide which encoding is canonical, whether duplicate keys are rejected, last-write-wins, or otherwise normalized, whether field order is part of the contract, whether serializer/library changes can alter output, and whether the boundary requires language- or implementation-independent canonicalization.
- **Validation:** Tests cover duplicate keys, canonical byte output or normalized structure, and representative cross-version or cross-implementation cases when those are part of the boundary.
- **Exceptions:** Pretty-printing, human-only logs, and local debugging output do not need canonicalization unless they are later reused as a signed, cached, or replayed contract.
- **Sources:** `RUST-DATA-003`; audit serialization/parsers/Unicode/numeric/binary section.

### RP-DATA-007 — Binary formats define endianness and checked framing

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff introduces or changes a binary wire format, file format, length-prefix or varint parser, packed numeric decoding, or allocation/indexing driven by binary input.
- **Risk:** Native-endian assumptions, unchecked lengths, or unchecked framing arithmetic can corrupt parsing, mis-size allocations, or turn malformed input into memory pressure and logic errors.
- **Rule:** For binary formats, make byte order, framing, and length interpretation explicit and validate lengths with checked arithmetic before indexing, slicing, or allocating.
- **Required reasoning:** Determine the format's endianness, width, varint or length-prefix rules, maximum allowed sizes, overflow behavior, incomplete-frame handling, and whether allocation should be bounded or streamed instead of eager.
- **Validation:** Boundary and malformed-input tests cover endianness, truncated frames, oversized lengths, and allocation/indexing guards; fuzzing or adversarial cases are used when the input is untrusted or externally controlled.
- **Exceptions:** Native-endian decoding is acceptable only when the format contract is truly native-endian and the supported-target policy documents that choice.
- **Sources:** `RUST-DATA-004`; audit serialization/parsers/Unicode/numeric/binary section.

### RP-DATA-008 — Backtracking regex on untrusted input needs bounded-work policy

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff introduces a backtracking regex engine, adds lookaround or backreferences to untrusted-input processing, or changes text validation/parsing so regex worst-case work becomes input-controlled.
- **Risk:** Input-driven catastrophic backtracking can turn parsing or validation into a denial-of-service boundary even when the expressions look small or tests pass on typical inputs.
- **Rule:** Prefer linear-time regex engines for untrusted input; when a backtracking engine is required, define explicit input bounds and timeout, work-limit, or equivalent bounded-work policy.
- **Required reasoning:** Determine whether the input is trusted, which regex engine semantics are in use, whether the pattern needs constructs unavailable in a linear-time engine, what maximum input size and work budget are acceptable, and which caller or service boundary owns failure behavior.
- **Validation:** Security or parser review and adversarial-input tests exercise worst-case patterns and confirm that configured bounds or fallback behavior actually limit work.
- **Exceptions:** Trusted offline tooling or tightly bounded local input may accept a backtracking engine without the same controls when the trust and size limits are explicit.
- **Sources:** `RUST-DATA-005`; audit serialization/parsers/Unicode/numeric/binary section.

### RP-DATA-009 — Compatibility-critical grammars define ambiguity and malformed-input handling

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff introduces or changes a custom grammar, protocol parser, compatibility-sensitive text format, ambiguous tokenization rule, or malformed-input recovery path.
- **Risk:** Custom grammars without explicit ambiguity resolution and malformed-input behavior drift across versions, accept conflicting interpretations, or fail unpredictably on hostile or legacy data.
- **Rule:** For security- or compatibility-relevant grammars, define ambiguity resolution, malformed-input handling, and versioning behavior before relying on the parser as a contract boundary.
- **Required reasoning:** Determine which parses are ambiguous, whether the grammar must reject or recover from malformed input, how recovery affects downstream state, whether the parser must remain compatible with older producers, and which cases are security-sensitive versus merely user-facing validation.
- **Validation:** Conflicting-input and malformed-case tests cover ambiguity resolution, rejection or recovery behavior, and version-compatibility expectations; parser review confirms the rule stays scoped to the actual grammar instead of generic parsing theory.
- **Exceptions:** Ad hoc internal text splitting with no external or compatibility contract does not activate this rule; if the boundary is purely structural serialization compatibility rather than grammar ambiguity, route the schema work through `RP-DATA-005` instead.
- **Sources:** `RUST-DATA-006`; audit serialization/parsers/Unicode/numeric/binary section.

### RP-SEC-001 — Cryptographic randomness must match the security contract

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff generates or refreshes keys, session identifiers, authentication tokens, password-reset material, security nonces, salts, invitation secrets, or any other value whose unpredictability is a security property.
- **Risk:** Using an RNG whose current contract does not match the threat model can make secret material predictable, mishandle fork or reseed behavior, or leave secret bytes in memory longer than the project allows.
- **Rule:** Choose an RNG whose documented current contract satisfies the project's cryptographic requirement, and make entropy source, fallibility, fork or process model, reseeding behavior, and secret-lifetime handling explicit instead of banning or approving APIs by name alone.
- **Required reasoning:** Determine whether the value needs a cryptographic unpredictability contract or only ordinary randomness, whether the chosen RNG implements the relevant `CryptoRng` or `TryCryptoRng` marker traits in the version actually used and what the current docs say those markers do and do not guarantee, whether OS entropy or a user-space CSPRNG is appropriate, how forked processes or cloned execution contexts are handled, whether failures must propagate, and whether generated secret bytes need zeroization or restricted encoding and storage.
- **Validation:** Security review records the crate and version checked, the documented RNG contract, the fork or reseed expectation, and the secret-lifetime policy; tests or review confirm security-sensitive paths do not silently fall back to a weaker RNG.
- **Exceptions:** Non-security randomness such as shuffles, sampling, jitter, or fuzz data does not activate this rule; a thread-local or fast CSPRNG may be acceptable for secret material only when its current documented contract, fork behavior, and secret-lifetime limits satisfy the project threat model.
- **Sources:** `RUST-SEC-006`; verified primary sources: `rand` docs for `ThreadRng`, `SysRng`, and `CryptoRng` (consulted 2026-06-18); audit security/privacy/trust-boundaries section and special-correction note for `RUST-SEC-006`.

### RP-SEC-002 — Security-sensitive boundaries define path, URL, crypto, and TLS policy

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff handles user- or config-controlled paths, security-sensitive URL parsing or canonicalization, password or token comparison, encryption or signing parameters, nonce policy, TLS configuration, or any filesystem target chosen across a trust boundary; outbound user- or externally derived network targets route through `RP-SEC-006`.
- **Risk:** Treating strings or crate names as self-validating can leave path traversal, unsafe URL normalization, weak comparison, nonce misuse, or TLS policy gaps hidden behind compiling code.
- **Rule:** Define security-relevant boundary policy explicitly for paths, non-connecting URL handling, crypto usage, and TLS behavior before implementing the boundary; outbound target selection routes through `RP-SEC-006`.
- **Required reasoning:** Identify who controls the path, URL, or cryptographic input; what path forms, schemes, algorithms, or certificate properties are permitted; whether constant-time comparison is actually required; how nonce uniqueness or randomness is guaranteed; and which policy is owned by the story versus the platform or deployment environment.
- **Validation:** Security review and targeted tests exercise allowed and rejected path or URL forms, boundary normalization, comparison behavior where secrecy matters, and certificate or crypto-policy failures relevant to the touched boundary.
- **Exceptions:** Public identifiers or non-secret values do not need constant-time comparison by default; internal trusted paths or non-connecting URLs may use a narrower policy when the trust assumption is explicit and verified.
- **Sources:** `RUST-SEC-002`; audit security/privacy/trust-boundaries section.

### RP-SEC-003 — Build-time and source-policy dependencies are reviewed trust boundaries

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff adds or changes proc-macro crates, `build.rs` dependencies, `*-sys` crates, git or alternate-registry dependencies, source overrides, vendored native code, or any dependency policy that changes what code executes at build time.
- **Risk:** Build-time or source-policy changes can execute unreviewed code, bypass normal provenance assumptions, or weaken advisory, license, and registry policy without touching runtime Rust logic.
- **Rule:** Treat new or changed build-time dependencies and source-policy overrides as security-sensitive boundary changes that require explicit security and provenance review in addition to the owning Cargo-pack review in `RP-CARGO-001` and `RP-CARGO-008`.
- **Required reasoning:** After the owning Cargo review establishes the resolved version, source, and override scope, determine what build-time or vendored code crosses the trust boundary, whether the change alters native toolchain or provenance assumptions, how advisory and license policy is enforced in this repository, and whether the change is temporary containment or a durable project dependency.
- **Validation:** `RP-CARGO-001` and `RP-CARGO-008` evidence confirm the resolved version/source and override scope; explicit security review confirms the new build-time or source-policy boundary is intentional, and repository-approved supply-chain checks cover advisory, license, banned-crate, or provenance policy where those gates exist.
- **Exceptions:** Normal runtime dependency updates that do not alter build-time execution or source policy still require ordinary dependency review but do not automatically trigger this high-assurance boundary; temporary overrides remain acceptable only with explicit review and cleanup intent.
- **Sources:** `RUST-SEC-003`, `RUST-SEC-007`; related `RP-CARGO-001`, `RP-CARGO-008`; audit security/privacy/trust-boundaries section.

### RP-SEC-004 — Fast hashers need an explicit trust-boundary and profiling decision

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff swaps a default hasher, introduces a non-cryptographic hasher for maps or caches, or claims hash-path performance wins for attacker-influenced keys.
- **Risk:** Faster but weaker hashers can reduce HashDoS resistance on untrusted keys for marginal or unmeasured gains.
- **Rule:** Use a fast non-cryptographic hasher only when the key space does not need HashDoS-resistant behavior; when hot-path optimization is the motivation, route the evidence-first tradeoff through `CORE-017` and `RP-PERF-008`.
- **Required reasoning:** Determine whether keys are attacker-influenced, whether collision resistance or HashDoS resistance matters, and whether a narrower cache-local scope can isolate the tradeoff; when performance is the motivation, determine whether the path is actually hot and what target-specific evidence `CORE-017` and `RP-PERF-008` require.
- **Validation:** Review records the input-trust decision for the affected maps or caches; profiling or benchmark evidence follows `CORE-017` and `RP-PERF-008` when a hot-path optimization claim is part of the change.
- **Exceptions:** Trusted internal caches and tightly scoped hot maps may use faster hashers when the trust boundary is explicit; public-facing or untrusted-input maps should keep a resistant policy unless the project accepts the tradeoff explicitly.
- **Sources:** `RUST-SEC-004`; related `CORE-017`, `RP-PERF-008`; audit security/privacy/trust-boundaries section.

### RP-SEC-005 — TLS rotation defines trust-material and expiry policy

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff changes TLS-terminating services, mTLS clients or servers, certificate-expiry handling, trust-material rotation, or in-process certificate reload where the security boundary itself changes.
- **Risk:** Wrong trust material, ignored expiry, or broken rotation assumptions can fail closed unexpectedly, keep serving invalid credentials, or leak private material during rotation.
- **Rule:** Make certificate rotation, expiry handling, and trust-material policy explicit; when certs reload live, route atomic swap, watcher behavior, and last-known-good lifecycle through `RP-TIME-003` and `RP-TIME-005`, and do not expose key material through logs or diagnostics.
- **Required reasoning:** Determine whether certs rotate in process, by rolling restart, or via a sidecar or platform service; what expiry, issuer, or trust-anchor properties are required; whether live reload exists and therefore must use the validated reload boundary owned by `RP-TIME-003` and `RP-TIME-005`; whether connections drain, restart, or keep existing sessions; and which data must stay redacted.
- **Validation:** Rotation or reload tests cover invalid new material, expiry behavior, and whichever restart-only or last-known-good policy the owning reload path defines; security or ops review confirms key material is not logged.
- **Exceptions:** Platform-managed cert rotation, sidecar termination, or rolling restart is valid when the story explicitly relies on that lifecycle instead of in-process reload.
- **Sources:** `RUST-SEC-005`; related `RP-TIME-003`, `RP-TIME-005`, `CORE-018`; audit security/privacy/trust-boundaries section.

### RP-SEC-006 — Outbound URLs and targets use an explicit allow or deny policy

- **Layer:** RISK_PACK
- **Importance:** HIGH_ASSURANCE
- **Trigger:** The diff makes outbound HTTP or network requests from user-supplied or externally derived targets, fetches webhooks, proxies URLs, or resolves remote hosts across a trust boundary.
- **Risk:** Accepting arbitrary outbound targets can turn a feature into SSRF, metadata access, internal-network reachability, or DNS-rebinding exposure.
- **Rule:** Parse and validate outbound targets against an explicit scheme and destination policy before opening the connection.
- **Required reasoning:** Determine which schemes are permitted, whether hostnames or IP ranges must be allowlisted or denied, whether loopback, link-local, RFC-1918, metadata, or internal suffixes are forbidden, whether redirects are revalidated, and whether the service is an intentional proxy with a narrower reviewed allowlist model.
- **Validation:** Security review and adversarial tests cover rejected loopback, link-local, private-range, metadata, and internal-only targets before connection attempts; where the threat model requires it, resolution and connection-time revalidation are checked.
- **Exceptions:** Intentional internal proxies or federation relays may use a strict hostname or destination allowlist instead of a generic denylist, but the reviewed policy must still be explicit.
- **Sources:** `RUST-SEC-008`; audit security/privacy/trust-boundaries section.

### RP-IO-001 — CLI and external-output boundaries are explicit and bounded

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff changes a CLI, daemon entry point, data-export path, stdout or stderr behavior, exit-path behavior, or untrusted or large input or output handling.
- **Risk:** Deep `process::exit`, mixed output channels, or unbounded `read_to_end`-style I/O can turn boundary handling into cleanup loss, user-facing confusion, or memory pressure.
- **Rule:** Keep CLI and external-output boundaries explicit: return `Result` from domain code, separate machine-readable stdout from diagnostics, and use bounded or streaming I/O when size or trust is not fixed.
- **Required reasoning:** Determine which layer owns process exit, which channel carries structured output versus diagnostics, whether the input or output size is bounded, and whether cleanup or shutdown must complete before a process exits.
- **Validation:** CLI or integration tests cover output-channel behavior and exit paths; review confirms large or untrusted I/O is bounded or streamed rather than eagerly slurped.
- **Exceptions:** Tiny trusted fixtures or one-shot scripts may use simpler buffered I/O when resource bounds are explicit and cleanup is unaffected.
- **Sources:** `RUST-IO-001`; related `CORE-009`; audit CLI/filesystem/process/network/external-I/O section.

### RP-IO-002 — Subprocesses define environment, timeout, and descendant-cleanup policy

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff spawns external commands, shells out to helpers, relies on ambient PATH or cwd, enforces subprocess timeouts, or interacts with tools that can spawn child processes of their own.
- **Risk:** Ambient environment, cwd, PATH, missing timeout or wait policy, or killing only the parent process can leak secrets, change behavior unexpectedly, or leave child processes running after shutdown.
- **Rule:** For subprocess boundaries, define environment inheritance, cwd and path resolution, timeout or kill or wait behavior, and whether descendant processes need explicit group or tree cleanup.
- **Required reasoning:** Determine whether the command or arguments are trusted, whether shell interpretation is involved or the target uses non-standard argument decoding such as Windows `cmd.exe` or `.bat` handling, which environment variables and working directory are allowed, what timeout and termination behavior is acceptable, and whether the tool can leave child processes that outlive the parent.
- **Validation:** Process-boundary review and integration tests cover environment inheritance, timeout or kill or wait behavior, and descendant cleanup on supported platforms when the process tree can persist.
- **Exceptions:** Simple reviewed one-shot children may inherit a narrow environment and omit group cleanup when the assumption is explicit and verified; direct `Command::arg` use is not shell interpolation for ordinary executable argv handling, but shells, `cmd.exe`/`.bat` targets, and other non-standard argument decoders remain separate command-injection boundaries.
- **Sources:** `RUST-IO-002`, `RUST-IO-003`, `RUST-IO-010`; audit CLI/filesystem/process/network/external-I/O section.

### RP-IO-003 — Network servers bound admission and long-lived state

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes a custom server, listener accept loop, connection tracking table, session store, gateway, or other long-lived network-facing state.
- **Risk:** Unbounded accept or spawn patterns and never-expiring in-memory state turn overload into file-descriptor, task, memory, or connection exhaustion.
- **Rule:** Define admission control, backpressure, overload behavior, and bounded retention or eviction policy for network-facing long-lived state.
- **Required reasoning:** Determine maximum concurrent connections or tasks, what is rejected or shed under overload, how state expires or evicts, which resources are bounded, and whether error paths release sockets and tasks correctly.
- **Validation:** Load or resource-boundary tests and review cover caps, overload behavior, and cleanup of long-lived state.
- **Exceptions:** Internal low-volume services may use simpler bounds when deployment and load assumptions are explicit, but unbounded growth should not remain implicit.
- **Sources:** `RUST-IO-004`; audit CLI/filesystem/process/network/external-I/O section.

### RP-IO-004 — Archive and compressed input need explicit expansion limits

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff extracts archives, decompresses untrusted payloads, accepts uploads containing nested or compressed formats, or parses compressed front-door data before ordinary validation.
- **Risk:** Small hostile inputs can expand into unbounded CPU, memory, file-count, or nesting work before business logic sees the data.
- **Rule:** Before processing untrusted compressed or archive-like input, define limits for decompressed bytes, expansion ratio, nesting depth, and file count.
- **Required reasoning:** Determine the maximum resource budget, whether extraction streams or materializes content, how nested formats are handled, and which failures abort processing versus partially continue.
- **Validation:** Negative tests with hostile fixtures and resource-boundary review confirm limits trigger before excessive work or extraction.
- **Exceptions:** Trusted offline archives may use simpler limits when source, size, and execution environment are fixed and reviewed.
- **Sources:** `RUST-IO-005`; related `RP-DATA-008`; audit CLI/filesystem/process/network/external-I/O section.

### RP-IO-005 — Durable file updates use contract-driven crash-consistency

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff rewrites config or state files, checkpoints, journals, durable caches, or security-sensitive file outputs whose success semantics include crash recovery or power-loss behavior.
- **Risk:** Reporting success after a rewrite without an explicit durability contract can lose data after crash or power loss, while cargo-cult sync steps can add cost without matching the real file contract.
- **Rule:** When durability is part of the contract, define the required crash-consistency sequence explicitly; when it is not, do not imply full durable-write semantics by accident.
- **Required reasoning:** Determine whether the file is throwaway, restart-recoverable, or correctness-critical; whether temp-write plus atomic rename is sufficient; whether file sync and parent-directory sync are required on supported platforms; what permissions must exist from creation time; and what acknowledgment point counts as success.
- **Validation:** Crash-durability review and platform-aware tests cover the required success semantics; review records when full sync steps are intentionally omitted because the file is cache-like or otherwise non-durable.
- **Exceptions:** Throwaway caches, rebuildable artifacts, or best-effort telemetry files do not need full durable-write sequences; parent-directory sync is only required where the platform and contract make directory-entry persistence part of success.
- **Sources:** `RUST-IO-006`; audit CLI/filesystem/process/network/external-I/O section.

### RP-IO-006 — Stream protocols define framing and recover-or-reset policy

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff changes custom TCP or byte-stream protocols, framed RPC, reusable socket connections, partial read or write loops, or cancellation of in-flight frame handling.
- **Risk:** Assuming one read equals one message or ignoring mid-frame cancellation can corrupt protocol state, duplicate or lose partial progress, or reuse a connection that is no longer synchronized.
- **Rule:** Use explicit framing for stream protocols and define whether partial progress after cancellation or I/O interruption is recoverable or requires closing or resetting the connection.
- **Required reasoning:** Determine message boundaries, how partial reads and writes are resumed, whether a cancelled or interrupted frame leaves the stream synchronized, when a connection can be safely reused, and which side owns reset or shutdown.
- **Validation:** Protocol tests cover partial I/O, cancellation, malformed or truncated frames, and reusable-connection behavior.
- **Exceptions:** One-shot request/response exchanges that always close the connection may use a simpler reset policy, but framing and interruption assumptions must still be explicit.
- **Sources:** `RUST-IO-007`; audit CLI/filesystem/process/network/external-I/O section.

### RP-IO-007 — Direct external dependency calls define timeout, retry, idempotency, and backpressure

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes direct calls to external APIs, RPC dependencies, or other network services whose failure, latency, or retry behavior affects correctness or load.
- **Risk:** Naive dependency calls can hang indefinitely, stampede a failing upstream, or duplicate side effects when retries are implicit.
- **Rule:** For direct external dependency calls, define call-site timeout classes, retry budget and retryable failures, idempotency policy for mutating retries, and concurrency or backpressure limits; broader reusable client deadline, retry, pacing, or pagination semantics belong to `RP-TIME-006` and `RP-TIME-007`.
- **Required reasoning:** Determine connect, request, read, and overall timeout ownership at this call boundary, routing broader client-boundary deadline policy through `RP-TIME-006`; which failures are safe to retry; whether the operation is idempotent or carries a replay token; how concurrency is bounded; and whether reusable retry, pacing, or pagination behavior belongs in `RP-TIME-007` instead of only at this call site.
- **Validation:** Fault-injection or integration tests cover direct-call timeout, retry, and backpressure behavior; when retries, pacing, or pagination are owned by a reusable client, tests or review point to `RP-TIME-006` and `RP-TIME-007` for that broader contract; review records the idempotency assumption for mutation retries.
- **Exceptions:** Fire-and-forget best-effort notifications may use a simpler no-retry policy when message loss is explicit; reusable client-wide deadline, retry, pacing, or pagination policy belongs in `RP-TIME-006` and `RP-TIME-007` rather than being redefined at every call site.
- **Sources:** `RUST-IO-008`; related `RP-TIME-006`, `RP-TIME-007`; audit CLI/filesystem/process/network/external-I/O section.

### RP-IO-008 — Cross-platform filenames need explicit semantic policy

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff accepts, generates, extracts, normalizes, or persists filenames across supported platforms or filesystems.
- **Risk:** Treating filenames as portable UTF-8 strings can break on reserved names, case-insensitive filesystems, link semantics, or platform-specific executable behavior.
- **Rule:** For untrusted or generated filenames, define cross-platform naming, reserved-name, case-sensitivity, link-handling, and executable-file semantics explicitly.
- **Required reasoning:** Determine which platforms are supported, whether names must be normalized or sanitized, how reserved names and collisions are handled, whether symlinks or hardlinks are allowed, and whether executability depends on mode bits, extensions, or both.
- **Validation:** Cross-platform tests or review reflect the supported filename contract instead of assuming one desktop filesystem.
- **Exceptions:** Single-platform internal tooling may use a narrower filename contract when the supported OS and filesystem semantics are explicit and tested.
- **Sources:** `RUST-IO-009`; audit CLI/filesystem/process/network/external-I/O section.

### 6.9 Database, messaging, and distributed state

Pack activation is controlled by the router row in section `5`. The minimum DB/messaging slice is: partial-failure and replay policy (`RP-DB-001`), at-least-once delivery and idempotent consumers (`RP-DB-002`), connection and transaction scope (`RP-DB-003`), mixed-version migration policy (`RP-DB-004`), dynamic SQL identifier allowlists (`RP-DB-005`), and Rust-to-DB nullability, width, time, and exact-quantity mapping (`RP-DB-006`). This pack owns durable-state, queue, transaction, replay, schema-migration, and Rust-to-DB contract boundaries when the story actually changes them. Production observability, incident response, deployment approval, and rollback bureaucracy stay in section `6.10` unless the DB or messaging contract itself depends on a mixed-version or recovery window.

### RP-DB-001 — Distributed state changes define partial-failure and replay policy

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff introduces or changes a workflow that coordinates DB writes with queues, outbox or inbox tables, external side effects, sagas, reconciliation jobs, or any multi-step durable update that can partially succeed across boundaries.
- **Risk:** Rust memory safety does not protect cross-system consistency; a crash, timeout, or poison message can leave one side committed while another side is missing, duplicated, or retried out of order.
- **Rule:** Before changing distributed durable workflows, define the partial-failure, replay, and recovery contract, including how each committed step is observed, retried, reconciled, or compensated.
- **Required reasoning:** Determine which system is the source of truth, which side effects can commit independently, whether outbox/inbox, compensating actions, or explicit reconciliation are required, how poison or malformed messages are handled, and whether replay must be lossless, idempotent, or operator-mediated.
- **Validation:** Integration tests or review cover crash or timeout points, replay or reconciliation paths, and poison-message handling without assuming a panic is a recovery strategy.
- **Exceptions:** A single local transaction with no queue, external side effect, or cross-service durable state does not activate this rule; purely in-memory retries with no persisted side effects remain outside this pack.
- **Sources:** `RUST-DB-001`; audit database/messaging/distributed-state section.

### RP-DB-002 — Queue consumers assume at-least-once delivery and explicit idempotency

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes queue consumers, event handlers, message-driven workers, replayed jobs, outbox or inbox consumers, or any handler whose side effects may be retried or redelivered.
- **Risk:** Duplicate delivery or replay can repeat side effects, charge twice, resend notifications, or corrupt state when consumer logic assumes exactly-once delivery without proof.
- **Rule:** Treat consumer side effects as at-least-once unless the system has a stronger reviewed guarantee, and make idempotency, deduplication, or replay-safe state transitions explicit at the handler boundary.
- **Required reasoning:** Determine what uniquely identifies a logical message, where deduplication state lives, whether the handler uses upsert, compare-and-set, monotonic versioning, or another replay-safe transition, how invalid payloads are quarantined or dropped, and whether acknowledgement happens before or after the durable side effect.
- **Validation:** Duplicate-delivery and replay tests exercise representative redelivery, retry, and invalid-payload paths; review can point to the idempotency key or replay-safe transition, not just hope that consumers rarely retry.
- **Exceptions:** Fire-and-forget best-effort notifications may accept duplicate effects only when that loss or duplication contract is explicit; exactly-once claims require boundary-specific evidence and do not remove the need to review recovery behavior.
- **Sources:** `RUST-DB-002`; audit database/messaging/distributed-state section.

### RP-DB-003 — Connections and transactions do not span unrelated external awaits

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff changes async DB code that holds a checked-out connection, transaction, cursor, DB lock, or distributed lock while awaiting unrelated network, queue, filesystem, or long-running external work.
- **Risk:** Holding scarce DB resources across unrelated awaits can starve the pool, deadlock application progress, or widen transaction scope until retries and cancellation become much harder to reason about.
- **Rule:** Keep DB connection and transaction scope as tight as the durable operation allows; fetch unrelated external data before opening the transaction or after commit unless the architecture explicitly accepts the contention and recovery tradeoff.
- **Required reasoning:** Determine which awaits are part of the DB contract versus unrelated external work, whether the checked-out resource is a transaction or pooled connection, how cancellation or timeout affects the held resource, whether DB or distributed lock duration or isolation level changes contention, and whether a staged workflow or explicit saga boundary would be safer.
- **Validation:** Integration tests or review cover pool checkout lifetime, transaction boundaries, timeout or cancellation behavior, and contention-sensitive paths when the story touches async DB work.
- **Exceptions:** Short awaited work that is itself part of the DB boundary, such as driver-internal protocol I/O within the transaction, does not violate this rule; an architecture may intentionally hold the transaction open across an external await only when the tradeoff is documented and validated.
- **Sources:** `RUST-DB-003`; related `CORE-009`, `RP-ASYNC-004`; audit database/messaging/distributed-state section.

### RP-DB-004 — Mixed-version schema changes define compatibility and recovery policy

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff changes schema, migrations, or durable invariants in a way that old and new binaries, workers, or jobs may overlap during rollout, replay, backfill, or rollback.
- **Risk:** Old and new code can disagree about schema shape or allowed values, making rollout, replay, or rollback corrupt data even when each version works in isolation.
- **Rule:** For mixed-version or rollback-relevant schema changes, define the compatibility window and choose expand/contract, explicit forward-only cutover, or another reviewed migration strategy before applying the change.
- **Required reasoning:** Determine whether old and new application versions overlap, whether rollback is supported or intentionally impossible, which readers and writers must coexist, whether data backfill or dual-write is needed, and what recovery path exists if deployment stops mid-migration.
- **Validation:** Migration review and representative upgrade or rollback tests cover the chosen compatibility window, old/new reader-writer overlap, and the failure path for interrupted rollout.
- **Exceptions:** Synchronized one-shot maintenance windows may use an explicit forward-only cutover when overlap and rollback are intentionally disallowed and the operational recovery path is recorded; local disposable development databases do not need production-style rollout policy.
- **Sources:** `RUST-DB-004`; audit database/messaging/distributed-state section.

### RP-DB-005 — Dynamic SQL structure comes from reviewed allowlists

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff builds SQL or query-builder structure from runtime-selected table names, column names, sort keys, sort directions, or other identifier-level tokens that cannot be parameter-bound as ordinary values.
- **Risk:** Parameter binding does not protect identifier and query-structure interpolation, so unreviewed dynamic SQL tokens can create injection, compatibility, or accidental-query-shape bugs.
- **Rule:** Map dynamic SQL identifiers and structural query tokens through explicit reviewed allowlists or enum-like selectors instead of interpolating loosely validated runtime strings.
- **Required reasoning:** Determine which SQL parts are values versus identifiers or keywords, where the selector set is defined, whether sort or filter options are closed and documented, and whether a query-builder abstraction already provides the needed structure without string assembly.
- **Validation:** Query-construction tests and security review cover rejected unknown identifiers, expected generated SQL shape, and the boundary between bound values and reviewed structural tokens.
- **Exceptions:** Ordinary data values should still use parameter binding; static query strings with no runtime-selected identifiers do not activate this rule.
- **Sources:** `RUST-DB-005`; audit database/messaging/distributed-state section.

### RP-DB-006 — Rust-to-DB types define nullability, width, time, and exact-quantity semantics

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes DB models, ORM mappings, row decoding or encoding, migration column types, query-layer conversions, or persisted values whose meaning depends on `NULL`, integer width, time zone handling, or exact decimal semantics.
- **Risk:** Implicit type mapping can silently lose `NULL`, truncate widths, shift timestamps, or encode exact quantities with approximation semantics that the application does not intend.
- **Rule:** Make the Rust-to-DB contract explicit for nullability, integer width, time and timezone semantics, and exact-quantity representation before treating the schema boundary as stable.
- **Required reasoning:** Determine whether absence is `NULL`, sentinel, or separate row state; whether integer widths and signedness round-trip safely; whether timestamps are UTC, offset-preserving, local-time, or date-only; whether exact quantities require decimal or fixed-point representation; and whether public or cross-service consumers depend on the same mapping.
- **Validation:** Schema review, round-trip tests, and migration or query tests cover `NULL`, width edges, representative time-zone cases, and exact-quantity behavior at the touched boundary.
- **Exceptions:** Internal transient projections that never persist or cross a DB boundary may use local convenience conversions; approximate floats are acceptable only when the project explicitly accepts approximation semantics for that stored value.
- **Sources:** `RUST-DB-006`; related `CORE-010`; audit database/messaging/distributed-state section.

### 6.10 Time, configuration, API clients, operations, observability, and rollback

Pack activation is controlled by the router row in section `5`. The minimum time/config/client slice loads the touched owner rules from this pack: monotonic durations (`RP-TIME-001`), validated config plus atomic reload and last-known-good policy (`RP-TIME-003`), process-environment mutation confinement (`RP-TIME-004`), file-watcher events as reload hints (`RP-TIME-005`), explicit deadline ownership (`RP-TIME-006`), and retry, pacing, pagination, and streaming contract (`RP-TIME-007`). This section owns time modeling, config boundaries, API-client retry/deadline semantics, and production operations only when the story actually changes those contracts. Timing-sensitive deterministic test-clock guidance stays in `RP-TIME-002` when the touched surface includes timing or async test oracles; config reload, process-environment mutation, retry policy, observability, and rollback remain separate conditional concerns inside this section.

### RP-TIME-001 — Elapsed-time logic uses monotonic clocks and explicit wall-clock boundaries

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes timeout math, backoff or retry delays, cache expiry calculations, scheduling delays, elapsed-duration measurement, deadline comparisons, or code that mixes wall-clock timestamps with duration logic.
- **Risk:** Using wall-clock time for elapsed-duration logic can break under DST jumps, NTP adjustments, leap handling, or manual clock changes, while mixing civil-time and monotonic-time semantics hides ownership of the actual time contract.
- **Rule:** Use monotonic time for elapsed durations, deadlines, and backoff measurement; use wall-clock or civil time only where the external contract is about timestamps, calendars, or human-facing time, and make the conversion boundary explicit.
- **Required reasoning:** Determine whether the code needs elapsed-duration measurement or a real-world timestamp, who owns the deadline budget, whether persisted or external timestamps must survive process restarts, how monotonic and wall-clock values are converted or compared, and whether the touched behavior crosses timezone or calendar semantics that should stay out of duration logic.
- **Validation:** Tests or review cover clock-jump-resistant elapsed behavior, explicit timestamp-versus-duration boundaries, and representative edge cases where wall-clock adjustments would otherwise change control flow.
- **Exceptions:** Logging, audit trails, persisted timestamps, and user-visible schedules may require wall-clock semantics; a boundary may intentionally translate between wall-clock input and monotonic deadline tracking when that conversion point is explicit and validated.
- **Sources:** partial split of `RUST-TIME-001`; audit time/config/API-client section.

### RP-TIME-002 — Timing-sensitive unit tests prefer deterministic test clocks

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes async or timing-sensitive unit tests for timeout, retry, delay, scheduling, debounce, backoff, or expiry behavior.
- **Risk:** Real sleeps make timing tests slow, flaky, and weak as oracles because they depend on scheduler latency and host timing instead of the intended timeout or delay contract.
- **Rule:** For timing-sensitive unit tests, prefer a deterministic paused or virtual clock when the active runtime or harness supports it; reserve real-time waits for integration tests or boundary checks that actually need real clock behavior.
- **Required reasoning:** Determine whether the test is exercising logical timeout or delay semantics versus OS or external timing behavior, whether the runtime or harness offers controllable clock advancement, whether the production code needs an injected clock boundary, and whether a real-time integration test is still required for external behavior.
- **Validation:** Unit tests for timeout, retry, delay, or expiry logic run without unnecessary real sleeps, complete deterministically at normal test speed, and keep any remaining real-time waits justified by an external timing dependency.
- **Exceptions:** Integration tests that intentionally exercise real sockets, real schedulers, or other external timing behavior may use real waits when that dependency is explicit; if the project runtime lacks a controllable clock, the test may use the smallest justified real-time wait or a local abstraction boundary instead.
- **Sources:** `RUST-TIME-002`; audit time/config/API-client section.

### RP-TIME-003 — Dynamic configuration is validated as a whole and swapped atomically

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes runtime-loaded or runtime-reloaded configuration or other authoritative runtime artifacts such as certificate or ruleset bundles, configuration parsing or validation, startup config assembly that may later become reloadable, or code that applies multiple config fields independently after reading an external source.
- **Risk:** Partial candidate application can leave the process in a mixed invalid state, silently accept an unusable configuration or artifact set, or overwrite the last known good state with a broken reload.
- **Rule:** When configuration or another authoritative runtime artifact set can change at runtime, validate the full candidate before use and atomically replace the active snapshot only after the whole candidate is known to be valid; otherwise keep the last known good state or make restart-only policy explicit.
- **Required reasoning:** Determine whether the touched configuration or artifact boundary is startup-only or reloadable, which external sources feed the candidate snapshot, what "whole config or artifact set" means for the boundary being changed, how validation covers cross-field or cross-file invariants, what happens on invalid reload, whether swap granularity is a single snapshot or another reviewed unit, and whether failure paths expose sensitive material that must stay within `CORE-018`.
- **Validation:** Reload or startup tests and review cover full-candidate validation, invalid-reload behavior, atomic swap boundaries, and last-known-good or restart-only policy for the touched reload path.
- **Exceptions:** Static startup-only configuration or other restart-only runtime artifacts do not need hot-reload machinery; explicit restart-only policy is acceptable when the project documents that policy and does not pretend to support partial live updates.
- **Sources:** `RUST-TIME-003`; related `CORE-018`; audit time/config/API-client section.

### RP-TIME-004 — Process-wide environment mutation stays in isolated setup code

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes `std::env::set_var`, `remove_var`, or equivalent process-environment mutation in config loading, startup/bootstrap code, test setup, or runtime request/task logic.
- **Risk:** Process-wide environment mutation is global mutable state; in concurrent programs it can race with unrelated readers, create non-deterministic tests or runtime behavior, and require explicit unsafe precondition handling on current Rust toolchains.
- **Rule:** Confine process-wide environment mutation to isolated setup or separately spawned process boundaries with explicit single-thread or platform reasoning; prefer a reviewed non-ambient configuration boundary over mutating shared process state during ordinary runtime logic or concurrent tests.
- **Required reasoning:** Determine whether the environment mutation is truly necessary, whether the code runs before any concurrent threads exist, whether the platform/toolchain safety contract permits the call, whether a reviewed non-ambient boundary would satisfy the same need, and whether test isolation depends on process-wide mutation.
- **Validation:** Code review and tests reject shared-runtime or concurrent-test environment mutation without explicit isolation reasoning; any remaining use documents the single-thread or process-isolation boundary and the applicable toolchain safety preconditions.
- **Exceptions:** Integration tests that launch isolated child processes, Windows-specific code paths whose safety contract is satisfied, or bootstrap code that runs before concurrent threads or ambient readers exist may use environment mutation when that boundary is explicit and reviewed.
- **Sources:** `RUST-TIME-004`; official `std::env::set_var` safety docs; Rust 2024 edition guide for newly unsafe functions; audit time/config/API-client section.

### RP-TIME-005 — File-watcher events are hints, not atomic config state

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes file-watcher-driven reload for config, certificates, rulesets, or other runtime artifacts, especially when events may arrive during partial writes, renames, or bursty editor/deployer update sequences.
- **Risk:** Watcher noise, duplicate events, or reads during partial writes can apply torn artifacts or trigger reload logic from incomplete state even when the steady-state config or artifact format is valid.
- **Rule:** Treat watcher events as hints to reread authoritative state and apply watcher-driven changes only through the validated atomic reload boundary defined by `RP-TIME-003`.
- **Required reasoning:** Determine what artifact is authoritative after an event, how the reread path avoids applying torn or incomplete state, whether restart-only policy is safer than live reload, and which rollback or last-known-good behavior applies when a watcher-triggered reread fails validation.
- **Validation:** Reload tests cover duplicate-event, bursty-event, partial-write, and invalid-artifact scenarios, and review confirms watcher callbacks do not treat raw events as already-valid new state.
- **Exceptions:** Polling or explicit manual reload paths that do not rely on watcher events do not activate this rule; restart-only configuration remains acceptable per `RP-TIME-003`.
- **Sources:** `RUST-TIME-006`; related `RP-TIME-003`; audit time/config/API-client section.

### RP-TIME-006 — API clients expose one clear deadline owner

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes a reusable API client, client middleware, layered request wrappers, streaming client, or timeout logic where multiple layers could each impose their own deadline, cancellation, or timeout policy.
- **Risk:** Missing external deadlines can hang requests or shutdown paths indefinitely, while blanket per-layer timeouts duplicate policy and create conflicting failure modes that are hard to reason about.
- **Rule:** Put timeout, cancellation, and deadline ownership at one explicit API-client boundary and document when lower-level futures intentionally rely on the caller-owned budget instead of imposing their own independent timeout.
- **Required reasoning:** Determine which layer owns the end-to-end request budget, whether connect/request/read/overall timeouts need separate classes, which lower-level operations are internal implementation details versus exposed client boundaries, how cancellation propagates through retries or streaming, and where `RP-IO-007` already covers direct dependency-call policy so this rule only owns the broader client contract.
- **Validation:** Tests or review cover hung-upstream and shutdown behavior, confirm that deadline classes are explicit at the chosen client boundary, and show that nested helpers do not add conflicting timeout layers without documented intent.
- **Exceptions:** Internal helper futures may omit their own timeout when the caller or client boundary owns the budget; a lower-level protective timeout is acceptable when it is intentionally narrower than the caller budget and its interaction with the outer deadline is documented.
- **Sources:** partial split of `RUST-TIME-001`; `RUST-TIME-005`; related `RP-IO-007`; audit time/config/API-client section.

### RP-TIME-007 — API client retries, pacing, and pagination preserve upstream contracts

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes automatic retries, backoff, `Retry-After` handling, pagination loops, streaming pull loops, cursor walking, or reusable client helpers that can replay or multiply upstream requests.
- **Risk:** Generic retry and pagination loops can duplicate side effects, ignore upstream pacing, hide unbounded work, or turn a client abstraction into an accidental load amplifier.
- **Rule:** Make API-client retryability, idempotency or replay-token requirements, upstream pacing signals such as `Retry-After`, and bounded pagination or streaming behavior explicit in the client contract instead of hiding them inside generic helper loops.
- **Required reasoning:** Determine which operations are safe to replay, whether mutation retries require idempotency keys or another replay contract, which failures are retryable, how backoff and `Retry-After` interact, how pagination or streaming terminates and stays bounded, and whether the rule belongs in the reusable client contract rather than only at one direct call site.
- **Validation:** Fault-injection or integration tests cover retryable versus terminal failures, pacing-signal handling, mutation-retry idempotency assumptions, and bounded pagination or streaming behavior for the touched client surface.
- **Exceptions:** Single-shot callers may choose an explicit no-retry policy; finite one-page lookups or bounded internal streams do not need a generic pagination helper when the boundary is obvious and review confirms that work and memory remain bounded.
- **Sources:** partial split of `RUST-TIME-001`; related `RP-IO-007`; audit time/config/API-client section.

The operations slice inside this section is separate from the time/config/client slice above. Load `RP-OPS-*` only when the story changes a deployed service, worker, telemetry pipeline, health probe, incident-evidence surface, or rollback contract. The minimum operations slice loads the touched owner rules from this pack: observability and rollback contract (`RP-OPS-001`), tracing-context policy for spawned service work (`RP-OPS-002`), bounded metric labels (`RP-OPS-003`), exporter backpressure and shutdown policy when telemetry exporters are touched (`RP-OPS-004`), incident evidence and build identity (`RP-OPS-005`), liveness/readiness/startup separation (`RP-OPS-006`), runtime-supported signal handling (`RP-OPS-007`), operator-visible saturation diagnostics for scale-sensitive services (`RP-OPS-008`), and hot-path diagnostic cost review (`RP-OPS-009`). Keep local prototypes, tests, one-shot CLIs, and library-only changes on the narrower time/config/client rules unless they introduce a real operator-facing deployment contract.

### RP-OPS-001 — Production services define observability and rollback as part of the service contract

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff changes a production service, worker, rollout or rollback path, telemetry surface, or operator-visible failure handling.
- **Risk:** A production change can become hard to diagnose, unsafe to roll back, or operationally unverifiable when observability and mitigation expectations are left implicit.
- **Rule:** When a story changes a production service or worker contract, define the minimum operator-visible observability surface and rollback or mitigation path together with the behavior change instead of treating them as optional follow-up work.
- **Required reasoning:** Determine whether the touched code really has a deployment or operator contract or is only a local prototype; which failures, degraded modes, saturation states, and rollout risks must be visible; what rollback, disablement, or containment path exists; and which output surfaces must stay within `CORE-018` redaction limits.
- **Validation:** Service integration or rollout checks plus ops review confirm the observable signals, degraded behavior, and rollback or mitigation path for the changed contract.
- **Exceptions:** See the 6.10 operations-slice caveat for local prototypes, tests, one-shot CLIs, and library-only changes with no deployment or operator contract; low-risk internal service changes may satisfy rollback planning with a documented disablement or containment path instead of a separate deployment mechanism.
- **Sources:** `RUST-OPS-001`; related `CORE-018`; audit operations section.

### RP-OPS-002 — Spawned service work has an explicit tracing-context policy

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes spawned or background work in a deployed service, worker, or telemetry pipeline where tracing context or operator-visible logs cross a request, queue, or detached-work boundary.
- **Risk:** Background or detached work can lose request causality, inherit the wrong parent context, or produce misleading traces when context propagation is accidental.
- **Rule:** For spawned or background service work, decide whether tracing context is preserved, transformed, created fresh, or intentionally detached; do not rely on implicit inheritance as the default contract.
- **Required reasoning:** Determine whether the work is part of a request, batch, queue message, cron-like schedule, or independent maintenance task; whether correlation IDs or parent spans should cross the boundary; whether detachment is intentional; and how context decisions interact with privacy limits and log retention.
- **Validation:** Observability review and targeted service tests confirm the intended parent or detached trace shape for the changed work path.
- **Exceptions:** Work that is deliberately independent of any triggering request may start a fresh root span or omit parent context when that choice is explicit and documented.
- **Sources:** `RUST-OPS-002`; audit operations section.

### RP-OPS-003 — Metric labels are bounded, normalized, and non-sensitive

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes metrics, label dimensions, cardinality-affecting tags, status breakdowns, or code that promotes raw values into metrics.
- **Risk:** Raw user IDs, paths, error strings, or other unbounded values can explode metric cardinality, overload telemetry systems, and leak sensitive information.
- **Rule:** Use bounded, normalized labels for metrics and keep raw unbounded or sensitive values out of metric dimensions.
- **Required reasoning:** Determine which dimensions are needed for actionability, whether each dimension is bounded, how raw values are normalized or bucketed, whether sensitive data or identifiers could appear, and whether richer detail belongs in logs or traces instead.
- **Validation:** Telemetry review checks label bounds, normalization, and redaction; targeted tests or fixture inspection confirm representative raw inputs do not become metric labels.
- **Exceptions:** Rich per-item diagnostic detail belongs in redacted logs or traces, not in metric labels; bounded enumerations and documented buckets are acceptable when they remain stable under expected production traffic.
- **Sources:** `RUST-OPS-003`; related `CORE-018`; audit operations section.

### RP-OPS-004 — Telemetry exporters define request-path backpressure and shutdown behavior

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes telemetry exporters, exporter buffers, asynchronous drain workers, flush-on-shutdown behavior, or service code whose request path can wait on telemetry.
- **Risk:** Exporters can block request paths, grow unbounded queues, or hang shutdown when buffer bounds, drop policy, and flush deadlines are implicit.
- **Rule:** Define whether telemetry may block request paths, what queue or buffer bounds apply, when events are dropped versus backpressured, and what shutdown flush deadline applies for the exporter path.
- **Required reasoning:** Determine whether request or worker paths may ever wait on telemetry, what loss is acceptable, how exporter queues are bounded, which shutdown path owns flush attempts, and how this exporter-specific policy complements rather than replaces the general lifecycle contract in `CORE-009`.
- **Validation:** Ops review plus shutdown or overload tests confirm bounded queue behavior, accepted loss or blocking policy, and exporter behavior during shutdown.
- **Exceptions:** Development-only telemetry sinks or local debugging setups can use simpler best-effort handling when they are outside the production service contract.
- **Sources:** `RUST-OPS-004`; related `CORE-009`; audit operations section.

### RP-OPS-005 — Incident evidence carries safe build identity and crash-diagnostic policy

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff changes release builds, build identity, crash reporters, panic or backtrace output, symbol or strip policy, incident artifact generation, or release-path path-remapping behavior.
- **Risk:** Crashes and incidents become unactionable if operators cannot map artifacts back to code and config, while careless build metadata or panic output can leak local paths or sensitive environment details.
- **Rule:** Define a safe build-identity and crash-diagnostic policy that lets operators map incidents to the right release while respecting symbol, strip, path-redaction, and sensitive-output boundaries.
- **Required reasoning:** Determine which release identifier, config or schema version, symbol policy, backtrace behavior, and path-redaction mechanism the service contract requires; whether crash reports or panic output are operator-visible; and which metadata would violate privacy or reproducibility constraints.
- **Validation:** Release-gate review and incident-evidence inspection confirm the chosen build identity, crash-output shape, and path-redaction or symbol policy for the affected artifact.
- **Exceptions:** Internal debug artifacts may intentionally retain richer local paths or symbols when that scope is explicit and not part of externally exposed release diagnostics.
- **Sources:** `RUST-OPS-005`; related `CORE-018`; audit operations section.

### RP-OPS-006 — Liveness, readiness, and startup checks stay separate

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes health endpoints, orchestration probes, startup warmup checks, dependency readiness logic, or degraded-mode admission control.
- **Risk:** One overloaded or over-coupled health endpoint can trigger restart storms or route traffic to instances that are alive but not ready.
- **Rule:** Separate liveness, readiness, and startup semantics: keep liveness focused on process or event-loop health, and let readiness or startup own dependency state, warmup, queue pressure, and degraded-mode admission.
- **Required reasoning:** Determine which conditions mean the process is merely alive versus ready to accept work; whether startup has a one-time warmup or migration window; which dependencies should affect readiness but not liveness; and how degraded mode or backpressure is surfaced without causing restart loops.
- **Validation:** Service integration tests and deployment review confirm that probe behavior matches rollout and failure expectations and does not turn dependency outages into liveness failures.
- **Exceptions:** Services without orchestration or probe endpoints do not activate this rule; a minimal worker may expose only the subset of probe semantics that actually exists, provided omitted probe classes are explicit.
- **Sources:** `RUST-OPS-006`; audit operations section.

### RP-OPS-007 — Services use runtime-supported signal handling or a minimal async-signal-safe handoff

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff adds or changes POSIX signal handling, graceful shutdown on `SIGINT` or `SIGTERM`, supervisor stop behavior, or low-level handlers for service processes.
- **Risk:** Hand-rolled signal handlers that take locks, allocate, or perform complex work can create deadlocks, undefined behavior, or non-portable shutdown paths.
- **Rule:** Prefer the runtime-supported signal API approved by the project together with channels, cancellation tokens, or broadcast-based shutdown coordination; if a low-level synchronous signal handler is unavoidable, keep it to the smallest async-signal-safe handoff such as an atomic flag update.
- **Required reasoning:** Determine whether the service can rely on a runtime-supported signal API, which signals are relevant on the supported platforms, how shutdown work is handed off to normal tasks or threads, whether any low-level handler body stays async-signal-safe, and how signal handling interacts with the lifecycle contract already owned by `CORE-009`.
- **Validation:** Shutdown-path review, handler-body review for async-signal safety, and service integration tests confirm that signal-triggered shutdown uses the intended coordination path.
- **Exceptions:** Non-service code and platforms without POSIX-style signals do not activate this rule; a dedicated low-level design may use a reviewed atomic handoff when runtime-supported signal wrappers are unavailable or inappropriate.
- **Sources:** `RUST-OPS-008`; related `CORE-009`; audit operations section.

### RP-OPS-008 — High-scale services expose operator-visible saturation diagnostics

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff changes a high-throughput async service, queue-driven worker fleet, backpressure-sensitive runtime path, or operator tooling for saturation and stuck-work diagnosis.
- **Risk:** Slow, saturated, or stuck services become guesswork when operators cannot inspect queue depth, worker health, blocked tasks, resource growth, or panic and task-failure signals.
- **Rule:** For scale-sensitive services, define which saturation and stuck-work signals operators can inspect for queue pressure, worker state, blocked tasks, file-descriptor or memory growth, and panic or task failures.
- **Required reasoning:** Determine whether the touched service is actually scale-sensitive, which saturation indicators are actionable, what resource-growth or runtime-health signals matter, how operators access them, and how diagnostics remain bounded and non-sensitive.
- **Validation:** Load-test diagnostics or targeted service checks confirm that the relevant saturation signals exist for the expected failure modes; service review or incident-runbook review verifies that operators can find and interpret them.
- **Exceptions:** Small internal services with no scale-sensitive operator contract do not need the full saturation surface; project-specific tools such as console integrations or dump endpoints remain optional techniques rather than universal defaults.
- **Sources:** `RUST-OPS-009`; related `CORE-018`; audit operations section.

### RP-OPS-009 — Hot-path diagnostic work is guarded when suppressed output would discard it

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes debug, trace, or diagnostic logging on an operator-facing service path that is already under a measured hot-path claim or explicit latency/throughput budget, especially when the log expression computes large strings, serializes complex state, or calls non-trivial helpers.
- **Risk:** Expensive diagnostic expressions can execute even when the relevant log level is disabled, adding hidden overhead to hot paths and confusing production performance analysis.
- **Rule:** When an operator-facing service path is already under a reviewed hot-path or resource-budget contract, guard expensive diagnostic computations behind explicit level-enablement or equivalent short-circuit checks when the logging stack would otherwise evaluate work that suppressed output discards; route broader measurement and optimization tradeoffs through `CORE-017`, `6.11`, and `REC-PERF-007`.
- **Required reasoning:** Determine whether the touched logging path is part of a deployed service contract, whether the diagnostic expression performs non-trivial work or allocation, whether the active logging or tracing API already avoids that work, and what `CORE-017` or `6.11` evidence makes this a materially hot path rather than a style-only cleanup.
- **Validation:** Code review plus `CORE-017` performance evidence confirm that disabled diagnostic paths avoid the heavy computation or allocation that motivated the change for the touched operator-facing path.
- **Exceptions:** Trivial primitive formatting outside hot loops does not need a manual guard; non-production diagnostic code that is not on a hot path does not activate this rule.
- **Sources:** `RUST-OPS-010`; related `CORE-017`, `REC-PERF-007`; audit operations section.

### 6.11 Performance, portability, no_std, WASM, and embedded

Owns evidence-first performance, portability and resource-budget rules, benchmark validity, target capability, allocation/layout/codegen tradeoffs, crate topology, `no_std`, WASM, embedded and SIMD concerns. It must cross-link to the owning correctness pack when an optimization affects safety, lifecycle, public API, error behavior, data compatibility, or trust-boundary semantics.

Pack activation is controlled by the router row in section `5`. `CORE-017` already owns the always-on requirement for an explicit target, baseline, and measured or contractually defined bottleneck; this pack activates when the story changes a measured or claimed hot path under that evidence contract, an explicit latency/throughput/memory/binary-size/compile-time/resource budget, benchmark validity, target capabilities, codegen/layout tuning, crate topology, custom allocators, `no_std`/embedded/WASM behavior, or another portability-sensitive resource contract. The minimum performance slice is: evidence-first performance contract and benchmark-validity review (`CORE-017`; exact microbenchmark optimizer-elimination mechanics route through `REC-PERF-002`), target capabilities (`RP-PERF-001`), SIMD fallback and dispatch (`RP-PERF-002`), allocator policy (`RP-PERF-003`), crate topology (`RP-PERF-004`), `no_std` panic/allocation/diagnostics policy (`RP-PERF-005`), WASM host contract (`RP-PERF-007`), and layout/codegen/contention tuning (`RP-PERF-008`); embedded interrupt and stack budgets (`RP-PERF-006`) stay touched-surface-specific. Keep exact benchmark commands, LLVM/MIR tools, `build-std` workflows, and concrete target-specific helper APIs in recipes rather than normative pack rules.

### RP-PERF-001 — Portability-sensitive code states target capabilities explicitly

- **Layer:** RISK_PACK
- **Importance:** COMMON
- **Trigger:** The diff adds or changes `no_std`/`alloc` support, target-specific `cfg`, alternate target triples, portability-sensitive dependencies, host-only assumptions about threads/atomics/filesystem/RNG, or a claim that the same code works across desktop, embedded, or WASM-like targets.
- **Risk:** Host-development assumptions can hide missing target capabilities, transitive `std` dependencies, unsupported collections, or runtime requirements until a non-host target fails to build or run.
- **Rule:** State the required target capabilities explicitly and validate them against the supported target matrix instead of assuming host `std` behavior generalizes to every target.
- **Required reasoning:** Determine which targets are actually in scope, whether `std`, `alloc`, atomics, filesystem, time, randomness, or blocking APIs are available there, whether a host build would mask a missing capability, and which parts of the code need cfg-gated isolation or alternate implementations.
- **Validation:** Cross-target compile or integration checks, target-matrix review, and dependency review confirm that the claimed target capabilities and `std`/`alloc` assumptions match the supported targets.
- **Exceptions:** Single-target desktop/server code without a portability claim does not activate this rule; an application may intentionally support only one reviewed target so long as that restriction is explicit.
- **Sources:** `RUST-PERF-004`; related `CORE-017`; audit performance/portability section.

### RP-PERF-002 — SIMD and `target_feature` paths keep safe fallback and dispatch

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes SIMD intrinsics, `#[target_feature]`, CPU-feature dispatch, vectorized hot loops, architecture-specific modules, or callback/function-pointer use around feature-gated accelerated code.
- **Risk:** Feature-specific code can be called from unsupported contexts, leak a misleading safe signature, or become the only implementation path on CPUs that lack the required feature set.
- **Rule:** Keep a reviewed baseline implementation and make accelerated paths callable only through a boundary that proves or checks the required target features; if that boundary relies on `unsafe`, route the soundness contract through `RP-UNSAFE-001`.
- **Required reasoning:** Determine which baseline path preserves correctness, how runtime or compile-time feature detection selects the accelerated path, whether any call boundary must be `unsafe` or private to preserve the feature contract, and whether inlining, callback use, or public exposure would blur the required feature proof.
- **Validation:** Baseline and accelerated paths are both exercised or reviewed against the target contract, and feature-dispatch review confirms that unsupported targets cannot reach the accelerated implementation accidentally.
- **Exceptions:** A build that intentionally targets one fixed reviewed CPU feature set may omit runtime dispatch when the deployment contract proves that requirement; the restriction must remain explicit rather than implicit in one helper call.
- **Sources:** `RUST-PERF-005`; related `CORE-017`; audit performance/portability section.

### RP-PERF-003 — Custom allocator changes are binary-level operational choices

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff changes the global allocator, adds allocator-specific dependencies or cfgs, or proposes allocator replacement as a performance fix for an application binary.
- **Risk:** Allocator swaps can change memory behavior, observability, deployment assumptions, or failure modes without improving the measured bottleneck, and can leak application policy into reusable libraries.
- **Rule:** Treat custom allocator selection as an application-level performance and operations decision backed by measured allocation evidence and explicit deployment acceptance.
- **Required reasoning:** Determine whether the change applies to a final binary rather than a reusable library, what measured allocation or fragmentation problem it addresses, how the allocator changes failure modes or tooling, and whether the deployment environment accepts that operational tradeoff.
- **Validation:** Allocation profiling, representative benchmarks, and release or deployment review confirm that the allocator change addresses the measured problem and fits the application contract.
- **Exceptions:** Libraries and target-agnostic shared crates should not change allocator policy just to chase hypothetical performance wins; an existing project-wide allocator policy can remain in force when the story does not alter it.
- **Sources:** `RUST-PERF-006`; related `CORE-017`; audit performance/portability section.

### RP-PERF-004 — Crate topology changes need an explicit boundary or measured workspace benefit

- **Layer:** RISK_PACK
- **Importance:** CONDITIONAL
- **Trigger:** The diff splits or merges crates primarily for compile-time, optimization, target/feature-separation, or other measured workspace-build/resource reasons, or otherwise treats crate topology as part of a performance or portability contract.
- **Risk:** Speculative crate splits add SemVer surface, dependency fan-out, CI cost, and release complexity without addressing a real public boundary or measured workspace bottleneck.
- **Rule:** In this pack, change crate topology only for explicit target/feature separation or a measured workspace build/resource benefit; route release, dependency-isolation, workspace-graph, publish-boundary, and public-surface policy through the owning Cargo or API pack.
- **Required reasoning:** Determine whether the new boundary is driven by target or feature separation, where the measured build or resource benefit comes from, whether module-level structure would satisfy the same need without new crate overhead, and whether any public/package/publish contract changes instead belong in `RP-API-009`, `RP-CARGO-002`, or `RP-CARGO-009`.
- **Validation:** Workspace architecture review plus build-timing, binary-size, or dependency-graph evidence confirm that the crate-topology change serves a measured workspace benefit or explicit target/feature contract rather than style preference; review any public/package/publish fallout in the owning Cargo or API pack.
- **Exceptions:** Small packaging moves that follow an already-approved workspace boundary may not need fresh timing evidence when they preserve the same boundary rationale; speculative "future reuse" alone is not enough.
- **Sources:** detailed topology portion of `RUST-PERF-010`; related `CORE-007`, `CORE-017`; audit performance/portability section.

### RP-PERF-005 — `no_std` binaries define panic, allocation, and diagnostics policy explicitly

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes a final binary with `#![no_std]` or another constrained runtime contract, target-specific `alloc` usage, custom panic handling, constrained-memory behavior, or target-runtime linkage assumptions.
- **Risk:** Assuming default panic, allocator, OOM, diagnostic, or runtime support on constrained targets can turn target-policy gaps into latent link or runtime failures.
- **Rule:** For `no_std` binaries, make panic strategy, allocation availability, OOM handling, diagnostics, and required runtime support explicit parts of the target contract.
- **Required reasoning:** Determine whether the artifact is a library or final binary, whether `alloc` is available and how allocation failure is handled, what panic and diagnostic behavior the target permits, which runtime or compiler-builtins support the final link requires, and route exact helper-API or toolchain-workflow choices through the relevant `no_std` recipes and their version assumptions.
- **Validation:** Target-aware build or link checks plus review of panic, allocation, and diagnostics policy confirm that the final artifact matches the intended constrained-target contract.
- **Exceptions:** Ordinary `std` targets and `no_std` libraries that are not being linked into a final constrained artifact in the current story do not activate the full binary-policy rule; those cases still need explicit target claims if portability is being promised.
- **Sources:** `RUST-PERF-011`, policy parts of `RUST-PERF-023`, policy parts of `RUST-PERF-025`; related `CORE-017`; audit performance/portability section.

### RP-PERF-006 — Embedded interrupt and stack budgets stay explicit

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes interrupt handlers, RTOS-task code, bare-metal loops, stack-constrained worker paths, or large by-value temporaries on embedded or otherwise stack-limited targets.
- **Risk:** Ordinary blocking/runtime code, logging, or large stack-formed temporaries can violate latency, safety, or stack-budget constraints even when the Rust types look harmless.
- **Rule:** Treat interrupt-safe behavior and stack-budget limits as explicit target constraints before adding blocking work, large temporaries, or heap-construction patterns to embedded or stack-constrained paths.
- **Required reasoning:** Determine which contexts are interrupt handlers versus ordinary tasks, what operations are target-approved there, how much stack budget exists, whether a large value is formed on the stack before moving to heap storage, and whether deferred work, static storage, or another reviewed target pattern is required.
- **Validation:** Embedded or target review, constrained-target tests where available, and stack-aware code inspection confirm that interrupt paths stay minimal and large values respect the target stack budget.
- **Exceptions:** Desktop/server targets without interrupt or constrained-stack concerns do not activate this rule; small values on reviewed targets do not need special handling when stack budget is not material.
- **Sources:** `RUST-PERF-012`, policy parts of `RUST-PERF-014`; related `CORE-017`; audit performance/portability section.

### RP-PERF-007 — WASM boundaries define the host contract explicitly

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes Rust/WASM artifacts, browser or Node bindings, WASI-like modules, JS Promise or callback interop, or assumptions about host randomness, time, storage, networking, blocking, or panic mapping.
- **Risk:** One host environment's behavior can be treated as a universal WASM default, hiding differences in cancellation, panic translation, capability availability, or blocking semantics.
- **Rule:** Define the host contract explicitly for Rust/WASM boundaries, including which host capabilities exist and how errors, cancellation, and blocking limitations map across the boundary.
- **Required reasoning:** Determine which host environments are actually supported, how Rust futures or panics map into host behavior, whether randomness, time, storage, and networking exist or differ across hosts, and which behavior belongs in the host contract rather than in Rust-only assumptions.
- **Validation:** Target-specific integration tests and host-contract review confirm that the changed boundary matches the supported host capabilities and error or cancellation semantics.
- **Exceptions:** WASM-like builds used only for one reviewed host may document that single-host contract instead of pretending to support every host environment.
- **Sources:** `RUST-PERF-013`; related `CORE-017`; audit performance/portability section.

### RP-PERF-008 — Layout, codegen, and contention tuning need target-specific evidence

- **Layer:** RISK_PACK
- **Importance:** ADVANCED
- **Trigger:** The diff adds or changes padding or alignment, false-sharing mitigation, layout-sensitive boxing, size assertions, codegen-oriented profile overrides, or performance claims about generic monomorphization and cache or copy behavior.
- **Risk:** Padding, boxing, layout assertions, or dependency-profile tuning can bloat memory, miss the real hot code location, or encode one target's codegen assumptions as universal architecture.
- **Rule:** Make layout, codegen, and contention tuning only from target-specific evidence that identifies where the hot code or contested memory actually lives and why the chosen structural change matches that bottleneck.
- **Required reasoning:** Determine whether the issue is code size, cache contention, copy cost, inline size, or layout stability; where the hot monomorphized code is instantiated; whether the target architecture or feature matrix changes the tradeoff; and whether a recipe-level technique or a simpler representation change would be enough.
- **Validation:** Codegen, layout, benchmark, or contention evidence plus target-aware review confirm that the chosen tuning addresses the measured or contractually bounded bottleneck without overgeneralizing to unrelated targets.
- **Exceptions:** Ordinary non-hot structs, enums, or dependency updates do not activate this rule; exact size assertions remain optional unless layout or resource budget is part of the contract and target variability has been reviewed.
- **Sources:** `RUST-PERF-003`, `RUST-PERF-008`; related `CORE-017`; audit performance/portability section.

