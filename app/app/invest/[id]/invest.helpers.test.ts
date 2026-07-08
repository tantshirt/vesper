import { describe, expect, test } from "vitest";
import {
  investGateState,
  shouldMirrorWallet,
  hasCryptoVocabulary,
  INVEST_COPY,
} from "./invest.helpers";

// Story 3.1 · Invest-flow entry helpers — one assertion set per row of the spec's
// I/O & Edge-Case Matrix, plus the idempotency guard and the no-crypto-vocabulary invariant.

const ADDR = "So1anaAddr1111111111111111111111111111111111";
const OTHER = "So1anaAddr2222222222222222222222222222222222";

describe("investGateState — one screen per matrix row", () => {
  const base = {
    privyReady: true,
    isAuthenticated: true,
    walletAddress: null as string | null,
    propertyLoaded: true,
    propertyFound: true,
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

  test("wallet ready, not yet mirrored → ready", () => {
    expect(investGateState({ ...base, walletAddress: ADDR })).toBe("ready");
  });

  test("returning linked user (mirrored address resolves) → ready", () => {
    expect(investGateState({ ...base, walletAddress: ADDR })).toBe("ready");
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
