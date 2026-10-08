import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import {
  developmentStubEnabled,
  findUserByIdentity,
  identityKey,
  requireDevelopmentStub,
} from "./security";
import { enqueueEligibilityAttestation } from "./eligibilityAttest";

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

export function regulatoryYear(now = Date.now()): number {
  return new Date(now).getUTCFullYear();
}

// Reg A+ per-investor cap STATUS for the compliance-oversight view (Admin 5.2). Pure + ctx-free.
//
// ENFORCEMENT AUTHORITY: `settlement.businessGateDecision` is the single place a purchase is blocked —
// its inline rule is `typeof limit !== "number" || !Number.isFinite(limit) || invested + amount > limit`
// ⇒ reason "reg-a-cap" (an unset/non-finite limit blocks entirely). This helper does NOT enforce; it
// MIRRORS that same rule for a read-only headroom view so the oversight surface and the settlement gate
// can never disagree:
//   • unset / non-finite limit ⇒ "over" (blocking — exactly settlement's "unset limit blocks"),
//   • cumulative invested at/above the limit ⇒ "over" (settlement's `invested + amount > limit` at the
//     boundary: any further amount > 0 breaches),
//   • ≥80% of the cap consumed ⇒ "near" (a headroom warning; not itself blocking),
//   • otherwise ⇒ "ok".
// "no-limit" is a reserved blocking-equivalent state; the unset-limit case collapses to "over" so the
// view reads identically to settlement's decision.
export type RegACapState = "no-limit" | "ok" | "near" | "over";

export function regACapStatus(input: {
  limit: number | null | undefined;
  invested: number | null | undefined;
}): {
  limit: number | null;
  invested: number;
  remaining: number;
  pctUsed: number;
  state: RegACapState;
} {
  const invested =
    typeof input.invested === "number" && Number.isFinite(input.invested)
      ? Math.max(0, input.invested)
      : 0;

  // Unset / non-finite limit ⇒ blocking, exactly as settlement treats it (no cap → no purchase).
  if (typeof input.limit !== "number" || !Number.isFinite(input.limit)) {
    return { limit: null, invested, remaining: 0, pctUsed: 1, state: "over" };
  }

  const limit = input.limit;
  const remaining = limit - invested;
  // A zero cap is fully consumed by definition (avoid 0/0 NaN); otherwise the fraction used.
  const pctUsed = limit > 0 ? invested / limit : 1;

  let state: RegACapState;
  if (invested >= limit) {
    state = "over"; // at/above the cap — mirrors settlement's `invested + amount > limit` at the edge
  } else if (pctUsed >= 0.8) {
    state = "near";
  } else {
    state = "ok";
  }

  return { limit, invested, remaining, pctUsed, state };
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

// The self-service identity form is only a development simulation. Expose that capability explicitly
// so production renders a truthful blocked state instead of offering a submission that must fail.
export const getIdentityRailStatus = query({
  args: {},
  handler: async () => {
    const developmentSimulation = developmentStubEnabled("kyc");
    return {
      available: developmentSimulation,
      verifiedProvider: false,
      developmentSimulation,
      blocker: developmentSimulation
        ? "Development identity simulation"
        : "Verified identity provider is not configured",
    };
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
    requireDevelopmentStub("kyc", "Stub KYC");

    const user = await findUserByIdentity(ctx, identity);
    if (!user) throw new Error("User not provisioned");

    // Identity-check failure revokes every prior property entitlement. Leaving an old row thawed
    // after a failed recheck would let the failed identity continue purchasing on chain.
    if (!args.verified) {
      if (user.kycStatus !== "failed") {
        await ctx.db.patch(user._id, { kycStatus: "failed" });
      }
      const existingRows = await ctx.db
        .query("eligibility")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const row of existingRows) {
        if (row.eligible || row.tokenAclState !== "frozen") {
          await ctx.db.patch(row._id, { eligible: false, tokenAclState: "frozen" });
          await writeAudit(ctx, {
            actor,
            action: "acl.frozen",
            target: user._id,
            meta: { propertyId: row.propertyId, reason: "kyc-failed" },
          });
        }
        await enqueueEligibilityAttestation(ctx, {
          userId: user._id,
          propertyId: row.propertyId,
          eligible: false,
          forceRetry: true,
        });
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
    const year = regulatoryYear();
    const yearChanged =
      user.regARegulatoryYear !== undefined && user.regARegulatoryYear !== year;
    if (
      user.kycStatus !== "verified" ||
      user.regAAnnualLimit !== regAAnnualLimit ||
      user.regARegulatoryYear !== year
    ) {
      await ctx.db.patch(user._id, {
        kycStatus: "verified",
        regAAnnualLimit,
        regARegulatoryYear: year,
        // Legacy rows without a year are conservatively assigned to the current year and retain
        // their accumulator. A known prior year resets at the UTC year boundary.
        ...(yearChanged ? { regAInvestedThisYear: 0 } : {}),
      });
      await writeAudit(ctx, {
        actor,
        action: "kyc.verified",
        target: user._id,
        meta: { propertyId: args.propertyId, regAAnnualLimit, regulatoryYear: year },
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

      // Project the entitlement decision onto the chain: write the on-chain Eligibility attestation so
      // the buyer's frozen-by-default property token account can actually be thawed at purchase time.
      // Without this, buildSettlePurchaseTransaction injects a thaw that the program reverts (NotEligible),
      // breaking first-time on-chain purchases. Scheduled (not awaited) — attestation is an async chain
      // effect, not part of this mutation's atomic Convex write. Only fires on a real state transition.
      await enqueueEligibilityAttestation(ctx, {
        userId: user._id,
        propertyId: args.propertyId,
        eligible,
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
