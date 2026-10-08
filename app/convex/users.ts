import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { findUserByIdentity, identityKey, normalizeSolanaAddress } from "./security";

// E1.1 AC: "a user signs in with Privy → Convex trusts the JWT → resolves the user in a reactive query."
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await findUserByIdentity(ctx, identity);
  },
});

// Idempotently provision the Convex user for the authenticated Privy identity.
// Called client-side on first authenticated load.
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const actor = identityKey(identity);

    const existing = await findUserByIdentity(ctx, identity);
    if (existing) {
      if (existing.privyId !== actor) {
        await ctx.db.patch(existing._id, { privyId: actor });
      }
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      privyId: actor,
      kycStatus: "none",
      createdAt: Date.now(),
    });

    // FR16: creating a user is an auditable state change.
    await writeAudit(ctx, {
      actor,
      action: "user.created",
      target: userId,
    });

    return userId;
  },
});

// Story 3.1 — mirror the Privy embedded (self-custodial Solana) address into the read model.
// Idempotent + auditable (spine I3): the caller is derived server-side from the JWT (never taken
// as an argument), an unchanged address is a no-op, and linking a new address appends an AuditLog
// entry. The address is an internal read-model detail — it is never surfaced to the user.
export const setWalletAddress = mutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, { walletAddress }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const actor = identityKey(identity);
    const normalizedWalletAddress = normalizeSolanaAddress(walletAddress);

    const existing = await findUserByIdentity(ctx, identity);
    if (!existing) throw new Error("User not provisioned");

    // Idempotent: unchanged address is a no-op (no write, no duplicate audit entry).
    if (existing.walletAddress === normalizedWalletAddress) return existing._id;

    // Mirror-once: the embedded wallet address is stable for the life of the account. Never
    // silently repoint an already-linked account to a different address — that would rewrite the
    // on-chain settlement routing key (reconcile.ts `by_wallet`) out from under existing holdings.
    if (existing.walletAddress) {
      throw new Error("Wallet already linked");
    }

    // Uniqueness: the address is the reconciliation routing key, so it must map to at most one
    // account. Reject if another user already mirrors it (guards against collisions / hijack).
    const addrOwner = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedWalletAddress))
      .first();
    if (addrOwner && addrOwner._id !== existing._id) {
      throw new Error("Wallet already linked to another account");
    }

    await ctx.db.patch(existing._id, { walletAddress: normalizedWalletAddress });

    // I3: persisting the wallet address is an auditable state change (record which address).
    await writeAudit(ctx, {
      actor,
      action: "user.wallet_linked",
      target: existing._id,
      meta: { walletAddress: normalizedWalletAddress },
    });

    return existing._id;
  },
});
