import { query, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { requireSponsor, sponsorActor } from "./sponsor";

// Admin Story 6.2 — the sponsor INTAKE surface: a required-document checklist, validation ON UPLOAD
// (the wrong/empty doc rejected early with a plain reason, never silently accepted), and a derived
// status timeline. Every read/write resolves the org through 6.1's `requireSponsor` and asserts the
// deal belongs to that org — a crafted foreign `dealId` reads as not-found. This is the sponsor's
// SUBMISSION experience; internal review of the submission is Epic 3 (not here).
//
// storageRef is an OPAQUE locator — there is no OCR / file-content parsing / live storage vendor in
// this story. Validation is on `kind`/metadata, not bytes.

// REQUIRED_DOC_KINDS — the intake checklist. One source of truth: the upload validator, the checklist
// query, the timeline, and `submitDeal`'s gate all read from this single list.
export const REQUIRED_DOC_KINDS = [
  "title",
  "valuation",
  "financials",
  "operating_history",
  "legal",
] as const;

export type DocKind = (typeof REQUIRED_DOC_KINDS)[number];

// Human labels for the required kinds — used by the checklist/timeline and by submitDeal's block reason
// so the sponsor always sees plain language, never a raw enum token.
export const DOC_KIND_LABELS: Record<DocKind, string> = {
  title: "Title / deed",
  valuation: "Independent valuation",
  financials: "Financial statements",
  operating_history: "Operating history",
  legal: "Legal / entity documents",
};

type IntakeCtx = QueryCtx | MutationCtx;

// A required kind counts as satisfied only when a `received` row exists for it (a `rejected` row does
// NOT satisfy the checklist — a bad upload leaves its slot missing). One place computes this so the
// checklist, the timeline, and the submit gate can never disagree on "what's still missing".
export async function missingRequiredKinds(
  ctx: IntakeCtx,
  dealId: Id<"sponsorDeals">,
): Promise<DocKind[]> {
  const docs = await ctx.db
    .query("sponsorDocuments")
    .withIndex("by_deal", (q) => q.eq("dealId", dealId))
    .collect();
  const received = new Set(docs.filter((d) => d.status === "received").map((d) => d.kind));
  return REQUIRED_DOC_KINDS.filter((k) => !received.has(k));
}

// resolveOwnedDeal — the tenant wall for every doc read/write. `requireSponsor` resolves the org
// server-side (and bars internal staff), then the deal is admitted ONLY if it belongs to that org.
// A crafted id for another tenant's deal throws "Deal not found" — never confirmed. Returns the
// resolved staff + org so callers read them from the same server source.
async function resolveOwnedDeal(ctx: IntakeCtx, dealId: Id<"sponsorDeals">) {
  const { staff, orgId } = await requireSponsor(ctx);
  const deal = await ctx.db.get(dealId);
  // Not-owned (or non-existent) reads as not-found — the tenant wall on both read and write sides.
  if (!deal || deal.sponsorOrgId !== orgId) throw new Error("Deal not found");
  return { staff, orgId, deal };
}

// --- Mutations --------------------------------------------------------------------------------

// uploadDocument — validation ON UPLOAD, gated `sponsor.documents` so BOTH sponsor roles (principal
// AND ops/Sofia) can upload. Resolve + tenant-check the deal, then validate: a non-empty `storageRef`
// and a `kind` in the required checklist. A failing upload is a DURABLE BUSINESS REJECTION — we insert
// a `rejected` row carrying a plain `rejectReason` and RETURN it (we do NOT throw: per the 1-2/1-4
// lesson a thrown error rolls back, leaving no record; a rejection must persist). A valid upload is
// `received`. Both outcomes are audited to the sponsor human.
export const uploadDocument = mutation({
  args: {
    dealId: v.id("sponsorDeals"),
    // Free-form on the wire: an unknown kind must be a business rejection we RECORD, not a validator
    // throw that vanishes. The handler validates it against REQUIRED_DOC_KINDS.
    kind: v.string(),
    storageRef: v.string(),
  },
  handler: async (ctx, { dealId, kind, storageRef }) => {
    // requireSponsor (inside resolveOwnedDeal) bars a non-sponsor; the permission check then admits
    // both sponsor roles. Order: tenant identity → permission → tenant ownership.
    await requirePermission(ctx, "sponsor.documents");
    const { staff, deal } = await resolveOwnedDeal(ctx, dealId);

    const trimmedKind = kind.trim();
    const trimmedRef = storageRef.trim();

    // Validate kind + metadata (never bytes). Empty file first, then unknown kind — each a distinct,
    // human-readable reason.
    let rejectReason: string | null = null;
    if (!trimmedRef) {
      rejectReason = "No file was provided — the upload had an empty storage reference.";
    } else if (!(REQUIRED_DOC_KINDS as readonly string[]).includes(trimmedKind)) {
      rejectReason =
        `"${trimmedKind || "(blank)"}" is not a required document type. ` +
        `Expected one of: ${REQUIRED_DOC_KINDS.join(", ")}.`;
    }

    if (rejectReason) {
      const docId = await ctx.db.insert("sponsorDocuments", {
        dealId: deal._id,
        kind: trimmedKind,
        storageRef: trimmedRef,
        status: "rejected",
        rejectReason,
        uploadedBy: sponsorActor(staff),
        createdAt: Date.now(),
      });
      await writeAudit(ctx, {
        actor: sponsorActor(staff),
        action: "sponsor.doc.rejected",
        target: docId,
        meta: { dealId: deal._id, kind: trimmedKind, rejectReason },
      });
      // Return the rejection (do NOT throw) — the row is durable, the caller renders the reason inline.
      return { status: "rejected" as const, rejectReason, docId };
    }

    const docId = await ctx.db.insert("sponsorDocuments", {
      dealId: deal._id,
      kind: trimmedKind,
      storageRef: trimmedRef,
      status: "received",
      uploadedBy: sponsorActor(staff),
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      actor: sponsorActor(staff),
      action: "sponsor.doc.uploaded",
      target: docId,
      meta: { dealId: deal._id, kind: trimmedKind },
    });
    return { status: "received" as const, docId };
  },
});

// --- Queries ----------------------------------------------------------------------------------

// checklistStatus — each required kind → received | missing, org-scoped. `sponsor.read`-gated so both
// sponsor roles can view it; the deal-ownership assert denies a foreign deal (not-found).
export const checklistStatus = query({
  args: { dealId: v.id("sponsorDeals") },
  handler: async (ctx, { dealId }) => {
    await requirePermission(ctx, "sponsor.read");
    const { deal } = await resolveOwnedDeal(ctx, dealId);
    const docs = await ctx.db
      .query("sponsorDocuments")
      .withIndex("by_deal", (q) => q.eq("dealId", deal._id))
      .collect();
    const received = new Set(docs.filter((d) => d.status === "received").map((d) => d.kind));
    return REQUIRED_DOC_KINDS.map((kind) => ({
      kind,
      label: DOC_KIND_LABELS[kind],
      status: received.has(kind) ? ("received" as const) : ("missing" as const),
    }));
  },
});

export type TimelineState = "passed" | "pending" | "needs-you";

// dealTimeline — the status timeline is DERIVED, not stored twice: it computes {KYB/Gate 0, each
// checklist item, submitted} from the live rows (org.kybStatus, sponsorDocuments, deal.status). One
// source of truth. States: passed (done), needs-you (the sponsor must act), pending (waiting on a
// prerequisite / in third-party review).
export const dealTimeline = query({
  args: { dealId: v.id("sponsorDeals") },
  handler: async (ctx, { dealId }) => {
    await requirePermission(ctx, "sponsor.read");
    const { orgId, deal } = await resolveOwnedDeal(ctx, dealId);
    const org = await ctx.db.get(orgId);

    const docs = await ctx.db
      .query("sponsorDocuments")
      .withIndex("by_deal", (q) => q.eq("dealId", deal._id))
      .collect();
    const received = new Set(docs.filter((d) => d.status === "received").map((d) => d.kind));

    // KYB: passed → passed; the org's own "pending" (in third-party review) → pending; none/failed →
    // needs-you (the sponsor must run/complete it).
    const kybState: TimelineState =
      org?.kybStatus === "passed" ? "passed" : org?.kybStatus === "pending" ? "pending" : "needs-you";

    const docStages = REQUIRED_DOC_KINDS.map((kind) => ({
      key: kind as string,
      label: DOC_KIND_LABELS[kind],
      state: (received.has(kind) ? "passed" : "needs-you") as TimelineState,
    }));

    const allDocsReceived = REQUIRED_DOC_KINDS.every((k) => received.has(k));
    const prerequisitesMet = org?.kybStatus === "passed" && allDocsReceived;
    // submitted: done → passed; all prerequisites met but not yet submitted → needs-you (ready to
    // submit); otherwise pending (still waiting on KYB or a document).
    const submittedState: TimelineState =
      deal.status === "submitted" ? "passed" : prerequisitesMet ? "needs-you" : "pending";

    return [
      { key: "kyb", label: "KYB / Gate 0", state: kybState },
      ...docStages,
      { key: "submitted", label: "Submitted for review", state: submittedState },
    ];
  },
});

// listDealDocuments — the deal's uploaded documents (received + rejected), newest first, org-scoped.
// `sponsor.read`-gated; a foreign deal is not-found.
export const listDealDocuments = query({
  args: { dealId: v.id("sponsorDeals") },
  handler: async (ctx, { dealId }) => {
    await requirePermission(ctx, "sponsor.read");
    const { deal } = await resolveOwnedDeal(ctx, dealId);
    return await ctx.db
      .query("sponsorDocuments")
      .withIndex("by_deal", (q) => q.eq("dealId", deal._id))
      .order("desc")
      .collect();
  },
});
