import { describe, expect, test } from "vitest";
import {
  investGateState,
  shouldMirrorWallet,
  shouldHoldForPurchaseRestore,
  hasCryptoVocabulary,
  remainingRegAHeadroom,
  formatUsd,
  INVEST_COPY,
} from "./invest.helpers";

// Story 3.1 · Invest-flow entry helpers — one assertion set per row of the spec's
// I/O & Edge-Case Matrix, plus the idempotency guard and the no-crypto-vocabulary invariant.

const ADDR = "So1anaAddr1111111111111111111111111111111111";
const OTHER = "So1anaAddr2222222222222222222222222222222222";

describe("purchase reload gate", () => {
  test("holds authenticated UI until the durable operation query resolves", () => {
    expect(shouldHoldForPurchaseRestore(true, undefined)).toBe(true);
    expect(shouldHoldForPurchaseRestore(true, null)).toBe(false);
    expect(shouldHoldForPurchaseRestore(true, { status: "submitted" })).toBe(false);
    expect(shouldHoldForPurchaseRestore(false, undefined)).toBe(false);
  });
});

describe("investGateState — one screen per matrix row", () => {
  const base = {
    privyReady: true,
    isAuthenticated: true,
    walletAddress: null as string | null,
    propertyLoaded: true,
    propertyFound: true,
    kycStatus: "verified" as const,
    eligibilityLoaded: true,
    eligible: true as boolean | null,
    balanceLoaded: true,
    fundedBalance: 500 as number | null,
  };

  test("Privy initializing (ready === false) → loading", () => {
    expect(investGateState({ ...base, privyReady: false })).toBe("loading");
  });

  test("property query not yet resolved → loading", () => {
    expect(investGateState({ ...base, propertyLoaded: false })).toBe("loading");
  });

  test("unknown/invalid property id (query null) → not-found", () => {
    expect(investGateState({ ...base, propertyFound: false })).toBe("not-found");
  });

  test("not-found takes precedence over an unauthenticated visitor", () => {
    expect(
      investGateState({ ...base, isAuthenticated: false, propertyFound: false }),
    ).toBe("not-found");
  });

  test("unauthenticated visitor, property found → signup", () => {
    expect(investGateState({ ...base, isAuthenticated: false })).toBe("signup");
  });

  test("signup done, embedded address not yet resolvable → provisioning", () => {
    expect(investGateState({ ...base, walletAddress: null })).toBe("provisioning");
  });

  test("empty/whitespace address is not treated as ready → provisioning", () => {
    expect(investGateState({ ...base, walletAddress: "   " })).toBe("provisioning");
  });

  test("account ready but identity not yet verified → kyc", () => {
    expect(investGateState({ ...base, walletAddress: ADDR, kycStatus: "none" })).toBe("kyc");
  });

  test("prior identity-check failure keeps the user on kyc (retryable)", () => {
    expect(investGateState({ ...base, walletAddress: ADDR, kycStatus: "failed" })).toBe("kyc");
  });

  test("verified but eligibility doc not yet resolved → loading (never flash restricted)", () => {
    expect(
      investGateState({ ...base, walletAddress: ADDR, eligibilityLoaded: false, eligible: null }),
    ).toBe("loading");
  });

  test("verified + eligible but balance query not yet resolved → loading (never flash funding)", () => {
    expect(
      investGateState({ ...base, walletAddress: ADDR, eligible: true, balanceLoaded: false, fundedBalance: null }),
    ).toBe("loading");
  });

  test("verified + eligible + zero balance → funding (Add Money form)", () => {
    expect(
      investGateState({ ...base, walletAddress: ADDR, eligible: true, balanceLoaded: true, fundedBalance: 0 }),
    ).toBe("funding");
  });

  test("verified + eligible + non-finite/absent balance treated as 0 → funding", () => {
    expect(
      investGateState({ ...base, walletAddress: ADDR, eligible: true, balanceLoaded: true, fundedBalance: null }),
    ).toBe("funding");
    expect(
      investGateState({ ...base, walletAddress: ADDR, eligible: true, balanceLoaded: true, fundedBalance: NaN }),
    ).toBe("funding");
  });

  test("verified + eligible + positive balance → funded", () => {
    expect(
      investGateState({ ...base, walletAddress: ADDR, eligible: true, balanceLoaded: true, fundedBalance: 500 }),
    ).toBe("funded");
  });

  test("verified + restricted jurisdiction → restricted (no funding offered)", () => {
    expect(investGateState({ ...base, walletAddress: ADDR, eligible: false })).toBe("restricted");
  });

  test("verified globally but no eligibility record for this property → kyc", () => {
    expect(
      investGateState({ ...base, walletAddress: ADDR, eligibilityLoaded: true, eligible: null }),
    ).toBe("kyc");
  });
});

describe("remainingRegAHeadroom — remaining dollars, never negative", () => {
  test("full cap when nothing invested yet", () => {
    expect(remainingRegAHeadroom(12_000, 0)).toBe(12_000);
  });

  test("partial headroom after prior investment", () => {
    expect(remainingRegAHeadroom(20_000, 15_000)).toBe(5_000);
  });

  test("never goes negative once the cap is exhausted or exceeded", () => {
    expect(remainingRegAHeadroom(10_000, 10_000)).toBe(0);
    expect(remainingRegAHeadroom(10_000, 12_500)).toBe(0);
  });

  test("floors a fractional cap down to whole dollars (never shown above the true 10%)", () => {
    expect(remainingRegAHeadroom(5_555.5, 0)).toBe(5_555);
    expect(remainingRegAHeadroom(5_555.5, 55.4)).toBe(5_500);
  });

  test("undefined/null/NaN inputs are treated as 0", () => {
    expect(remainingRegAHeadroom(undefined, undefined)).toBe(0);
    expect(remainingRegAHeadroom(null, 5)).toBe(0);
    expect(remainingRegAHeadroom(NaN, NaN)).toBe(0);
    expect(remainingRegAHeadroom(10_000, undefined)).toBe(10_000);
  });
});

describe("formatUsd — calm whole-dollar display", () => {
  test("formats whole dollars with no cents", () => {
    expect(formatUsd(12_000)).toBe("$12,000");
    expect(formatUsd(0)).toBe("$0");
  });

  test("rounds away cents (maximumFractionDigits: 0)", () => {
    expect(formatUsd(12_000.75)).toBe("$12,001");
  });

  test("non-finite input falls back to $0", () => {
    expect(formatUsd(NaN)).toBe("$0");
  });
});

describe("shouldMirrorWallet — one-time, idempotent write guard", () => {
  test("no address yet → false (never write a null/empty address)", () => {
    expect(shouldMirrorWallet({ walletAddress: undefined }, null)).toBe(false);
    expect(shouldMirrorWallet({ walletAddress: undefined }, "")).toBe(false);
    expect(shouldMirrorWallet({ walletAddress: undefined }, "   ")).toBe(false);
  });

  test("user row not provisioned yet → false (wait for ensureUser)", () => {
    expect(shouldMirrorWallet(null, ADDR)).toBe(false);
    expect(shouldMirrorWallet(undefined, ADDR)).toBe(false);
  });

  test("address resolved but not yet mirrored → true", () => {
    expect(shouldMirrorWallet({ walletAddress: undefined }, ADDR)).toBe(true);
    expect(shouldMirrorWallet({ walletAddress: null }, ADDR)).toBe(true);
  });

  test("account already has a linked address → false (mirror-once, never repoint)", () => {
    expect(shouldMirrorWallet({ walletAddress: OTHER }, ADDR)).toBe(false);
  });

  test("already mirrored to the same address → false (idempotent, no repeat write)", () => {
    expect(shouldMirrorWallet({ walletAddress: ADDR }, ADDR)).toBe(false);
  });
});

describe("hasCryptoVocabulary — whole-word forbidden-vocabulary guard", () => {
  test.each(["wallet", "gas", "tx", "mint", "seed phrase", "blockchain", "crypto"])(
    "flags forbidden term: %s",
    (term) => {
      expect(hasCryptoVocabulary(`please review your ${term} now`)).toBe(true);
    },
  );

  test("matches 'seed phrase' across arbitrary whitespace", () => {
    expect(hasCryptoVocabulary("your seed   phrase")).toBe(true);
  });

  test("does not trip on innocent substrings", () => {
    expect(hasCryptoVocabulary("Continue to the next context in Las Vegas")).toBe(false);
  });

  test("case-insensitive", () => {
    expect(hasCryptoVocabulary("Your WALLET is ready")).toBe(true);
  });
});

describe("no-crypto-vocabulary invariant — every consumer copy constant is clean", () => {
  test.each(Object.entries(INVEST_COPY))("INVEST_COPY.%s contains no crypto vocabulary", (_key, value) => {
    expect(hasCryptoVocabulary(value)).toBe(false);
  });
});
