import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";
import { splitDistribution } from "./home";
import type { Id } from "./_generated/dataModel";

// Slice 5 — Monthly dividend distribution engine (PUSH model, FR12/FR14).
//
// This module computes and SCHEDULES each holder's pro-rata share of a property's monthly net
// distribution pool. It is the intent/eligibility side of the spine: Convex owns the pending ledger
// rows; on-chain payment is authoritative. So `runDistribution` writes/updates append-only
// incomeLedger rows as PENDING (schema status `"scheduled"` — there is no `"pending"` literal;
// `"scheduled"` IS the pending state) and NEVER marks a row paid. The paid flip is owned solely by
// `reconcile.applyChainEvent` (a `distribution` chain event carrying period + txSig), exactly like DvP
// settlement is owned by the on-chain confirm — Convex never self-settles a distribution.
//
// The share math is a pure, unit-tested helper (no ctx/db). It guarantees the sum of shares NEVER
// exceeds the pool: the pool is FLOORED to whole cents and apportioned by the largest-remainder method
// in integer cents, so the allocated total is exactly `floor(pool¢)` — always ≤ the real pool, never a
// fabricated over-distribution. Consumer-facing copy stays fiat-native (dollars); "USDC" appears only
// in the internal push seam (distributionPush.ts).

// --- Pure helpers (exported for unit tests; no ctx/db access) ---------------------------------

// Coerce any input to a finite number, else 0 — the shared finite guard (mirrors settlement.ts).
// `+ 0` normalizes `-0` → `+0`.
function finite(n: number): number {
  return Number.isFinite(n) ? n + 0 : 0;
}

// Round to whole cents (half-up for positives) — same discipline as settlement.ts/income.ts.
export function roundCents(n: number): number {
  return Math.round(finite(n) * 100) / 100;
}

// holderWeight — THE single holder pro-rata weight rule, shared by every place that aggregates holdings
// into a distribution. Weight is `ownershipPct` (the unit-safe ownership basis both purchase paths
// maintain — NOT `tokenAmount`, whose units differ across the stub-settle and reconciled-chain paths),
// coerced to a finite number (a non-finite ownershipPct contributes 0, never NaN). Exported and reused
// by runDistribution, distributionTargets (distribution.ts), and holdersByUser (distributionBuild.ts)
// so the scheduled ledger, the push targets, and the built draft can NEVER drift on how a holder is
// weighted — removing the mis-pay risk of three hand-copied `Number.isFinite(...) ? ... : 0` sites.
export function holderWeight(h: { ownershipPct: number }): number {
  return Number.isFinite(h.ownershipPct) ? h.ownershipPct : 0;
}

// A holder's pro-rata weight input (the property ownership/token amount). `id` is an opaque key (a user
// or holding id) so the math stays db-free and testable.
export interface ShareInput {
  id: string;
  weight: number;
}

// A computed share, aligned 1:1 to the input holders. `cents` is the authoritative integer allocation;
// `amount` is its dollar view (cents / 100). Excluded (zero/negative/non-finite weight) holders get 0.
export interface Share {
  id: string;
  cents: number;
  amount: number;
}

// Pro-rata apportionment of a net distribution pool across holders, in whole cents.
//
// Invariants (all enforced, all unit-tested):
//   • Σ shares NEVER exceeds the pool — the pool is FLOORED to whole cents (rounding UP could
//     over-distribute by up to half a cent, which is forbidden), and the allocated total is exactly
//     that floored cent count.
//   • A zero / negative / non-finite pool → every holder gets $0 (never NaN/negative).
//   • Zero-token (non-positive / non-finite weight) holders are EXCLUDED from the weighting and are
//     never awarded a remainder cent — they surface with `cents: 0`.
//   • Each share ∝ that holder's weight over the total eligible weight; the leftover cents from
//     flooring are handed out one-by-one by the largest-remainder method (ties → biggest holder, then
//     input order) so the allocation is deterministic and the components sum to the pool exactly.
export function computeShares(poolDollars: number, holders: readonly ShareInput[]): Share[] {
  const pool = finite(poolDollars);
  // Floor the pool to whole cents so the allocated total can NEVER exceed the actual pool. The tiny
  // epsilon absorbs binary-float representation error (e.g. 0.29 * 100 = 28.9999999) without ever
  // rounding a genuine sub-cent excess up.
  const poolCents = pool > 0 ? Math.floor(pool * 100 + 1e-6) : 0;

  // Eligible weights: strictly-positive finite only — zero-token holders are excluded (weight 0).
  const weights = holders.map((h) => {
    const w = finite(h.weight);
    return w > 0 ? w : 0;
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  // No pool or no eligible weight → all-zero (guarded: never NaN/negative, never a phantom payout).
  if (poolCents <= 0 || totalWeight <= 0) {
    return holders.map((h) => ({ id: h.id, cents: 0, amount: 0 }));
  }

  // Largest-remainder apportionment in integer cents: floor each exact share, then distribute the
  // leftover cents to the largest fractional remainders first.
  const exact = weights.map((w) => (poolCents * w) / totalWeight);
  const floors = exact.map((x) => Math.floor(x));
  const allocated = floors.reduce((s, c) => s + c, 0);
  let leftover = poolCents - allocated; // integer in [0, eligibleCount) — Σ of the fractional parts

  // Rank by fractional remainder desc; ties broken toward the BIGGEST holder, then input order — so
  // the allocation is fully deterministic (no dependence on Map/object iteration quirks).
  const order = holders
    .map((_, i) => ({ i, remainder: exact[i] - floors[i], weight: weights[i] }))
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.i - b.i);

  const cents = floors.slice();
  for (const { i } of order) {
    if (leftover <= 0) break;
    if (weights[i] <= 0) continue; // never award a cent to an excluded (zero-weight) holder
    cents[i] += 1;
    leftover -= 1;
  }

  return holders.map((h, i) => ({ id: h.id, cents: cents[i], amount: cents[i] / 100 }));
}

// --- Distribution scheduling mutation ---------------------------------------------------------

// Compute each holder's pro-rata share of a property's `period` net pool and write/update their
// incomeLedger row as PENDING (`status: "scheduled"`) — never paid. Server-authoritative and audited.
// Holders are aggregated by user (a user's multiple holdings sum into one share), and $0 rounded /
// zero-token holders never get a fabricated ledger row. A row already flipped `paid` (chain truth via
// reconcile) is left untouched — reconcile owns the paid state. This is CLI/orchestration-only
// (internalMutation): the push action calls it, and it leaves the clean seam for
// `reconcile.applyChainEvent(distribution)` to flip scheduled → paid from the on-chain signature.
export const runDistribution = internalMutation({
  args: {
    propertyId: v.id("properties"),
    period: v.string(), // "YYYY-MM"
    poolNet: v.number(), // total net dollars to distribute for this property this period
  },
  handler: async (ctx, { propertyId, period, poolNet }) => {
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");

    const holdings = await ctx.db
      .query("holdings")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .collect();

    // Aggregate weight by user (a holder is a user, not an individual holding row). Weight is
    // `ownershipPct`, NOT `tokenAmount`: tokenAmount carries different units across the two purchase
    // paths (USD in the Convex-stub settle, chain token count once reconciled), so weighting by it
    // would mis-pay dividends. ownershipPct is the single unit-safe ownership basis both paths maintain.
    const weightByUser = new Map<Id<"users">, number>();
    for (const h of holdings) {
      weightByUser.set(h.userId, (weightByUser.get(h.userId) ?? 0) + holderWeight(h));
    }
    const users = [...weightByUser.entries()];
    const shares = computeShares(
      poolNet,
      users.map(([id, w]) => ({ id, weight: w })),
    );

    // Existing rows for this (property, period) — upsert per user (idempotent re-runs never double-pay).
    const existing = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .collect();
    const existingByUser = new Map(existing.map((r) => [r.userId, r]));

    let written = 0;
    let updated = 0;
    let skippedPaid = 0;
    let skippedZero = 0;
    for (let i = 0; i < users.length; i++) {
      const userId = users[i][0];
      const netPaid = shares[i].amount;
      // Exclude zero-token holders and sub-cent ($0 rounded) shares — no fabricated all-zero rows.
      if (netPaid <= 0) {
        skippedZero += 1;
        continue;
      }
      // A real, internally-consistent gross→net waterfall (grossShare = costs+mgmtFee+reserve+netPaid),
      // reusing the same splitter the read model/seed use so Home/Portfolio/Income stay consistent.
      const waterfall = splitDistribution(netPaid);
      const prior = existingByUser.get(userId);
      if (prior) {
        // A chain-confirmed (paid) row is authoritative — never overwrite it (reconcile owns paid).
        if (prior.status === "paid") {
          skippedPaid += 1;
          continue;
        }
        await ctx.db.patch(prior._id, { ...waterfall, status: "scheduled" });
        updated += 1;
      } else {
        await ctx.db.insert("incomeLedger", {
          userId,
          propertyId,
          period,
          grossShare: waterfall.grossShare,
          costs: waterfall.costs,
          mgmtFee: waterfall.mgmtFee,
          reserve: waterfall.reserve,
          netPaid: waterfall.netPaid,
          status: "scheduled",
        });
        written += 1;
      }
    }

    await writeAudit(ctx, {
      actor: "distribution",
      action: "distribution.scheduled",
      target: propertyId,
      meta: {
        period,
        poolNet: roundCents(poolNet),
        holders: users.length,
        written,
        updated,
        skippedPaid,
        skippedZero,
      },
    });

    return { period, holders: users.length, written, updated, skippedPaid, skippedZero };
  },
});

// --- Push targets read (for the orchestrating action) -----------------------------------------

// Resolve the property's push targets: each holder's user id, destination wallet, and aggregated
// pro-rata weight. `walletAddress` is on the users table and is OPTIONAL — a holder without one cannot
// be pushed to (the action counts them as skipped rather than inventing a destination). Returns the
// property mint too, so the push action can hand reconcile the (mint, period) it needs to confirm.
export const distributionTargets = internalQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");

    const holdings = await ctx.db
      .query("holdings")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .collect();

    // Weight by ownershipPct (unit-safe), identical to runDistribution — the two aggregations MUST
    // stay in lockstep so the pushed amount matches the scheduled ledger amount.
    const weightByUser = new Map<Id<"users">, number>();
    for (const h of holdings) {
      weightByUser.set(h.userId, (weightByUser.get(h.userId) ?? 0) + holderWeight(h));
    }

    const holders: { userId: Id<"users">; walletAddress: string | undefined; weight: number }[] = [];
    for (const [userId, weight] of weightByUser) {
      const user = await ctx.db.get(userId);
      holders.push({ userId, walletAddress: user?.walletAddress, weight });
    }

    return { mint: property.mint, holders };
  },
});
