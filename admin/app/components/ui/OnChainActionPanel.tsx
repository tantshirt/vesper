"use client";

import type { ReactNode } from "react";

export type OnChainPhase =
  | "idle"
  | "submitting"
  | "awaiting_confirmation"
  | "unknown"
  | "partial"
  | "failed_safe"
  | "reconciled"
  | "intent"
  | "confirmed";

const PHASE_LABEL: Record<Exclude<OnChainPhase, "idle">, string> = {
  submitting: "Submitting to the provider",
  awaiting_confirmation: "Submitted; waiting for network confirmation",
  unknown: "Outcome unknown; reconciliation is required",
  partial: "Partially complete; unresolved items require review",
  failed_safe: "Stopped before a confirmed external effect",
  reconciled: "Complete; records match verified external evidence",
  intent: "Submitting to the provider",
  confirmed: "Submitted; waiting for records to update",
};

export function OnChainActionPanel({
  eyebrow = "External action",
  title,
  consequence,
  meta = [],
  finality = "Once submitted, this action may be irreversible",
  confirmLabel,
  onConfirm,
  onCancel,
  phase = "idle",
  disabled = false,
  details,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  consequence: ReactNode;
  meta?: { label: ReactNode; value: ReactNode }[];
  finality?: ReactNode;
  confirmLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  phase?: OnChainPhase;
  disabled?: boolean;
  details?: ReactNode;
}) {
  const terminal = phase === "unknown" || phase === "partial" || phase === "reconciled";

  return (
    <section className={`a-onchain phase-${phase}`} aria-label="External operation">
      <p className="a-onchain-eyebrow">{eyebrow}</p>
      <h3 className="a-onchain-title">{title}</h3>
      <p className="a-onchain-consequence">{consequence}</p>

      {meta.length > 0 && (
        <dl className="a-onchain-meta">
          {meta.map((item, index) => (
            <div className="a-onchain-meta-item" key={index}>
              <dt className="a-onchain-meta-k">{item.label}</dt>
              <dd className="a-onchain-meta-v">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="a-onchain-finality">{finality}</p>

      {phase !== "idle" && (
        <p className="a-onchain-status" role="status" aria-live="polite">
          <span className="a-onchain-dot" aria-hidden />
          {PHASE_LABEL[phase]}
        </p>
      )}

      {details && (
        <details className="a-technical-details">
          <summary>Technical details</summary>
          <div>{details}</div>
        </details>
      )}

      {!terminal && (onConfirm || onCancel) && (
        <div className="a-onchain-actions">
          {onConfirm && confirmLabel && (
            <button
              type="button"
              className="a-onchain-confirm"
              onClick={onConfirm}
              disabled={disabled || phase === "submitting" || phase === "intent" || phase === "awaiting_confirmation"}
            >
              {confirmLabel}
            </button>
          )}
          {onCancel && phase !== "awaiting_confirmation" && (
            <button type="button" className="a-onchain-cancel" onClick={onCancel} disabled={disabled}>
              Cancel
            </button>
          )}
        </div>
      )}
    </section>
  );
}
