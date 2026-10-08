import { describe, expect, test } from "vitest";
import { hasCryptoVocabulary } from "./invest.helpers";
import {
  CONFIRMATION_COPY,
  formatDistributionDate,
  formatConfirmationRef,
} from "./confirmation.helpers";

// Story 4.5 · Confirmation ("You're an owner") — lock the two pure formatters (valid/missing/malformed
// date, no-TZ-drift, ref normal/empty/short) and the consumer-copy no-crypto-vocabulary invariant.
// Pure, no DOM.

describe("formatDistributionDate", () => {
  test("formats a valid YYYY-MM-DD as a long US date", () => {
    expect(formatDistributionDate("2026-08-31")).toBe("August 31, 2026");
  });

  test("formats month and day without zero-padding artifacts", () => {
    expect(formatDistributionDate("2026-01-05")).toBe("January 5, 2026");
  });

  test("parses as UTC — no timezone drift off the date-only string", () => {
    // A naive local-time parse of "2026-08-31" in a negative-offset zone would roll back to Aug 30.
    // UTC parsing must keep it on the 31st regardless of the runner's timezone.
    expect(formatDistributionDate("2026-08-31")).toBe("August 31, 2026");
    expect(formatDistributionDate("2026-01-01")).toBe("January 1, 2026");
  });

  test("returns null for undefined (missing field)", () => {
    expect(formatDistributionDate(undefined)).toBeNull();
  });

  test("returns null for an empty string", () => {
    expect(formatDistributionDate("")).toBeNull();
  });

  test("returns null for a malformed date string", () => {
    expect(formatDistributionDate("August 31, 2026")).toBeNull();
    expect(formatDistributionDate("2026/08/31")).toBeNull();
    expect(formatDistributionDate("2026-8-31")).toBeNull();
    expect(formatDistributionDate("not-a-date")).toBeNull();
  });

  test("returns null for an out-of-range / overflow date", () => {
    expect(formatDistributionDate("2026-02-31")).toBeNull();
    expect(formatDistributionDate("2026-13-01")).toBeNull();
    expect(formatDistributionDate("2026-00-10")).toBeNull();
  });

  test("never returns the string 'Invalid Date'", () => {
    for (const input of ["", "nope", "2026-13-40", "2026-02-30"]) {
      expect(formatDistributionDate(input)).not.toBe("Invalid Date");
    }
  });
});

describe("formatConfirmationRef", () => {
  test("derives a VSP- prefixed, uppercased ref from the last 8 chars of the order id", () => {
    expect(formatConfirmationRef("k57abcd1234efgh")).toBe("VSP-1234EFGH");
  });

  test("is deterministic for the same order id", () => {
    const id = "jd7xyz9012qrst";
    expect(formatConfirmationRef(id)).toBe(formatConfirmationRef(id));
  });

  test("handles a short id (fewer than 8 chars) without throwing", () => {
    expect(formatConfirmationRef("abc")).toBe("VSP-ABC");
  });

  test("returns a safe fallback for an empty id", () => {
    expect(formatConfirmationRef("")).toBe("VSP-PENDING");
  });

  test("returns a safe fallback for a whitespace-only id", () => {
    expect(formatConfirmationRef("   ")).toBe("VSP-PENDING");
  });
});

describe("no-crypto-vocabulary invariant — every confirmation string is clean", () => {
  test.each(Object.entries(CONFIRMATION_COPY))(
    "CONFIRMATION_COPY.%s contains no crypto vocabulary",
    (_key, value) => {
      expect(hasCryptoVocabulary(value)).toBe(false);
    },
  );

  test("the derived confirmation reference contains no crypto vocabulary", () => {
    expect(hasCryptoVocabulary(formatConfirmationRef("k57abcd1234efgh"))).toBe(false);
    expect(hasCryptoVocabulary(formatConfirmationRef(""))).toBe(false);
  });
});
