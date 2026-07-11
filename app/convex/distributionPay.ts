import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { requireStepUp, requireUnsafeStubs } from "./security";
import { roundCents } from "./distribution";
import { applyChainEventInner } from "./reconcile";

// Admin Story 4.2 — FUND ESCROW + PUSH DISTRIBUTION (no self-settle). A `distribution.execute`-gated
// operator (ops_diligence; platform_admin denied at 1-1's wall) takes a built `scheduled` draft (4-1),
// FUNDS it into escrow (B1 custody stub), then PUSHES it on-chain behind a step-up re-auth stating the
// irreversible consequence. THE MONEY-SAFETY SPINE, unchanged from mint/DvP:
//   • FUND BEFORE PUSH. `pushDistribution` refuses unless `fundDistributionEscrow` has recorded escrow
//     for the (property, period).
//   • CONVEX NEVER SELF-SETTLES. The push REUSES `runDistributionPush` (the `STUB-DIST-` seam): it
//     records each holder's push signature on their `scheduled` row and audits `distribution.pushed`,
//     but NEVER flips `status:"paid"`. The `scheduled`→`paid` flip is owned SOLELY by reconcile
//     (`income.reconciled`) when the on-chain push confirms — `confirmDistributionStub` routes a
//     distribution confirm through that exact chain-wins path (mirroring `confirmMintStub`).
//   • FAILURE IS SAFE + AUDITED + RETRYABLE. A push-seam failure marks NO row paid, audits
//     `distribution.push.failed`, and leaves the draft `scheduled` for retry (idempotent — a re-push
//     re-stamps the same deterministic signature and never double-pays; a chain-confirmed row is never
//     re-pushed).
// This module adds NO new payout math and does NOT change the consumer `runDistributionPush` /
// `pushUsdcToHolder` / reconcile semantics — it is the operator TRIGGER + the escrow + the step-up.

// ── The push-seam fault-injection flag (test/ops seam, mirrors requireUnsafeStubs posture) ────────────
// The real push is the Privy server-wallet signAndSend inside `pushUsdcToHolder` (distributionPush.ts),
// which can REJECT (network / insufficient-escrow / signer failure). No live server wallet exists here,
// so a seam failure is inducible via this documented flag — the operator can prove the failure path is
// safe (no paid flip, audited, retryable) exactly as the real rejection would be. Off by default.
function pushSeamShouldFail(): boolean {
  return process.env.VESPER_STUB_DIST_PUSH_FAIL === "true";
}

// resolveDistributor — the permission gate for the ACTION half (pushDistribution has no db of its own).
// Reuses 1-1's `requirePermission` on a QueryCtx: platform_admin (no distribution.execute) is denied
// HERE, before any escrow/step-up/seam work — proving the 1-1 wall. Returns the caller's staff doc so
// the action can name the human. Internal-only.
export const resolveDistributor = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"staff">> => {
    return await requirePermission(ctx, "distribution.execute");
  },
});

// loadPushState — the action's read half: the built draft's push-relevant state for (property, period).
// `poolNet` is the net pool the push re-apportions — the Σ of every ledger row's `netPaid` (identical to
// what 4-1 built), so the pushed amounts match the scheduled draft exactly. `escrowFunded` is the
// fund-before-push gate. Returns null for a missing property.
export const loadPushState = internalQuery({
  args: { propertyId: v.id("properties"), period: v.string() },
  handler: async (ctx, { propertyId, period }) => {
    const property = await ctx.db.get(propertyId);
    if (!property) return null;

    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .collect();

    const escrow = await ctx.db
      .query("distributionEscrow")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .unique();

    return {
      mint: property.mint ?? null,
      scheduledCount: rows.filter((r) => r.status === "scheduled").length,
      paidCount: rows.filter((r) => r.status === "paid").length,
      // The full built net pool (all non-missed rows) — runDistributionPush re-apportions this exact
      // amount, so the per-holder push equals the scheduled draft.
      poolNet: roundCents(rows.reduce((s, r) => s + (r.status === "missed" ? 0 : r.netPaid), 0)),
      escrowFunded: !!escrow,
      fundedAmount: escrow?.fundedAmount ?? 0,
    };
  },
});

// ── fundDistributionEscrow — the B1 custody STUB seam: fund the pool BEFORE any push (mutation) ────────
// distribution.execute-gated + `requireUnsafeStubs` (the escrow stays disabled until a real custody
// vendor is configured, mirroring STUB-MINT/-DIST). Asserts a built `scheduled` draft exists for the
// (property, period) — you cannot fund a pool that was never built. Funds the FULL built net pool
// (Σ netPaid) and upserts the escrow row IDEMPOTENTLY per (property, period) — a re-fund updates in
// place, never duplicates. Audits `distribution.escrow.funded` to the NAMED human. NO push here; the
// push is a distinct, step-up-gated act.
export const fundDistributionEscrow = mutation({
  args: { propertyId: v.id("properties"), period: v.string() },
  handler: async (ctx, { propertyId, period }) => {
    const staff = await requirePermission(ctx, "distribution.execute");
    requireUnsafeStubs("Distribution escrow");
    const actor = staff.email || staff.name || staff.workosId;

    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .collect();
    const scheduled = rows.filter((r) => r.status === "scheduled");
    if (scheduled.length === 0) {
      throw new Error("No scheduled distribution draft to fund — build the draft first");
    }

    // Fund the FULL built pool (every non-missed row's net) so the escrow always covers the push.
    const fundedAmount = roundCents(rows.reduce((s, r) => s + (r.status === "missed" ? 0 : r.netPaid), 0));
    // The (stubbed) custody deposit reference — deterministic per (property, period) so a re-fund is a
    // clean idempotent update. The real custody vendor returns its own ref here with no shape change.
    const custodyRef = `STUB-ESCROW-${propertyId}-${period}`;

    const existing = await ctx.db
      .query("distributionEscrow")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        fundedAmount,
        custodyRef,
        fundedBy: actor,
        fundedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("distributionEscrow", {
        propertyId,
        period,
        fundedAmount,
        custodyRef,
        fundedBy: actor,
        fundedAt: Date.now(),
      });
    }

    await writeAudit(ctx, {
      actor, // the named human who funded — never a system
      action: "distribution.escrow.funded",
      target: propertyId,
      meta: { period, fundedAmount, custodyRef, holders: scheduled.length },
    });

    return { funded: true as const, fundedAmount, custodyRef };
  },
});

// recordPushFailure — the WRITE half of a FAILED push (internalMutation). Audits `distribution.push.failed`
// to the NAMED human. It NEVER touches ledger status — the push never flips `paid`, so a failed attempt
// leaves every row `scheduled` (retryable) by construction; this only records the durable failure.
export const recordPushFailure = internalMutation({
  args: {
    propertyId: v.id("properties"),
    period: v.string(),
    actor: v.string(),
    message: v.string(),
  },
  handler: async (ctx, { propertyId, period, actor, message }) => {
    await writeAudit(ctx, {
      actor, // the named human who triggered the (failed) push
      action: "distribution.push.failed",
      target: propertyId,
      meta: { period, message },
    });
    return { recorded: true as const };
  },
});

// ── pushDistribution — the irreversible on-chain push (ACTION, distribution.execute-gated) ────────────
// An ACTION because it drives the server-wallet push seam (runDistributionPush). Flow, first-failing-wall
// wins:
//   1. resolveDistributor — distribution.execute (platform_admin denied here, before anything else).
//   2. load the built draft; refuse if missing OR nothing scheduled to push (build it first).
//   3. FUND-BEFORE-PUSH: refuse unless the escrow is funded for this (property, period).
//   4. requireStepUp — the B2 step-up placeholder for this irreversible, final act.
//   5. runDistributionPush (STUB-DIST push) — records each holder's push signature on the `scheduled`
//      row and audits `distribution.pushed`. Status STAYS `scheduled` — Convex NEVER self-settles; the
//      `paid` flip is reconcile's alone (confirmDistributionStub / the real Helius confirm).
// On any seam failure: audit `distribution.push.failed`, mark NO row paid, rethrow — the draft stays
// `scheduled` and a retry does not double-pay (recordPushSignatures re-stamps the same deterministic
// signature and never touches a chain-confirmed row).
export const pushDistribution = action({
  args: { propertyId: v.id("properties"), period: v.string() },
  handler: async (
    ctx,
    { propertyId, period },
  ): Promise<{ pushed: number; skippedNoWallet: number; skippedZero: number }> => {
    const staff = await ctx.runQuery(internal.distributionPay.resolveDistributor, {});
    const actor = staff.email || staff.name || staff.workosId;

    const state = await ctx.runQuery(internal.distributionPay.loadPushState, { propertyId, period });
    if (!state) throw new Error("Property not found");
    if (state.scheduledCount === 0) {
      throw new Error("No scheduled distribution draft to push — build the draft first");
    }

    // FUND-BEFORE-PUSH — the B1 gate. A pool that was never funded into escrow can never be pushed.
    if (!state.escrowFunded) {
      throw new Error("Cannot push: fund the distribution escrow first");
    }

    // STEP-UP (B2 placeholder) — the irreversible, final push requires a step-up re-auth. Stub seam.
    requireStepUp(ctx, "distribution.execute");

    try {
      // The push seam can reject (real Privy signAndSend); prove the failure path is safe via the flag.
      if (pushSeamShouldFail()) throw new Error("Distribution push seam failed (stub-injected fault)");

      // REUSE the consumer push: records per-holder txSig on the scheduled rows + audits
      // `distribution.pushed`. It NEVER flips `paid` — reconcile owns that.
      const res = await ctx.runAction(internal.distributionPush.runDistributionPush, {
        propertyId,
        period,
        poolNet: state.poolNet,
      });
      return {
        pushed: res.pushed,
        skippedNoWallet: res.skippedNoWallet,
        skippedZero: res.skippedZero,
      };
    } catch (err) {
      // Failure is safe + audited + retryable: no row was flipped paid (push never pays), and the draft
      // stays scheduled. Record the durable failure, then rethrow so the operator sees it and can retry.
      await ctx.runMutation(internal.distributionPay.recordPushFailure, {
        propertyId,
        period,
        actor,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});

// ── confirmDistributionStub — route a distribution confirm through reconcile (mutation) ───────────────
// distribution.execute-gated + `requireUnsafeStubs`. The REAL confirm is the Helius webhook → reconcile
// path (http.ts → applyChainEvent) applying chain truth; this stub is exposed so the demo/tests can
// reach the `paid` state. Like `confirmMintStub`, it does NOT flip status itself — it SYNTHESIZES the
// on-chain distribution event and drives it through the SAME chain-wins apply path
// (reconcile.applyChainEventInner → `income.reconciled`), so the `scheduled`→`paid` flip is owned by
// reconcile (chain-authoritative), never by this operator call. Deliberately DISTINCT from the push — a
// distribution is never confirmed in the same breath it is pushed. Idempotent by signature at the
// reconcile layer (and reconcile only ever pays a not-already-paid row).
export const confirmDistributionStub = mutation({
  args: { propertyId: v.id("properties"), period: v.string() },
  handler: async (ctx, { propertyId, period }) => {
    await requirePermission(ctx, "distribution.execute");
    requireUnsafeStubs("Distribution confirmation");

    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");
    // Reconcile routes by `mint` (by_mint) — an unminted property can never carry a chain distribution.
    if (!property.mint) {
      throw new Error("Cannot confirm a distribution for a property with no on-chain mint");
    }

    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .collect();
    const pushed = rows.filter((r) => r.status === "scheduled" && r.txSig);
    if (pushed.length === 0) {
      throw new Error("No pushed distribution to confirm — push it first");
    }

    // Synthesize the on-chain distribution confirmation and route it through the reconcile apply path.
    // The signature is deterministic per (property, period) so a re-run is an idempotent no-op at the
    // reconcile layer too. The apply audits `income.reconciled` (actor "helius") — the chain event, not
    // the operator, owns the paid flip.
    const signature = `STUB-DIST-CONFIRM-${propertyId}-${period}`;
    const result = await applyChainEventInner(ctx, {
      type: "distribution",
      signature,
      mint: property.mint,
      period,
      txSig: signature,
    });

    return { confirmed: result.status === "applied", status: result.status };
  },
});

// ── distributionPayStatus — the console's fund/push/paid read (query, distribution.execute) ───────────
// Per-(property, period) settlement state for the console: whether the escrow is funded (+ amount/ref),
// how many rows carry a push signature (pushed), and how many have been reconciled `paid`. Read-only;
// returns null for a missing property.
export const distributionPayStatus = query({
  args: { propertyId: v.id("properties"), period: v.string() },
  handler: async (ctx, { propertyId, period }) => {
    await requirePermission(ctx, "distribution.execute");

    const property = await ctx.db.get(propertyId);
    if (!property) return null;

    const rows = await ctx.db
      .query("incomeLedger")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .collect();

    const escrow = await ctx.db
      .query("distributionEscrow")
      .withIndex("by_property_period", (q) => q.eq("propertyId", propertyId).eq("period", period))
      .unique();

    const scheduled = rows.filter((r) => r.status === "scheduled");
    const paid = rows.filter((r) => r.status === "paid");
    // "Pushed" = a scheduled row that already carries its on-chain push signature (recorded by the push,
    // awaiting reconcile). A paid row has moved past pushed (reconcile owns it).
    const pushed = scheduled.filter((r) => !!r.txSig);

    return {
      period,
      mint: property.mint ?? null,
      rowCount: rows.length,
      scheduledCount: scheduled.length,
      pushedCount: pushed.length,
      paidCount: paid.length,
      netTotal: roundCents(rows.reduce((s, r) => s + (r.status === "missed" ? 0 : r.netPaid), 0)),
      escrow: escrow
        ? {
            funded: true as const,
            fundedAmount: escrow.fundedAmount,
            custodyRef: escrow.custodyRef,
            fundedBy: escrow.fundedBy,
            fundedAt: escrow.fundedAt,
          }
        : { funded: false as const },
    };
  },
});
