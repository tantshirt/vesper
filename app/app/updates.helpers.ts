// Story 5.4 · Property updates ("a monthly note on every home — even the quiet months") — pure copy +
// formatters + the update text-equivalent (no JSX/React/DOM), so the view-state decision, the
// occupancy/reserves/rent formatting, the accessible description, and the no-crypto-vocabulary invariant
// are all unit-testable without a browser harness (mirrors income.helpers.ts + portfolio.helpers.ts).
//
// Consumer surface rule (spine I6 / NFR3): NONE of UPDATES_COPY nor any value this module produces may
// contain crypto vocabulary (the shared `hasCryptoVocabulary` guard asserts this). Updates never surfaces
// a wallet/token/on-chain term. Occupancy/percent uses whole numbers (glanceable, like Home/Portfolio).

// The latest operator update for a held property, as returned by `api.updates.summary`. `null` on the
// card means the property has never been updated (the awaiting note renders).
export interface PropertyUpdateLatest {
  operator: string;
  period: string; // "YYYY-MM"
  occupancy: number; // fraction 0..1
  reservesMonths: number;
  rentOnTime: boolean;
  note: string;
  publishedAt: number;
}

// One card — a distinct held property with its latest update (or null) + an honest overdue flag. Every
// owned property produces a card; quiet months and never-updated properties are never hidden.
export interface PropertyUpdateCard {
  propertyId: string;
  name: string;
  location: string;
  overdue: boolean;
  latest: PropertyUpdateLatest | null;
}

// The reactive Updates model as returned by `api.updates.summary` (a superset is fine). `null` = the
// query resolved to no caller (unauthenticated / unprovisioned); `undefined` (loading) is handled in the
// view.
export interface UpdatesSummary {
  hasHoldings: boolean;
  updates: PropertyUpdateCard[];
}

// Which Updates surface a provisioned owner sees:
//   • "updates" — owns at least one property → one card per owned home (each with a note, never silent).
//   • "empty"   — provisioned but owns nothing yet → the calm start state.
export type UpdatesViewState = "empty" | "updates";

export function updatesViewState(summary: UpdatesSummary): UpdatesViewState {
  return summary.hasHoldings ? "updates" : "empty";
}

// Occupancy as an unsigned whole percent (fraction input, e.g. 0.96 → "96%"). Clamped to [0, 1] and
// guarded so a non-finite or out-of-range fraction never renders "NaN%"/"140%".
export function formatOccupancy(fraction: number): string {
  const f = Number.isFinite(fraction) ? fraction : 0;
  const clamped = Math.min(1, Math.max(0, f));
  return `${Math.round(clamped * 100)}%`;
}

// Reserves runway in whole months (e.g. 4 → "4 months", 1 → "1 month"). Guarded to 0 (non-finite or
// negative → "0 months") so a bad figure never reads as "NaN months".
export function formatReserves(months: number): string {
  const m = Number.isFinite(months) && months > 0 ? Math.round(months) : 0;
  return `${m} ${m === 1 ? "month" : "months"}`;
}

// Rent-collection state as calm copy (true → "On time", false → "Delayed"). Draws from UPDATES_COPY so
// the label is single-sourced.
export function formatRentOnTime(onTime: boolean): string {
  return onTime ? UPDATES_COPY.rentOnTime : UPDATES_COPY.rentDelayed;
}

// The card's accessible text equivalent (WCAG — the visual figures also read as one sentence to
// assistive tech). Crypto-clean. A never-updated card describes the awaiting note; an up-to-date card
// names the operator + occupancy/reserves/rent + the plain note; an overdue-but-stale card appends the
// calm overdue note so the gap is never silent for a screen-reader user.
export function describeUpdate(card: PropertyUpdateCard): string {
  if (card.latest === null) {
    return `${card.name} in ${card.location}. ${UPDATES_COPY.awaitingNote}`;
  }
  const l = card.latest;
  const base =
    `${card.name} in ${card.location}, from ${l.operator}: ` +
    `occupancy ${formatOccupancy(l.occupancy)}, ` +
    `${formatReserves(l.reservesMonths)} of reserve fund, ` +
    `rent ${formatRentOnTime(l.rentOnTime).toLowerCase()}. ` +
    l.note;
  return card.overdue ? `${base} ${UPDATES_COPY.overdueNote}` : base;
}

// --- Consumer-visible copy. Crypto-clean (asserted by hasCryptoVocabulary over every value). --------
export const UPDATES_COPY = {
  eyebrow: "Vesper",
  title: "Property updates",
  subtitle: "How each of your homes is doing this month — in plain language.",

  // Section labels (from the operator).
  operatorLabel: "From",
  occupancyLabel: "Occupancy",
  reservesLabel: "Reserve fund",
  rentLabel: "Rent collection",
  noteHeading: "This month",

  // Rent-collection state variants.
  rentOnTime: "On time",
  rentDelayed: "Delayed",

  // Calm overdue / awaiting notes (never a silent gap).
  overdueNote:
    "This month's update hasn't arrived yet. We'll post it here the moment your operator files it — you won't miss it.",
  awaitingNote:
    "Your first monthly update is on the way. Once your operator files it, you'll see occupancy, the reserve fund, and a plain note right here.",

  // Empty / start state (provisioned owner, owns nothing yet).
  emptyTitle: "Updates show up here",
  emptyBody:
    "Once you own a share of a home, this is where you'll read how it's doing each month — in plain language, even the quiet ones.",

  // Signed-out welcome.
  signedOutTitle: "See how your homes are doing",
  signedOutBody:
    "Sign in to read a plain monthly note on every home you own — how full it is, how healthy the reserve fund is, and whether rent came in on time.",
  signInCta: "Sign in",

  // Onward affordance.
  exploreCta: "Explore properties",
} as const;
