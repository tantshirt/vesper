import { query, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { requireStaff, requirePermission } from "./rbac";
import { isSponsorRole } from "./roles";

// Admin Story 5.3 — the MARKETING SIGN-OFF gate. Public/marketing copy cannot ship without a
// counsel-gated (`compliance.review`) sign-off, or is blocked with a mandatory note. This is the
// remaining half of AE5.3; the AUDIT-EXPORT half is ALREADY built (1-3 `exportAudit`, `audit.export`-
// gated) and is only SURFACED from the console — never rebuilt here.
//
// The lifecycle is `draft → signed_off | blocked`. The gate any public-render path consults is the
// exported pure helper `isMarketingSignedOff` — ONLY a `signed_off` item is shippable (wiring the
// consumer Explore/Property public copy to it is a NOTE below, not part of this story). Every review
// decision names the compliance human and is audited. B4 (the Reg A+ pre-authorization marketing
// limits) is the reviewer's CRITERIA applied at sign-off — guidance the officer weighs, optionally
// captured in `reviewNote` — never hardcoded policy here.

// The single actor-resolution rule shared with every other staff surface (compliance/rbac/sod) — the
// named human, never a system. The caller has already been proven active staff by requireStaff /
// requirePermission before this runs.
function staffActor(staff: Doc<"staff">): string {
  return staff.email || staff.name || staff.workosId;
}

// isMarketingSignedOff — THE gate. A pure predicate over a marketing item (or null/undefined when no
// item exists): shippable IFF the item exists and its status is `signed_off`. A `draft` or `blocked`
// item — and the absence of any item at all — is NOT shippable. This is the single function a
// public-render path would consult before showing marketing copy.
//
// CONSUMER-WIRING NOTE (deliberately NOT built in this story): the consumer Explore/Property public
// copy path would call this with the property's marketing item and refuse to render (or fall back to a
// safe generic string) when it returns false. That wiring is downstream scope — this story delivers the
// workflow + the gate, proven by marketing.test.ts, not the consumer render consumer.
export function isMarketingSignedOff(
  content: { status: "draft" | "signed_off" | "blocked" } | null | undefined,
): boolean {
  return content?.status === "signed_off";
}

// --- Mutations --------------------------------------------------------------------------------

// submitMarketingContent — create a `draft` item. Gated on `requireStaff` (any ACTIVE staff may draft
// copy — ops/marketing draft, only compliance signs), attributed to the named human, and audited
// `marketing.submitted`. A fresh draft is NEVER shippable: `isMarketingSignedOff` is false until a
// `compliance.review` officer signs it off.
export const submitMarketingContent = mutation({
  args: {
    kind: v.string(),
    body: v.string(),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, { kind, body, propertyId }) => {
    const staff = await requireStaff(ctx);
    // INTERNAL staff only may draft platform marketing. `requireStaff` admits sponsor rows too (they are
    // `staff` rows), but platform marketing copy is not a sponsor's to draft — and a sponsor has no
    // platform-wide propertyId scope. A caller holding ANY sponsor role is refused here (the role-
    // partition wall, mirroring `requireSponsor`'s reverse direction).
    if (staff.roles.some(isSponsorRole)) {
      throw new Error("Not authorized to submit marketing: internal staff only");
    }
    const actor = staffActor(staff);

    const trimmedKind = kind.trim();
    const trimmedBody = body.trim();
    // A submission with no kind or no body is unreviewable — refuse rather than queue an empty draft.
    if (!trimmedKind || !trimmedBody) {
      throw new Error("submitMarketingContent requires a non-empty kind and body");
    }

    if (propertyId) {
      const property = await ctx.db.get(propertyId);
      if (!property) throw new Error("Property not found");
    }

    const id = await ctx.db.insert("marketingContent", {
      propertyId,
      kind: trimmedKind,
      body: trimmedBody,
      status: "draft",
      submittedBy: actor,
      createdAt: Date.now(),
    });

    await writeAudit(ctx, {
      actor,
      action: "marketing.submitted",
      target: id,
      meta: { kind: trimmedKind, propertyId },
    });

    return { id, status: "draft" as const };
  },
});

// signOffMarketing — the counsel gate. `compliance.review`-only (platform_admin, which holds NO
// compliance.review, is denied). Sets `signed_off` + records the compliance human as `reviewedBy` at
// `reviewedAt`, and audits `compliance.marketing.signed_off` naming that human. Refuses if the item is
// already `signed_off` — a decision recorded once is not re-recorded. An optional `note` captures the
// reviewer's B4 policy rationale (never mandatory on sign-off).
export const signOffMarketing = mutation({
  args: { id: v.id("marketingContent"), note: v.optional(v.string()) },
  handler: async (ctx, { id, note }) => {
    const staff = await requirePermission(ctx, "compliance.review");
    const actor = staffActor(staff);

    const item = await ctx.db.get(id);
    if (!item) throw new Error("Marketing item not found");
    if (item.status === "signed_off") {
      throw new Error("Marketing item is already signed off");
    }

    const trimmedNote = note?.trim();
    await ctx.db.patch(id, {
      status: "signed_off",
      reviewedBy: actor,
      reviewedAt: Date.now(),
      // Preserve a prior block's reviewNote unless the officer supplies a new policy note on sign-off.
      ...(trimmedNote ? { reviewNote: trimmedNote } : {}),
    });

    await writeAudit(ctx, {
      actor,
      action: "compliance.marketing.signed_off",
      target: id,
      meta: { kind: item.kind, propertyId: item.propertyId },
    });

    return { id, status: "signed_off" as const };
  },
});

// blockMarketing — the refusal lever. `compliance.review`-only (platform_admin denied). REQUIRES a
// non-empty note (a block naming no reason is unauditable — the same rule adjudicateEligibility
// enforces), sets `blocked` + `reviewNote` + the compliance human, and audits
// `compliance.marketing.blocked`. A blocked item stays NOT shippable (`isMarketingSignedOff` false).
export const blockMarketing = mutation({
  args: { id: v.id("marketingContent"), note: v.string() },
  handler: async (ctx, { id, note }) => {
    const staff = await requirePermission(ctx, "compliance.review");
    const actor = staffActor(staff);

    const trimmedNote = note.trim();
    if (!trimmedNote) {
      throw new Error("blockMarketing requires a non-empty note");
    }

    const item = await ctx.db.get(id);
    if (!item) throw new Error("Marketing item not found");

    await ctx.db.patch(id, {
      status: "blocked",
      reviewedBy: actor,
      reviewNote: trimmedNote,
      reviewedAt: Date.now(),
    });

    await writeAudit(ctx, {
      actor,
      action: "compliance.marketing.blocked",
      target: id,
      meta: { kind: item.kind, propertyId: item.propertyId, note: trimmedNote },
    });

    return { id, status: "blocked" as const };
  },
});

// --- Queries ----------------------------------------------------------------------------------

// A display-safe marketing item for the compliance console. Marketing `body` is outward-facing public
// copy (never PII), so it is surfaced verbatim for the reviewer to read.
type MarketingItem = {
  id: Id<"marketingContent">;
  propertyId: Id<"properties"> | null;
  kind: string;
  body: string;
  status: "draft" | "signed_off" | "blocked";
  submittedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: number;
  reviewedAt: number | null;
};

function toItem(row: Doc<"marketingContent">): MarketingItem {
  return {
    id: row._id,
    propertyId: row.propertyId ?? null,
    kind: row.kind,
    body: row.body,
    status: row.status,
    submittedBy: row.submittedBy,
    reviewedBy: row.reviewedBy ?? null,
    reviewNote: row.reviewNote ?? null,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt ?? null,
  };
}

// listMarketingQueue — the compliance review queue, gated on `compliance.review`. With `status`, lists
// that lifecycle bucket via `by_status`; otherwise every item (seed scale). Newest first.
export const listMarketingQueue = query({
  args: {
    status: v.optional(
      v.union(v.literal("draft"), v.literal("signed_off"), v.literal("blocked")),
    ),
  },
  handler: async (ctx, { status }): Promise<MarketingItem[]> => {
    await requirePermission(ctx, "compliance.review");

    const rows = status
      ? await ctx.db
          .query("marketingContent")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect()
      : await ctx.db.query("marketingContent").collect();

    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toItem);
  },
});

// getMarketingItem — a single item by id, gated on `compliance.review`. Null when it does not exist.
export const getMarketingItem = query({
  args: { id: v.id("marketingContent") },
  handler: async (ctx, { id }): Promise<MarketingItem | null> => {
    await requirePermission(ctx, "compliance.review");
    const row = await ctx.db.get(id);
    return row ? toItem(row) : null;
  },
});

// A PUBLIC-safe marketing item — the ONLY shape the open/consumer render path sees. It deliberately
// carries NO reviewer/submitter identity, NO reviewNote, and NO status/lifecycle metadata: only the
// outward-facing public copy itself (`kind`/`body`) and the `propertyId` it is about. Everything here is
// already public by construction (the `body` is outward-facing marketing text, never PII).
type PublicMarketingItem = {
  id: Id<"marketingContent">;
  propertyId: Id<"properties"> | null;
  kind: string;
  body: string;
};

// publicSignedOffMarketing — the PUBLIC render gate's data source (NO auth — open, like the consumer
// public offering reads properties.listOpen/getWithGates). Returns ONLY `signed_off` marketing items
// (optionally scoped to one `propertyId`), each RE-VALIDATED through `isMarketingSignedOff` so a `draft`
// or `blocked` item can NEVER reach the public path — nothing ships without counsel's recorded sign-off.
// The payload is mapped to `PublicMarketingItem`, so no reviewer PII (reviewedBy/submittedBy/reviewNote)
// is ever exposed. Newest first.
//
// CONSUMER-WIRING NOTE (consumer-scope — deliberately NOT built here): the consumer Explore/Property
// public copy path calls this and renders ONLY what it returns (falling back to a safe generic string
// when a property has no signed-off item). This story/closure delivers the GATED DATA SOURCE; the UI
// hookup is downstream consumer scope.
export const publicSignedOffMarketing = query({
  args: { propertyId: v.optional(v.id("properties")) },
  handler: async (ctx, { propertyId }): Promise<PublicMarketingItem[]> => {
    const rows = await ctx.db
      .query("marketingContent")
      .withIndex("by_status", (q) => q.eq("status", "signed_off"))
      .collect();

    return rows
      .filter((row) => isMarketingSignedOff(row)) // belt-and-braces: only a signed_off item ever ships
      .filter((row) => (propertyId ? row.propertyId === propertyId : true))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        id: row._id,
        propertyId: row.propertyId ?? null,
        kind: row.kind,
        body: row.body,
      }));
  },
});
