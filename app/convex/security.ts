import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

type Identity = {
  subject: string;
  tokenIdentifier?: string | null;
  issuer?: string; // Admin Story 1.1: the scope wall keys off a recognized WorkOS issuer
};

type UserReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

// Minimal auth-bearing ctx shape (query / mutation / action all satisfy it). Kept structural so this
// helper does not couple to a specific Convex ctx type.
type AuthCtx = {
  auth: {
    getUserIdentity(): Promise<
      { subject: string; issuer?: string; tokenIdentifier?: string | null } | null
    >;
  };
};

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

// Admin Story 1.1 — the scope wall, in one predicate. It must be issuer-POSITIVE: "is this a
// recognized WorkOS issuer?", never "is the issuer missing / not privy.io?". The existing consumer
// tests fake identity as `{ subject }` with NO issuer, so an issuer-negative rule would both break
// every one of them AND fail OPEN the day a third provider appears. The prefix is the EXACT WorkOS
// user-management path — matching the bare `https://api.workos.com/` host would silently promote any
// future WorkOS-hosted issuer to a staff issuer (fails open).
const WORKOS_ISSUER_PREFIX = "https://api.workos.com/user_management/";

export function isWorkosIdentity(identity: Identity): boolean {
  return Boolean(identity.issuer?.startsWith(WORKOS_ISSUER_PREFIX));
}

export function devAdminAuthEnabled(): boolean {
  return process.env.VESPER_RUNTIME_ENV === "development" &&
    process.env.VESPER_ENABLE_DEV_ADMIN_AUTH === "true";
}

export function isDevAdminIdentity(identity: Identity): boolean {
  return devAdminAuthEnabled() && identity.issuer === "https://dev-admin.vesper.local";
}

export function isStaffIdentity(identity: Identity): boolean {
  return isWorkosIdentity(identity) || isDevAdminIdentity(identity);
}

// Consumer half of the scope wall: resolve the caller and REFUSE a staff (WorkOS) identity. Every
// consumer write path that provisions a `users` row (e.g. users.ensureUser) must gate on this — see
// the note there for why a staff token would otherwise become a consumer-account factory.
export async function requireConsumer(ctx: AuthCtx): Promise<Identity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  if (isStaffIdentity(identity)) throw new Error("Not authenticated as a consumer");
  return identity;
}

export function identityKey(identity: Identity): string {
  return identity.tokenIdentifier || identity.subject;
}

export async function findUserByIdentity(
  ctx: UserReadCtx,
  identity: Identity,
): Promise<Doc<"users"> | null> {
  // Scope wall (consumer side): a staff (WorkOS) identity must never resolve to a consumer `users`
  // row. Returning null here is what makes a staff token at a consumer function resolve to "no user".
  if (isStaffIdentity(identity)) return null;

  const key = identityKey(identity);
  const user = await ctx.db
    .query("users")
    .withIndex("by_privyId", (q) => q.eq("privyId", key))
    .unique();
  if (user) return user;

  // Migration/test fallback. Production auth should use tokenIdentifier; existing rows
  // may still hold the legacy subject, and convex-test often supplies only subject.
  if (identity.subject !== key) {
    return await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", identity.subject))
      .unique();
  }
  return null;
}

export type DevelopmentStubFeature =
  | "kyc"
  | "funding"
  | "kyb"
  | "aml"
  | "extraction"
  | "dvp"
  | "eligibilityAttestation";

const DEVELOPMENT_STUB_FLAGS: Record<DevelopmentStubFeature, string> = {
  kyc: "VESPER_ENABLE_KYC_STUB",
  funding: "VESPER_ENABLE_FUNDING_STUB",
  kyb: "VESPER_ENABLE_KYB_STUB",
  aml: "VESPER_ENABLE_AML_STUB",
  extraction: "VESPER_ENABLE_EXTRACTION_STUB",
  dvp: "VESPER_ENABLE_DVP_STUB",
  eligibilityAttestation: "VESPER_ENABLE_ELIGIBILITY_ATTEST_STUB",
};

const LEGACY_FEATURE_MAP: Record<string, DevelopmentStubFeature> = {
  "Stub KYC": "kyc",
  "Stub funding": "funding",
  "Stub KYB": "kyb",
  "AML screening": "aml",
  "AI extraction": "extraction",
};

export function developmentStubEnabled(feature: DevelopmentStubFeature): boolean {
  if (process.env.NODE_ENV === "test") return true;
  return (
    process.env.VESPER_RUNTIME_ENV === "development" &&
    process.env[DEVELOPMENT_STUB_FLAGS[feature]] === "true"
  );
}

export function requireDevelopmentStub(
  feature: DevelopmentStubFeature,
  label: string,
): void {
  if (!developmentStubEnabled(feature)) {
    throw new Error(`${label} is disabled until a server-attested provider is configured`);
  }
}

// Compatibility for feature owners still migrating call sites. The former global flag is deliberately
// ignored: every recognized seam maps to its own development-only flag and unknown seams fail closed.
export function unsafeStubsEnabled(): boolean {
  return developmentStubEnabled("dvp");
}

export function requireUnsafeStubs(feature: string): void {
  const mapped = LEGACY_FEATURE_MAP[feature];
  if (!mapped) {
    throw new Error(`${feature} is disabled until a dedicated development flag is configured`);
  }
  requireDevelopmentStub(mapped, feature);
}

// Admin Story 3.2 — the STEP-UP seam (B2 placeholder). The irreversible mint (mintOffering) demands a
// step-up RE-AUTHENTICATION at the moment of the act — proof the operator physically re-authorized this
// one on-chain, irreversible operation, not merely that a valid session exists. The REAL implementation
// is a WebAuthn hardware-key / passkey challenge (blocker B2): mintOffering would present a challenge,
// the operator taps their security key, and this verifies the resulting assertion against the caller's
// registered credential (via ctx) before the mint fires. That provider is not wired in this environment,
// so — mirroring `requireUnsafeStubs` posture exactly — this is a DOCUMENTED STUB: satisfied in test /
// behind the flag so the mint path is exercisable, and REFUSED otherwise (the irreversible act is never
// allowed without a real step-up). `ctx` is accepted now so the real WebAuthn verification (which needs
// the caller identity) drops in behind this signature with no caller change. Flag it pending B2.
export function stepUpEnabled(): boolean {
  if (process.env.NODE_ENV === "test") return true;
  return (
    process.env.VESPER_RUNTIME_ENV === "development" &&
    process.env.VESPER_ENABLE_STEP_UP_STUB === "true"
  );
}

export function requireStepUp(_ctx: unknown, action: string): void {
  if (!stepUpEnabled()) {
    throw new Error(
      `Step-up authentication is required for ${action} (pending B2 WebAuthn hardware-key step-up)`,
    );
  }
}

export function seedWritesEnabled(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    (process.env.VESPER_RUNTIME_ENV === "development" &&
      process.env.VESPER_ENABLE_DEMO_SEED === "true")
  );
}

export function requireSeedWrites(feature: string): void {
  if (!seedWritesEnabled()) {
    throw new Error(`${feature} is disabled unless VESPER_ENABLE_DEMO_SEED=true`);
  }
}

export function normalizeSolanaAddress(address: string): string {
  const normalized = address.trim();
  if (!BASE58_RE.test(normalized) || normalized.length < 32 || normalized.length > 44) {
    throw new Error("Invalid Solana address");
  }
  return normalized;
}

export function isLikelySolanaSignature(signature: string): boolean {
  const normalized = signature.trim();
  return BASE58_RE.test(normalized) && normalized.length >= 64 && normalized.length <= 128;
}
