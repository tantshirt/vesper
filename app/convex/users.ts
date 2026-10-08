import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { PublicKey } from "@solana/web3.js";
import { writeAudit } from "./audit";
import { enqueueEligibilityAttestation } from "./eligibilityAttest";
import { findUserByIdentity, identityKey, requireConsumer } from "./security";

const CHALLENGE_TTL_MS = 5 * 60_000;
const WALLET_LINK_DOMAIN = process.env.VESPER_WALLET_LINK_DOMAIN?.trim() || "vesper.finance";

export function parseSolanaPublicKey(address: string): PublicKey {
  const normalized = address.trim();
  try {
    const key = new PublicKey(normalized);
    if (key.toBase58() !== normalized) throw new Error("Non-canonical address");
    return key;
  } catch {
    throw new Error("Invalid Solana address");
  }
}

function decodeBase64Signature(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error("Invalid wallet signature");
  }
  try {
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.length !== 64) throw new Error("Invalid length");
    return bytes;
  } catch {
    throw new Error("Invalid wallet signature");
  }
}

export async function verifyWalletChallengeSignature(input: {
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const publicKey = parseSolanaPublicKey(input.walletAddress);
  const signature = decodeBase64Signature(input.signature);
  const publicKeyBytes = Uint8Array.from(publicKey.toBytes()).buffer as ArrayBuffer;
  const signatureBytes = Uint8Array.from(signature).buffer as ArrayBuffer;
  const messageBytes = new TextEncoder().encode(input.message).buffer as ArrayBuffer;
  try {
    const verificationKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      verificationKey,
      signatureBytes,
      messageBytes,
    );
  } catch {
    return false;
  }
}

export function walletChallengeMessage(input: {
  domain: string;
  identityKey: string;
  walletAddress: string;
  nonce: string;
  expiresAt: number;
}): string {
  return [
    "Vesper wallet ownership verification",
    `Domain: ${input.domain}`,
    `Identity: ${input.identityKey}`,
    `Address: ${input.walletAddress}`,
    `Nonce: ${input.nonce}`,
    `Expires at: ${new Date(input.expiresAt).toISOString()}`,
    "Purpose: Link this Solana wallet to your Vesper account.",
  ].join("\n");
}

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await findUserByIdentity(ctx, identity);
  },
});

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireConsumer(ctx);
    const actor = identityKey(identity);
    const existing = await findUserByIdentity(ctx, identity);
    if (existing) {
      if (existing.privyId !== actor) await ctx.db.patch(existing._id, { privyId: actor });
      return existing._id;
    }
    const userId = await ctx.db.insert("users", {
      privyId: actor,
      kycStatus: "none",
      createdAt: Date.now(),
    });
    await writeAudit(ctx, { actor, action: "user.created", target: userId });
    return userId;
  },
});

export const requestWalletLinkChallenge = mutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, { walletAddress }) => {
    const identity = await requireConsumer(ctx);
    const actor = identityKey(identity);
    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");

    const normalizedWalletAddress = parseSolanaPublicKey(walletAddress).toBase58();
    if (user.walletAddress && user.walletAddress !== normalizedWalletAddress) {
      throw new Error("Wallet already linked");
    }
    const owner = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedWalletAddress))
      .first();
    if (owner && owner._id !== user._id) {
      throw new Error("Wallet already linked to another account");
    }

    const now = Date.now();
    const expiresAt = now + CHALLENGE_TTL_MS;
    const challengeId = await ctx.db.insert("walletLinkChallenges", {
      userId: user._id,
      identityKey: actor,
      walletAddress: normalizedWalletAddress,
      domain: WALLET_LINK_DOMAIN,
      message: "pending",
      expiresAt,
      createdAt: now,
    });
    const message = walletChallengeMessage({
      domain: WALLET_LINK_DOMAIN,
      identityKey: actor,
      walletAddress: normalizedWalletAddress,
      nonce: challengeId,
      expiresAt,
    });
    await ctx.db.patch(challengeId, { message });
    return { challengeId, message, expiresAt, walletAddress: normalizedWalletAddress };
  },
});

async function linkVerifiedWallet(
  ctx: MutationCtx,
  user: Doc<"users">,
  actor: string,
  walletAddress: string,
  auditAction: string,
) {
  if (user.walletAddress && user.walletAddress !== walletAddress) {
    throw new Error("Wallet already linked");
  }
  const owner = await ctx.db
    .query("users")
    .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
    .first();
  if (owner && owner._id !== user._id) {
    throw new Error("Wallet already linked to another account");
  }
  if (user.walletAddress === walletAddress) return user._id;

  await ctx.db.patch(user._id, { walletAddress });
  await writeAudit(ctx, {
    actor,
    action: auditAction,
    target: user._id,
    meta: { walletAddress },
  });

  const eligibilityRows = await ctx.db
    .query("eligibility")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  for (const row of eligibilityRows) {
    await enqueueEligibilityAttestation(ctx, {
      userId: user._id,
      propertyId: row.propertyId,
      eligible: row.eligible && row.tokenAclState === "thawed",
      forceRetry: true,
    });
  }
  return user._id;
}

export const confirmWalletAddress = mutation({
  args: {
    challengeId: v.id("walletLinkChallenges"),
    signature: v.string(),
  },
  handler: async (ctx, { challengeId, signature }) => {
    const identity = await requireConsumer(ctx);
    const actor = identityKey(identity);
    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");
    const challenge = await ctx.db.get(challengeId);
    if (!challenge || challenge.userId !== user._id || challenge.identityKey !== actor) {
      throw new Error("Wallet challenge not found");
    }
    if (challenge.domain !== WALLET_LINK_DOMAIN) throw new Error("Wallet challenge domain mismatch");
    if (challenge.consumedAt !== undefined) throw new Error("Wallet challenge already used");
    if (Date.now() >= challenge.expiresAt) throw new Error("Wallet challenge expired");

    const valid = await verifyWalletChallengeSignature({
      walletAddress: challenge.walletAddress,
      message: challenge.message,
      signature,
    });
    if (!valid) throw new Error("Wallet signature verification failed");

    // Consumption and linking share one serializable mutation. Concurrent replay retries against the
    // consumed row and fails instead of linking twice.
    await ctx.db.patch(challenge._id, { consumedAt: Date.now() });
    const userId = await linkVerifiedWallet(
      ctx,
      user,
      actor,
      challenge.walletAddress,
      "user.wallet_linked",
    );
    await writeAudit(ctx, {
      actor,
      action: "user.wallet_challenge_consumed",
      target: userId,
      meta: { challengeId, domain: challenge.domain },
    });
    return userId;
  },
});

// Test/migration seam for old embedded-wallet records. Outside tests it requires both an explicit
// development runtime marker and the one-off migration flag.
export const setWalletAddress = mutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, { walletAddress }) => {
    if (
      process.env.NODE_ENV !== "test" &&
      !(
        process.env.VESPER_RUNTIME_ENV === "development" &&
        process.env.VESPER_ALLOW_UNVERIFIED_WALLET_MIGRATION === "true"
      )
    ) {
      throw new Error("Signed wallet ownership proof is required");
    }
    const identity = await requireConsumer(ctx);
    const actor = identityKey(identity);
    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");
    const walletAddressNormalized = parseSolanaPublicKey(walletAddress).toBase58();
    return await linkVerifiedWallet(
      ctx,
      user,
      actor,
      walletAddressNormalized,
      "user.wallet_linked_migration",
    );
  },
});
