import { describe, expect, test } from "vitest";
import {
  homeHeroState,
  formatSignedUsd,
  formatSignedPct,
  formatNextDistribution,
  sparklinePoints,
  describeSparkline,
  HOME_COPY,
  type HomeSummary,
} from "./home.helpers";
import { hasCryptoVocabulary } from "./invest/[id]/invest.helpers";

// Story 5.1 — locks the Home helper invariants without a DOM (repo's pure-helper + vitest convention):
// the hero-state decision, the signed money/percent formatters, the sparkline geometry + its text
// equivalent, and the no-crypto-vocabulary invariant over every HOME_COPY value + a rendered hero string.

// A minimal summary factory; overrides tweak the branch under test.
function summary(over: Partial<HomeSummary> = {}): HomeSummary {
  return {
    hasHoldings: false,
    portfolioValue: 0,
    incomeToDate: 0,
    allTimeReturn: 0,
    allTimeReturnPct: 0,
    freshDistribution: null,
    nextDistributionDate: null,
    balanceSeries: [],
    ...over,
  };
}

describe("homeHeroState — fresh | next | empty", () => {
  test("fresh distribution present → fresh (wins even with holdings)", () => {
    expect(homeHeroState(summary({ hasHoldings: true, freshDistribution: { amount: 42 } }))).toBe(
      "fresh",
    );
  });

  test("holdings but nothing fresh → next", () => {
    expect(homeHeroState(summary({ hasHoldings: true }))).toBe("next");
  });

  test("provisioned, no holdings → empty", () => {
    expect(homeHeroState(summary())).toBe("empty");
  });
});

describe("formatSignedUsd — explicit sign, whole dollars", () => {
  test.each([
    [1200, "+$1,200"],
    [0, "$0"],
    [-350, "-$350"],
    [0.4, "$0"], // sub-dollar rounds to $0 → no dangling "+" sign
  ])("%d → %s", (input, expected) => {
    expect(formatSignedUsd(input)).toBe(expected);
  });

  test("non-finite degrades to $0", () => {
    expect(formatSignedUsd(NaN)).toBe("$0");
    expect(formatSignedUsd(Infinity)).toBe("$0");
  });
});

describe("formatSignedPct — signed, one decimal, fraction input", () => {
  test.each([
    [0.062, "+6.2%"],
    [0, "0.0%"],
    [-0.05, "-5.0%"],
    [1, "+100.0%"],
    [0.0002, "0.0%"], // rounds to 0.0 magnitude → no contradictory "+0.0%"
    [-0.0002, "0.0%"], // and no "-0.0%"
  ])("%d → %s", (input, expected) => {
    expect(formatSignedPct(input)).toBe(expected);
  });

  test("non-finite degrades to 0.0%", () => {
    expect(formatSignedPct(NaN)).toBe("0.0%");
  });
});

describe("formatNextDistribution — reuses the UTC parser, null on missing/invalid", () => {
  test("valid ISO → long date", () => {
    expect(formatNextDistribution("2026-08-31")).toBe("August 31, 2026");
  });
  test("null passthrough", () => {
    expect(formatNextDistribution(null)).toBeNull();
  });
  test("invalid string → null", () => {
    expect(formatNextDistribution("nope")).toBeNull();
  });
});

describe("sparklinePoints — SVG polyline geometry", () => {
  test("empty series → empty string", () => {
    expect(sparklinePoints([], 100, 40)).toBe("");
  });

  test("single point → flat mid-height line across the width", () => {
    expect(sparklinePoints([500], 100, 40)).toBe("0,20 100,20");
  });

  test("all-equal series → flat mid-line (no divide-by-zero)", () => {
    expect(sparklinePoints([500, 500, 500], 100, 40)).toBe("0,20 50,20 100,20");
  });

  test("ascending series spans full height, min at bottom, max at top", () => {
    // series 0..100 over width 100, height 40: x evenly spaced, y inverted (100 → 0, 0 → 40).
    const pts = sparklinePoints([0, 50, 100], 100, 40).split(" ");
    expect(pts[0]).toBe("0,40"); // min → bottom
    expect(pts[2]).toBe("100,0"); // max → top
  });
});

describe("describeSparkline — text equivalent", () => {
  test("empty → honest fallback", () => {
    expect(describeSparkline([])).toBe(HOME_COPY.sparkEmpty);
  });
  test("single point → describes that one balance (coherent with the flat line drawn)", () => {
    expect(describeSparkline([500])).toBe("Your balance is $500.");
  });
  test("multi describes first → last", () => {
    expect(describeSparkline([100, 300, 750])).toBe(
      "Your balance over time, from $100 to $750.",
    );
  });
});

describe("no crypto vocabulary on the Home surface (spine I6 / NFR3)", () => {
  test("every HOME_COPY value is crypto-clean", () => {
    for (const value of Object.values(HOME_COPY)) {
      expect(hasCryptoVocabulary(value)).toBe(false);
    }
  });

  test("a rendered hero string stays crypto-clean", () => {
    const hero = `${HOME_COPY.heroLead} ${formatSignedUsd(1200)}`;
    expect(hasCryptoVocabulary(hero)).toBe(false);
  });

  test("the sparkline description is crypto-clean", () => {
    expect(hasCryptoVocabulary(describeSparkline([100, 750]))).toBe(false);
  });
});
