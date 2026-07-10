import { describe, expect, test } from "vitest";
import {
  portfolioViewState,
  formatAllocationPct,
  allocationBarWidth,
  formatConcentrationNudge,
  describeHolding,
  PORTFOLIO_COPY,
  type PortfolioSummary,
} from "./portfolio.helpers";
import { hasCryptoVocabulary } from "./invest/[id]/invest.helpers";

// Story 5.2 — locks the Portfolio helper invariants without a DOM (repo's pure-helper + vitest
// convention): the view-state decision, the allocation/percent formatters (incl. clamping), the
// concentration-nudge text, and the no-crypto-vocabulary invariant over every PORTFOLIO_COPY value +
// a rendered nudge string.

function summary(over: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    hasHoldings: false,
    holdings: [],
    allocations: [],
    totalValue: 0,
    totalMonthIncome: 0,
    concentration: null,
    ...over,
  };
}

describe("portfolioViewState — empty | holdings", () => {
  test("has holdings → holdings", () => {
    expect(portfolioViewState(summary({ hasHoldings: true }))).toBe("holdings");
  });
  test("provisioned, no holdings → empty", () => {
    expect(portfolioViewState(summary())).toBe("empty");
  });
});

describe("formatAllocationPct — unsigned whole percent, clamped", () => {
  test.each([
    [0, "0%"],
    [0.72, "72%"],
    [0.355, "36%"], // rounds
    [1, "100%"],
    [1.4, "100%"], // over-1 clamps
    [-0.2, "0%"], // negative clamps
  ])("%d → %s", (input, expected) => {
    expect(formatAllocationPct(input)).toBe(expected);
  });
  test("non-finite → 0%", () => {
    expect(formatAllocationPct(NaN)).toBe("0%");
    expect(formatAllocationPct(Infinity)).toBe("0%"); // non-finite guarded to 0 before clamp
  });
});

describe("allocationBarWidth — clamped CSS width", () => {
  test.each([
    [0, "0%"],
    [0.5, "50%"],
    [1, "100%"],
    [1.8, "100%"], // over-1 clamp (never overflow the track)
    [-1, "0%"], // negative clamp
  ])("%d → %s", (input, expected) => {
    expect(allocationBarWidth(input)).toBe(expected);
  });
  test("non-finite → 0%", () => {
    expect(allocationBarWidth(NaN)).toBe("0%");
  });
});

describe("formatConcentrationNudge — calm, names market + share", () => {
  test("includes the market and its whole-percent share", () => {
    const nudge = formatConcentrationNudge("Tampa, FL", 1);
    expect(nudge).toContain("Tampa, FL");
    expect(nudge).toContain("100%");
  });
});

describe("describeHolding — text equivalent", () => {
  test("names the holding, market, value, and this-month income", () => {
    const text = describeHolding({
      propertyId: "p1",
      name: "The Monroe",
      market: "Tampa, FL",
      value: 1000,
      monthIncome: 62,
    });
    expect(text).toContain("The Monroe");
    expect(text).toContain("Tampa, FL");
    expect(text).toContain("$1,000");
    expect(text).toContain("$62");
  });
});

describe("no crypto vocabulary on the Portfolio surface (spine I6 / NFR3)", () => {
  test("every PORTFOLIO_COPY value is crypto-clean", () => {
    for (const value of Object.values(PORTFOLIO_COPY)) {
      expect(hasCryptoVocabulary(value)).toBe(false);
    }
  });

  test("a rendered concentration nudge stays crypto-clean", () => {
    expect(hasCryptoVocabulary(formatConcentrationNudge("Tampa, FL", 1))).toBe(false);
  });

  test("a rendered holding description stays crypto-clean", () => {
    const text = describeHolding({
      propertyId: "p1",
      name: "The Monroe",
      market: "Tampa, FL",
      value: 1000,
      monthIncome: 62,
    });
    expect(hasCryptoVocabulary(text)).toBe(false);
  });
});
