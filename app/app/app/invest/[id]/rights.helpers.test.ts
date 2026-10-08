import { describe, expect, test } from "vitest";
import { hasCryptoVocabulary } from "./invest.helpers";
import {
  RIGHTS_ACKS,
  REQUIRED_ACK_COUNT,
  allAcknowledged,
  RIGHTS_COPY,
} from "./rights.helpers";

// Story 4.3 · Rights & risk acknowledgement — lock the count, the unique ids, the "all three checked"
// consent gate (FR9), and the consumer-copy no-crypto-vocabulary invariant. Pure, no DOM.

const IDS = RIGHTS_ACKS.map((a) => a.id);
const allTrue = () => Object.fromEntries(IDS.map((id) => [id, true]));

describe("acknowledgement set", () => {
  test("there are exactly three required acknowledgements", () => {
    expect(REQUIRED_ACK_COUNT).toBe(3);
    expect(RIGHTS_ACKS).toHaveLength(3);
  });

  test("all acknowledgement ids are unique", () => {
    expect(new Set(IDS).size).toBe(IDS.length);
  });
});

describe("allAcknowledged — the consent gate (FR9)", () => {
  test("empty state is not acknowledged", () => {
    expect(allAcknowledged({})).toBe(false);
  });

  test("one id true is not enough", () => {
    expect(allAcknowledged({ [IDS[0]]: true })).toBe(false);
  });

  test("two ids true is not enough", () => {
    expect(allAcknowledged({ [IDS[0]]: true, [IDS[1]]: true })).toBe(false);
  });

  test("all three ids true satisfies the gate", () => {
    expect(allAcknowledged(allTrue())).toBe(true);
  });

  test("two required true plus an unknown id true still fails (unknown keys never satisfy)", () => {
    expect(
      allAcknowledged({ [IDS[0]]: true, [IDS[1]]: true, "made-up-key": true }),
    ).toBe(false);
  });

  test("a required id explicitly false (others true) fails", () => {
    expect(allAcknowledged({ ...allTrue(), [IDS[0]]: false })).toBe(false);
  });
});

describe("no-crypto-vocabulary invariant — every consumer string is clean", () => {
  test.each(Object.entries(RIGHTS_COPY))(
    "RIGHTS_COPY.%s contains no crypto vocabulary",
    (_key, value) => {
      expect(hasCryptoVocabulary(value)).toBe(false);
    },
  );

  test.each(RIGHTS_ACKS.map((a) => [a.id, a.label] as const))(
    "RIGHTS_ACKS[%s] label contains no crypto vocabulary",
    (_id, label) => {
      expect(hasCryptoVocabulary(label)).toBe(false);
    },
  );
});
