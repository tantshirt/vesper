// Story 4.1 · Calculator & live projection — pure projection math, validation, formatters, and
// consumer copy (no JSX/React/DOM), so the calculator is unit-testable and the no-crypto-vocabulary
// invariant is locked without a browser harness (mirrors the invest.helpers.ts + vitest pattern).
//
// Consumer surface rule (spine I6 / NFR3): NONE of CALC_COPY may contain crypto vocabulary
// (the shared `hasCryptoVocabulary` guard asserts this) — nor order/fee/funding-source terms;
// the one-time platform fee, funding source, and order preview are Story 4.2, out of scope here.

import { formatUsd } from "./invest.helpers";

// --- Projection constants (design contract DD-001 / screen 01.6). ---
// Appreciation slice of the net yield (1.4%) — the non-cash-distributed component of the base
// first-year figure. The remaining slice (targetNetYield − this) is the cash-distributed rent.
export const APPRECIATION_YIELD = 0.014;
// First-year net figure for the documented −12% value-stress scenario ($100 → −$0.80). The exact
// −12%→−0.8% derivation is unspecified upstream and logged as deferred work — isolated to this
// one constant + `firstYearDownside` so a later confirmation is a one-line swap.
export const DOWNSIDE_FIRST_YEAR_RATE = -0.008;
// The scenario label shown in copy (the value-stress magnitude), distinct from the rate above.
export const DOWNSIDE_VALUE_LABEL = "−12%";
// Amount slider bounds (whole dollars). The minimum enforced for the CTA is property.minInvestment,
// not SLIDER_MIN — these only bound the slider control's range.
export const SLIDER_MIN = 50;
export const SLIDER_MAX = 2000;
// Quick-set chips for common amounts.
export const QUICK_CHIPS = [50, 100, 250, 500] as const;

// Coerce any input to a finite number, else 0 — the shared finite guard for all math below.
// `+ 0` normalizes a computed `-0` back to `+0` so downstream signs read cleanly.
function finite(n: number): number {
  return Number.isFinite(n) ? n + 0 : 0;
}

// --- Projection math (all finite-guarded; non-finite → 0). ---

// Ownership basis is `amount / offeringSize` (B2 open decision — appraisal basis for the seed).
// Localized to this one function so swapping to a raise/share-count basis is a one-line change.
// 0 when offeringSize is non-positive or non-finite (no basis → no fabricated fraction). Clamped to
// [0, 1] — you can never own less than 0% or more than 100% of the offering, however large the input.
export function ownershipFraction(amount: number, offeringSize: number): number {
  const a = finite(amount);
  const size = finite(offeringSize);
  if (size <= 0) return 0;
  return finite(Math.max(0, Math.min(1, a / size)));
}

// Estimated monthly income = the cash-distributed rent slice ÷ 12 (only rent is distributed).
export function estMonthlyIncome(amount: number, targetNetYield: number): number {
  return finite(finite(amount) * (finite(targetNetYield) - APPRECIATION_YIELD)) / 12;
}

// Base first-year figure = amount × targetNetYield (read from the property, never hardcoded).
export function firstYearBase(amount: number, targetNetYield: number): number {
  return finite(finite(amount) * finite(targetNetYield));
}

// Downside first-year figure = amount × the documented −12%-scenario rate (negative).
export function firstYearDownside(amount: number): number {
  return finite(finite(amount) * DOWNSIDE_FIRST_YEAR_RATE);
}

// The cash-distributed rent slice of the base = amount × (targetNetYield − APPRECIATION_YIELD).
export function rentComponent(amount: number, targetNetYield: number): number {
  return finite(finite(amount) * (finite(targetNetYield) - APPRECIATION_YIELD));
}

// The appreciation slice of the base = amount × APPRECIATION_YIELD.
export function appreciationComponent(amount: number): number {
  return finite(finite(amount) * APPRECIATION_YIELD);
}

// --- Validation. ---
// The primary CTA gate: a finite amount at or above the property minimum ($50 seed).
export function isValidInvestAmount(amount: number, min: number): boolean {
  return Number.isFinite(amount) && amount >= min;
}

// --- Formatters (tabular-friendly; non-finite → 0). ---

// Currency with exactly two fraction digits (e.g. `$4.80`) — the money display for the calculator.
const CENTS_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function formatUsdCents(amount: number): string {
  return CENTS_FORMATTER.format(finite(amount));
}

// Signed money: prefix an explicit `+` (>= 0) or a real minus glyph `−` (< 0) on the ABSOLUTE
// cents value, so positives read `+$6.20` and the downside reads `−$0.80` (loss color applied in UI).
export function formatSignedUsd(amount: number): string {
  const value = finite(amount);
  const sign = value < 0 ? "−" : "+";
  return `${sign}${formatUsdCents(Math.abs(value))}`;
}

// Ownership percent at 4 decimals (e.g. `0.0081%`) — small fractions stay legible.
export function formatOwnershipPct(fraction: number): string {
  return `${(finite(fraction) * 100).toFixed(4)}%`;
}

// Yield as a one-decimal percent (e.g. `6.2%`) — the property's headline rate for the mini-context.
export function formatYieldPct(rate: number): string {
  return `${(finite(rate) * 100).toFixed(1)}%`;
}

// The minimum-amount hint, derived from the property's own `minInvestment` (never a hardcoded "$50"),
// so the threshold the CTA enforces and the number the user reads always come from one source.
export function formatMinHint(min: number): string {
  return `The minimum is ${formatUsd(min)}.`;
}

// --- Consumer copy. No crypto vocabulary; no order/fee/funding-source terms (Story 4.2). ---
export const CALC_COPY = {
  eyebrow: "Your investment",
  title: "How much would you like to invest?",
  amountLabel: "How much?",
  // Distinct accessible names for the two amount controls (they must not share a label).
  amountInputLabel: "Investment amount in dollars",
  sliderLabel: "Adjust investment amount",
  backLabel: "‹ Back to your balance",

  projectionHeading: "What you'd get",
  ownLabel: "You'd own",
  monthlyLabel: "Est. monthly income",
  firstYearLabel: "First year",

  baseToggle: "Base",
  downsideToggle: "Downside",

  itemizedNote: "rent · appreciation",
  rentLabel: "rent",
  appreciationLabel: "appreciation",

  // Clarifies that the label refers to a drop in the property's *value* (single-sourced from
  // DOWNSIDE_VALUE_LABEL), so the headline percentage isn't misread as the first-year dollar figure.
  downsideExplainer: `Downside models a ${DOWNSIDE_VALUE_LABEL} drop in the property's value. It's an illustrative first-year assumption — not a promise or a forecast.`,

  reviewCta: "Review rights & risks →",
  comingSoonNote: "The review step is coming soon — we'll pick up right here when it's ready.",
} as const;
