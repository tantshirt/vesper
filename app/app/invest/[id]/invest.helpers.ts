// Story 3.1 · Invest-flow entry — pure state/decision logic + consumer copy (no JSX/React),
// so the gate state machine and the no-crypto-vocabulary invariant are unit-testable without a DOM.
//
// Consumer surface rule (spine I6 / NFR3): NONE of the copy below may contain crypto vocabulary
// (wallet, gas, tx, mint, seed phrase, blockchain). The embedded self-custodial account stays
// fully abstracted — its address is never surfaced to the user. `hasCryptoVocabulary` locks this.

// Discriminated gate state the route renders one screen per.
export type InvestGateState = "loading" | "not-found" | "signup" | "provisioning" | "ready";

// Minimal shape of the reactive Convex user we read here (the full Doc is a superset).
export interface InvestUser {
  walletAddress?: string | null;
}

function isNonEmpty(value?: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Resolve which screen to show. Order matters: platform readiness → property existence →
// auth → account provisioning. `walletAddress` is the already-resolved embedded address
// (Privy live wallet, falling back to the mirrored value on the Convex user); once it is a
// truthy address the account is usable, so we hand off to the ready state.
export function investGateState(input: {
  privyReady: boolean;
  isAuthenticated: boolean;
  walletAddress?: string | null;
  propertyLoaded: boolean;
  propertyFound: boolean;
}): InvestGateState {
  const { privyReady, isAuthenticated, walletAddress, propertyLoaded, propertyFound } = input;

  // Privy still initializing, or the property query hasn't resolved yet → calm loading.
  if (!privyReady || !propertyLoaded) return "loading";
  // Property query resolved to null → honest not-found (mirrors property-detail).
  if (!propertyFound) return "not-found";
  // Not signed in → passkey/social signup, in place on this property's invest entry.
  if (!isAuthenticated) return "signup";
  // Signed in and the embedded account address is resolvable → account ready.
  if (isNonEmpty(walletAddress)) return "ready";
  // Signed in but the embedded account isn't resolvable yet → calm interstitial (never write null).
  return "provisioning";
}

// Mirror-once guard: attempt the write only when there is a real address AND the provisioned user
// has no linked address yet. No user row (null/undefined) → wait for ensureUser; empty/undefined
// address → never write; already-linked (any non-empty value) → never repoint (the address is
// stable, and repointing would churn the audit log + rewrite the settlement routing key server-side).
export function shouldMirrorWallet(
  currentUser: InvestUser | null | undefined,
  walletAddress?: string | null,
): boolean {
  if (!isNonEmpty(walletAddress)) return false;
  if (currentUser == null) return false;
  if (isNonEmpty(currentUser.walletAddress)) return false;
  return true;
}

// Consumer-visible copy. Deliberately free of crypto vocabulary and of the embedded address.
export const INVEST_COPY = {
  loadingLabel: "One moment…",

  notFoundTitle: "Property not found",
  notFoundCta: "Back to Explore",

  brandEyebrow: "Vesper",
  signupTitle: "Create your account to continue",
  signupBody: "Sign up in seconds with a passkey or your email — no passwords to remember.",
  signupContext: "Investing in",
  signupCta: "Continue",

  provisioningTitle: "Setting up your account",
  provisioningBody: "Just a moment while we get everything ready for you.",

  readyEyebrow: "You're all set",
  readyTitle: "Your account is ready",
  readyConfirm: "Account created",
  readyBody: "Next, you'll choose how much to invest. We'll pick up right here.",
  readyCta: "Continue to your investment",
  readyNote: "The next step is coming soon.",
} as const;

// Forbidden consumer-facing vocabulary (spine I6 / NFR3, AC1). Whole-word matched so innocent
// substrings ("next", "context", "Vegas") never trip the guard; "seed phrase" matches across
// arbitrary whitespace. Used to assert the copy above — and any new route strings — stay clean.
const CRYPTO_VOCABULARY = [
  "wallet",
  "gas",
  "tx",
  "mint",
  "seed phrase",
  "seed",
  "blockchain",
  "crypto",
  "solana",
  "token",
  "coin",
  "web3",
  "on-chain",
  "onchain",
  "custody",
  "custodial",
  "ledger",
];

export function hasCryptoVocabulary(text: string): boolean {
  return CRYPTO_VOCABULARY.some((word) => {
    const pattern = new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "i");
    return pattern.test(text);
  });
}
