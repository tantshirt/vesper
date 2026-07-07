---
name: rdx-setup
description: Sets up the Rust Dev eXpert (RDX) module. Injects Rust engineering expertise into Developer (Amelia), Architect (Winston), and PM (John) agents via layered KB rules. Use when the user requests to 'install RDX', 'setup Rust module', 'configure Rust experts', or 'enable rdx'.
---

# RDX — Rust Dev eXpert Setup

## Overview

Installs the Rust Dev eXpert module into the current project. This module does not create new agents — it layers Rust engineering discipline on top of three existing BMad agents by injecting KB rules through the BMad team-override mechanism.

**What gets installed:**

| File | Purpose |
|------|---------|
| `_bmad/rust-kb/section-4-core.md` | 18 Always-on Core rules (CORE-001..018) — Amelia + Winston load always |
| `_bmad/rust-kb/section-5-router.md` | Risk Router table — Amelia consults before every story |
| `_bmad/rust-kb/section-6-packs.md` | 12 Conditional Risk Packs — Amelia loads the matching pack on trigger |
| `_bmad/rust-kb/section-8-governance.md` | Governance rules — Winston + John load always |
| `_bmad/custom/bmad-agent-dev.toml` | Amelia: persistent KB facts + Risk Router principles |
| `_bmad/custom/bmad-agent-architect.toml` | Winston: boundary design + contract principles |
| `_bmad/custom/bmad-agent-pm.toml` | John: governance + behavior grading principles |

## Conventions

- Bare paths resolve from the skill root (`{skill-root}`).
- `{project-root}` resolves to the project working directory.
- `{skill-root}` resolves to this skill's installed directory.

## On Activation

If args include `--headless` or `-H`, skip all interactive prompts and use defaults.

### Step 0: Module registration check

Check if `{project-root}/_bmad/config.yaml` contains a `[modules.rdx]` section.

- **Section absent** → this is a first-time install. Load `./assets/module-setup.md` and complete module registration (writes `[modules.rdx]` to `config.yaml` and registers capabilities in `module-help.csv`) before proceeding to Step 1.
- **Args include `setup`, `configure`, or `install`** → always reload registration (reconfiguration). Load `./assets/module-setup.md` regardless of current state.
- **Section present and no reconfigure arg** → skip registration and proceed directly to Step 1.

### Step 0.5: Pick an enforcement level (Phase 4 mode selector)

During first-time registration (or any reconfigure), present the user with the
five RDX modes and ask which one this project should run at. The full mode
reference is at `./assets/modes.md` — load it to answer follow-up questions,
but the short summary the user picks from is:

| Mode | Label | One-liner |
|------|-------|-----------|
| MODE_0 | Advisory | Record verdicts, never block |
| MODE_1 | Local Validated | **Default.** Wrapper soft-gate inside the agent |
| MODE_2 | Local Gated | Pre-push hook (bypassable with `--no-verify`) |
| MODE_3 | CI Enforced | CI required check (the actual enforcement point) |
| MODE_4 | Specialist Approval | Cat-4 sign-off (Phase 8 — accepted but not yet wired end-to-end) |

Default: `MODE_1` (Local Validated). The user's choice is passed to
`install.py` via `--enforcement-level MODE_X` and is recorded in
`{project-root}/_bmad/config.yaml` under `[modules.rdx].enforcement_level`.

Modes 0 and 1 are NOT hard enforcement — they depend on the LLM honoring
the SKILL.md prose. Real enforcement starts at Mode 2 (pre-push hook) and
becomes tamper-resistant at Mode 3 (CI required check). Mention this when
the user asks "which one should I pick?"; do NOT call Mode 1 "Enforced".

### Step 1: Resolve project root

Determine the actual filesystem path of `{project-root}`. This is the project working directory where `_bmad/` lives (or will live). All subsequent paths are relative to this resolved root.

### Step 2: Check install status

Check if `{project-root}/_bmad/rust-kb/section-4-core.md` exists.

- **Exists** → this is an **update** — inform the user and proceed; existing files will be overwritten with the latest versions from this skill's assets.
- **Does not exist** → this is a **fresh install** — inform the user.

### Step 3: Install KB section files

Create the directory `{project-root}/_bmad/rust-kb/` if it does not exist.

Copy these four files from `{skill-root}/assets/kb-sections/` to `{project-root}/_bmad/rust-kb/`:

- `section-4-core.md` — Always-on Core (CORE-001..018) + KB meta-model (sections 1-3)
- `section-5-router.md` — Risk Router table
- `section-6-packs.md` — All 12 Conditional Risk Packs (single file, ~1400 lines)
- `section-8-governance.md` — Builder/evaluator governance rules

Use the `cp` command (not `cat`) to copy each file. Do not read the files into context.

### Step 4: Install agent override TOMLs

Create the directory `{project-root}/_bmad/custom/` if it does not exist.

For each of the three agent override files in `{skill-root}/assets/agent-overrides/`:

```
bmad-agent-dev.toml
bmad-agent-architect.toml
bmad-agent-pm.toml
```

When running the deterministic install script directly, pass the user's
selected mode through so the `enforcement_level` is recorded in the same
pass:

```bash
python3 {skill-root}/scripts/install.py \
  --project-root {project-root} \
  --enforcement-level MODE_1
```

Omitting `--enforcement-level` preserves any previously selected level (or
defaults to `MODE_1` for fresh installs). See `./assets/modes.md` for the
full label table and migration guidance.

**For each file, check if the target already exists at `{project-root}/_bmad/custom/{filename}`:**

#### Case A — Target does not exist

Copy the file directly:

```bash
cp {skill-root}/assets/agent-overrides/{filename} {project-root}/_bmad/custom/{filename}
```

#### Case B — Target already exists

Read both files. Check if the target already contains a `# RDX` comment or any of the `rust-kb` paths in `persistent_facts`.

- **RDX entries already present** → skip (already installed), report to user.
- **RDX entries not present** → merge: append the `persistent_facts` array entries and `principles` array entries from the RDX override into the existing file, preserving all existing content. The `[agent]` header must appear only once.

When merging arrays in TOML, add the new entries to the existing array. Example: if the existing file has:

```toml
[agent]
persistent_facts = ["file:{project-root}/**/project-context.md"]
principles = ["Some existing principle."]
```

After merge it should look like:

```toml
[agent]
persistent_facts = [
  "file:{project-root}/**/project-context.md",
  "file:{project-root}/_bmad/rust-kb/section-4-core.md",   # added by RDX
  "file:{project-root}/_bmad/rust-kb/section-5-router.md", # added by RDX
]
principles = [
  "Some existing principle.",
  "You are a strict Rust implementation expert...",          # added by RDX
  ...
]
```

Add a `# added by RDX` comment after each new entry for traceability.

### Step 5: Register capabilities in module-help.csv

Run the help CSV merge script to register RDX capabilities in the project help system (idempotent — safe to re-run):

```bash
python3 {skill-root}/scripts/merge-help-csv.py \
  --target "{project-root}/_bmad/module-help.csv" \
  --source "{skill-root}/assets/module-help.csv" \
  --module-code rdx
```

If the script exits non-zero, surface the error and stop. Missing `module-help.csv` is not an error — the script creates it.

### Step 6: Confirm and display greeting

Report the result:

- List each file copied/merged/skipped with its status
- State whether this was a fresh install or update
- Display the `module_greeting` from `./assets/module.yaml`
- Remind the user: **agents must be restarted** (re-invoked) for the new `persistent_facts` to take effect in the current session.
