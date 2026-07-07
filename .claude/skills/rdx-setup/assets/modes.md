# RDX Operating Modes

The RDX `enforcement_level` controls how strongly RDX gates a story before it
reaches `main`. The selected level is recorded in
`{project-root}/_bmad/config.yaml` under `[modules.rdx].enforcement_level`
and is the single source of truth consulted by the wrapper, the pre-push
hook, and CI.

Five modes are defined. Phase 4 wires the first four end-to-end; MODE_4
(Specialist Approval) is accepted in the selector but its full enforcement
path lands in Phase 8 (Cat-4 sign-off).

| Mode | Label | What it actually does | Bypassable? | Where it runs |
|------|-------|-----------------------|-------------|---------------|
| MODE_0 | Advisory | Validator runs; verdicts are recorded; nothing blocks. Exit code always 0. | n/a (by design) | Local + CI (informational) |
| MODE_1 | Local Validated | Wrapper (rdx-dev-story) runs validator after the child skill and halts the workflow on FAIL. Soft gate — LLM-cooperative. | Yes (LLM can skip steps; this is a cooperative orchestrator, not a programmatic boundary) | Local, inside the agent session |
| MODE_2 | Local Gated | Pre-push git hook runs validator before push. Push is rejected on FAIL. | Yes — `git push --no-verify` documented bypass (recorded as 'hook bypassed' in evidence) | Developer machine, on push |
| MODE_3 | CI Enforced | GitHub Actions required check runs validator (sourced from target branch / pinned release). PR cannot merge without green. | No — required check + branch protection. This is the actual enforcement point. | CI runners |
| MODE_4 | Specialist Approval | Cat-4 rules (FFI, unsafe surface, public API) require CODEOWNERS approval pinned to `diff_digest`. Stale approvals auto-invalidate on diff change. | No — approval is pinned to the head commit's diff | CI + CODEOWNERS review |

## How to pick

Most teams should start at **MODE_1** (Local Validated). It's the default
selected by the installer when no `--enforcement-level` is supplied.
Reasoning:

- It exercises the validator on every story automatically through the
  wrapper, so the team builds the evidence trail from day one.
- It does NOT touch git hooks or CI, so adoption is reversible: uninstalling
  RDX leaves no infrastructure trace.
- The pre-push hook (MODE_2) and CI required check (MODE_3) are additive —
  you can upgrade later without reauthoring stories.

Pick **MODE_0** when you want to record verdicts but not act on them yet
(e.g., a baseline-collection phase before turning the gate on).

Pick **MODE_2** once the team has run MODE_1 for a sprint and trusts the
validator's verdict on local diffs.

Pick **MODE_3** when you're ready to add the required check to the GitHub
branch protection and accept that PRs cannot merge without a green
validator run.

## Honest framing (T-V5-ACC-06)

- MODE_0 and MODE_1 are NOT hard enforcement. They depend on the LLM
  honoring the SKILL.md prose, and a distracted or non-cooperative LLM
  can skip steps. The wrapper's value is UX + the happy-path evidence
  trail, not a programmatic boundary.
- MODE_2 is genuine local enforcement but documents a `--no-verify`
  bypass. A determined developer can still push.
- MODE_3 is the actual enforcement boundary for V5. Only the CI required
  check sits between a FAIL verdict and a merge.
- MODE_4 layers specialist approval on top of MODE_3 for changes that
  cannot be evaluated by a deterministic check alone.

The selector deliberately uses the verbs "Validated" (MODE_1), "Gated"
(MODE_2), and "Enforced" (MODE_3) to distinguish them. Mode 1 is
*validated, not enforced* — the wrapper validates; only the hook and CI
enforce.

## Resolver compatibility (Phase 4 deferred from Phase 3.3)

The wrapper, install, and uninstall scripts rely on the BMad resolver
respecting `_bmad/custom/*.toml` overrides as described in
`tests/bmad/_helpers/resolver_shim.py`. If the project's BMAD core is
older than the shim contract, `rdx-setup` prints a compatibility warning
during install. The minimum supported resolver behaviour is documented
inline in the shim.
