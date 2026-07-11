import { query, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { requireUnsafeStubs } from "./security";
import { regACapStatus, type RegACapState } from "./eligibility";

// Admin Story 5.1 — the compliance officer's KYC/AML adjudication → Token-ACL surface.
//
// This is the compliance SAFETY NET over the SAME `eligibility` data the consumer self-service path
// (eligibility.recordEligibility) writes — NOT a second eligibility system. It reuses the existing
// boundary verbatim:
//   • the `eligibility` table (`eligible`, `tokenAclState`, `personaInquiryId`) is the authoritative
//     Convex mirror of the on-chain Token-ACL state;
//   • `internal.eligibilityAttest.attestEligibilityOnChain` is the ONLY Convex→chain seam — SCHEDULED
//     (never awaited), an async chain effect, exactly as recordEligibility uses it.
// It never touches the consumer `recordEligibility` behavior; the compliance fields it writes
// (`reviewedBy`, `reviewReason`, `amlFlag`) are all OPTIONAL, so the consumer path leaves them unset.
//
// Every mutation here is staff-gated (requirePermission), reason/attribution-bearing, and AUDITED with
// the named compliance human — a compliance decision that names no human is worthless. No PII (income,
// net worth, wallet) enters the audit meta; only the decision + its reason.

// The single actor-resolution rule shared with every other staff surface (rbac/sod/diligence) — the
// named human, never a system. requirePermission has already proven the caller is active staff.
function staffActor(staff: Doc<"staff">): string {
  return staff.email || staff.name || staff.workosId;
}

// Elide the middle of an identifier so both ends stay legible (0x1234…cdef) — the queue shows a
// display-safe handle, never a raw full wallet/privyId, and never any PII.
function truncateMiddle(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

// The eligibility row for a (user, property), or null. One indexed lookup on the by_user_property key —
// the same key the consumer path upserts on, so adjudication reads and writes exactly one row.
async function findEligibility(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  propertyId: Id<"properties">,
): Promise<Doc<"eligibility"> | null> {
  return await ctx.db
    .query("eligibility")
    .withIndex("by_user_property", (q) =>
      q.eq("userId", userId).eq("propertyId", propertyId),
    )
    .unique();
}

// A display-safe handle for a consumer user — the wallet (truncated) when present, else a truncated
// privyId. Consumer `users` carry no name/email, and raw income/net worth NEVER surface here; the queue
// shows only what attribution already permits (an identifier + KYC status).
function userHandle(user: Doc<"users">): string {
  if (user.walletAddress) return truncateMiddle(user.walletAddress, 4, 4);
  return truncateMiddle(user.privyId, 12, 6);
}

// --- Mutations --------------------------------------------------------------------------------

// adjudicateEligibility — the compliance override. Sets a (user, property)'s eligibility with a
// RECORDED, non-empty reason: `eligible:false` ⇒ `tokenAclState:"frozen"` (cannot receive tokens),
// `eligible:true` ⇒ `"thawed"`. Upserts the SAME eligibility row the consumer path uses, stamps the
// compliance human + reason, audits `compliance.eligibility.adjudicated` (decision + reason — no PII),
// and SCHEDULES the on-chain attestation. Idempotent: an unchanged decision (same eligible + reason on
// an already-correct ACL state) is a no-op — no duplicate audit, no redundant attestation.
export const adjudicateEligibility = mutation({
  args: {
    userId: v.id("users"),
    propertyId: v.id("properties"),
    eligible: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, { userId, propertyId, eligible, reason }) => {
    const staff = await requirePermission(ctx, "compliance.review");
    const actor = staffActor(staff);

    // A compliance override MUST carry a reason — an adjudication naming no reason is unauditable.
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new Error("adjudicateEligibility requires a non-empty reason");
    }

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");

    const tokenAclState = eligible ? ("thawed" as const) : ("frozen" as const);
    const existing = await findEligibility(ctx, userId, propertyId);

    // Idempotent on an unchanged decision: same eligibility + ACL state + reason already recorded by a
    // compliance human ⇒ nothing to re-audit or re-attest.
    const unchanged =
      existing != null &&
      existing.eligible === eligible &&
      existing.tokenAclState === tokenAclState &&
      existing.reviewReason === trimmedReason &&
      existing.reviewedBy === actor;
    if (unchanged) {
      return { eligible, tokenAclState };
    }

    // Upsert the SAME row the consumer path owns — preserve its jurisdiction/personaInquiryId/amlFlag,
    // overwrite the decision + attribution. A brand-new row (no prior self-service record) records the
    // compliance decision with an empty jurisdiction marker.
    if (existing) {
      await ctx.db.patch(existing._id, {
        eligible,
        tokenAclState,
        reviewedBy: actor,
        reviewReason: trimmedReason,
      });
    } else {
      await ctx.db.insert("eligibility", {
        userId,
        propertyId,
        eligible,
        jurisdiction: "",
        tokenAclState,
        reviewedBy: actor,
        reviewReason: trimmedReason,
      });
    }

    // Audit names the compliance human + the decision + the reason. NO PII (no income/net worth/wallet).
    await writeAudit(ctx, {
      actor,
      action: "compliance.eligibility.adjudicated",
      target: userId,
      meta: { propertyId, eligible, reason: trimmedReason },
    });

    // Project the decision onto the chain — SCHEDULED, not awaited (an async chain effect, exactly as
    // recordEligibility does it). The live Token-2022 freeze/thaw is the deferred boundary; this
    // scheduled attestation + the audit above are the authoritative record here.
    await ctx.scheduler.runAfter(0, internal.eligibilityAttest.attestEligibilityOnChain, {
      userId,
      propertyId,
      eligible,
    });

    return { eligible, tokenAclState };
  },
});

// setTokenAclState — compliance's direct freeze/thaw lever over the Token ACL, gated on `freeze.execute`
// (an operational permission compliance holds; ops_diligence does NOT). Patches `tokenAclState`, audits
// `acl.frozen`/`acl.thawed` naming the human, and schedules the on-chain attestation. Idempotent: a row
// already in the requested state is a no-op.
export const setTokenAclState = mutation({
  args: {
    userId: v.id("users"),
    propertyId: v.id("properties"),
    state: v.union(v.literal("freeze"), v.literal("thaw")),
  },
  handler: async (ctx, { userId, propertyId, state }) => {
    const staff = await requirePermission(ctx, "freeze.execute");
    const actor = staffActor(staff);

    const existing = await findEligibility(ctx, userId, propertyId);
    if (!existing) throw new Error("No eligibility record for this user and property");

    const tokenAclState = state === "freeze" ? ("frozen" as const) : ("thawed" as const);
    // `eligible` tracks the ACL lever: thaw ⇒ eligible, freeze ⇒ ineligible — so the attestation the
    // scheduler receives matches the state we just recorded.
    const eligible = tokenAclState === "thawed";

    if (existing.tokenAclState === tokenAclState) {
      return { tokenAclState }; // idempotent no-op — already in the requested state
    }

    await ctx.db.patch(existing._id, { tokenAclState, eligible, reviewedBy: actor });

    await writeAudit(ctx, {
      actor,
      action: tokenAclState === "frozen" ? "acl.frozen" : "acl.thawed",
      target: userId,
      meta: { propertyId },
    });

    await ctx.scheduler.runAfter(0, internal.eligibilityAttest.attestEligibilityOnChain, {
      userId,
      propertyId,
      eligible,
    });

    return { tokenAclState };
  },
});

// screenAml — the STUBBED AML screening input, gated on `compliance.review` AND `requireUnsafeStubs`
// (same posture as the Persona/Middesk/DvP stubs — it REFUSES with no server-attested provider rather
// than fabricating a live ComplyAdvantage/TRM call). Records an `amlFlag` on the case for the reviewer
// and audits `compliance.aml.screened`. It only records a flag — it never itself changes the ACL.
export const screenAml = mutation({
  args: {
    userId: v.id("users"),
    propertyId: v.id("properties"),
    flag: v.union(v.literal("clear"), v.literal("flagged")),
  },
  handler: async (ctx, { userId, propertyId, flag }) => {
    const staff = await requirePermission(ctx, "compliance.review");
    requireUnsafeStubs("AML screening");
    const actor = staffActor(staff);

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");

    const existing = await findEligibility(ctx, userId, propertyId);
    if (existing) {
      await ctx.db.patch(existing._id, { amlFlag: flag });
    } else {
      // No self-service record yet — create a compliance-only case carrying the AML flag. Frozen by
      // default (no eligibility decision has been made) so the token account can never receive tokens
      // off the back of an unadjudicated AML screen.
      await ctx.db.insert("eligibility", {
        userId,
        propertyId,
        eligible: false,
        jurisdiction: "",
        tokenAclState: "frozen",
        amlFlag: flag,
      });
    }

    await writeAudit(ctx, {
      actor,
      action: "compliance.aml.screened",
      target: userId,
      meta: { propertyId, flag },
    });

    return { flag };
  },
});

// --- Queries ----------------------------------------------------------------------------------

// A display-safe compliance case: the row's decision + ACL state + AML flag + attribution, joined to a
// display-safe user handle. No PII (income/net worth) — only what attribution already permits.
type ComplianceCase = {
  id: Id<"eligibility">;
  userId: Id<"users">;
  propertyId: Id<"properties">;
  userHandle: string;
  kycStatus: Doc<"users">["kycStatus"];
  eligible: boolean;
  jurisdiction: string;
  tokenAclState: "frozen" | "thawed";
  amlFlag: "clear" | "flagged" | null;
  reviewedBy: string | null;
  reviewReason: string | null;
};

async function toCase(
  ctx: QueryCtx,
  row: Doc<"eligibility">,
): Promise<ComplianceCase | null> {
  const user = await ctx.db.get(row.userId);
  if (!user) return null;
  return {
    id: row._id,
    userId: row.userId,
    propertyId: row.propertyId,
    userHandle: userHandle(user),
    kycStatus: user.kycStatus,
    eligible: row.eligible,
    jurisdiction: row.jurisdiction,
    tokenAclState: row.tokenAclState,
    amlFlag: row.amlFlag ?? null,
    reviewedBy: row.reviewedBy ?? null,
    reviewReason: row.reviewReason ?? null,
  };
}

// listComplianceQueue — the compliance review queue, gated on `compliance.review`. When `propertyId` is
// given, lists that property's eligibility rows via `by_property`; otherwise scans all rows (seed scale).
// Each row is projected to a display-safe case (no PII beyond attribution).
export const listComplianceQueue = query({
  args: { propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { propertyId }): Promise<ComplianceCase[]> => {
    await requirePermission(ctx, "compliance.review");

    const rows = propertyId
      ? await ctx.db
          .query("eligibility")
          .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
          .collect()
      : await ctx.db.query("eligibility").collect();

    const cases: ComplianceCase[] = [];
    for (const row of rows) {
      const c = await toCase(ctx, row);
      if (c) cases.push(c);
    }
    return cases;
  },
});

// getComplianceCase — a single case for a (user, property), gated on `compliance.review`. Null when no
// eligibility row exists (or the user is gone).
export const getComplianceCase = query({
  args: { userId: v.id("users"), propertyId: v.id("properties") },
  handler: async (ctx, { userId, propertyId }): Promise<ComplianceCase | null> => {
    await requirePermission(ctx, "compliance.review");
    const row = await findEligibility(ctx, userId, propertyId);
    if (!row) return null;
    return await toCase(ctx, row);
  },
});

// A display-safe Reg A+ cap-usage row. `limit`/`invested`/`remaining` are the COMPUTED cap + cumulative
// invested (both regulated-decision outputs, not raw inputs) — NO income/net-worth PII ever surfaces
// (those raw inputs aren't even stored on `users`). Only the computed cap + state + a safe handle.
type CapUsageRow = {
  userId: Id<"users">;
  handle: string;
  kycStatus: Doc<"users">["kycStatus"];
  limit: number | null;
  invested: number;
  remaining: number;
  state: RegACapState;
};

// listCapUsage — Admin 5.2 Reg A+ cap OVERSIGHT, gated on `compliance.review`. Lists every investor who
// has a COMPUTED cap (`regAAnnualLimit` set by the KYC-verified path), each with headroom + state via the
// shared `regACapStatus` helper — which MIRRORS settlement's enforcement rule, so the oversight view and
// the settlement gate can never disagree. Optional `state` filter narrows to (e.g.) only `near`/`over`.
// This is enforcement's read-only mirror: it never blocks a purchase and never touches the regA fields.
export const listCapUsage = query({
  args: {
    state: v.optional(
      v.union(
        v.literal("no-limit"),
        v.literal("ok"),
        v.literal("near"),
        v.literal("over"),
      ),
    ),
  },
  handler: async (ctx, { state }): Promise<CapUsageRow[]> => {
    await requirePermission(ctx, "compliance.review");

    const users = await ctx.db.query("users").collect();
    const rows: CapUsageRow[] = [];
    for (const user of users) {
      // Oversight covers only investors with a COMPUTED Reg A+ cap (the verified KYC path set it).
      if (typeof user.regAAnnualLimit !== "number" || !Number.isFinite(user.regAAnnualLimit)) {
        continue;
      }
      const status = regACapStatus({
        limit: user.regAAnnualLimit,
        invested: user.regAInvestedThisYear,
      });
      if (state && status.state !== state) continue;
      rows.push({
        userId: user._id,
        handle: userHandle(user),
        kycStatus: user.kycStatus,
        limit: status.limit,
        invested: status.invested,
        remaining: status.remaining,
        state: status.state,
      });
    }
    return rows;
  },
});
