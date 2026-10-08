import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const settlementSource = readFileSync(new URL("./settlement.ts", import.meta.url), "utf8");
const quoteSource = readFileSync(new URL("./purchaseQuote.ts", import.meta.url), "utf8");

describe("Convex runtime boundary", () => {
  test("default-runtime settlement module has no Node or Solana client imports", () => {
    expect(settlementSource).not.toMatch(/node:buffer|@solana\/web3\.js|\.\.\/lib\/solana\/dvp/);
    expect(settlementSource).not.toMatch(/^\s*["']use node["']/m);
  });

  test("live Offering RPC and ABI decoding are isolated in a Node action", () => {
    expect(quoteSource.startsWith('"use node";')).toBe(true);
    expect(quoteSource).toContain('from "../lib/solana/dvp"');
    expect(quoteSource).toContain("internal.settlement.preparePurchaseVerified");
  });
});
