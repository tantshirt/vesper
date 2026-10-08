import { query, mutation, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { isWorkosIdentity, requireDevelopmentStub } from "./security";
import { requireStaff, requirePermission, applyGrant } from "./rbac";
import { isSponsorRole, sponsorRoleValidator } from "./roles";
import { missingRequiredKinds, DOC_KIND_LABELS, type DocKind } from "./sponsorIntake";

// Admin Story 6.1 — the SPONSOR half of the scope wall + KYB/Gate 0.
//
// This module is the tenant-isolation primitive. Where `requireStaff` (rbac.ts) is the WorkOS half of
// the wall (staff vs consumer), `requireSponsor` is the role-partition WITHIN staff: it admits ONLY a
// sponsor role and resolves the caller to exactly ONE `sponsorOrgId`. Every sponsor query/mutation
// filters by that org server-side, so a sponsor can never read/write another sponsor's data — and an
// internal staff role (ops/compliance/ai/platform), which is NOT a sponsor role, is barred here from
// every sponsor mutation. The reverse wall is already in place: a sponsor holds only
// sponsor.read/sponsor.manage, so `requirePermission` denies them at every internal `/console` function.
//
// KYB/Gate 0 is a RECORDED step with a STUBBED Middesk seam (mirror of eligibility.ts / the Persona
// stub): `recordKyb` returns + persists a result and is audited; no live vendor is integrated. A deal
// cannot reach `submitted` until its org `kybStatus === "passed"`.

type SponsorReadCtx = QueryCtx | MutationCtx;

// The resolved sponsor context: the staff human, their org, and the membership row. Returned by the
// enforcement primitive so every caller reads the org from the SAME server-resolved source (never a
// client-supplied orgId — the classic tenant-isolation hole).
export type SponsorContext = {
  staff: Doc<"staff">;
  member: Doc<"sponsorMembers">;
  orgId: Id<"sponsorOrgs">;
};

// requireSponsor — the tenant-isolation primitive. `requireStaff` first (so a consumer token, a missing
// staff row, or a revoked member is refused exactly as everywhere else), THEN assert the staff row
// carries a sponsor role, THEN resolve their single `sponsorMembers` row → `sponsorOrgId`. Distinct
// throw messages so "internal staff at a sponsor function" (no sponsor role) and "sponsor with no org"
// (unprovisioned) are each diagnosable. This is the ONLY place a sponsor's org is resolved.
export async function requireSponsor(ctx: SponsorReadCtx): Promise<SponsorContext> {
  const staff = await requireStaff(ctx);
  // Role-partition wall: an internal staff role (ops/compliance/ai/platform) is NOT a sponsor and is
  // barred here from every sponsor mutation. This is the internal→sponsor direction of the two-way wall.
  if (!staff.roles.some(isSponsorRole)) {
    throw new Error("Not authorized as a sponsor");
  }
  const member = await ctx.db
    .query("sponsorMembers")
    .withIndex("by_workosId", (q) => q.eq("workosId", staff.workosId))
    .unique();
  if (!member) throw new Error("Sponsor not provisioned");
  return { staff, member, orgId: member.sponsorOrgId };
}

// The audit actor for a sponsor action — the named human, never a system label (spine I4). Falls back
// through email → name → workosId so an entry always names someone.
// Exported so Story 6.2's `sponsorIntake.ts` attributes document uploads to the SAME resolved human
// through one helper (no second copy of the actor rule).
export function sponsorActor(staff: Doc<"staff">): string {
  return staff.email || staff.name || staff.workosId;
}

// --- Queries ----------------------------------------------------------------------------------

// mySponsorOrg — the sponsor shell's identity + KYB read. Resolves the caller GRACEFULLY to null
// (never throws) so the walled `/sponsor` layout can render a clean "no sponsor access" state for a
// non-sponsor exactly the way `rbac.me` does for a non-staff caller — the UI gate, never the
// enforcement point. It returns ONLY the caller's own org; there is no path to another org's row.
export const mySponsorOrg = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !isWorkosIdentity(identity)) return null;

    const staff = await ctx.db
      .query("staff")
      .withIndex("by_workosId", (q) => q.eq("workosId", identity.subject))
      .unique();
    if (!staff || staff.status === "revoked") return null;
    if (!staff.roles.some(isSponsorRole)) return null;

    const member = await ctx.db
      .query("sponsorMembers")
      .withIndex("by_workosId", (q) => q.eq("workosId", staff.workosId))
      .unique();
    if (!member) return null;

    const org = await ctx.db.get(member.sponsorOrgId);
    if (!org) return null;

    return {
      id: org._id,
      name: org.name,
      kybStatus: org.kybStatus,
      kybRef: org.kybRef ?? null,
      role: member.role,
      // Only a sponsor_principal holds sponsor.manage — the UI uses this to show/hide the manage actions
      // (the server re-checks the permission on every mutation regardless).
      canManage: staff.roles.includes("sponsor_principal"),
    };
  },
});

// myDeals — the caller's deals, ORG-SCOPED via the `by_org` index. `requireSponsor` resolves the org
// server-side; there is no client-supplied filter, so a sponsor sees EXACTLY their org's deals and a
// non-sponsor is denied. Cross-tenant enumeration is structurally impossible — the index is keyed on
// the server-resolved orgId.
export const myDeals = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireSponsor(ctx);
    return await ctx.db
      .query("sponsorDeals")
      .withIndex("by_org", (q) => q.eq("sponsorOrgId", orgId))
      .order("desc")
      .collect();
  },
});

// getDeal — a single deal by id, but ONLY if it belongs to the caller's org. A crafted id for another
// sponsor's deal resolves to null (tenant isolation): the org check, not the id, decides visibility.
export const getDeal = query({
  args: { dealId: v.id("sponsorDeals") },
  handler: async (ctx, { dealId }) => {
    const { orgId } = await requireSponsor(ctx);
    const deal = await ctx.db.get(dealId);
    // Not-owned reads as not-found — never confirm the existence of another tenant's deal.
    if (!deal || deal.sponsorOrgId !== orgId) return null;
    return deal;
  },
});

// --- Mutations --------------------------------------------------------------------------------

// startDeal — create a draft deal in the caller's org. `requireSponsor` resolves the org (and bars
// internal staff); `requirePermission(sponsor.manage)` then admits ONLY a sponsor_principal (sponsor_ops
// holds sponsor.read alone) and audits a denial. The new deal is stamped with the SERVER-resolved
// orgId, never a client value. Audited to the sponsor human.
export const startDeal = mutation({
  args: { propertyName: v.string() },
  handler: async (ctx, { propertyName }) => {
    const { staff, orgId } = await requireSponsor(ctx);
    await requirePermission(ctx, "sponsor.manage");

    const name = propertyName.trim();
    if (!name) throw new Error("propertyName is required");

    const dealId = await ctx.db.insert("sponsorDeals", {
      sponsorOrgId: orgId,
      propertyName: name,
      status: "draft",
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      actor: sponsorActor(staff),
      action: "sponsor.deal.started",
      target: dealId,
      meta: { sponsorOrgId: orgId, propertyName: name },
    });

    return dealId;
  },
});

// recordKyb — Gate 0. The STUBBED Middesk result boundary (same posture as eligibility.ts / the Persona
// stub): this mutation IS the KYB-result seam — the live Middesk hosted flow + webhook that would call
// it is deferred. Its dedicated development guard disables it outside test / an explicit flag until a
// real vendor is wired. Sets the org's `kybStatus`, records the (stubbed) `kybRef`, audits
// `sponsor.kyb.recorded` to the sponsor human. Only a sponsor_principal (sponsor.manage) may record it.
export const recordKyb = mutation({
  args: {
    // The stubbed outcome. `passed` unlocks the submitted-state gate; anything else keeps deals blocked.
    result: v.union(v.literal("passed"), v.literal("failed"), v.literal("pending")),
    kybRef: v.optional(v.string()),
  },
  handler: async (ctx, { result, kybRef }) => {
    const { staff, orgId } = await requireSponsor(ctx);
    await requirePermission(ctx, "sponsor.manage");
    // Live Middesk is not wired — this seam is disabled outside test / an explicit flag, exactly as the
    // Persona KYC stub in eligibility.ts. Do NOT fabricate a live vendor call.
    requireDevelopmentStub("kyb", "Stub KYB");

    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Sponsor org not found");

    // Stubbed Middesk reference — a stable per-org handle when the caller supplies none, so the audit
    // trail always links the KYB decision to a reference even in the stub.
    const ref = (kybRef ?? org.kybRef ?? `middesk_stub_${orgId}`).trim();

    await ctx.db.patch(orgId, { kybStatus: result, kybRef: ref });

    await writeAudit(ctx, {
      actor: sponsorActor(staff),
      action: "sponsor.kyb.recorded",
      target: orgId,
      meta: { kybStatus: result, kybRef: ref },
    });

    return { kybStatus: result, kybRef: ref };
  },
});

// submitDeal — the Gate 0 CHECK lives here (the full submission checklist/upload is Story 6.2). A deal
// can only reach `submitted` when its org `kybStatus === "passed"`; otherwise it is blocked with a
// "complete KYB first" reason. Org-scoped: a deal that is not the caller's org reads as not-found, so a
// crafted id for another tenant's deal is denied — the tenant wall on the write side. Audited.
export const submitDeal = mutation({
  args: { dealId: v.id("sponsorDeals") },
  handler: async (ctx, { dealId }) => {
    const { staff, orgId } = await requireSponsor(ctx);
    await requirePermission(ctx, "sponsor.manage");

    const deal = await ctx.db.get(dealId);
    // Tenant isolation: another org's deal (or a non-existent one) is "not found" — never confirmed.
    if (!deal || deal.sponsorOrgId !== orgId) throw new Error("Deal not found");

    const org = await ctx.db.get(orgId);
    if (org?.kybStatus !== "passed") {
      throw new Error("Complete KYB first: Gate 0 (KYB) must be passed before a deal can be submitted");
    }

    // Story 6.2: the intake CHECKLIST joins Gate 0 on the SAME (single) submit path — every required
    // document kind must be `received` before a deal can leave draft. Block with a plain reason naming
    // exactly what is still missing (never a bare "incomplete"). This reuses the checklist computed by
    // sponsorIntake so there is one definition of "what's required".
    const missing = await missingRequiredKinds(ctx, deal._id);
    if (missing.length > 0) {
      const labels = missing.map((k) => DOC_KIND_LABELS[k as DocKind] ?? k).join(", ");
      throw new Error(`Upload required documents first: still missing ${labels}`);
    }

    if (deal.status !== "submitted") {
      await ctx.db.patch(deal._id, { status: "submitted" });
      await writeAudit(ctx, {
        actor: sponsorActor(staff),
        action: "sponsor.deal.submitted",
        target: deal._id,
        meta: { sponsorOrgId: orgId },
      });
    }

    return deal._id;
  },
});

// --- Provisioning (internal, grant-only) ------------------------------------------------------

// provisionSponsor — creates the org + membership for a WorkOS-invited sponsor. Like `grantRoles`, this
// is the crown-jewel write for the sponsor surface (it mints a tenant and its member), so it is an
// **internalMutation**: ABSENT from the public `api`, reachable only through the Convex CLI/dashboard
// (which already requires deployment credentials). The `staff` row is created through the SINGLE grant
// core `applyGrant` (so sponsor staff and internal staff can never drift on what a grant means), then
// the org is created (or reused via `sponsorOrgId`) and the membership upserted. Audited to the human
// who authorized the provisioning — never the invitee.
export const provisionSponsor = internalMutation({
  args: {
    workosId: v.string(),
    email: v.string(),
    name: v.string(),
    role: sponsorRoleValidator,
    // Attach to an existing org (a second member of the same sponsor) or create a new one from orgName.
    sponsorOrgId: v.optional(v.id("sponsorOrgs")),
    orgName: v.optional(v.string()),
    provisionedBy: v.string(), // the human who authorized this — audited as the actor
  },
  handler: async (ctx, args): Promise<Id<"sponsorOrgs">> => {
    const workosId = args.workosId.trim();
    const provisionedBy = args.provisionedBy.trim();
    if (!workosId || !provisionedBy) {
      throw new Error("provisionSponsor requires non-empty workosId and provisionedBy");
    }

    // Resolve the org: reuse an existing one, or mint a fresh tenant from orgName (kybStatus "none").
    let orgId: Id<"sponsorOrgs">;
    if (args.sponsorOrgId) {
      const existingOrg = await ctx.db.get(args.sponsorOrgId);
      if (!existingOrg) throw new Error("sponsorOrgId does not exist");
      orgId = args.sponsorOrgId;
    } else {
      const orgName = (args.orgName ?? "").trim();
      if (!orgName) throw new Error("provisionSponsor requires orgName when sponsorOrgId is omitted");
      orgId = await ctx.db.insert("sponsorOrgs", {
        name: orgName,
        kybStatus: "none",
        createdAt: Date.now(),
      });
    }

    // Create the staff row through the single grant core (writes the staff.granted audit).
    await applyGrant(ctx, {
      workosId,
      email: args.email,
      name: args.name,
      roles: [args.role],
      grantedBy: provisionedBy,
    });

    // Upsert the membership (idempotent re-provision retargets org/role rather than duplicating).
    const existingMember = await ctx.db
      .query("sponsorMembers")
      .withIndex("by_workosId", (q) => q.eq("workosId", workosId))
      .unique();
    if (existingMember) {
      await ctx.db.patch(existingMember._id, { sponsorOrgId: orgId, role: args.role });
    } else {
      await ctx.db.insert("sponsorMembers", {
        workosId,
        sponsorOrgId: orgId,
        role: args.role,
        createdAt: Date.now(),
      });
    }

    await writeAudit(ctx, {
      actor: provisionedBy,
      action: "sponsor.provisioned",
      target: workosId,
      meta: { sponsorOrgId: orgId, role: args.role },
    });

    return orgId;
  },
});
