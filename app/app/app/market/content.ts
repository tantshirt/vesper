export const MARKET_COPY = {
  eyebrow: "Ownership transfers",
  title: "Market",
  unavailableTitle: "Resale is not currently available.",
  unavailableBody:
    "Vesper does not have live bids, spread, last-sale price, or time-to-fill data to show. We will not estimate an exit without current market evidence.",
  restrictionBody:
    "Any future resale will require investor eligibility and must follow the transfer restrictions for the offering.",
  primaryOnly: "Primary offering only",
  dataUnavailable: "No live resale market data",
  exploreCta: "Explore open properties",
  learnCta: "Learn how resale works",
} as const;

export function targetYieldDisclosure(targetNetYield: number): string {
  const percentage = Number.isFinite(targetNetYield) ? targetNetYield * 100 : 0;
  const formatted = percentage.toFixed(percentage % 1 === 0 ? 0 : 1);
  return `Target net yield ${formatted}% · Target, not guaranteed.`;
}
