import { describe, expect, test } from "vitest";
import { gateNumberLabel, gateStatusLabel, formatSignedDate, signerText } from "./trustStack.helpers";

// Story 2.3 · Trust Stack helpers — one assertion per row of the spec's I/O & Edge-Case Matrix.

describe("gateNumberLabel — zero-padded structural gate number", () => {
  test("gateNo 0 → GATE 00", () => {
    expect(gateNumberLabel(0)).toBe("GATE 00");
  });
  test("gateNo 7 → GATE 07 (2-digit zero pad)", () => {
    expect(gateNumberLabel(7)).toBe("GATE 07");
  });
});

describe("gateStatusLabel — text-equivalent status (never color/glyph alone)", () => {
  test("passed → Passed", () => {
    expect(gateStatusLabel("passed")).toBe("Passed");
  });
  test("pending → In review", () => {
    expect(gateStatusLabel("pending")).toBe("In review");
  });
  test("failed → Not passed", () => {
    expect(gateStatusLabel("failed")).toBe("Not passed");
  });
});

describe("formatSignedDate — guard falsy values, no Invalid Date", () => {
  test("real epoch ms → 'Mon D' short date", () => {
    // 2026-07-08T12:00:00Z — asserts the short month/day format used across the surface.
    const out = formatSignedDate(Date.UTC(2026, 6, 8, 12));
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
  test("undefined → empty (date segment omitted)", () => {
    expect(formatSignedDate(undefined)).toBe("");
  });
  test("0 → empty (falsy guard, never epoch 1970)", () => {
    expect(formatSignedDate(0)).toBe("");
  });
});

describe("signerText — only the human signer or an honest fallback (never AI)", () => {
  test("named human → verbatim name", () => {
    expect(signerText("A. Okafor")).toBe("A. Okafor");
  });
  test("undefined → 'Signer pending' (never fabricated, never AI)", () => {
    expect(signerText(undefined)).toBe("Signer pending");
  });
  test("blank/whitespace → 'Signer pending'", () => {
    expect(signerText("   ")).toBe("Signer pending");
  });
});
