import { describe, expect, test } from "vitest";
import {
  updatesViewState,
  formatOccupancy,
  formatReserves,
  formatRentOnTime,
  describeUpdate,
  UPDATES_COPY,
  type UpdatesSummary,
  type PropertyUpdateCard,
} from "./updates.helpers";
import { hasCryptoVocabulary } from "./invest/[id]/invest.helpers";

// Story 5.4 — locks the Updates helper invariants without a DOM (repo's pure-helper + vitest
// convention): the view-state decision, the occupancy/reserves/rent formatters (incl. clamping), the
// card text-equivalent (up-to-date / overdue-stale / never-updated), and the no-crypto-vocabulary
// invariant over every UPDATES_COPY value + rendered card/note strings.

function summary(over: Partial<UpdatesSummary> = {}): UpdatesSummary {
  return { hasHoldings: false, updates: [], ...over };
}

function card(over: Partial<PropertyUpdateCard> = {}): PropertyUpdateCard {
  return {
    propertyId: "p1",
    name: "The Monroe",
    location: "Tampa, FL",
    overdue: false,
    latest: {
      operator: "Maria Alvarez, Property Manager",
      period: "2026-07",
      occupancy: 0.96,
      reservesMonths: 4,
      rentOnTime: true,
      note: "A quiet, steady month. Nothing needs your attention.",
      publishedAt: Date.now(),
    },
    ...over,
  };
}

describe("updatesViewState — empty | updates", () => {
  test("owns at least one property → updates", () => {
    expect(updatesViewState(summary({ hasHoldings: true }))).toBe("updates");
  });
  test("provisioned, owns nothing → empty", () => {
    expect(updatesViewState(summary())).toBe("empty");
  });
});

describe("formatOccupancy — unsigned whole percent, clamped", () => {
  test.each([
    [0, "0%"],
    [0.96, "96%"],
    [0.965, "97%"], // rounds
    [1, "100%"],
    [1.4, "100%"], // over-1 clamps
    [-0.2, "0%"], // negative clamps
  ])("%d → %s", (input, expected) => {
    expect(formatOccupancy(input)).toBe(expected);
  });
  test("non-finite → 0%", () => {
    expect(formatOccupancy(NaN)).toBe("0%");
    expect(formatOccupancy(Infinity)).toBe("0%");
  });
});

describe("formatReserves — whole months, singular/plural, guarded", () => {
  test.each([
    [4, "4 months"],
    [1, "1 month"],
    [0, "0 months"],
    [2.6, "3 months"], // rounds
  ])("%d → %s", (input, expected) => {
    expect(formatReserves(input)).toBe(expected);
  });
  test("negative / non-finite → 0 months", () => {
    expect(formatReserves(-3)).toBe("0 months");
    expect(formatReserves(NaN)).toBe("0 months");
  });
});

describe("formatRentOnTime — calm on-time / delayed copy", () => {
  test("true → On time", () => {
    expect(formatRentOnTime(true)).toBe(UPDATES_COPY.rentOnTime);
  });
  test("false → Delayed", () => {
    expect(formatRentOnTime(false)).toBe(UPDATES_COPY.rentDelayed);
  });
});

describe("describeUpdate — text equivalent", () => {
  test("up-to-date card names operator, occupancy, reserves, rent, and the note", () => {
    const text = describeUpdate(card());
    expect(text).toContain("The Monroe");
    expect(text).toContain("Tampa, FL");
    expect(text).toContain("Maria Alvarez");
    expect(text).toContain("96%");
    expect(text).toContain("4 months");
    expect(text).toContain("on time");
    expect(text).toContain("Nothing needs your attention");
    // Not overdue → no overdue note appended.
    expect(text).not.toContain(UPDATES_COPY.overdueNote);
  });

  test("overdue-but-stale card appends the calm overdue note", () => {
    const text = describeUpdate(card({ overdue: true }));
    expect(text).toContain(UPDATES_COPY.overdueNote);
  });

  test("never-updated card (latest null) describes the awaiting note", () => {
    const text = describeUpdate(card({ latest: null, overdue: true }));
    expect(text).toContain("The Monroe");
    expect(text).toContain(UPDATES_COPY.awaitingNote);
  });
});

describe("no crypto vocabulary on the Updates surface (spine I6 / NFR3)", () => {
  test("every UPDATES_COPY value is crypto-clean", () => {
    for (const value of Object.values(UPDATES_COPY)) {
      expect(hasCryptoVocabulary(value)).toBe(false);
    }
  });

  test("a rendered up-to-date card description stays crypto-clean", () => {
    expect(hasCryptoVocabulary(describeUpdate(card()))).toBe(false);
  });

  test("a rendered overdue card description stays crypto-clean", () => {
    expect(hasCryptoVocabulary(describeUpdate(card({ overdue: true })))).toBe(false);
  });

  test("a rendered awaiting (never-updated) card description stays crypto-clean", () => {
    expect(hasCryptoVocabulary(describeUpdate(card({ latest: null, overdue: true })))).toBe(false);
  });
});
