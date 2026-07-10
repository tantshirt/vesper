import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { findUserByIdentity, identityKey, requireUnsafeStubs } from "./security";

// Story 3.2 — KYC + Reg A+ eligibility.
//
// This module is the eligibility→Token-ACL boundary. Persona is stubbed: `recordEligibility` *is*
// the KYC-result boundary (the live Persona hosted flow + webhook that would call this same mutation
// is deferred). Token ACL is a Convex mirror only here — `tokenAclState` records the authoritative
// eligibility→ACL state; the live on-chain Token-2022 freeze/thaw is a marked boundary deferred to
// Epic 4 (no Convex→chain propagation exists; do NOT fabricate an on-chain call).
//
// Frozen-by-default: `tokenAclState` starts/stays "frozen" and only flips to "thawed" when KYC is
// verified AND the jurisdiction is eligible (self-thaw on eligibility). All mutations resolve the
// caller server-side from the JWT (`getUserIdentity()` → by_privyId) and are idempotent + audited.

// --- Pure helpers (exported for unit tests; no ctx/db access) ---------------------------------

// Reg A+ Tier 2, non-accredited per-investor cap: 10% of the GREATER of annual income or net worth.
// Negative/NaN inputs are floored to 0 so the cap is never negative or garbage.
export function computeRegALimit(input: { annualIncome: number; netWorth: number }): number {
  const income = Number.isFinite(input.annualIncome) ? Math.max(0, input.annualIncome) : 0;
  const netWorth = Number.isFinite(input.netWorth) ? Math.max(0, input.netWorth) : 0;
  return 0.1 * Math.max(income, netWorth);
}

// Jurisdiction rule (MVP allowlist): US ("US" / "United States", case/space-insensitive) is
// eligible; anything else is restricted → waitlist. State-by-state blue-sky handling is out of scope.
export function isEligibleJurisdiction(jurisdiction: string): boolean {
  const normalized = jurisdiction.trim().toLowerCase();
  return normalized === "us" || normalized === "united states";
}

// --- Query ------------------------------------------------------------------------------------

// Returns the caller's eligibility doc for this property (or null). Reactive: the page waits on
// this to resolve before choosing between the eligible/restricted screens (no flash of restricted).
export const getEligibility = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await findUserByIdentity(ctx, identity);
    if (!user) return null;

    return await ctx.db
      .query("eligibility")
      .withIndex("by_user_property", (q) =>
        q.eq("userId", user._id).eq("propertyId", propertyId),
      )
      .unique();
  },
});

// --- Mutations --------------------------------------------------------------------------------

// Records the (stubbed-Persona) KYC result and mirrors eligibility into the Token-ACL state.
// - !verified → kycStatus="failed" + audit kyc.failed, then return (no thaw, no throw).
// - verified → kycStatus="verified", compute+patch regAAnnualLimit, upsert the eligibility row
//   (eligible = isEligibleJurisdiction, tokenAclState = eligible ? "thawed" : "frozen"), audit
//   kyc.verified + eligibility.recorded + acl.thawed|acl.frozen.
// Idempotent: an unchanged eligibility row is a no-op (no duplicate row, no repeat audit churn).
export const recordEligibility = mutation({
  args: {
    propertyId: v.id("properties"),
    jurisdiction: v.string(),
    annualIncome: v.number(),
    netWorth: v.number(),
    verified: v.boolean(),
    personaInquiryId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const actor = identityKey(identity);
    requireUnsafeStubs("Stub KYC");

    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");

    // Identity-check failure: mark failed (idempotently) and audit. No thaw, no throw — retryable.
    if (!args.verified) {
      if (user.kycStatus !== "failed") {
        await ctx.db.patch(user._id, { kycStatus: "failed" });
      }
      await writeAudit(ctx, {
        actor,
        action: "kyc.failed",
        target: user._id,
        meta: { propertyId: args.propertyId },
      });
      return { verified: false as const };
    }

    // Verified path. Compute the Reg A+ cap and persist it on the user (never touch
    // regAInvestedThisYear — that accumulator is fed by settlement in Epic 4).
    const regAAnnualLimit = computeRegALimit({
      annualIncome: args.annualIncome,
      netWorth: args.netWorth,
    });
    // Audit the verification only on an actual transition (status or cap change), so idempotent
    // re-submits of identical data don't spam kyc.verified rows with no matching eligibility change.
    if (user.kycStatus !== "verified" || user.regAAnnualLimit !== regAAnnualLimit) {
      await ctx.db.patch(user._id, { kycStatus: "verified", regAAnnualLimit });
      await writeAudit(ctx, {
        actor,
        action: "kyc.verified",
        target: user._id,
        meta: { propertyId: args.propertyId, regAAnnualLimit },
      });
    }

    const eligible = isEligibleJurisdiction(args.jurisdiction);
    const tokenAclState = eligible ? ("thawed" as const) : ("frozen" as const);

    const existing = await ctx.db
      .query("eligibility")
      .withIndex("by_user_property", (q) =>
        q.eq("userId", user._id).eq("propertyId", args.propertyId),
      )
      .unique();

    // Preserve a previously recorded Persona reference when this (stubbed) call omits it, so a
    // re-record never nulls the link between the eligibility decision and the KYC inquiry.
    const personaInquiryId = args.personaInquiryId ?? existing?.personaInquiryId;

    // Idempotent upsert: skip the write + ACL audit only when the mirror is already in this state.
    const unchanged =
      existing != null &&
      existing.eligible === eligible &&
      existing.jurisdiction === args.jurisdiction &&
      existing.tokenAclState === tokenAclState &&
      existing.personaInquiryId === personaInquiryId;

    if (!unchanged) {
      if (existing) {
        await ctx.db.patch(existing._id, {
          eligible,
          jurisdiction: args.jurisdiction,
          tokenAclState,
          personaInquiryId,
        });
      } else {
        await ctx.db.insert("eligibility", {
          userId: user._id,
          propertyId: args.propertyId,
          eligible,
          jurisdiction: args.jurisdiction,
          tokenAclState,
          personaInquiryId,
        });
      }

      // eligibility.recorded meta carries the decisive regulated-decision inputs (computed cap +
      // jurisdiction) — not raw income/net worth, which stay out of the audit log as PII.
      await writeAudit(ctx, {
        actor,
        action: "eligibility.recorded",
        target: user._id,
        meta: { propertyId: args.propertyId, eligible, jurisdiction: args.jurisdiction, regAAnnualLimit },
      });

      // Convex mirror of the on-chain Token-ACL state (self-thaw on eligibility). The live
      // Token-2022 freeze/thaw is deferred — this audit is the authoritative record here.
      await writeAudit(ctx, {
        actor,
        action: eligible ? "acl.thawed" : "acl.frozen",
        target: user._id,
        meta: { propertyId: args.propertyId },
      });
    }

    return { verified: true as const, eligible, regAAnnualLimit };
  },
});

// Restricted-jurisdiction waitlist join. Idempotent: one row per (user, property); a repeat join
// is a no-op (no duplicate row, no repeat audit). Never a dead-end — always resolves successfully.
export const joinWaitlist = mutation({
  args: {
    propertyId: v.id("properties"),
    jurisdiction: v.string(),
  },
  handler: async (ctx, { propertyId, jurisdiction }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const actor = identityKey(identity);

    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");

    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_user_property", (q) =>
        q.eq("userId", user._id).eq("propertyId", propertyId),
      )
      .unique();
    if (existing) return existing._id; // idempotent no-op — already on the waitlist

    const waitlistId = await ctx.db.insert("waitlist", {
      userId: user._id,
      propertyId,
      jurisdiction,
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      actor,
      action: "waitlist.joined",
      target: user._id,
      meta: { propertyId },
    });

    return waitlistId;
  },
});
