import { describe, expect, test } from "vitest";
import { MARKET_COPY, targetYieldDisclosure } from "./content";

describe("market copy", () => {
  test("does not imply resale liquidity without live evidence", () => {
    const copy = Object.values(MARKET_COPY).join(" ").toLowerCase();
    expect(copy).toContain("resale is not currently available");
    expect(copy).toContain("no live resale market data");
    expect(copy).not.toMatch(/instant exit|sell now|approved by ai/);
  });

  test("labels target yield and includes the required disclaimer", () => {
    expect(targetYieldDisclosure(0.062)).toBe(
      "Target net yield 6.2% · Target, not guaranteed.",
    );
  });
});
