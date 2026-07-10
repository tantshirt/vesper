// Story 4.5 · Confirmation ("You're an owner") — pure copy + formatters (no JSX/React/DOM), so the
// celebratory receipt renders from a single source and its no-crypto-vocabulary invariant is
// unit-testable without a browser harness (mirrors the rights.helpers.ts + vitest pattern).
//
// Consumer surface rule (spine I6 / NFR3): NONE of CONFIRMATION_COPY nor any value this module
// produces may contain crypto vocabulary (the shared `hasCryptoVocabulary` guard asserts this). The
// confirmation reference is a consumer-safe string derived from the order id — the raw on-chain DvP
// receipt (`dvpTxSig`) and crypto terms live ONLY in the pull-only proof view, never here.

// --- Consumer copy. Crypto-clean; the celebratory owner receipt (FR11): exact ownership %, the
// first-distribution date, a confirmation reference, plus low-weight onward links. ---
export const CONFIRMATION_COPY = {
  eyebrow: "You're an owner",
  title: "Welcome to the building",
  ownedLabel: "You now own",
  distributionLabel: "First income date",
  distributionFallback: "Announced soon",
  referenceLabel: "Confirmation reference",
  portfolioCta: "View your portfolio",
  proofLinkLabel: "See the record behind this purchase",
  // Terminal holding line for the rare frame where the purchase has settled but the property record
  // is not yet in hand — keeps a settled buyer on a confirmation-flavored screen, never the funding form.
  finalizingNote: "Finalizing your confirmation…",
} as const;

// Format a YYYY-MM-DD offering date for the confirmation. Parsed as UTC (via Date.UTC) so a date-only
// string never drifts across a timezone boundary — e.g. "2026-08-31" is always August 31, never the
// 30th in a negative-offset zone. Returns null on missing/malformed/overflow input so the UI can show
// an honest fallback line rather than "Invalid Date". Pure, no DOM.
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDistributionDate(iso?: string): string | null {
  if (typeof iso !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject overflow (e.g. "2026-02-31" rolling into March): the round-trip must match the input.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return DATE_FORMATTER.format(date);
}

// Derive a deterministic, consumer-safe confirmation reference from the order id (FR11's "receipt
// reference"). Never exposes the raw on-chain signature. The last 8 chars keep it short and stable;
// an empty/whitespace id degrades to a safe fallback rather than an empty "VSP-". No throw.
export function formatConfirmationRef(orderId: string): string {
  const clean = typeof orderId === "string" ? orderId.trim() : "";
  if (clean.length === 0) return "VSP-PENDING";
  return "VSP-" + clean.slice(-8).toUpperCase();
}
