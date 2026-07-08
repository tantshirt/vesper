import { describe, expect, test } from "vitest";
import {
  isValidFundingAmount,
  usdToUsdc,
  availableBalance,
  MIN_FUNDING,
  MAX_FUNDING,
} from "./funding";

// Story 3.3 — locks the three money-adjacent invariants of the funding surface: the whole-dollar
// amount rule, the 1:1 USDC conversion seam, and the balance-summation formula. DOM-less per the
// repo's pure-helper + vitest convention; the mutation/auth/audit surface is covered in
// funding.mutations.test.ts.

describe("isValidFundingAmount — whole-dollar amount within [MIN, MAX]", () => {
  test.each([MIN_FUNDING, 100, 1_000, MAX_FUNDING])("accepts %d", (amount) => {
    expect(isValidFundingAmount(amount)).toBe(true);
  });

  test.each([
    0, // zero
    49, // below the $50 minimum
    -100, // negative
    50.5, // non-integer
    49.99, // fractional under min
    MAX_FUNDING + 1, // above the sanity cap
    2_000_000, // well above the cap
    NaN, // non-finite
    Infinity, // non-finite
    -Infinity, // non-finite
  ])("rejects %d", (amount) => {
    expect(isValidFundingAmount(amount)).toBe(false);
  });
});

describe("usdToUsdc — 1:1 conversion seam", () => {
  test.each([
    [0, 0],
    [50, 50],
    [100, 100],
    [1_000_000, 1_000_000],
  ])("converts %d → %d (1:1)", (usd, expected) => {
    expect(usdToUsdc(usd)).toBe(expected);
  });
});

describe("availableBalance — sum of settled deposits", () => {
  test("empty ledger → 0", () => {
    expect(availableBalance([])).toBe(0);
  });

  test("sums only settled deposits", () => {
    expect(
      availableBalance([
        { amountUsd: 100, status: "settled" },
        { amountUsd: 250, status: "settled" },
      ]),
    ).toBe(350);
  });

  test("ignores pending and failed rows", () => {
    expect(
      availableBalance([
        { amountUsd: 100, status: "settled" },
        { amountUsd: 500, status: "pending" },
        { amountUsd: 999, status: "failed" },
        { amountUsd: 50, status: "settled" },
      ]),
    ).toBe(150);
  });

  test("all non-settled → 0", () => {
    expect(
      availableBalance([
        { amountUsd: 500, status: "pending" },
        { amountUsd: 999, status: "failed" },
      ]),
    ).toBe(0);
  });
});
