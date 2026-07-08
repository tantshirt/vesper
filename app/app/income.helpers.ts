// Story 5.3 · Income ("understand exactly what you were paid") — pure copy + formatters + the
// waterfall text-equivalent (no JSX/React/DOM), so the view-state decision, the target/variance
// wording, the accessible waterfall description, and the no-crypto-vocabulary invariant are all
// unit-testable without a browser harness (mirrors portfolio.helpers.ts + home.helpers.ts + vitest).
//
// Consumer surface rule (spine I6 / NFR3): NONE of INCOME_COPY nor any value this module produces may
// contain crypto vocabulary (the shared `hasCryptoVocabulary` guard asserts this). Income never
// surfaces a raw distribution txSig, the "USDC" settlement label, or any wallet/on-chain term. Money is
// the legibility surface (O3 — "understand exactly what you were paid"), so it uses CENTS precision
// (`formatUsdCents`), unlike Home/Portfolio's glanceable whole dollars.

import { formatUsdCents, formatYieldPct } from "./invest/[id]/calculator.helpers";

// A distribution status literal. `missed` is the only non-paid state with a producer today; the honest
// banner keys off `status !== "paid"`, so a future `paused` literal is covered identically (deferred).
export type DistributionStatus = "scheduled" | "paid" | "missed";

// The server-side target evaluation for the latest distribution (annualized realized net vs target).
export interface TargetEvaluation {
  targetYield: number; // property.targetNetYield (fraction, e.g. 0.062)
  realizedYield: number; // netPaid × 12 / costBasis (fraction; guarded to 0 when costBasis ≤ 0)
  matchesTarget: boolean; // realizedYield ≥ targetYield − TARGET_MATCH_TOLERANCE
}

// The latest distribution's full itemized waterfall + its target evaluation, as returned by
// `api.income.summary`. `propertyId` is route-safe (the interim missed-distribution onward link).
export interface IncomeDistribution {
  propertyId: string;
  period: string;
  status: DistributionStatus;
  grossShare: number;
  costs: number;
  mgmtFee: number;
  reserve: number;
  netPaid: number;
  target: TargetEvaluation;
}

// One history row — month + net + status only (no per-row itemization; the detailed waterfall is the
// latest distribution alone).
export interface IncomeHistoryRow {
  period: string;
  netPaid: number;
  status: DistributionStatus;
}

// The reactive Income model as returned by `api.income.summary` (a superset is fine). `null` = the query
// resolved to no caller (unauthenticated / unprovisioned); `undefined` (loading) is handled in the view.
export interface IncomeSummary {
  hasHoldings: boolean;
  latest: IncomeDistribution | null;
  history: IncomeHistoryRow[];
  nextDistributionDate: string | null;
  firstDistributionDate: string | null;
}

// Which Income surface a provisioned owner sees:
//   • "income" — at least one distribution exists → the itemized waterfall + history + next date.
//   • "empty"  — no distributions yet → the calm start / "first income expected {date}" state.
export type IncomeViewState = "empty" | "income";

export function incomeViewState(summary: IncomeSummary): IncomeViewState {
  return summary.latest !== null ? "income" : "empty";
}

// A distribution is honest-banner-worthy when it did not pay (anything but "paid"). Keyed off the
// status literal so a future "paused" state is covered without a code change.
export function isMissed(status: DistributionStatus): boolean {
  return status !== "paid";
}

// The calm "matches your target" affirmation (never "guaranteed"/"earns"). Names the target percent via
// the existing formatter (e.g. 0.062 → "6.2%").
export function formatMatchesTarget(targetYield: number): string {
  return `This matches your ${formatYieldPct(targetYield)} target for this home.`;
}

// The calm below-target variance note — names realized vs target factually, never alarming, and frames
// month-to-month variation as ordinary (not a failure).
export function formatBelowTarget(realizedYield: number, targetYield: number): string {
  return `This came in around ${formatYieldPct(realizedYield)}, a little under your ${formatYieldPct(
    targetYield,
  )} target. Income can move month to month — nothing here needs your attention.`;
}

// The waterfall's accessible text equivalent (WCAG — the visual rows also read as one sentence to
// assistive tech). Cents precision, DD-002 order, crypto-clean. Reuses formatUsdCents for every figure.
export function describeWaterfall(distribution: IncomeDistribution): string {
  return (
    `Gross rent share ${formatUsdCents(distribution.grossShare)}, ` +
    `less operating costs ${formatUsdCents(distribution.costs)}, ` +
    `management fee ${formatUsdCents(distribution.mgmtFee)}, ` +
    `and reserve ${formatUsdCents(distribution.reserve)}, ` +
    `for a net payment to you of ${formatUsdCents(distribution.netPaid)}.`
  );
}

// A short text equivalent for a history row (month + net + status), crypto-clean.
export function describeHistoryRow(row: IncomeHistoryRow): string {
  const paid = row.status === "paid" ? `paid ${formatUsdCents(row.netPaid)}` : STATUS_LABEL[row.status];
  return `${row.period}: ${paid}.`;
}

// Human status label for a history row / banner.
export const STATUS_LABEL: Record<DistributionStatus, string> = {
  paid: "Paid",
  scheduled: "Scheduled",
  missed: "Didn't arrive",
};

// --- Consumer-visible copy. Crypto-clean (asserted by hasCryptoVocabulary over every value). --------
export const INCOME_COPY = {
  eyebrow: "Vesper",
  title: "Your income",

  // The latest distribution's itemized breakdown.
  breakdownHeading: "This distribution",
  grossLabel: "Gross rent share",
  costsLabel: "Operating costs",
  mgmtLabel: "Management fee",
  reserveLabel: "Reserve",
  netLabel: "Net paid to you",

  // History section.
  historyHeading: "Your income history",

  // Next-distribution line (shown alongside the breakdown / on the empty state).
  nextLabel: "Next distribution",
  nextFallback: "Announced soon",
  firstExpectedLabel: "First income expected",

  // Honest banner (a latest distribution that did not pay). Never silent.
  bannerTitle: "This month's income didn't arrive",
  bannerBody:
    "The payment for this period didn't come through. We keep this honest — here's the latest on the home so you know where things stand.",
  updateCta: "See the latest on this home",

  // Empty / start states.
  emptyTitle: "Your first income is on the way",
  emptyBody:
    "You haven't received a distribution yet. When your first payment lands, you'll see the full breakdown here.",

  // No holdings (provisioned owner, nothing invested yet).
  noHoldingsTitle: "Income shows up here",
  noHoldingsBody:
    "Once you own a share of a home, this is where you'll see exactly what you were paid each month.",

  // Signed-out welcome.
  signedOutTitle: "See exactly what you were paid",
  signedOutBody:
    "Sign in to see each payment broken down line by line — rent in, costs out, and the amount that reached you.",
  signInCta: "Sign in",

  // Onward affordances.
  exploreCta: "Explore properties",
} as const;
