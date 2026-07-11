"use client";

import type { ReactNode } from "react";

// OnChainActionPanel — the SHELL for an irreversible on-chain action (mint / freeze /
// thaw / distribute). Before any confirm it states, plainly and together:
//   • consequence — exactly what this does, in named terms
//   • cost — network / fee cost
//   • finality — that it is irreversible and permanent on Solana
// The midnight/dusk framing signals "this touches the chain." It also surfaces the
// action's lifecycle (optimistic-intent → chain-confirm → reconciled) so state is
// never ambiguous. The confirm handler here is a PLACEHOLDER — the real step-up-auth
// and on-chain wiring land in a later story.

export type OnChainPhase = "idle" | "intent" | "confirmed" | "reconciled";

const PHASE_LABEL: Record<Exclude<OnChainPhase, "idle">, string> = {
  intent: "Optimistic intent — awaiting the chain",
  confirmed: "Confirmed on-chain",
  reconciled: "Reconciled with Convex",
};

export function OnChainActionPanel({
  eyebrow = "On-chain action",
  title,
  consequence,
  meta = [],
  finality = "Irreversible · permanent on Solana",
  confirmLabel,
  onConfirm,
  onCancel,
  phase = "idle",
  disabled = false,
}: {
  eyebrow?: ReactNode;
  /** Named, consequence-stated title, e.g. "Mint The Monroe (1,000,000 units)". */
  title: ReactNode;
  consequence: ReactNode;
  /** Exact values shown before confirm — always include cost. */
  meta?: { label: ReactNode; value: ReactNode }[];
  finality?: ReactNode;
  confirmLabel: string;
  /** Placeholder handler — real step-up / on-chain wiring is a later story. */
  onConfirm?: () => void;
  onCancel?: () => void;
  phase?: OnChainPhase;
  disabled?: boolean;
}) {
  return (
    <section className="a-onchain" aria-label="On-chain action">
      <p className="a-onchain-eyebrow">
        <span aria-hidden>⛓</span>
        {eyebrow}
      </p>
      <h3 className="a-onchain-title">{title}</h3>
      <p className="a-onchain-consequence">{consequence}</p>

      {meta.length > 0 && (
        <div className="a-onchain-meta">
          {meta.map((m, i) => (
            <div className="a-onchain-meta-item" key={i}>
              <span className="a-onchain-meta-k">{m.label}</span>
              <span className="a-onchain-meta-v">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      <span className="a-onchain-finality">
        <span aria-hidden>⚠</span>
        {finality}
      </span>

      {phase !== "idle" && (
        <span className={`a-onchain-status${phase === "confirmed" || phase === "reconciled" ? " is-confirmed" : ""}`}>
          <span className="a-onchain-dot" aria-hidden />
          {PHASE_LABEL[phase]}
        </span>
      )}

      <div className="a-onchain-actions">
        <button
          type="button"
          className="a-onchain-confirm"
          onClick={onConfirm}
          disabled={disabled || phase === "intent"}
        >
          {confirmLabel}
        </button>
        {onCancel && (
          <button type="button" className="a-onchain-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
