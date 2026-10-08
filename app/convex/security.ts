import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

type Identity = {
  subject: string;
  tokenIdentifier?: string | null;
};

type UserReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function identityKey(identity: Identity): string {
  return identity.tokenIdentifier || identity.subject;
}

export async function findUserByIdentity(
  ctx: UserReadCtx,
  identity: Identity,
): Promise<Doc<"users"> | null> {
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

export function unsafeStubsEnabled(): boolean {
  return process.env.VESPER_ENABLE_UNSAFE_STUBS === "true" || process.env.NODE_ENV === "test";
}

export function requireUnsafeStubs(feature: string): void {
  if (!unsafeStubsEnabled()) {
    throw new Error(`${feature} is disabled until a server-attested provider is configured`);
  }
}

export function seedWritesEnabled(): boolean {
  return process.env.VESPER_ENABLE_DEMO_SEED === "true" || process.env.NODE_ENV === "test";
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
