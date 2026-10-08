import type { ReactNode } from "react";

// StatusChip — the operational status system for the admin surface.
// Every status pairs COLOR + ICON + LABEL (never color alone — the same rule as
// the consumer app's gain/loss money). Colors come only from the canonical
// semantic tokens (gain/loss/warning), the accent, muted, or champagne; the chip
// ground is the shared lavender --chip. See the admin design-system data-layer doc.

export type StatusKind =
  | "passed" // Passed / Signed — gate signed, KYC cleared, doc validated
  | "blocked" // Blocked / Failed / SoD-conflict — SoD block, cap breach, DvP fail, ineligible
  | "pending" // Pending / Needs-you — awaiting review, sponsor action needed
  | "onchain" // On-chain confirmed — mint/distribution reconciled with the chain
  | "draft" // Draft / Neutral — unstarted, informational
  | "complete"; // Complete (earned) — a gate FULLY signed / distribution pushed + reconciled

type StatusMeta = { className: string; icon: string; label: string; dot?: boolean };

// icon + default label + the class that carries the status color. `dot` renders the
// champagne dot (the rare earned moment) instead of a plain colored glyph.
const STATUS: Record<StatusKind, StatusMeta> = {
  passed: { className: "is-passed", icon: "✓", label: "Passed" },
  blocked: { className: "is-blocked", icon: "⊘", label: "Blocked" },
  pending: { className: "is-pending", icon: "◷", label: "Pending" },
  onchain: { className: "is-onchain", icon: "⛓", label: "On-chain confirmed" },
  draft: { className: "is-draft", icon: "○", label: "Draft" },
  complete: { className: "is-complete", icon: "★", label: "Complete", dot: true },
};

export function StatusChip({
  status,
  label,
  title,
}: {
  status: StatusKind;
  /** Override the default label (e.g. "Signed", "SoD conflict", "Reconciled"). */
  label?: ReactNode;
  title?: string;
}) {
  const meta = STATUS[status];
  return (
    <span className={`a-chip ${meta.className}`} title={title}>
      {meta.dot && <span className="a-chip-dot" aria-hidden />}
      <span className="a-chip-icon" aria-hidden>
        {meta.icon}
      </span>
      <span className="a-chip-label">{label ?? meta.label}</span>
    </span>
  );
}
