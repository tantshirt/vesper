import { describe, expect, test } from "vitest";
import {
  SOLANA_CLUSTER,
  truncateAddress,
  explorerAddressUrl,
  explorerTxUrl,
  holderSummary,
} from "./proof.helpers";

// Story 2.4 · On-chain proof helpers — one assertion per row of the spec's I/O & Edge-Case Matrix.

describe("truncateAddress — head…tail, short strings unchanged", () => {
  test("long base58 string → head…tail", () => {
    expect(truncateAddress("6MonRoeSeedM1ntDemo11111111111111111111111")).toBe("6MonRo…1111");
  });
  test("short address (≤ head+tail) rendered unchanged", () => {
    expect(truncateAddress("6MonR111")).toBe("6MonR111");
  });
  test("empty string → empty", () => {
    expect(truncateAddress("")).toBe("");
  });
});

describe("holderSummary — honest empty at 0, singular/plural otherwise", () => {
  test("0 holders → honest empty", () => {
    expect(holderSummary(0)).toBe("No positions have settled yet");
  });
  test("1 holder → singular", () => {
    expect(holderSummary(1)).toBe("1 owner on-chain");
  });
  test("3 holders → plural", () => {
    expect(holderSummary(3)).toBe("3 owners on-chain");
  });
});

describe("explorer URL building — public Solana explorer", () => {
  test("address URL with default devnet cluster", () => {
    expect(explorerAddressUrl("6MonRoeSeedM1ntDemo11111111111111111111111")).toBe(
      "https://explorer.solana.com/address/6MonRoeSeedM1ntDemo11111111111111111111111?cluster=devnet",
    );
  });
  test("address URL honors explicit cluster", () => {
    expect(explorerAddressUrl("ADDR", "mainnet")).toBe(
      "https://explorer.solana.com/address/ADDR?cluster=mainnet",
    );
  });
  test("tx URL with default cluster", () => {
    expect(explorerTxUrl("5xSig")).toBe(
      `https://explorer.solana.com/tx/5xSig?cluster=${SOLANA_CLUSTER}`,
    );
  });
});
