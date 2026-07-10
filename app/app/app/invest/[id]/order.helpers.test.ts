import { describe, expect, test } from "vitest";
import { hasCryptoVocabulary } from "./invest.helpers";
import { formatUsdCents, formatYieldPct } from "./calculator.helpers";
import {
  PLATFORM_FEE_RATE,
  platformFee,
  totalChargedToday,
  formatMgmtFeeNote,
  ORDER_COPY,
} from "./order.helpers";

// Story 4.2 · Order preview & fee transparency — lock the fee math, the visible rate, the
// management-fee note, and the consumer-copy no-crypto-vocabulary invariant. Pure, no DOM.

// The Monroe seed net yield, used in the management-fee note.
const YIELD = 0.062;

describe("platform-fee rate", () => {
  test("is the documented one-time 0.9%", () => {
    expect(PLATFORM_FEE_RATE).toBe(0.009);
    expect(formatYieldPct(PLATFORM_FEE_RATE)).toBe("0.9%");
  });
});

describe("worked example — $100 investment", () => {
  const amount = 100;

  test("platform fee is $0.90", () => {
    expect(formatUsdCents(platformFee(amount))).toBe("$0.90");
  });

  test("total charged today is $100.90", () => {
    expect(formatUsdCents(totalChargedToday(amount))).toBe("$100.90");
  });
});

describe("fee math is finite-guarded (non-finite input → $0.00)", () => {
  test.each([NaN, Infinity, -Infinity])("fee and total are $0.00 for %s", (bad) => {
    expect(formatUsdCents(platformFee(bad))).toBe("$0.00");
    expect(formatUsdCents(totalChargedToday(bad))).toBe("$0.00");
  });
});

describe("negative amount is clamped to a neutral $0.00", () => {
  test("no negative fee or total", () => {
    expect(formatUsdCents(platformFee(-100))).toBe("$0.00");
    expect(formatUsdCents(totalChargedToday(-100))).toBe("$0.00");
  });
});

describe("displayed rows always reconcile (investment + fee === total)", () => {
  // The whole point of the screen: what's shown must add up, even for a sub-cent typed amount.
  test.each([100, 50, 50.555, 137.49, 999.999, 250])("amount %s reconciles to the penny", (amount) => {
    const investment = formatUsdCents(Math.max(0, amount));
    const fee = formatUsdCents(platformFee(amount));
    const total = formatUsdCents(totalChargedToday(amount));
    const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);
    expect(cents(investment) + cents(fee)).toBe(cents(total));
  });
});

describe("formatMgmtFeeNote — derived from the property net yield", () => {
  test("contains the formatted yield (6.2% for the seed)", () => {
    expect(formatMgmtFeeNote(YIELD)).toContain("6.2%");
  });
});

describe("no-crypto-vocabulary invariant — every order copy string is clean", () => {
  test.each(Object.entries(ORDER_COPY))("ORDER_COPY.%s contains no crypto vocabulary", (_key, value) => {
    expect(hasCryptoVocabulary(value)).toBe(false);
  });

  test("the management-fee note contains no crypto vocabulary", () => {
    expect(hasCryptoVocabulary(formatMgmtFeeNote(YIELD))).toBe(false);
  });
});
