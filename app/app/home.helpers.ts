// Story 5.1 · Home ("the payout is the hero") — pure copy + formatters + sparkline geometry (no
// JSX/React/DOM), so the hero-state decision, the signed money/percent formatting, and the
// no-crypto-vocabulary invariant are all unit-testable without a browser harness (mirrors the
// invest.helpers.ts + confirmation.helpers.ts + vitest pattern).
//
// Consumer surface rule (spine I6 / NFR3): NONE of HOME_COPY nor any value this module produces may
// contain crypto vocabulary (the shared `hasCryptoVocabulary` guard asserts this). Home never surfaces
// the raw distribution txSig or any wallet/token/on-chain term. Money uses tabular numerals (the CSS
// class) and the existing formatters; gains/losses always carry an explicit sign.

import { formatUsd } from "./invest/[id]/invest.helpers";
import { formatDistributionDate } from "./invest/[id]/confirmation.helpers";

// The reactive Home model as returned by `api.home.summary` (a superset is fine). `null` = the query
// resolved to no caller (unauthenticated / unprovisioned); `undefined` (loading) is handled in the view.
export interface HomeSummary {
  hasHoldings: boolean;
  portfolioValue: number;
  incomeToDate: number;
  allTimeReturn: number;
  allTimeReturnPct: number;
  freshDistribution: { amount: number } | null;
  nextDistributionDate: string | null;
  balanceSeries: number[];
}

// Which Home surface an authenticated, provisioned owner sees:
//   • "fresh" — a distribution landed inside the freshness window → dusk "Rent just landed" hero.
//   • "next"  — holdings exist but nothing fresh → balance card + the next-distribution line.
//   • "empty" — provisioned but no holdings yet → the calm start state.
export type HomeHeroState = "fresh" | "next" | "empty";

export function homeHeroState(summary: HomeSummary): HomeHeroState {
  if (summary.freshDistribution !== null) return "fresh";
  if (summary.hasHoldings) return "next";
  return "empty";
}

// Signed whole-dollar money for a gain/loss figure. Reuses `formatUsd` (tabular, no cents). The sign is
// keyed off the ROUNDED dollars, not the raw input, so a sub-dollar amount that rounds to $0 renders a
// plain "$0" (never a signless-magnitude "+$0"); zero and non-finite likewise render "$0".
export function formatSignedUsd(amount: number): string {
  if (!Number.isFinite(amount)) return formatUsd(0);
  const rounded = Math.round(amount);
  if (rounded > 0) return "+" + formatUsd(rounded);
  if (rounded < 0) return formatUsd(rounded);
  return formatUsd(0);
}

// Signed percent for the all-time return. Input is a FRACTION (income / value, e.g. 0.062 → "+6.2%").
// One decimal; the sign is keyed off the ROUNDED magnitude so a fraction that rounds to "0.0" renders a
// plain "0.0%" (never a contradictory "+0.0%"/"-0.0%"). Non-finite degrades to "0.0%".
export function formatSignedPct(fraction: number): string {
  const f = Number.isFinite(fraction) ? fraction : 0;
  const pct = f * 100;
  const magnitude = Math.abs(pct).toFixed(1);
  const sign = Number(magnitude) === 0 ? "" : pct > 0 ? "+" : "-";
  return `${sign}${magnitude}%`;
}

// Format a held-property first-distribution date for the next-distribution line, reusing the
// confirmation view's UTC parser. Returns null on missing/invalid so the caller shows an honest
// fallback ("announced soon") rather than "Invalid Date".
export function formatNextDistribution(iso: string | null): string | null {
  return iso ? formatDistributionDate(iso) : null;
}

// --- Sparkline geometry (pure; no DOM) --------------------------------------------------------

// Build the `points` attribute for an SVG <polyline> from the balance series, mapping each value to a
// point in a `w`×`h` box (y inverted: SVG's origin is top-left, so a higher balance sits higher). The
// series is honest cumulative cost basis — degenerate cases render a calm flat line:
//   • 0 points → "" (nothing to draw; the view shows the text equivalent only)
//   • 1 point, or an all-equal series → a flat mid-height line across the full width
// Coordinates are rounded to 2 decimals to keep the emitted string compact and deterministic.
export function sparklinePoints(series: number[], w: number, h: number): string {
  if (series.length === 0) return "";
  const mid = round2(h / 2);
  if (series.length === 1) return `0,${mid} ${round2(w)},${mid}`;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  const lastIndex = series.length - 1;

  return series
    .map((value, i) => {
      const x = round2((i / lastIndex) * w);
      // Flat mid-line when every value is equal (span 0) — avoids a divide-by-zero and reads calm.
      const y = span === 0 ? mid : round2(h - ((value - min) / span) * h);
      return `${x},${y}`;
    })
    .join(" ");
}

// The sparkline's text equivalent (WCAG — the chart carries a non-visual description), kept coherent
// with what `sparklinePoints` draws: an empty series draws nothing → the honest "No balance history
// yet"; a single point draws a flat line → describe that one balance; two or more describe the trend.
// Crypto-clean.
export function describeSparkline(series: number[]): string {
  if (series.length === 0) return HOME_COPY.sparkEmpty;
  if (series.length === 1) return `Your balance is ${formatUsd(series[0])}.`;
  return `Your balance over time, from ${formatUsd(series[0])} to ${formatUsd(series[series.length - 1])}.`;
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

// --- Consumer-visible copy. Crypto-clean (asserted by hasCryptoVocabulary over every value). --------
export const HOME_COPY = {
  eyebrow: "Vesper",

  // Fresh-distribution hero (dusk card, champagne star).
  heroStarLabel: "Income",
  heroLead: "Rent just landed",
  heroSub: "Your latest income has arrived.",

  // Balance card.
  portfolioLabel: "Portfolio value",
  returnLabel: "All-time return",
  incomeLabel: "Income to date",

  // Next-distribution line (shown when nothing is fresh).
  nextLabel: "Next distribution",
  nextFallback: "Announced soon",

  // Sparkline text equivalent for the degenerate case.
  sparkEmpty: "No balance history yet",

  // Empty / start state (provisioned owner, no holdings yet).
  emptyTitle: "Own real estate income, quietly",
  emptyBody:
    "You haven't invested yet. Browse the homes on offer and start earning your share of the rent.",

  // Signed-out welcome.
  signedOutTitle: "Own real estate income, quietly",
  signedOutBody:
    "Invest in a share of a real home and earn your part of the rent — no landlording, no fuss.",
  signInCta: "Sign in",

  // Onward affordance (interim portfolio link → Explore, matching Story 4.5).
  exploreCta: "Explore properties",
} as const;
