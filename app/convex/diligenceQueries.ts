import { query } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";

// Admin Story 2.1 — the READ side of AI extraction, for the ai.review reviewer. Both queries are
// permission-gated (ai.review) server-side on every request and are strictly read-only. The reviewer
// read is where CITE-OR-REFUSE is HONORED at presentation: an `uncited` field is returned with
// `needsSource: true` and is NEVER presented as an established value — the UI renders it as "needs a
// source, not an established fact." A field is a fact ONLY when it carries a citation (`extracted`).

// listReviewableProperties — the ai.review reviewer's property picker (id + name + status only). Not in
// the original Code Map, but the review page needs a staff-gated way to CHOOSE a property to extract
// over; reusing the consumer `properties:listOpen` would (a) leak the choice through an ungated surface
// and (b) hide pre-listing deals. Small, read-only, ai.review-gated.
export const listReviewableProperties = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "ai.review");
    const properties = await ctx.db.query("properties").take(200);
    return properties.map((p) => ({ id: p._id, name: p.name, status: p.status }));
  },
});

// listExtractionRuns — the runs for a property, newest first. ai.review-gated.
export const listExtractionRuns = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ai.review");
    const runs = await ctx.db
      .query("extractionRuns")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .order("desc")
      .collect();
    return runs.map((r) => ({
      id: r._id,
      propertyId: r.propertyId,
      status: r.status,
      model: r.model,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
  },
});

// listExtractedFields — the fields for a run (or, if runId is omitted, for a property). ai.review-gated.
// Each row is decorated with `needsSource` (true iff uncited) so the reviewer surface can flag it and
// NEVER render it as an established fact. Rejected rows carry their human `reviewNote`. Nothing here is
// an approval; there is no verified/approved status to return.
export const listExtractedFields = query({
  args: {
    propertyId: v.id("properties"),
    runId: v.optional(v.id("extractionRuns")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "ai.review");

    const fields = args.runId
      ? await ctx.db
          .query("extractedFields")
          .withIndex("by_run", (q) => q.eq("runId", args.runId!))
          .collect()
      : await ctx.db
          .query("extractedFields")
          .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
          .order("desc")
          .collect();

    return fields.map((f) => ({
      id: f._id,
      runId: f.runId,
      docId: f.docId,
      field: f.field,
      value: f.value,
      sourceRef: f.sourceRef ?? null,
      confidence: f.confidence,
      status: f.status,
      reviewNote: f.reviewNote ?? null,
      // Cite-or-refuse at the read boundary: an uncited field NEEDS a source and is not an established
      // fact. The UI must render it flagged, never as a plain value.
      needsSource: f.status === "uncited",
    }));
  },
});
