import { describe, expect, test } from "vitest";
import { hasCryptoVocabulary } from "./invest.helpers";
import {
  APPRECIATION_YIELD,
  DOWNSIDE_FIRST_YEAR_RATE,
  DOWNSIDE_VALUE_LABEL,
  SLIDER_MIN,
  SLIDER_MAX,
  QUICK_CHIPS,
  ownershipFraction,
  estMonthlyIncome,
  firstYearBase,
  firstYearDownside,
  rentComponent,
  appreciationComponent,
  isValidInvestAmount,
  formatUsdCents,
  formatSignedUsd,
  formatOwnershipPct,
  formatYieldPct,
  formatMinHint,
  CALC_COPY,
} from "./calculator.helpers";

// Story 4.1 · Calculator & live projection — lock the projection math, the min rule, the
// formatter output, and the consumer-copy no-crypto-vocabulary invariant. Pure, no DOM.

// The Monroe seed basis, used across the worked example.
const OFFERING = 1_240_000;
const YIELD = 0.062;

describe("projection constants", () => {
  test("match the documented design contract", () => {
    expect(APPRECIATION_YIELD).toBe(0.014);
    expect(DOWNSIDE_FIRST_YEAR_RATE).toBe(-0.008);
    expect(DOWNSIDE_VALUE_LABEL).toBe("−12%");
    expect(SLIDER_MIN).toBe(50);
    expect(SLIDER_MAX).toBe(2000);
    expect(QUICK_CHIPS).toEqual([50, 100, 250, 500]);
  });
});

describe("worked example — The Monroe at $100", () => {
  const amount = 100;

  test("ownership % is 0.0081%", () => {
    expect(formatOwnershipPct(ownershipFraction(amount, OFFERING))).toBe("0.0081%");
  });

  test("est. monthly income is +$0.40", () => {
    expect(formatSignedUsd(estMonthlyIncome(amount, YIELD))).toBe("+$0.40");
  });

  test("first-year base is +$6.20", () => {
    expect(formatSignedUsd(firstYearBase(amount, YIELD))).toBe("+$6.20");
  });

  test("rent slice is $4.80 and appreciation slice is $1.40", () => {
    expect(formatUsdCents(rentComponent(amount, YIELD))).toBe("$4.80");
    expect(formatUsdCents(appreciationComponent(amount))).toBe("$1.40");
  });

  test("downside first-year is −$0.80", () => {
    expect(formatSignedUsd(firstYearDownside(amount))).toBe("−$0.80");
  });

  test("rent + appreciation reconstruct the base", () => {
    expect(rentComponent(amount, YIELD) + appreciationComponent(amount)).toBeCloseTo(
      firstYearBase(amount, YIELD),
      10,
    );
  });
});

describe("ownershipFraction — finite-guarded basis", () => {
  test("amount / offeringSize", () => {
    expect(ownershipFraction(100, OFFERING)).toBeCloseTo(100 / OFFERING, 12);
  });

  test("non-positive or non-finite offeringSize → 0 (no fabricated basis)", () => {
    expect(ownershipFraction(100, 0)).toBe(0);
    expect(ownershipFraction(100, -5)).toBe(0);
    expect(ownershipFraction(100, NaN)).toBe(0);
    expect(ownershipFraction(100, Infinity)).toBe(0);
  });

  test("non-finite amount → 0", () => {
    expect(ownershipFraction(NaN, OFFERING)).toBe(0);
    expect(ownershipFraction(Infinity, OFFERING)).toBe(0);
  });

  test("clamped to [0, 1] — never below 0% or above 100% of the offering", () => {
    // Amount far above the offering can't imply >100% ownership.
    expect(ownershipFraction(OFFERING * 5, OFFERING)).toBe(1);
    expect(ownershipFraction(OFFERING, OFFERING)).toBe(1);
    // A negative amount can't imply negative ownership.
    expect(ownershipFraction(-100, OFFERING)).toBe(0);
  });
});

describe("formatMinHint — derived from the property minimum, never a hardcoded $50", () => {
  test("renders the passed minimum as whole dollars", () => {
    expect(formatMinHint(50)).toBe("The minimum is $50.");
    expect(formatMinHint(100)).toBe("The minimum is $100.");
    expect(formatMinHint(250)).toBe("The minimum is $250.");
  });
});

describe("math is finite-guarded (non-finite input → 0)", () => {
  test.each([NaN, Infinity, -Infinity])("all figures are 0 for %s", (bad) => {
    expect(estMonthlyIncome(bad, YIELD)).toBe(0);
    expect(firstYearBase(bad, YIELD)).toBe(0);
    expect(firstYearDownside(bad)).toBe(0);
    expect(rentComponent(bad, YIELD)).toBe(0);
    expect(appreciationComponent(bad)).toBe(0);
  });
});

describe("isValidInvestAmount — minimum enforcement", () => {
  const MIN = 50;

  test("accepts the minimum, a mid value, and the slider max", () => {
    expect(isValidInvestAmount(50, MIN)).toBe(true);
    expect(isValidInvestAmount(100, MIN)).toBe(true);
    expect(isValidInvestAmount(2000, MIN)).toBe(true);
  });

  test("rejects below-min, zero, and negative", () => {
    expect(isValidInvestAmount(49, MIN)).toBe(false);
    expect(isValidInvestAmount(0, MIN)).toBe(false);
    expect(isValidInvestAmount(-100, MIN)).toBe(false);
  });

  test("rejects non-finite (empty input → NaN, Infinity)", () => {
    expect(isValidInvestAmount(NaN, MIN)).toBe(false);
    expect(isValidInvestAmount(Infinity, MIN)).toBe(false);
  });
});

describe("formatters", () => {
  test("formatUsdCents — always two fraction digits", () => {
    expect(formatUsdCents(4.8)).toBe("$4.80");
    expect(formatUsdCents(1.4)).toBe("$1.40");
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(NaN)).toBe("$0.00");
  });

  test("formatSignedUsd — explicit + on non-negative, real minus glyph on negative", () => {
    expect(formatSignedUsd(6.2)).toBe("+$6.20");
    expect(formatSignedUsd(0)).toBe("+$0.00");
    expect(formatSignedUsd(-0.8)).toBe("−$0.80");
    expect(formatSignedUsd(NaN)).toBe("+$0.00");
  });

  test("formatOwnershipPct — four decimals", () => {
    expect(formatOwnershipPct(0.0000806451)).toBe("0.0081%");
    expect(formatOwnershipPct(0)).toBe("0.0000%");
  });

  test("formatYieldPct — one decimal", () => {
    expect(formatYieldPct(0.062)).toBe("6.2%");
    expect(formatYieldPct(0.1)).toBe("10.0%");
  });
});

describe("no-crypto-vocabulary invariant — every calculator copy string is clean", () => {
  test.each(Object.entries(CALC_COPY))("CALC_COPY.%s contains no crypto vocabulary", (_key, value) => {
    expect(hasCryptoVocabulary(value)).toBe(false);
  });
});
