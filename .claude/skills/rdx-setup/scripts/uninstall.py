#!/usr/bin/env python3
"""RDX uninstall script — removes RDX artifacts; preserves foreign user
customizations.

Usage:
    python uninstall.py --project-root /path/to/project

Effects:
- Removes {project-root}/_bmad/rust-kb/section-{4,5,6,8}-*.md (RDX KB).
- Rewrites {project-root}/_bmad/custom/bmad-agent-dev.toml stripping the
  RDX-tagged principles, RDX persistent_facts entries (file: paths pointing
  to _bmad/rust-kb/...), and the RDX-owned [[agent.menu]] entry where
  skill == "rdx-dev-story". Foreign menu entries / principles / facts
  remain intact. If no foreign content survives, the file is removed.
- Removes {project-root}/_bmad/custom/bmad-agent-{architect,pm}.toml (these
  are RDX-only — they contain no foreign user content by design).
- Removes the [modules.rdx] block from {project-root}/_bmad/config.yaml.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import tomllib  # 3.11+
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]

RDX_KB_FILES = (
    "section-4-core.md",
    "section-5-router.md",
    "section-6-packs.md",
    "section-8-governance.md",
)

# Substrings that mark a principle/fact as RDX-owned (added by install.py
# from the RDX override template).
RDX_PRINCIPLE_MARKERS = (
    "CORE-001 through CORE-018",
    "Risk Router in section-5-router.md",
    "Conditional pack rules take precedence",
    "Never skip the router check",
)
RDX_FACT_MARKERS = (
    "_bmad/rust-kb/section-4-core.md",
    "_bmad/rust-kb/section-5-router.md",
)


def _format_string_array(name: str, items: list[str]) -> str:
    if not items:
        return ""
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


def _strip_rdx_from_dev(project_root: Path) -> None:
    path = project_root / "_bmad" / "custom" / "bmad-agent-dev.toml"
    if not path.exists():
        return
    with path.open("rb") as fh:
        doc = tomllib.load(fh)
    agent = doc.get("agent", {})

    pf = [
        s
        for s in agent.get("persistent_facts", [])
        if not any(m in s for m in RDX_FACT_MARKERS)
    ]
    pr = [
        s
        for s in agent.get("principles", [])
        if not any(m in s for m in RDX_PRINCIPLE_MARKERS)
    ]
    menu = [
        e
        for e in agent.get("menu", [])
        if e.get("skill") != "rdx-dev-story"
    ]

    # If nothing foreign survives, remove the file entirely.
    if not pf and not pr and not menu:
        path.unlink()
        return

    chunks: list[str] = ["# bmad-agent-dev override (RDX removed)\n", "[agent]\n"]
    if pf:
        chunks.append(_format_string_array("persistent_facts", pf))
    if pr:
        chunks.append(_format_string_array("principles", pr))
    if menu:
        chunks.append("\n")
        for entry in menu:
            chunks.append(_format_menu_entry(entry))
            chunks.append("\n")
    path.write_text("".join(chunks), encoding="utf-8")


def _remove_rdx_kb(project_root: Path) -> None:
    kb_dir = project_root / "_bmad" / "rust-kb"
    if not kb_dir.exists():
        return
    for fname in RDX_KB_FILES:
        f = kb_dir / fname
        if f.exists():
            f.unlink()
    # Remove directory if empty.
    if not any(kb_dir.iterdir()):
        kb_dir.rmdir()


def _remove_rdx_only_overrides(project_root: Path) -> None:
    for fname in ("bmad-agent-architect.toml", "bmad-agent-pm.toml"):
        f = project_root / "_bmad" / "custom" / fname
        if f.exists():
            f.unlink()


_RDX_BLOCK_RE = re.compile(
    r"^  rdx:.*?(?=^[A-Za-z_]|^  [A-Za-z_]|\Z)",
    re.MULTILINE | re.DOTALL,
)


def _strip_rdx_config(project_root: Path) -> None:
    config = project_root / "_bmad" / "config.yaml"
    if not config.exists():
        return
    text = config.read_text(encoding="utf-8")
    # Remove the rdx block under modules.
    lines = text.splitlines()
    out: list[str] = []
    skipping = False
    for line in lines:
        stripped = line.rstrip()
        if not skipping and stripped == "  rdx:":
            skipping = True
            continue
        if skipping:
            # Continue skipping indented child lines (4+ spaces).
            if line.startswith("    ") or line.strip() == "":
                # Empty line inside block: skip.
                if line.startswith("    "):
                    continue
                # Truly blank line ends nothing structural; pass through.
                out.append(line)
                skipping = False
                continue
            # Non-indented or 2-space line means new top-level/sibling block.
            skipping = False
            out.append(line)
            continue
        out.append(line)
    config.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser(description="RDX uninstall")
    p.add_argument("--project-root", required=True, type=Path)
    args = p.parse_args()
    project_root: Path = args.project_root.resolve()
    if not project_root.exists():
        print(f"[uninstall] project-root does not exist: {project_root}", file=sys.stderr)
        return 1

    _remove_rdx_kb(project_root)
    _strip_rdx_from_dev(project_root)
    _remove_rdx_only_overrides(project_root)
    _strip_rdx_config(project_root)

    print(f"[uninstall] RDX removed from {project_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
