import { query, mutation } from "./_generated/server";
import { writeAudit } from "./audit";

// E1.1 AC: "a user signs in with Privy → Convex trusts the JWT → resolves the user in a reactive query."
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", identity.subject))
      .unique();
  },
});

// Idempotently provision the Convex user for the authenticated Privy identity.
// Called client-side on first authenticated load.
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_privyId", (q) => q.eq("privyId", identity.subject))
      .unique();
    if (existing) return existing._id;

    const userId = await ctx.db.insert("users", {
      privyId: identity.subject,
      kycStatus: "none",
      createdAt: Date.now(),
    });

    // FR16: creating a user is an auditable state change.
    await writeAudit(ctx, {
      actor: identity.subject,
      action: "user.created",
      target: userId,
    });

    return userId;
  },
});
