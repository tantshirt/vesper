import { describe, expect, test } from "vitest";
import {
  incomeViewState,
  isMissed,
  formatMatchesTarget,
  formatBelowTarget,
  monthAbbrev,
  formatPeriodLabel,
  aggregateHistoryByPeriod,
  describeWaterfall,
  describeHistoryRow,
  STATUS_LABEL,
  INCOME_COPY,
  type IncomeSummary,
  type IncomeDistribution,
} from "./income.helpers";
import { hasCryptoVocabulary } from "./invest/[id]/invest.helpers";

// Story 5.3 — locks the Income helper invariants without a DOM (repo's pure-helper + vitest
// convention): the view-state decision, the matches/variance formatters, the waterfall text-equivalent,
// and the no-crypto-vocabulary invariant over every INCOME_COPY value + every rendered waterfall /
// affirmation / variance / banner / history string.

function distribution(over: Partial<IncomeDistribution> = {}): IncomeDistribution {
  return {
    propertyId: "prop123",
    period: "2026-07",
    status: "paid",
    grossShare: 100,
    costs: 24,
    mgmtFee: 8,
    reserve: 6,
    netPaid: 62,
    target: { targetYield: 0.062, realizedYield: 0.062, matchesTarget: true },
    ...over,
  };
}

function summary(over: Partial<IncomeSummary> = {}): IncomeSummary {
  return {
    hasHoldings: false,
    latest: null,
    history: [],
    nextDistributionDate: null,
    firstDistributionDate: null,
    ...over,
  };
}

describe("incomeViewState — empty | income", () => {
  test("no latest distribution → empty (regardless of holdings)", () => {
    expect(incomeViewState(summary())).toBe("empty");
    expect(incomeViewState(summary({ hasHoldings: true }))).toBe("empty");
  });

  test("a latest distribution → income", () => {
    expect(incomeViewState(summary({ hasHoldings: true, latest: distribution() }))).toBe("income");
  });
});

describe("isMissed — honest-banner trigger keys off status !== paid", () => {
  test("paid → not missed; anything else → missed (covers a future paused literal identically)", () => {
    expect(isMissed("paid")).toBe(false);
    expect(isMissed("missed")).toBe(true);
    expect(isMissed("scheduled")).toBe(true);
  });
});

describe("formatMatchesTarget / formatBelowTarget — calm, factual, never guaranteed", () => {
  test("matches names the target percent via formatYieldPct", () => {
    expect(formatMatchesTarget(0.062)).toContain("6.2%");
  });

  test("below-target names realized AND target, never alarming", () => {
    const note = formatBelowTarget(0.051, 0.062);
    expect(note).toContain("5.1%");
    expect(note).toContain("6.2%");
  });

  test("neither uses a guaranteed/earns framing", () => {
    for (const s of [formatMatchesTarget(0.062), formatBelowTarget(0.05, 0.062)]) {
      expect(s.toLowerCase()).not.toContain("guarantee");
      expect(s.toLowerCase()).not.toContain("earns");
    }
  });
});

describe("describeWaterfall — accessible text equivalent, DD-002 order, cents", () => {
  test("names every line item with cents precision, ending on the net payment", () => {
    const text = describeWaterfall(distribution());
    expect(text).toContain("$100.00"); // gross
    expect(text).toContain("$24.00"); // costs
    expect(text).toContain("$8.00"); // mgmt
    expect(text).toContain("$6.00"); // reserve
    expect(text).toContain("$62.00"); // net
    // DD-002 order: gross precedes costs precedes net.
    expect(text.indexOf("$100.00")).toBeLessThan(text.indexOf("$24.00"));
    expect(text.indexOf("$24.00")).toBeLessThan(text.indexOf("$62.00"));
  });

  test("a missed distribution reads as no-payment — never asserts a $0.00 payout to assistive tech", () => {
    const text = describeWaterfall(
      distribution({ status: "missed", grossShare: 0, costs: 0, mgmtFee: 0, reserve: 0, netPaid: 0 }),
    );
    expect(text.toLowerCase()).toContain("didn't arrive");
    expect(text).not.toContain("$0.00");
    expect(text.toLowerCase()).not.toContain("net payment to you");
  });
});

describe("describeHistoryRow / STATUS_LABEL", () => {
  test("a paid row names the net; a non-paid row names its status", () => {
    expect(describeHistoryRow({ period: "2026-07", netPaid: 62, status: "paid" })).toContain("$62.00");
    expect(describeHistoryRow({ period: "2026-06", netPaid: 0, status: "missed" })).toContain(
      STATUS_LABEL.missed,
    );
  });
});

describe("period labels and monthly aggregation", () => {
  test("malformed periods render unchanged", () => {
    expect(monthAbbrev("bad-07")).toBe("bad-07");
    expect(formatPeriodLabel("bad-07")).toBe("bad-07");
    expect(monthAbbrev("2026-13")).toBe("2026-13");
    expect(formatPeriodLabel("2026-13")).toBe("2026-13");
  });

  test("a month with paid and missed rows surfaces the miss", () => {
    const [row] = aggregateHistoryByPeriod([
      { period: "2026-07", netPaid: 62, status: "paid" },
      { period: "2026-07", netPaid: 0, status: "missed" },
    ]);
    expect(row.status).toBe("missed");
    expect(row.netPaid).toBe(62);
  });
});

describe("no crypto vocabulary (spine I6 / NFR3, AC5)", () => {
  test("every INCOME_COPY value is crypto-clean", () => {
    for (const value of Object.values(INCOME_COPY)) {
      expect(hasCryptoVocabulary(value)).toBe(false);
    }
  });

  test("every STATUS_LABEL value is crypto-clean", () => {
    for (const value of Object.values(STATUS_LABEL)) {
      expect(hasCryptoVocabulary(value)).toBe(false);
    }
  });

  test("rendered waterfall / affirmation / variance / banner / history strings are crypto-clean", () => {
    const strings = [
      describeWaterfall(distribution()),
      describeWaterfall(distribution({ grossShare: 5, costs: 1, mgmtFee: 0, reserve: 1, netPaid: 3 })),
      formatMatchesTarget(0.062),
      formatBelowTarget(0.051, 0.062),
      describeHistoryRow({ period: "2026-07", netPaid: 62, status: "paid" }),
      describeHistoryRow({ period: "2026-06", netPaid: 0, status: "missed" }),
    ];
    for (const s of strings) {
      expect(hasCryptoVocabulary(s)).toBe(false);
    }
  });
});
