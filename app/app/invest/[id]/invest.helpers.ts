// Story 3.1 · Invest-flow entry — pure state/decision logic + consumer copy (no JSX/React),
// so the gate state machine and the no-crypto-vocabulary invariant are unit-testable without a DOM.
//
// Consumer surface rule (spine I6 / NFR3): NONE of the copy below may contain crypto vocabulary
// (wallet, gas, tx, mint, seed phrase, blockchain). The embedded self-custodial account stays
// fully abstracted — its address is never surfaced to the user. `hasCryptoVocabulary` locks this.

// Discriminated gate state the route renders one screen per. Story 3.2 repurposes the terminal
// `ready` into the KYC → eligible/restricted eligibility gate that sits between provisioning and
// the (still-disabled) Epic 4 handoff.
export type InvestGateState =
  | "loading"
  | "not-found"
  | "signup"
  | "provisioning"
  | "kyc"
  | "restricted"
  | "eligible";

// KYC status as stored on the Convex user (schema `users.kycStatus`).
export type KycStatus = "none" | "pending" | "verified" | "failed";

// Minimal shape of the reactive Convex user we read here (the full Doc is a superset).
export interface InvestUser {
  walletAddress?: string | null;
}

function isNonEmpty(value?: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Resolve which screen to show. Order matters (state precedence per the spec):
// loading → not-found → signup → provisioning → (kycStatus !== "verified" ⇒ kyc)
// → (eligible === false ⇒ restricted) → (eligible === true ⇒ eligible).
// `walletAddress` is the already-resolved embedded address (Privy live wallet, falling back to the
// mirrored value on the Convex user). While verified-but-eligibility-unresolved, we hold on the
// loading affordance rather than flashing `restricted`. `eligible` is the per-property eligibility
// doc's flag (null when no doc exists yet for this property, even if the user is verified elsewhere).
export function investGateState(input: {
  privyReady: boolean;
  isAuthenticated: boolean;
  walletAddress?: string | null;
  propertyLoaded: boolean;
  propertyFound: boolean;
  kycStatus?: KycStatus | null;
  eligibilityLoaded: boolean;
  eligible?: boolean | null;
}): InvestGateState {
  const {
    privyReady,
    isAuthenticated,
    walletAddress,
    propertyLoaded,
    propertyFound,
    kycStatus,
    eligibilityLoaded,
    eligible,
  } = input;

  // Privy still initializing, or the property query hasn't resolved yet → calm loading.
  if (!privyReady || !propertyLoaded) return "loading";
  // Property query resolved to null → honest not-found (mirrors property-detail).
  if (!propertyFound) return "not-found";
  // Not signed in → passkey/social signup, in place on this property's invest entry.
  if (!isAuthenticated) return "signup";
  // Signed in but the embedded account isn't resolvable yet → calm interstitial (never write null).
  if (!isNonEmpty(walletAddress)) return "provisioning";
  // Account ready but identity not yet verified → the calm identity-check step (retryable on fail).
  if (kycStatus !== "verified") return "kyc";
  // Verified: wait for the reactive eligibility doc before choosing a terminal screen (no flash).
  if (!eligibilityLoaded) return "loading";
  // Verified + eligible → the headroom + E4 handoff screen.
  if (eligible === true) return "eligible";
  // Verified + restricted → the calm waitlist explainer (frozen-by-default ACL mirror).
  if (eligible === false) return "restricted";
  // Verified globally but no eligibility record for THIS property yet → collect it via the kyc step.
  return "kyc";
}

// Remaining Reg A+ headroom for the year, in whole dollars: max(0, limit − investedThisYear).
// Floored (not rounded) so the displayed cap is never shown ABOVE the true 10% figure — a rounded-up
// cap could imply more headroom than the regulation allows. Never negative. `regAInvestedThisYear`
// is 0 until settlement (Epic 4) feeds it. Undefined/NaN → 0.
export function remainingRegAHeadroom(limit?: number | null, invested?: number | null): number {
  const l = typeof limit === "number" && Number.isFinite(limit) ? limit : 0;
  const i = typeof invested === "number" && Number.isFinite(invested) ? invested : 0;
  return Math.floor(Math.max(0, l - i));
}

// Calm, tabular USD display for the headroom figure (whole dollars, no cents).
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
export function formatUsd(amount: number): string {
  return USD_FORMATTER.format(Number.isFinite(amount) ? amount : 0);
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

  // --- Story 3.2: identity check (kyc state) ---
  kycTitle: "A quick identity check",
  kycBody:
    "Confirm a few details so we can complete your eligibility review. This keeps everything above board and takes about a minute.",
  kycCountryLabel: "Where do you live?",
  kycCountryUs: "United States",
  kycCountryOther: "Somewhere else",
  kycIncomeLabel: "Annual income",
  kycNetWorthLabel: "Net worth",
  kycAmountHint: "A rounded figure is fine.",
  kycCta: "Begin identity check",
  kycSubmitting: "Checking…",
  kycRetryNote: "That didn't go through. No harm done — you can try the check again.",

  // --- Story 3.2: restricted jurisdiction (restricted state) ---
  restrictedTitle: "We're not open in your area just yet",
  restrictedBody:
    "Vesper isn't available where you live right now. Join the list and we'll reach out the moment that changes — you won't miss it.",
  restrictedCta: "Join the waitlist",
  restrictedSubmitting: "Adding you…",
  restrictedConfirm: "You're on the list. We'll be in touch.",

  // --- Story 3.2: eligible (eligible state) ---
  eligibleEyebrow: "You're all set",
  eligibleTitle: "You're ready to invest",
  eligibleHeadroomLabel: "Available to invest this year",
  eligibleHeadroomNote:
    "This is a yearly guideline based on the income and net worth you shared. It's here as guidance, not a wall.",
  eligibleCta: "Continue to your investment",
  eligibleNote: "The next step is coming soon.",
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
