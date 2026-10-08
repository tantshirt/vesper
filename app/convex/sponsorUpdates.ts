import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { requireSponsor, sponsorActor } from "./sponsor";

// Admin Story 6.3 — the sponsor AUTHORING composer for a property's monthly update (FR15's write side).
//
// Consumer E5.4 already OWNS the read + overdue-flagging: `updates.summary` renders the latest update
// per HELD property, and `updates.flagOverdueUpdates` (an internalMutation cron) flags a property with no
// current-period update. This module adds the surface where a SPONSOR (Sofia/`sponsor_ops` or the
// principal) publishes that update — including the uneventful months, which still carry occupancy /
// reserves / rent-on-time and a plain note (never a silent "nothing happened").
//
// Tenant isolation is the sponsor↔property OPERATOR link: `properties.operatorSponsorOrgId`. A sponsor
// may author an update ONLY for a property whose link equals their `requireSponsor`-resolved org; a
// property they do not operate reads as not-found (never a client-supplied org, never a confirmed
// existence). The link is POPULATED at listing (Epic 3); here we scope every read/write by it.

// --- Queries ----------------------------------------------------------------------------------

// myOperatedProperties — the properties the caller's org operates, org-scoped via the `by_operator`
// index. `requireSponsor` resolves the org server-side (and bars a non-sponsor); there is no
// client-supplied filter, so a sponsor sees EXACTLY the properties linked to their org. Drives the
// composer's property picker.
export const myOperatedProperties = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sponsor.read");
    const { orgId } = await requireSponsor(ctx);
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_operator", (q) => q.eq("operatorSponsorOrgId", orgId))
      .collect();
    return properties.map((p) => ({
      id: p._id,
      name: p.name,
      location: p.location,
    }));
  },
});

// listMyUpdates — every monthly update the caller's org has published, org-scoped by fanning out from
// the operated properties (propertyUpdates carries no org, so the operator link on `properties` is the
// only tenant key). Newest first. A property that leaves the org's operation simply drops out — there
// is no path to another org's updates.
export const listMyUpdates = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sponsor.read");
    const { orgId } = await requireSponsor(ctx);
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_operator", (q) => q.eq("operatorSponsorOrgId", orgId))
      .collect();

    const updates = [];
    for (const property of properties) {
      const rows = await ctx.db
        .query("propertyUpdates")
        .withIndex("by_property", (q) => q.eq("propertyId", property._id))
        .collect();
      for (const row of rows) {
        updates.push({
          id: row._id,
          propertyId: property._id,
          propertyName: property.name,
          period: row.period,
          occupancy: row.occupancy,
          reservesMonths: row.reservesMonths,
          rentOnTime: row.rentOnTime,
          note: row.note,
          operator: row.operator,
          publishedAt: row.publishedAt,
        });
      }
    }

    // Deterministic newest-first order so a reactive re-read never reshuffles the list.
    updates.sort((a, b) => b.publishedAt - a.publishedAt);
    return updates;
  },
});

// --- Mutation ---------------------------------------------------------------------------------

// publishUpdate — author one monthly update for an OPERATED property. `requireSponsor` resolves the org
// (and bars a non-sponsor); `requirePermission(sponsor.updates)` then admits BOTH sponsor roles (Sofia
// authors). Tenant wall: the property is admitted ONLY if its `operatorSponsorOrgId` equals the caller's
// org — a property they do not operate is not-found, never confirmed.
//
// EVERY field is required and validated — even a quiet month needs occupancy, reserves-months,
// rent-on-time, a named operator, and a plain note. There is deliberately NO "nothing happened" empty
// publish: an empty/partial submission throws BEFORE any write. Audited to the sponsor human.
export const publishUpdate = mutation({
  args: {
    propertyId: v.id("properties"),
    period: v.string(), // "YYYY-MM"
    occupancy: v.number(), // fraction in [0, 1]
    reservesMonths: v.number(), // months of reserves on hand (≥ 0)
    rentOnTime: v.boolean(),
    operator: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { staff, orgId } = await requireSponsor(ctx);
    await requirePermission(ctx, "sponsor.updates");

    const property = await ctx.db.get(args.propertyId);
    // Tenant isolation: a property the caller's org does not operate (or a non-existent one) reads as
    // not-found — never trust a client-supplied org, never confirm another tenant's property.
    if (!property || property.operatorSponsorOrgId !== orgId) {
      throw new Error("Property not found");
    }

    // Every field required — a quiet month is still a full report, never a silent blank.
    const period = args.period.trim();
    const operator = args.operator.trim();
    const note = args.note.trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new Error("period is required in YYYY-MM form");
    }
    if (!operator) throw new Error("operator is required");
    if (!note) {
      throw new Error("A note is required — even a quiet month needs a plain summary");
    }
    if (!Number.isFinite(args.occupancy) || args.occupancy < 0 || args.occupancy > 1) {
      throw new Error("occupancy must be a fraction between 0 and 1");
    }
    if (!Number.isFinite(args.reservesMonths) || args.reservesMonths < 0) {
      throw new Error("reservesMonths must be zero or greater");
    }

    const updateId = await ctx.db.insert("propertyUpdates", {
      propertyId: property._id,
      period,
      occupancy: args.occupancy,
      reservesMonths: args.reservesMonths,
      rentOnTime: args.rentOnTime,
      note,
      operator,
      publishedAt: Date.now(),
    });

    await writeAudit(ctx, {
      actor: sponsorActor(staff),
      action: "sponsor.update.published",
      target: updateId,
      meta: { propertyId: property._id, period, sponsorOrgId: orgId },
    });

    return updateId;
  },
});
