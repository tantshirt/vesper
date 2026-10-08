import { describe, expect, test } from "vitest";
import { computeShares, type ShareInput } from "./distribution";

// Slice 5 — unit tests for the pure distribution share math (no ctx/db, mirrors income.test.ts's
// pure-helper style). Covers: pro-rata correctness, the sum-NEVER-exceeds-pool invariant, deterministic
// largest-remainder allocation, single holder, zero-token holders excluded, and zero/negative/non-finite
// pools. The central guarantee is that Σ shares can never over-distribute the pool.

// Sum of allocated cents / dollars, for the invariants.
const sumCents = (holders: ShareInput[], pool: number) =>
  computeShares(pool, holders).reduce((s, x) => s + x.cents, 0);
const sumAmount = (holders: ShareInput[], pool: number) =>
  computeShares(pool, holders).reduce((s, x) => s + x.amount, 0);

describe("computeShares — pro-rata correctness", () => {
  test("splits ∝ weight (3:1 of $100 → $75 / $25)", () => {
    const shares = computeShares(100, [
      { id: "a", weight: 3 },
      { id: "b", weight: 1 },
    ]);
    expect(shares.map((s) => s.amount)).toEqual([75, 25]);
    expect(shares.map((s) => s.cents)).toEqual([7500, 2500]);
  });

  test("equal weights of a cleanly-divisible pool split evenly", () => {
    const shares = computeShares(90, [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
    ]);
    expect(shares.map((s) => s.amount)).toEqual([30, 30, 30]);
  });

  test("aligns output 1:1 to input holders (by id, in order)", () => {
    const shares = computeShares(50, [
      { id: "x", weight: 1 },
      { id: "y", weight: 1 },
    ]);
    expect(shares.map((s) => s.id)).toEqual(["x", "y"]);
  });
});

describe("computeShares — Σ shares NEVER exceeds the pool", () => {
  test("indivisible pool: 3 equal holders of $100 → sum is exactly $100, spread ≤ 1¢", () => {
    const holders = [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
    ];
    const shares = computeShares(100, holders);
    expect(sumCents(holders, 100)).toBe(10000); // exactly the pool, never 10001
    const cents = shares.map((s) => s.cents).sort((a, b) => a - b);
    expect(cents[cents.length - 1] - cents[0]).toBeLessThanOrEqual(1); // fair: at most a 1¢ spread
  });

  test("sub-cent pool floors down, never rounds up over the pool", () => {
    // $0.005 across two holders: flooring to whole cents yields 0¢ (rounding up would over-distribute).
    const holders = [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
    ];
    expect(sumAmount(holders, 0.005)).toBe(0);
    // $0.999 → 99¢ (never 100¢), still ≤ the pool.
    expect(sumAmount(holders, 0.999)).toBeCloseTo(0.99, 10);
    expect(sumAmount(holders, 0.999)).toBeLessThanOrEqual(0.999);
  });

  test("invariant across many awkward pools/weightings: Σ ≤ pool, and == floored-pool when eligible", () => {
    const configs: { pool: number; weights: number[] }[] = [
      { pool: 100, weights: [1, 1, 1] },
      { pool: 62.62, weights: [20000, 16000, 12000] },
      { pool: 33.33, weights: [7, 3, 1, 1] },
      { pool: 1000.01, weights: [5, 5, 5, 5, 5, 5, 1] },
      { pool: 0.07, weights: [1, 1, 1] },
      { pool: 999.99, weights: [123, 456, 789] },
    ];
    for (const { pool, weights } of configs) {
      const holders = weights.map((w, i) => ({ id: `h${i}`, weight: w }));
      const shares = computeShares(pool, holders);
      const total = shares.reduce((s, x) => s + x.cents, 0);
      const flooredPoolCents = Math.floor(pool * 100 + 1e-6);
      expect(total).toBe(flooredPoolCents); // exact — no under- and no over-distribution
      expect(total / 100).toBeLessThanOrEqual(pool); // Σ shares never exceeds the pool
      expect(shares.every((x) => x.cents >= 0)).toBe(true); // never negative
    }
  });
});

describe("computeShares — deterministic remainder allocation (largest-remainder → biggest holder)", () => {
  test("the leftover cent goes to the largest fractional remainder", () => {
    // $1.00 across 2:1 → exact 66.66¢ / 33.33¢, floors 66/33 (=99), 1¢ leftover to the bigger remainder.
    const shares = computeShares(1, [
      { id: "big", weight: 2 },
      { id: "small", weight: 1 },
    ]);
    expect(shares.map((s) => s.cents)).toEqual([67, 33]);
    expect(shares[0].cents + shares[1].cents).toBe(100);
  });

  test("equal-remainder tie breaks toward the biggest holder, then input order", () => {
    // $1.00 across three EQUAL-remainder holders (.333 each), one leftover cent. Weights differ so the
    // tie resolves to the biggest holder deterministically (not the first index).
    const shares = computeShares(1, [
      { id: "small", weight: 1 },
      { id: "big", weight: 1.0000001 },
      { id: "mid", weight: 1 },
    ]);
    const byId = Object.fromEntries(shares.map((s) => [s.id, s.cents]));
    expect(byId.big).toBe(34); // biggest holder wins the tie
    expect(byId.small).toBe(33);
    expect(byId.mid).toBe(33);
    expect(shares.reduce((s, x) => s + x.cents, 0)).toBe(100);
  });

  test("fully deterministic: identical inputs yield identical allocations", () => {
    const holders = [
      { id: "a", weight: 7 },
      { id: "b", weight: 3 },
      { id: "c", weight: 1 },
    ];
    expect(computeShares(55.55, holders)).toEqual(computeShares(55.55, holders));
  });
});

describe("computeShares — single holder", () => {
  test("one holder receives the entire (floored) pool", () => {
    const shares = computeShares(62.5, [{ id: "solo", weight: 7 }]);
    expect(shares).toEqual([{ id: "solo", cents: 6250, amount: 62.5 }]);
  });

  test("one holder, sub-cent pool → $0 (floored, never over)", () => {
    expect(computeShares(0.004, [{ id: "solo", weight: 1 }])).toEqual([
      { id: "solo", cents: 0, amount: 0 },
    ]);
  });
});

describe("computeShares — zero-token holders excluded", () => {
  test("a zero-weight holder gets $0; the pool splits among the rest pro-rata", () => {
    const shares = computeShares(30, [
      { id: "a", weight: 10 },
      { id: "zero", weight: 0 },
      { id: "b", weight: 5 },
    ]);
    const byId = Object.fromEntries(shares.map((s) => [s.id, s.cents]));
    expect(byId.zero).toBe(0); // excluded — never receives a share OR a remainder cent
    expect(byId.a).toBe(2000); // 10/15 of $30 = $20
    expect(byId.b).toBe(1000); // 5/15 of $30 = $10
    expect(shares.reduce((s, x) => s + x.cents, 0)).toBe(3000);
  });

  test.each([0, -5, NaN, Infinity, -Infinity])(
    "non-positive / non-finite weight %s is excluded (gets $0)",
    (w) => {
      const shares = computeShares(10, [
        { id: "ok", weight: 1 },
        { id: "bad", weight: w as number },
      ]);
      const byId = Object.fromEntries(shares.map((s) => [s.id, s.cents]));
      expect(byId.bad).toBe(0);
      expect(byId.ok).toBe(1000); // the whole pool
    },
  );

  test("all holders zero-token → all $0 (no pool distributed, never NaN)", () => {
    const shares = computeShares(100, [
      { id: "a", weight: 0 },
      { id: "b", weight: 0 },
    ]);
    expect(shares.every((s) => s.cents === 0 && s.amount === 0)).toBe(true);
  });
});

describe("computeShares — zero / negative / non-finite pool → all-zero", () => {
  test.each([0, -1, -0.01, NaN, Infinity, -Infinity])(
    "pool %s → every holder $0 (guarded, never NaN/negative)",
    (pool) => {
      const shares = computeShares(pool as number, [
        { id: "a", weight: 1 },
        { id: "b", weight: 2 },
      ]);
      expect(shares.map((s) => s.cents)).toEqual([0, 0]);
      expect(shares.every((s) => Number.isFinite(s.amount))).toBe(true);
    },
  );

  test("empty holder list → empty result (no throw)", () => {
    expect(computeShares(100, [])).toEqual([]);
  });
});
