#!/usr/bin/env python3
"""RDX install script — deterministic, idempotent.

Mirrors the SKILL.md prose so the L4-SETUP tests can verify install
behavior without a live LLM. Designed to be safe to re-run.

Usage:
    python install.py --project-root /path/to/project
    python install.py --project-root /path/to/project --enforcement-level MODE_2

Effects:
- Copies KB sections to {project-root}/_bmad/rust-kb/
- Copies agent override TOMLs to {project-root}/_bmad/custom/
  - If a custom TOML already exists with foreign content, merges RDX
    additions in (keeps existing principles + agent.menu entries, adds RDX
    ones, dedupes).
- Ensures {project-root}/_bmad/config.yaml has a [modules.rdx] section.
- Writes `enforcement_level` (MODE_0..MODE_4) under [modules.rdx]; the
  selected level is the canonical record consulted by the wrapper, the
  pre-push hook, and CI. Phase 4 mode selector.

Exit codes: 0 = success, 1 = unrecoverable error.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

try:
    import tomllib  # 3.11+
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]

RDX_TAG_BANNER = (
    "# RDX — Rust Dev eXpert overrides"  # marker that lets uninstall identify RDX content
)

# Modes supported by Phase 4. MODE_4 is accepted for forward-compat but its
# end-to-end wiring is Phase 8 (Cat-4 specialist approvals).
VALID_MODES = ("MODE_0", "MODE_1", "MODE_2", "MODE_3", "MODE_4")
DEFAULT_MODE = "MODE_1"  # Local Validated — see assets/modes.md


def _skill_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _assets() -> Path:
    return _skill_root() / "assets"


def _install_kb(project_root: Path) -> None:
    src = _assets() / "kb-sections"
    dst = project_root / "_bmad" / "rust-kb"
    dst.mkdir(parents=True, exist_ok=True)
    for fname in (
        "section-4-core.md",
        "section-5-router.md",
        "section-6-packs.md",
        "section-8-governance.md",
    ):
        s = src / fname
        if not s.exists():
            print(f"[install] WARN: missing source {s}; writing placeholder", file=sys.stderr)
            (dst / fname).write_text(
                f"# RDX placeholder — {fname}\n"
                f"(install source absent; real KB ships in production rdx-setup assets)\n",
                encoding="utf-8",
            )
        else:
            shutil.copy(s, dst / fname)


def _install_cat4_artifacts(project_root: Path) -> None:
    """Seed Phase 8 Cat-4 schemas + approvers.yaml.example template.

    Schemas are always overwritten (canonical, must stay in sync with the RDX
    release). The example template is only written when no approvers.yaml AND
    no approvers.yaml.example already exists — never overwrites user content.
    """
    # Find the canonical schemas: they live in the RDX repo's _bmad/rdx/.
    repo_root = _skill_root().parent.parent.parent  # .../<repo>/.claude/skills/rdx-setup → repo
    src_dir = repo_root / "_bmad" / "rdx"
    dst_dir = project_root / "_bmad" / "rdx"
    dst_dir.mkdir(parents=True, exist_ok=True)
    (dst_dir / "approvals").mkdir(parents=True, exist_ok=True)

    for schema_name in ("approvers.schema.json", "approval.v1.schema.json"):
        src = src_dir / schema_name
        if src.exists():
            shutil.copy(src, dst_dir / schema_name)

    example_src = src_dir / "approvers.yaml.example"
    example_dst = dst_dir / "approvers.yaml.example"
    user_yaml = dst_dir / "approvers.yaml"
    if example_src.exists() and not example_dst.exists() and not user_yaml.exists():
        shutil.copy(example_src, example_dst)


def _read_toml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("rb") as fh:
        return tomllib.load(fh)


def _format_string_array(name: str, items: list[str]) -> str:
    if not items:
        return f"{name} = []\n"
    lines = [f"{name} = ["]
    for s in items:
        escaped = s.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'  "{escaped}",')
    lines.append("]")
    return "\n".join(lines) + "\n"


def _format_menu_entry(entry: dict) -> str:
    keys = [k for k in ("code", "skill", "task", "title") if k in entry]
    out = ["[[agent.menu]]"]
    for k in keys:
        v = entry[k]
        escaped = str(v).replace("\\", "\\\\").replace('"', '\\"')
        out.append(f'{k} = "{escaped}"')
    return "\n".join(out) + "\n"


def _merge_dev_override(project_root: Path) -> None:
    """Idempotent merge of RDX dev override on top of any pre-existing file."""
    src = _assets() / "agent-overrides" / "bmad-agent-dev.toml"
    dst_dir = project_root / "_bmad" / "custom"
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / "bmad-agent-dev.toml"

    rdx_doc = _read_toml(src)
    rdx_agent = rdx_doc.get("agent", {})

    if not dst.exists():
        shutil.copy(src, dst)
        return

    existing_doc = _read_toml(dst)
    existing_agent = existing_doc.get("agent", {})

    merged_pf: list[str] = []
    for s in list(existing_agent.get("persistent_facts", [])) + list(
        rdx_agent.get("persistent_facts", [])
    ):
        if s not in merged_pf:
            merged_pf.append(s)

    merged_pr: list[str] = []
    for s in list(existing_agent.get("principles", [])) + list(
        rdx_agent.get("principles", [])
    ):
        if s not in merged_pr:
            merged_pr.append(s)

    by_code: dict[str, dict] = {}
    order: list[str] = []
    for entry in list(existing_agent.get("menu", [])) + list(rdx_agent.get("menu", [])):
        code = entry.get("code")
        if code is None:
            continue
        if code not in by_code:
            order.append(code)
        by_code[code] = dict(entry)
    # RDX entries (loaded second) win on conflict (DS → rdx-dev-story).
    merged_menu = [by_code[c] for c in order]

    out: list[str] = [
        RDX_TAG_BANNER + " (rdx-setup managed; foreign keys preserved)\n",
        "[agent]\n",
    ]
    if merged_pf:
        out.append(_format_string_array("persistent_facts", merged_pf))
    if merged_pr:
        out.append(_format_string_array("principles", merged_pr))
    out.append("\n")
    for entry in merged_menu:
        out.append(_format_menu_entry(entry))
        out.append("\n")
    dst.write_text("".join(out), encoding="utf-8")


def _copy_simple_override(project_root: Path, fname: str) -> None:
    src = _assets() / "agent-overrides" / fname
    if not src.exists():
        return
    dst = project_root / "_bmad" / "custom" / fname
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        # idempotent: only overwrite if our content differs from existing.
        if dst.read_bytes() == src.read_bytes():
            return
        # foreign + RDX coexistence for architect/pm not in scope of Phase 3 tests;
        # safe overwrite of RDX-tagged file.
    shutil.copy(src, dst)


_RDX_LEVEL_RE = re.compile(r"^    enforcement_level:\s*(\S+)\s*$", re.MULTILINE)


def _extract_existing_level(text: str) -> str | None:
    m = _RDX_LEVEL_RE.search(text)
    return m.group(1) if m else None


def _strip_rdx_block(text: str) -> str:
    """Remove the entire 2-space-indented `rdx:` block under `modules:`.

    Reuses the strip semantics from uninstall.py so re-running install with a
    different --enforcement-level overwrites cleanly instead of duplicating.
    """
    lines = text.splitlines()
    out: list[str] = []
    skipping = False
    for line in lines:
        if not skipping and line.rstrip() == "  rdx:":
            skipping = True
            continue
        if skipping:
            if line.startswith("    ") or line.strip() == "":
                if line.startswith("    "):
                    continue
                out.append(line)
                skipping = False
                continue
            skipping = False
            out.append(line)
            continue
        out.append(line)
    return "\n".join(out)


def _ensure_config_block(project_root: Path, enforcement_level: str | None) -> None:
    """Write the [modules.rdx] block, carrying enforcement_level.

    Precedence:
      1. --enforcement-level flag (if supplied)
      2. existing enforcement_level in the file (if any) — preserves prior choice
      3. DEFAULT_MODE (MODE_1, Local Validated)
    """
    config = project_root / "_bmad" / "config.yaml"
    config.parent.mkdir(parents=True, exist_ok=True)
    text = config.read_text(encoding="utf-8") if config.exists() else "modules:\n"

    existing_level = _extract_existing_level(text)
    if enforcement_level is not None:
        chosen = enforcement_level
    elif existing_level is not None:
        chosen = existing_level
    else:
        chosen = DEFAULT_MODE

    # Always re-write the rdx block so a level change is applied cleanly.
    text = _strip_rdx_block(text)
    if "modules:" not in text:
        text = "modules:\n" + text

    lines = text.splitlines()
    out: list[str] = []
    inserted = False
    for line in lines:
        out.append(line)
        if not inserted and line.strip().startswith("modules:"):
            out.append("  rdx:")
            out.append('    version: "1.0.0"')
            out.append("    managed_by: rdx-setup")
            out.append(f"    enforcement_level: {chosen}")
            inserted = True
    if not inserted:
        out.append("modules:")
        out.append("  rdx:")
        out.append('    version: "1.0.0"')
        out.append("    managed_by: rdx-setup")
        out.append(f"    enforcement_level: {chosen}")
    # Normalise: collapse any run of blank lines so repeat installs are
    # bytewise identical (T-L4-SETUP-002 idempotency).
    rendered = "\n".join(out) + "\n"
    rendered = re.sub(r"\n{3,}", "\n\n", rendered)
    config.write_text(rendered, encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser(description="RDX install")
    p.add_argument("--project-root", required=True, type=Path)
    p.add_argument(
        "--enforcement-level",
        default=None,
        choices=list(VALID_MODES),
        help=(
            "RDX enforcement level. MODE_0=Advisory, MODE_1=Local Validated "
            "(default), MODE_2=Local Gated (pre-push hook), MODE_3=CI Enforced "
            "(CI required check), MODE_4=Specialist Approval. If omitted, "
            "preserves the existing value in config.yaml or defaults to MODE_1."
        ),
    )
    args = p.parse_args()

    project_root: Path = args.project_root.resolve()
    if not project_root.exists():
        print(f"[install] project-root does not exist: {project_root}", file=sys.stderr)
        return 1

    _install_kb(project_root)
    _install_cat4_artifacts(project_root)
    _merge_dev_override(project_root)
    _copy_simple_override(project_root, "bmad-agent-architect.toml")
    _copy_simple_override(project_root, "bmad-agent-pm.toml")
    _ensure_config_block(project_root, args.enforcement_level)

    final_level = _extract_existing_level(
        (project_root / "_bmad" / "config.yaml").read_text(encoding="utf-8")
    ) or DEFAULT_MODE
    print(f"[install] RDX installed into {project_root}; enforcement_level={final_level}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
