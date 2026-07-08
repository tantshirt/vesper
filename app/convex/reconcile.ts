import { internalMutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";

// E1.3 — On-chain reconciliation harness.
// Solana is authoritative for token ownership and distributions (spine I2/I3, FR16). Convex is a
// reactive mirror. This module applies chain-authoritative events to that mirror: chain always wins,
// every apply is audited, and every processed event is recorded (append-only) for idempotency and
// discrepancy tracking. Reconciliation NEVER makes Convex authoritative over chain.

// The internal event contract — the tolerant Helius shape is normalized down to exactly this.
export type ChainEventType = "mint" | "transfer" | "distribution";
export interface ChainEvent {
  type: ChainEventType;
  signature: string;
  mint?: string;
  owner?: string; // token account owner (wallet address)
  tokenAmount?: number;
  period?: string; // "2026-07" — distribution period
  txSig?: string; // on-chain distribution tx reference recorded on incomeLedger
  slot?: number;
  raw?: unknown;
}

// Convex mutation args validator mirroring ChainEvent.
const eventArgs = {
  type: v.union(v.literal("mint"), v.literal("transfer"), v.literal("distribution")),
  signature: v.string(),
  mint: v.optional(v.string()),
  owner: v.optional(v.string()),
  tokenAmount: v.optional(v.number()),
  period: v.optional(v.string()),
  txSig: v.optional(v.string()),
  slot: v.optional(v.number()),
  raw: v.optional(v.any()),
};

// Idempotent apply of a single chain event to the Convex mirror. Called from the Helius httpAction.
export const applyChainEvent = internalMutation({
  args: eventArgs,
  handler: async (ctx, event) => {
    // Idempotency: a signature that already *applied* is a no-op (never re-apply, never double-audit).
    // An earlier `unresolved` row (event arrived before its property/user existed) is NOT terminal —
    // delete it so a later redelivery re-drives to a real apply. `.first()` (not `.unique()`) so a
    // stray duplicate row can never make every future event with that signature throw.
    const prior = await ctx.db
      .query("reconciliations")
      .withIndex("by_signature", (q) => q.eq("signature", event.signature))
      .first();
    if (prior?.status === "applied") return { status: "duplicate" as const };
    if (prior) await ctx.db.delete(prior._id); // unresolved → re-drive

    if (event.type === "distribution") {
      return await applyDistribution(ctx, event);
    }
    return await applyOwnership(ctx, event);
  },
});

// mint / transfer → reconcile a user's holding to the chain-authoritative token balance.
async function applyOwnership(ctx: MutationCtx, event: ChainEvent) {
  // A mint/transfer can't reconcile a balance without a valid, non-negative chain amount. Missing or
  // malformed → unresolved (don't write a bogus 0/negative holding and mark it "applied").
  if (event.tokenAmount === undefined || !Number.isFinite(event.tokenAmount) || event.tokenAmount < 0) {
    await ctx.db.insert("reconciliations", {
      signature: event.signature,
      eventType: event.type,
      mint: event.mint,
      slot: event.slot,
      status: "unresolved",
      raw: event.raw ?? event,
      processedAt: Date.now(),
    });
    return { status: "unresolved" as const };
  }

  // Resolve routing via indexes: mint → property, owner wallet → user. Unknown refs are logged, never thrown.
  const property = event.mint
    ? await ctx.db.query("properties").withIndex("by_mint", (q) => q.eq("mint", event.mint)).first()
    : null;
  const user = event.owner
    ? await ctx.db.query("users").withIndex("by_wallet", (q) => q.eq("walletAddress", event.owner)).first()
    : null;

  if (!property || !user) {
    await ctx.db.insert("reconciliations", {
      signature: event.signature,
      eventType: event.type,
      mint: event.mint,
      slot: event.slot,
      status: "unresolved",
      raw: event.raw ?? event,
      processedAt: Date.now(),
    });
    return { status: "unresolved" as const };
  }

  const holding = (
    await ctx.db
      .query("holdings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
  ).find((h) => h.propertyId === property._id);

  // Chain wins: the event's token balance overwrites Convex. costBasis stays Convex intent (order
  // side, never chain-authoritative). ownershipPct scales with the prior balance→pct ratio when
  // known; a fresh holding has no supply oracle here (out of scope) so it starts at 0.
  const before = holding?.tokenAmount;
  const after = event.tokenAmount; // validated finite & non-negative above
  const ownershipPct =
    holding && holding.tokenAmount > 0
      ? holding.ownershipPct * (after / holding.tokenAmount)
      : (holding?.ownershipPct ?? 0);

  if (holding) {
    await ctx.db.patch(holding._id, { tokenAmount: after, ownershipPct });
  } else {
    await ctx.db.insert("holdings", {
      userId: user._id,
      propertyId: property._id,
      tokenAmount: after,
      ownershipPct,
      costBasis: 0,
    });
  }

  const diverged = before !== undefined && before !== after;
  const discrepancy = diverged ? { before, after } : undefined;

  await writeAudit(ctx, {
    actor: "helius",
    action: diverged ? "chain.discrepancy" : "holding.reconciled",
    target: property._id,
    meta: { signature: event.signature, userId: user._id, tokenAmount: after, discrepancy },
  });

  await ctx.db.insert("reconciliations", {
    signature: event.signature,
    eventType: event.type,
    mint: event.mint,
    slot: event.slot,
    status: "applied",
    discrepancy,
    raw: event.raw ?? event,
    processedAt: Date.now(),
  });
  return { status: "applied" as const, discrepancy };
}

// distribution → mark the matching incomeLedger rows paid with the on-chain tx reference.
async function applyDistribution(ctx: MutationCtx, event: ChainEvent) {
  const property = event.mint
    ? await ctx.db.query("properties").withIndex("by_mint", (q) => q.eq("mint", event.mint)).first()
    : null;

  const rows =
    property && event.period
      ? await ctx.db
          .query("incomeLedger")
          .withIndex("by_property_period", (q) =>
            q.eq("propertyId", property._id).eq("period", event.period!)
          )
          .collect()
      : [];

  if (!property || rows.length === 0) {
    await ctx.db.insert("reconciliations", {
      signature: event.signature,
      eventType: event.type,
      mint: event.mint,
      slot: event.slot,
      status: "unresolved",
      raw: event.raw ?? event,
      processedAt: Date.now(),
    });
    return { status: "unresolved" as const };
  }

  // Only settle rows not already paid — a later, distinct-signature distribution for the same period
  // must not clobber the on-chain txSig that already recorded the actual paying transaction.
  const unpaid = rows.filter((r) => r.status !== "paid");
  // Stamp `paidAt` (E5.1) alongside the txSig: the moment this distribution was reconciled as paid,
  // so Home's "just landed" hero can tell a recent distribution from an old one.
  for (const row of unpaid) {
    await ctx.db.patch(row._id, { status: "paid", txSig: event.txSig, paidAt: Date.now() });
  }

  await writeAudit(ctx, {
    actor: "helius",
    action: "income.reconciled",
    target: property._id,
    meta: { signature: event.signature, period: event.period, txSig: event.txSig, rows: unpaid.length },
  });

  await ctx.db.insert("reconciliations", {
    signature: event.signature,
    eventType: event.type,
    mint: event.mint,
    slot: event.slot,
    status: "applied",
    raw: event.raw ?? event,
    processedAt: Date.now(),
  });
  return { status: "applied" as const, rows: unpaid.length };
}

// Map a tolerant/enriched Helius webhook payload to the internal event contract. Helius sends an
// array of enriched transactions; field names vary, so parsing stays defensive. Anything without a
// recognizable type + signature is dropped (the httpAction 400s when nothing normalizes).
export function normalizeHeliusEvent(payload: unknown): ChainEvent[] {
  const items = Array.isArray(payload) ? payload : payload != null ? [payload] : [];
  const events: ChainEvent[] = [];

  for (const item of items) {
    if (item == null || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;

    const type = normalizeType(raw.type ?? raw.eventType);
    const signature = firstString(raw.signature, raw.txSignature, raw.txSig, raw.sig);
    if (!type || !signature) continue;

    const transfer = firstTokenTransfer(raw.tokenTransfers);

    events.push({
      type,
      signature,
      mint: firstString(raw.mint, transfer?.mint),
      owner: firstString(raw.owner, raw.ownerAddress, transfer?.toUserAccount, transfer?.owner),
      tokenAmount: firstNumber(raw.tokenAmount, transfer?.tokenAmount, transfer?.amount),
      period: firstString(raw.period),
      txSig: firstString(raw.txSig, raw.signature, raw.txSignature),
      slot: firstNumber(raw.slot),
      raw: item,
    });
  }
  return events;
}

function normalizeType(t: unknown): ChainEventType | undefined {
  if (typeof t !== "string") return undefined;
  const s = t.toLowerCase();
  if (s.includes("mint")) return "mint";
  if (s.includes("distribut")) return "distribution";
  if (s.includes("transfer")) return "transfer";
  return undefined;
}

function firstTokenTransfer(v: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === "object") {
    return v[0] as Record<string, unknown>;
  }
  return undefined;
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function firstNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
}
