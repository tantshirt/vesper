// Story 2.3 · Trust Stack — pure formatting helpers (no JSX/React), so the edge-case
// logic is isolated and unit-testable. NEVER attribute a gate to an AI: the signer
// fallback is an honest "Signer pending", never a fabricated or automated name.

export type GateStatus = "pending" | "passed" | "failed";

// Structural gate number (not compliance copy) — zero-padded to 2 digits: 7 → "GATE 07".
export function gateNumberLabel(gateNo: number): string {
  return `GATE ${String(gateNo).padStart(2, "0")}`;
}

// Text-equivalent status (WCAG 2.2 AA — never color/glyph alone).
export function gateStatusLabel(status: GateStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Not passed";
    case "pending":
    default:
      return "In review";
  }
}

// Matches the existing inline date convention ("Jul 8"). Guards falsy values
// (undefined or 0) so no "Invalid Date" or misleading epoch date is ever shown.
export function formatSignedDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Only ever the human signer, or an honest fallback — never AI, never fabricated.
export function signerText(signedByHuman?: string): string {
  const name = signedByHuman?.trim();
  return name ? name : "Signer pending";
}
