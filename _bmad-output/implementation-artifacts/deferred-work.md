# Deferred Work Ledger

Tracks intentionally out-of-scope follow-ups surfaced during story implementation.

| ID | Origin story | Item | Rationale | Status |
|----|-------------|------|-----------|--------|
| DW-1 | 1.2 (Design system tokens as code) | Refactor the existing hardcoded radius/padding literals in `app/app/globals.css` (e.g. `border-radius: 18px/20px/14px/13px/99px`, ad-hoc paddings) to consume the new `--radius-*` / `--space-*` scale tokens. | Story 1.2 adds the scale tokens but per its Design Notes the mechanical refactor of existing screen literals to those tokens is out of scope, to keep the 2.1/2.2 screens visually unchanged. | Open |

## Review deferrals (bmad-dev-auto step-04)

- source_spec: `spec-1-2-design-system-tokens.md`
  summary: In dark mode the accent flips to light lavender `--accent #9B98EA`, but `.cta`, `.chip.on`, and `.avatar` still paint white text/fg on it (~2.2:1), below WCAG 2.2 AA (NFR2).
  evidence: The dark `--accent` value and the white-on-accent component rules predate this story (shipped in E1.1/E2.1); E1.2 only makes the state more reachable by adding the forced `data-theme="dark"` override. A fix requires re-deciding a brand token (darker dark-mode accent or dark text on the accent), which is a product/brand decision out of this story's scope.
