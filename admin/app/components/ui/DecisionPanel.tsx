"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type DecisionFact = {
  label: string;
  value: ReactNode;
};

type DecisionPanelProps = {
  title: string;
  subject: string;
  consequence: string;
  accountableRole: string;
  nextAction: string;
  facts: DecisionFact[];
  rationaleLabel: string;
  rationaleRequired?: boolean;
  confirmLabel: string;
  tone?: "approve" | "block" | "neutral";
  onConfirm: (rationale: string) => Promise<void>;
  onCancel: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The decision could not be recorded. No completion was confirmed; review the case and try again.";
}

export function DecisionPanel({
  title,
  subject,
  consequence,
  accountableRole,
  nextAction,
  facts,
  rationaleLabel,
  rationaleRequired = false,
  confirmLabel,
  tone = "neutral",
  onConfirm,
  onCancel,
}: DecisionPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rationaleId = useId();
  const helpId = useId();
  const errorId = useId();
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  const submit = async () => {
    const note = rationale.trim();
    if (rationaleRequired && !note) {
      setError("Enter a rationale before recording this decision.");
      document.getElementById(rationaleId)?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onConfirm(note);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <section
      className={`a-decision is-${tone}`}
      aria-labelledby={`${rationaleId}-title`}
    >
      <header className="a-decision-head">
        <div>
          <p className="a-decision-eyebrow">Decision review</p>
          <h3 id={`${rationaleId}-title`} ref={headingRef} tabIndex={-1}>
            {title}
          </h3>
        </div>
        <button
          type="button"
          className="a-decision-close"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancel decision"
        >
          <X aria-hidden="true" weight="bold" />
        </button>
      </header>

      <dl className="a-decision-facts">
        <div>
          <dt>Subject</dt>
          <dd>{subject}</dd>
        </div>
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
        <div>
          <dt>Accountable reviewer</dt>
          <dd>{accountableRole}</dd>
        </div>
        <div>
          <dt>Proposed consequence</dt>
          <dd>{consequence}</dd>
        </div>
        <div>
          <dt>Next safe action</dt>
          <dd>{nextAction}</dd>
        </div>
      </dl>

      <label className="a-decision-label" htmlFor={rationaleId}>
        {rationaleLabel}{" "}
        <span>{rationaleRequired ? "Required" : "Optional"}</span>
      </label>
      <textarea
        id={rationaleId}
        className="a-decision-textarea"
        value={rationale}
        onChange={(event) => setRationale(event.target.value)}
        aria-describedby={`${helpId}${error ? ` ${errorId}` : ""}`}
        aria-invalid={error ? "true" : undefined}
        disabled={busy}
        rows={4}
      />
      <p id={helpId} className="a-decision-help">
        The audit record attributes this action to the signed-in reviewer.
        Cancel leaves the current workflow unchanged.
      </p>
      {error && (
        <p id={errorId} className="a-decision-error" role="alert">
          {error}
        </p>
      )}

      <div className="a-decision-actions">
        <button
          type="button"
          className={`a-decision-confirm is-${tone}`}
          onClick={submit}
          disabled={busy}
        >
          {busy ? "Recording…" : confirmLabel}
        </button>
        <button
          type="button"
          className="a-decision-cancel"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <span className="a-decision-live" aria-live="polite">
          {busy ? "Recording decision. Do not submit again." : ""}
        </span>
      </div>
    </section>
  );
}
