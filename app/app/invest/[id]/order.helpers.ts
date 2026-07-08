// Story 4.2 · Order preview & fee transparency — pure fee math + consumer copy (no JSX/React/DOM),
// so the order surface is unit-testable and the no-crypto-vocabulary invariant is locked without a
// browser harness (mirrors the calculator.helpers.ts + vitest pattern). Reuses the calculator's
// cents/percent formatters — no formatter duplication.
//
// Consumer surface rule (spine I6 / NFR3): NONE of ORDER_COPY (nor formatMgmtFeeNote's output) may
// contain crypto vocabulary (the shared `hasCryptoVocabulary` guard asserts this). The only charge
// on top of the investment is the one-time 0.9% platform fee; the annual management fee is already
// inside the quoted net yield and is NEVER a separate line item (no double-charging).

import { formatUsdCents, formatYieldPct } from "./calculator.helpers";

// The one-time platform fee rate (FR8): the ONLY charge on top of the investment. The visible
// "0.9%" label composes from `formatYieldPct(PLATFORM_FEE_RATE)` — never a hardcoded digit in JSX.
export const PLATFORM_FEE_RATE = 0.009;

// Coerce any input to a finite number, else 0 — the shared finite guard for the fee math below.
// `+ 0` normalizes a computed `-0` back to `+0` so downstream signs read cleanly.
function finite(n: number): number {
  return Number.isFinite(n) ? n + 0 : 0;
}

// Round to whole cents. All three displayed figures are built from cents-rounded parts so the rows
// always reconcile — investment + fee === total — even for a sub-cent typed amount like 50.555 (the
// display formatters round the same way, half-up for positives, so what's shown always adds up).
function roundCents(n: number): number {
  return Math.round(finite(n) * 100) / 100;
}

// The one-time platform fee = round(max(0, amount) × 0.9%) to cents. Finite-guarded and
// negative-clamped so a stray non-finite/negative amount yields a neutral $0.00 rather than a
// nonsensical negative fee; cents-rounded so the displayed fee is exactly the fee summed into total.
export function platformFee(amount: number): number {
  return finite(roundCents(Math.max(0, finite(amount)) * PLATFORM_FEE_RATE));
}

// Total charged today = round(max(0, amount)) to cents + the (already cents-rounded) platform fee, so
// the total equals the displayed investment plus the displayed fee to the penny (≈ amount × 1.009).
export function totalChargedToday(amount: number): number {
  return finite(roundCents(Math.max(0, finite(amount))) + platformFee(amount));
}

// The no-double-charge note: the annual management fee is already inside the quoted net yield and is
// never charged again. The yield derives from `property.targetNetYield` (never a hardcoded digit).
export function formatMgmtFeeNote(targetNetYield: number): string {
  return `The annual management fee is already included in the ${formatYieldPct(
    targetNetYield,
  )} net yield you see — you're never charged it on top.`;
}

// --- Consumer copy. No crypto vocabulary; no management-fee line item (it's inside the yield). ---
export const ORDER_COPY = {
  eyebrow: "Review your order",
  title: "Here's what you'd pay today",
  investmentLabel: "Your investment",
  platformFeeLabel: "One-time platform fee",
  totalLabel: "Total charged today",
  backLabel: "‹ Back to adjust your amount",
  continueCta: "Continue",
  comingSoonNote: "The next step is coming soon — we'll pick up right here when it's ready.",
} as const;
