import { describe, expect, test } from "vitest";
import { computeRegALimit, isEligibleJurisdiction } from "./eligibility";

// Story 3.2 — locks the Reg A+ Tier-2 non-accredited limit formula and the jurisdiction allow/deny
// rule (the two exported pure helpers), plus the headroom math derived from the computed cap. These
// are the money-adjacent invariants; kept DOM-less per the repo's pure-helper + vitest convention.

describe("computeRegALimit — 10% of the greater of income / net worth", () => {
  test.each([
    // [annualIncome, netWorth, expectedLimit]
    [100_000, 50_000, 10_000], // income greater → 10% of income
    [50_000, 100_000, 10_000], // net worth greater → 10% of net worth
    [100_000, 100_000, 10_000], // equal → 10% of either
    [0, 0, 0], // zero everything → zero cap
    [0, 250_000, 25_000], // no income, only net worth
    [250_000, 0, 25_000], // only income, no net worth
  ])("income=%d networth=%d → limit=%d", (income, netWorth, expected) => {
    expect(computeRegALimit({ annualIncome: income, netWorth })).toBe(expected);
  });

  test("negative inputs are floored to 0 (never a negative cap)", () => {
    expect(computeRegALimit({ annualIncome: -100_000, netWorth: -50_000 })).toBe(0);
    expect(computeRegALimit({ annualIncome: -1, netWorth: 200_000 })).toBe(20_000);
  });

  test("non-finite inputs (NaN/Infinity) are treated as 0", () => {
    expect(computeRegALimit({ annualIncome: NaN, netWorth: NaN })).toBe(0);
    expect(computeRegALimit({ annualIncome: Infinity, netWorth: 0 })).toBe(0);
    expect(computeRegALimit({ annualIncome: NaN, netWorth: 80_000 })).toBe(8_000);
  });
});

describe("isEligibleJurisdiction — US allowlist, everything else restricted", () => {
  test.each(["US", "us", " US ", "United States", "united states", "  united states  "])(
    "eligible: %s",
    (j) => {
      expect(isEligibleJurisdiction(j)).toBe(true);
    },
  );

  test.each(["CA", "Canada", "UK", "United Kingdom", "DE", "", "USA", "U.S."])(
    "restricted: %s",
    (j) => {
      expect(isEligibleJurisdiction(j)).toBe(false);
    },
  );
});

describe("headroom math — remaining = max(0, limit − investedThisYear)", () => {
  const headroom = (limit: number, invested: number) => Math.max(0, limit - invested);

  test("full cap available before any settlement (invested = 0)", () => {
    const limit = computeRegALimit({ annualIncome: 120_000, netWorth: 90_000 });
    expect(headroom(limit, 0)).toBe(12_000);
  });

  test("partial headroom after prior investment", () => {
    const limit = computeRegALimit({ annualIncome: 200_000, netWorth: 0 }); // 20_000
    expect(headroom(limit, 15_000)).toBe(5_000);
  });

  test("never negative once the cap is exhausted or exceeded", () => {
    const limit = computeRegALimit({ annualIncome: 100_000, netWorth: 0 }); // 10_000
    expect(headroom(limit, 10_000)).toBe(0);
    expect(headroom(limit, 12_500)).toBe(0);
  });
});
