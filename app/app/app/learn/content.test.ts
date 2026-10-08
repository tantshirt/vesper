import { describe, expect, test } from "vitest";
import { LEARN_COPY, LEARN_SECTIONS } from "./content";

describe("investor education copy", () => {
  const copy = [
    ...Object.values(LEARN_COPY),
    ...LEARN_SECTIONS.flatMap((section) => Object.values(section)),
  ].join(" ");

  test("covers ownership, returns, resale, and risk", () => {
    expect(LEARN_SECTIONS.map((section) => section.eyebrow)).toEqual([
      "Ownership",
      "Returns",
      "Resale",
      "Risk",
    ]);
  });

  test("uses qualified return language and rejects misleading claims", () => {
    expect(copy).toContain("Target net yield");
    expect(copy).toContain("Target, not guaranteed.");
    expect(copy.toLowerCase()).not.toMatch(/instant exit|approved by ai|guaranteed return/);
  });
});
