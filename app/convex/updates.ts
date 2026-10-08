import { query, internalMutation } from "./_generated/server";
import { periodFor } from "./home";
import { writeAudit } from "./audit";
import { findUserByIdentity } from "./security";
import type { Doc } from "./_generated/dataModel";

// Story 5.4 — Monthly property update (even quiet ones) (FR15).
//
// Updates is a PURE READ SURFACE over the property-operator mirror — it adds no authoritative state and
// never writes ownership/money. The whole model is derived from data already owned by the read model:
//   • every distinct property the caller HOLDS (holdings.by_user → distinct propertyIds → properties)
//   • per property, the latest operator update (propertyUpdates.by_property → most recent by period,
//     then publishedAt) — occupancy, reserves-months, rent-on-time, a plain note, a named operator
//   • an honest `overdue` flag per property (no update for the CURRENT period → overdue), so a quiet
//     month or a never-updated property still renders a calm "awaiting"/"overdue" note — never silence.
//
// The caller is always resolved server-side from the JWT (getUserIdentity() → by_privyId); the query
// returns `null` when unauthenticated or unprovisioned — the client-supplied identity is never trusted.
// No crypto vocabulary (wallet/gas/tx/mint/USDC) and no chain internal ever surfaces here.
//
// `flagOverdueUpdates` is the scheduled honest-minimal "flag": with no notification infrastructure, an
// overdue property gets ONE append-only `propertyUpdate.overdue` audit entry per period (idempotent by
// checking `auditLog` for an existing entry this period). `summary.overdue` drives the user-facing calm
// note independently — the two are separate honest signals.
//
// `devSeedPropertyUpdate` is a CLI-only seed (sibling to home:devSeedDistribution) that files a realistic
// CURRENT-period update for every held property so `/updates` is drivable without a live operator feed —
// NEVER wired to any consumer UI. It writes the current period, so live state is not-overdue; the overdue
// branch is proven by unit tests only (mirrors DW-9/DW-13). Real operator authoring/feed is deferred.

// --- Pure helpers (exported for unit tests; no ctx/db access) ---------------------------------

// The prior month's period key ("YYYY-MM") for a given epoch-ms instant, in UTC (matches `periodFor`'s
// UTC handling — no timezone drift on the period key). Date.UTC normalizes a month of -1 into December
// of the prior year, so a January instant yields the correct "YYYY-12".
export function previousPeriod(nowMs: number): string {
  const d = new Date(nowMs);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return prev.toISOString().slice(0, 7);
}

// A property is overdue for its monthly update when it has NO update for the current period — the literal
// reading of a monthly cadence, with a crisp boundary: `latestPeriod === null` (never updated) OR
// `latestPeriod < periodFor(now)` (the latest update predates the current period). A current-period
// update is NOT overdue; anything older is. A configurable grace day-of-month is deferred.
export function isUpdateOverdue(latestPeriod: string | null, nowMs: number): boolean {
  return latestPeriod === null || latestPeriod < periodFor(nowMs);
}

// Order two updates most-recent-first key: by `period` (lexicographic — a zero-padded "YYYY-MM" sorts
// identically to chronological order), then by `publishedAt`. Returns >0 when `a` is more recent.
function compareUpdateRecency(
  a: { period: string; publishedAt: number },
  b: { period: string; publishedAt: number },
): number {
  if (a.period !== b.period) return a.period < b.period ? -1 : 1;
  const ap = Number.isFinite(a.publishedAt) ? a.publishedAt : -Infinity;
  const bp = Number.isFinite(b.publishedAt) ? b.publishedAt : -Infinity;
  return ap - bp;
}

// The most recent update (by period, then publishedAt), or null when there are none.
export function selectLatestUpdate<T extends { period: string; publishedAt: number }>(
  rows: T[],
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (best === null || compareUpdateRecency(row, best) > 0) best = row;
  }
  return best;
}

// A narrow guard for the `v.any()` audit meta so the idempotency check reads `meta.period` safely.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// --- Query ------------------------------------------------------------------------------------

// The reactive Updates model for the authenticated caller. Resolves the caller from the JWT and derives
// one card per distinct HELD property — its latest operator update (or null) + an honest `overdue` flag.
// Returns `null` when unauthenticated or unprovisioned — never someone else's updates.
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await findUserByIdentity(ctx, identity);
    if (!user) return null;

    const holdings = await ctx.db
      .query("holdings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // The distinct properties the caller holds — every one appears as a card (quiet months and
    // never-updated properties included; the calm note is never silent).
    const propertyIds = [...new Set(holdings.map((h) => h.propertyId))];
    const now = Date.now();

    const cards = [];
    for (const propertyId of propertyIds) {
      const property = await ctx.db.get(propertyId);
      if (!property) continue;

      // No by_property_period index — collect this property's updates by_property and select the latest
      // in JS (acceptable at seed scale; a `by_property_period` index is deferred — see deferred-work.md).
      const rows = await ctx.db
        .query("propertyUpdates")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect();
      const latest = selectLatestUpdate(rows);

      cards.push({
        propertyId,
        name: property.name,
        location: property.location,
        overdue: isUpdateOverdue(latest?.period ?? null, now),
        // `latest:null` when this property has never been updated — the card shows the awaiting note.
        latest: latest
          ? {
              operator: latest.operator,
              period: latest.period,
              occupancy: latest.occupancy,
              reservesMonths: latest.reservesMonths,
              rentOnTime: latest.rentOnTime,
              note: latest.note,
              publishedAt: latest.publishedAt,
            }
          : null,
      });
    }

    // Stable, deterministic order (by property name) so a reactive re-read never reshuffles the cards.
    cards.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    return {
      hasHoldings: holdings.length > 0,
      updates: cards,
    };
  },
});

// --- Scheduled overdue flag (cron-invoked internalMutation) -----------------------------------

// Scan every property; for each one overdue for the current-period update AND not already flagged this
// period, write ONE append-only `propertyUpdate.overdue` audit entry. Idempotent per property per period
// (a second run in the same period writes none), and empty-safe (never throws when there is nothing to
// flag). This is the honest minimal "flag" absent notification infrastructure; the user-facing calm note
// is driven independently by `summary.overdue`. Registered as a daily cron in crons.ts.
export const flagOverdueUpdates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const period = periodFor(now);
    const properties = await ctx.db.query("properties").collect();

    let flagged = 0;
    for (const property of properties) {
      const rows = await ctx.db
        .query("propertyUpdates")
        .withIndex("by_property", (q) => q.eq("propertyId", property._id))
        .collect();
      const latest = selectLatestUpdate(rows);
      if (!isUpdateOverdue(latest?.period ?? null, now)) continue;

      // Idempotent per (property, period): skip when an overdue flag already exists for this period.
      const priorAudits = await ctx.db
        .query("auditLog")
        .withIndex("by_target", (q) => q.eq("target", property._id))
        .collect();
      const alreadyFlagged = priorAudits.some(
        (a) =>
          a.action === "propertyUpdate.overdue" &&
          isRecord(a.meta) &&
          a.meta.period === period,
      );
      if (alreadyFlagged) continue;

      await writeAudit(ctx, {
        actor: "system",
        action: "propertyUpdate.overdue",
        target: property._id,
        meta: { period },
      });
      flagged += 1;
    }

    return `flagOverdueUpdates: flagged ${flagged} (period ${period})`;
  },
});

// --- Mutation (CLI seed only — never UI-wired) ------------------------------------------------

// Demo update producer. For every distinct HELD property, file a realistic, quiet-month update for the
// CURRENT period so `/updates` is drivable without a live operator feed. Idempotent per (property, period)
// on `by_property` (re-running the seed never double-files) and audited. Writes the current period, so
// live state is not-overdue — the overdue branch is proven by unit tests only. No args / no JWT: under
// `npx convex run` there is no caller identity, so it iterates ALL holdings. Run:
// `npx convex run updates:devSeedPropertyUpdate`.
export const devSeedPropertyUpdate = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const period = periodFor(now);
    const holdings = await ctx.db.query("holdings").collect();
    const propertyIds = [...new Set(holdings.map((h) => h.propertyId))];

    let seeded = 0;
    let skipped = 0;

    for (const propertyId of propertyIds) {
      // Idempotent per (property, period): an update already present for this property this period is a
      // no-op (re-running the seed never double-files).
      const existing = (
        await ctx.db
          .query("propertyUpdates")
          .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
          .collect()
      ).find((r) => r.period === period);
      if (existing) {
        skipped += 1;
        continue;
      }

      const property: Doc<"properties"> | null = await ctx.db.get(propertyId);
      if (!property) {
        skipped += 1;
        continue;
      }

      await ctx.db.insert("propertyUpdates", {
        propertyId,
        period,
        occupancy: 0.96,
        reservesMonths: 4,
        rentOnTime: true,
        note:
          "A quiet, steady month. Every home stayed occupied, rent came in on time, and the reserve " +
          "fund is fully topped up. Nothing here needs your attention.",
        operator: "Maria Alvarez, Property Manager",
        publishedAt: now,
      });

      await writeAudit(ctx, {
        actor: "seed",
        action: "propertyUpdate.seeded",
        target: propertyId,
        meta: { period },
      });

      seeded += 1;
    }

    return `devSeedPropertyUpdate: seeded ${seeded}, skipped ${skipped} (period ${period})`;
  },
});
