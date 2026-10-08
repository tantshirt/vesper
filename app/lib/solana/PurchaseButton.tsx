"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { usePurchase } from "@/lib/solana/usePurchase";

const STATUS_LABEL: Record<string, string> = {
  idle: "",
  building: "Preparing your order...",
  signing: "Waiting for your authorization...",
  submitted: "Submitted. Payment may be processing.",
  checking: "Checking the submitted payment...",
  reconciling: "Payment confirmed. Ownership records are updating.",
  complete: "Purchase complete.",
  failed_safe: "No payment was submitted.",
  outcome_unknown: "Payment may have completed. Check the saved reference before taking action.",
};

export function PurchaseButton({ operationId }: { operationId: Id<"orders"> }) {
  const { purchase, checkStatus, status, signature, error } = usePurchase();
  const busy = ["building", "signing", "submitted", "checking"].includes(status);
  const submitted = Boolean(signature) || ["submitted", "checking", "reconciling", "complete", "outcome_unknown"].includes(status);

  return (
    <div aria-live="polite">
      {!submitted && (
        <button type="button" disabled={busy} onClick={() => void purchase(operationId)}>
          {busy ? "Working..." : "Authorize purchase"}
        </button>
      )}
      {status === "outcome_unknown" && signature && (
        <button type="button" disabled={busy} onClick={() => void checkStatus(operationId, signature)}>
          Check status
        </button>
      )}
      {status !== "idle" && <p role="status">{STATUS_LABEL[status] ?? status}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
