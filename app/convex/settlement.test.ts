import { describe, expect, test } from "vitest";
import {
  PLATFORM_FEE_RATE,
  MAX_PURCHASE,
  REQUIRED_RISK_ACK_COUNT,
  platformFeeCents,
  totalChargedCents,
  settledOrdersTotal,
  spendableBalance,
  ownershipBasis,
  isValidPurchaseAmount,
  distinctAckCount,
  hasRequiredRiskAcks,
  businessGateDecision,
  settlementDecision,
  dvpSettle,
} from "./settlement";
import { platformFee, totalChargedToday } from "../app/app/invest/[id]/order.helpers";
import { ownershipFraction } from "../app/app/invest/[id]/calculator.helpers";
import type { Id } from "./_generated/dataModel";

// Story 4.4 — locks the atomic-settlement invariants without a Convex ctx (repo's pure-helper + vitest
// convention): the charge math (and its parity with the previewed order.helpers figures), the
// spendable-balance summation, the ownership basis (parity with the calculator projection), distinct-
// ack counting, the pre-DvP business gates, and the full settlement-decision I/O matrix (every failure
// reason, the happy path, and the boundaries). This covers the pure decision layer ONLY — the mutation
// orchestration (auth resolution, order insert/patch, holding upsert, audit writes) is not exercised
// here (it needs a Convex ctx harness the repo does not use). No DOM.

// A settled-order row shape for the summation helpers.
const settled = (amount: number, platformFee: number) =>
  ({ amount, platformFee, status: "settled" as const });

// Base decision input for the happy path — each test overrides only the field under exercise.
const okInput = {
  eligible: true,
  tokenAclState: "thawed" as const,
  acknowledgedRiskCount: REQUIRED_RISK_ACK_COUNT,
  regAAnnualLimit: 10_000,
  regAInvestedThisYear: 0,
  amount: 100,
  total: 100.9,
  spendable: 500,
  dvpConfirmed: true,
};

describe("constants", () => {
  test("platform fee rate is 0.9%", () => {
    expect(PLATFORM_FEE_RATE).toBe(0.009);
  });
  test("required risk acks is three", () => {
    expect(REQUIRED_RISK_ACK_COUNT).toBe(3);
  });
});

describe("platformFeeCents / totalChargedCents — charge math", () => {
  test.each([
    [0, 0, 0],
    [50, 0.45, 50.45],
    [100, 0.9, 100.9],
    [250, 2.25, 252.25],
    [1000, 9, 1009],
  ])("amount %d → fee %d, total %d", (amount, fee, total) => {
    expect(platformFeeCents(amount)).toBe(fee);
    expect(totalChargedCents(amount)).toBe(total);
  });

  test("non-finite / negative amounts are neutralized to 0", () => {
    for (const bad of [NaN, Infinity, -Infinity, -100]) {
      expect(platformFeeCents(bad)).toBe(0);
      expect(totalChargedCents(bad)).toBe(0);
    }
  });

  test("total equals investment (cents-rounded) plus the displayed fee", () => {
    for (const amount of [50, 50.555, 100, 137, 999.99]) {
      const investment = Math.round(Math.max(0, amount) * 100) / 100;
      expect(totalChargedCents(amount)).toBeCloseTo(investment + platformFeeCents(amount), 10);
    }
  });
});

describe("PARITY — settlement charge math equals the previewed order.helpers figures", () => {
  test.each([0, 50, 50.555, 100, 137, 250, 999.99, 1000, 25000])(
    "amount %d matches order.helpers to the penny",
    (amount) => {
      expect(platformFeeCents(amount)).toBe(platformFee(amount));
      expect(totalChargedCents(amount)).toBe(totalChargedToday(amount));
    },
  );
});

describe("settledOrdersTotal — cumulative settled debit", () => {
  test("empty → 0", () => {
    expect(settledOrdersTotal([])).toBe(0);
  });

  test("sums amount + platformFee over settled orders only", () => {
    expect(
      settledOrdersTotal([
        settled(100, 0.9),
        settled(250, 2.25),
      ]),
    ).toBeCloseTo(353.15, 10);
  });

  test("ignores pending and failed orders (a failed order carries no charge)", () => {
    expect(
      settledOrdersTotal([
        settled(100, 0.9),
        { amount: 500, platformFee: 4.5, status: "pending" },
        { amount: 999, platformFee: 8.99, status: "failed" },
      ]),
    ).toBeCloseTo(100.9, 10);
  });
});

describe("spendableBalance — settled deposits minus settled-order totals", () => {
  test("deposits with no orders → full available balance", () => {
    expect(
      spendableBalance([{ amountUsd: 500, status: "settled" }], []),
    ).toBe(500);
  });

  test("a settled order reduces spendable by amount + fee", () => {
    expect(
      spendableBalance(
        [{ amountUsd: 500, status: "settled" }],
        [settled(100, 0.9)],
      ),
    ).toBeCloseTo(399.1, 10);
  });

  test("pending/failed deposits and orders never move the balance", () => {
    expect(
      spendableBalance(
        [
          { amountUsd: 500, status: "settled" },
          { amountUsd: 999, status: "pending" },
        ],
        [
          settled(100, 0.9),
          { amount: 200, platformFee: 1.8, status: "failed" },
        ],
      ),
    ).toBeCloseTo(399.1, 10);
  });
});

describe("ownershipBasis — amount / offeringSize, clamped", () => {
  test("zero / non-positive offering size → 0 (no fabricated fraction)", () => {
    expect(ownershipBasis(100, 0)).toBe(0);
    expect(ownershipBasis(100, -5)).toBe(0);
  });

  test("clamped to [0, 1]", () => {
    expect(ownershipBasis(2_000_000, 1_000_000)).toBe(1);
    expect(ownershipBasis(-100, 1_000_000)).toBe(0);
  });

  test("PARITY — mirrors calculator.ownershipFraction", () => {
    for (const [amount, size] of [
      [100, 1_240_000],
      [50, 1_240_000],
      [250, 1_240_000],
      [999_999, 1_240_000],
      [100, 0],
    ] as const) {
      expect(ownershipBasis(amount, size)).toBe(ownershipFraction(amount, size));
    }
  });
});

describe("isValidPurchaseAmount — finite, >= min, <= cap", () => {
  test.each([50, 100, 137.5, MAX_PURCHASE])("accepts %d (min 50)", (amount) => {
    expect(isValidPurchaseAmount(amount, 50)).toBe(true);
  });

  test.each([49, 0, -100, NaN, Infinity, -Infinity, MAX_PURCHASE + 1])(
    "rejects %d (min 50)",
    (amount) => {
      expect(isValidPurchaseAmount(amount, 50)).toBe(false);
    },
  );
});

describe("dvpSettle — the stub seam", () => {
  test("confirms synchronously with a clearly-marked stub signature", () => {
    const result = dvpSettle("order_abc" as Id<"orders">);
    expect(result.confirmed).toBe(true);
    expect(result.dvpTxSig).toBe("STUB-DVP-order_abc");
  });

  test("fails closed when unsafe stubs are not enabled", () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldStubFlag = process.env.VESPER_ENABLE_UNSAFE_STUBS;
    process.env.NODE_ENV = "production";
    delete process.env.VESPER_ENABLE_UNSAFE_STUBS;
    try {
      const result = dvpSettle("order_abc" as Id<"orders">);
      expect(result.confirmed).toBe(false);
      expect(result.dvpTxSig).toBe("");
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      if (oldStubFlag === undefined) delete process.env.VESPER_ENABLE_UNSAFE_STUBS;
      else process.env.VESPER_ENABLE_UNSAFE_STUBS = oldStubFlag;
    }
  });
});

describe("risk acknowledgements — duplicates and fake ids never satisfy consent", () => {
  test("counts distinct ids", () => {
    expect(distinctAckCount(["illiquidity", "loss", "not-insured"])).toBe(3);
  });
  test("canonical ids are required", () => {
    expect(hasRequiredRiskAcks(["illiquidity", "loss", "not-insured"])).toBe(true);
    expect(hasRequiredRiskAcks(["a", "b", "c"])).toBe(false);
  });
  test("empty → 0", () => {
    expect(distinctAckCount([])).toBe(0);
  });
  test("duplicates collapse (a crafted ['x','x','x'] is one distinct ack)", () => {
    expect(distinctAckCount(["x", "x", "x"])).toBe(1);
  });
  test("mixed duplicates count once each", () => {
    expect(distinctAckCount(["loss", "loss", "illiquidity"])).toBe(2);
  });
});

describe("businessGateDecision — the pre-DvP gates (invoked BEFORE the seam)", () => {
  test("all business gates pass → ok (the mutation may then call dvpSettle)", () => {
    expect(businessGateDecision(okInput)).toEqual({ ok: true });
  });
  test("closed/funded offering → offering-unavailable", () => {
    expect(businessGateDecision({ ...okInput, propertyStatus: "funded" })).toEqual({
      ok: false,
      reason: "offering-unavailable",
    });
  });
  test("purchase beyond remaining offering capacity → offering-unavailable", () => {
    expect(
      businessGateDecision({
        ...okInput,
        offeringSize: 1_000,
        offeringSettledAmount: 950,
        amount: 100,
      }),
    ).toEqual({ ok: false, reason: "offering-unavailable" });
  });
  test("ineligible / frozen / short consent → ineligible", () => {
    expect(businessGateDecision({ ...okInput, eligible: false })).toEqual({ ok: false, reason: "ineligible" });
    expect(businessGateDecision({ ...okInput, tokenAclState: "frozen" })).toEqual({ ok: false, reason: "ineligible" });
    expect(businessGateDecision({ ...okInput, acknowledgedRiskCount: 2 })).toEqual({ ok: false, reason: "ineligible" });
    expect(businessGateDecision({ ...okInput, hasRequiredRiskAcks: false })).toEqual({
      ok: false,
      reason: "ineligible",
    });
  });
  test("over Reg A+ cap → reg-a-cap", () => {
    expect(businessGateDecision({ ...okInput, regAInvestedThisYear: 9_950, amount: 100 })).toEqual({
      ok: false,
      reason: "reg-a-cap",
    });
  });
  test("insufficient balance → insufficient-funds", () => {
    expect(businessGateDecision({ ...okInput, total: 100.9, spendable: 100 })).toEqual({
      ok: false,
      reason: "insufficient-funds",
    });
  });
  test("never returns dvp-failed (the seam is not its concern)", () => {
    // A blocked business gate resolves before DvP is ever consulted — the mutation only calls the seam
    // when this returns ok, so 'dvp-failed' can never originate here.
    const blocked = businessGateDecision({ ...okInput, spendable: 0 });
    expect(blocked).toEqual({ ok: false, reason: "insufficient-funds" });
  });
});

describe("settlementDecision — the I/O matrix", () => {
  test("happy path: eligible+thawed, all acks, within cap, funded, DvP confirms → ok", () => {
    expect(settlementDecision(okInput)).toEqual({ ok: true });
  });

  describe("ineligible / ACL frozen / no consent → reason 'ineligible'", () => {
    test("eligibility not eligible", () => {
      expect(settlementDecision({ ...okInput, eligible: false })).toEqual({
        ok: false,
        reason: "ineligible",
      });
    });
    test("token ACL frozen", () => {
      expect(settlementDecision({ ...okInput, tokenAclState: "frozen" })).toEqual({
        ok: false,
        reason: "ineligible",
      });
    });
    test("no eligibility row (null ACL state)", () => {
      expect(
        settlementDecision({ ...okInput, eligible: false, tokenAclState: null }),
      ).toEqual({ ok: false, reason: "ineligible" });
    });
    test("empty acknowledgements", () => {
      expect(settlementDecision({ ...okInput, acknowledgedRiskCount: 0 })).toEqual({
        ok: false,
        reason: "ineligible",
      });
    });
    test("short acknowledgements (two of three)", () => {
      expect(settlementDecision({ ...okInput, acknowledgedRiskCount: 2 })).toEqual({
        ok: false,
        reason: "ineligible",
      });
    });
  });

  describe("over Reg A+ cap → reason 'reg-a-cap'", () => {
    test("invested + amount exceeds the limit", () => {
      expect(
        settlementDecision({ ...okInput, regAInvestedThisYear: 9_950, amount: 100 }),
      ).toEqual({ ok: false, reason: "reg-a-cap" });
    });
    test("limit unset → blocked", () => {
      expect(
        settlementDecision({ ...okInput, regAAnnualLimit: undefined }),
      ).toEqual({ ok: false, reason: "reg-a-cap" });
    });
    test("BOUNDARY: invested + amount exactly equals the limit → ok", () => {
      expect(
        settlementDecision({ ...okInput, regAAnnualLimit: 10_000, regAInvestedThisYear: 9_900, amount: 100 }),
      ).toEqual({ ok: true });
    });
    test("BOUNDARY: one dollar over the limit → reg-a-cap", () => {
      expect(
        settlementDecision({ ...okInput, regAAnnualLimit: 10_000, regAInvestedThisYear: 9_900, amount: 101 }),
      ).toEqual({ ok: false, reason: "reg-a-cap" });
    });
  });

  describe("insufficient balance → reason 'insufficient-funds'", () => {
    test("total exceeds spendable", () => {
      expect(
        settlementDecision({ ...okInput, total: 100.9, spendable: 100 }),
      ).toEqual({ ok: false, reason: "insufficient-funds" });
    });
    test("BOUNDARY: total exactly equals spendable → ok", () => {
      expect(
        settlementDecision({ ...okInput, total: 100.9, spendable: 100.9 }),
      ).toEqual({ ok: true });
    });
    test("BOUNDARY: total one cent over spendable → insufficient-funds", () => {
      expect(
        settlementDecision({ ...okInput, total: 100.91, spendable: 100.9 }),
      ).toEqual({ ok: false, reason: "insufficient-funds" });
    });
  });

  describe("DvP non-confirm → reason 'dvp-failed'", () => {
    test("every gate passes but the DvP seam does not confirm", () => {
      expect(settlementDecision({ ...okInput, dvpConfirmed: false })).toEqual({
        ok: false,
        reason: "dvp-failed",
      });
    });
  });

  describe("gate precedence — the first failing gate wins", () => {
    test("ineligible outranks a cap/balance/DvP failure", () => {
      expect(
        settlementDecision({
          ...okInput,
          eligible: false,
          regAInvestedThisYear: 99_999,
          spendable: 0,
          dvpConfirmed: false,
        }),
      ).toEqual({ ok: false, reason: "ineligible" });
    });
    test("cap outranks a balance/DvP failure", () => {
      expect(
        settlementDecision({
          ...okInput,
          regAInvestedThisYear: 99_999,
          spendable: 0,
          dvpConfirmed: false,
        }),
      ).toEqual({ ok: false, reason: "reg-a-cap" });
    });
    test("balance outranks a DvP failure", () => {
      expect(
        settlementDecision({ ...okInput, spendable: 0, dvpConfirmed: false }),
      ).toEqual({ ok: false, reason: "insufficient-funds" });
    });
  });
});
