import { internalMutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { writeAudit } from "./audit";

// E1.3 — On-chain reconciliation harness.
// Solana is authoritative for token ownership and distributions (spine I2/I3, FR16). Convex is a
// reactive mirror. This module applies chain-authoritative events to that mirror: chain always wins,
// every apply is audited, and every processed event is recorded (append-only) for idempotency and
// discrepancy tracking. Reconciliation NEVER makes Convex authoritative over chain.

// The internal event contract — the tolerant Helius shape is normalized down to exactly this.
// `mint_confirmed` (Admin Story 3.3) is a PROPERTY-mint confirmation: it names a property's `mint`
// (no user holding) and flips that property's `mintStatus`→"confirmed" (unblocking 3-2 listOffering).
// It is a DISTINCT type from `mint`/`transfer` (which reconcile a USER's token holding) so the two can
// never be confused — a holding mint with no known owner still stays `unresolved` for redrive.
export type ChainEventType = "mint" | "transfer" | "distribution" | "mint_confirmed";
export interface ChainEvent {
  type: ChainEventType;
  signature: string;
  eventIndex?: number;
  mint?: string;
  owner?: string; // token account owner (wallet address)
  tokenAmount?: number;
  tokenAmountRaw?: string;
  tokenDecimals?: number;
  ownershipPct?: number; // chain-authoritative ownership fraction (balance / mint supply), when known
  period?: string; // "2026-07" — distribution period
  txSig?: string; // on-chain distribution tx reference recorded on incomeLedger
  slot?: number;
  evidenceSource?: "webhook" | "rpc" | "test_stub";
  quarantineReason?: string;
  raw?: unknown;
}

// Convex mutation args validator mirroring ChainEvent.
const eventArgs = {
  type: v.union(
    v.literal("mint"),
    v.literal("transfer"),
    v.literal("distribution"),
    v.literal("mint_confirmed"),
  ),
  signature: v.string(),
  eventIndex: v.optional(v.number()),
  mint: v.optional(v.string()),
  owner: v.optional(v.string()),
  tokenAmount: v.optional(v.number()),
  tokenAmountRaw: v.optional(v.string()),
  tokenDecimals: v.optional(v.number()),
  ownershipPct: v.optional(v.number()),
  period: v.optional(v.string()),
  txSig: v.optional(v.string()),
  slot: v.optional(v.number()),
  evidenceSource: v.optional(
    v.union(v.literal("webhook"), v.literal("rpc"), v.literal("test_stub")),
  ),
  quarantineReason: v.optional(v.string()),
  raw: v.optional(v.any()),
};

function eventKey(event: ChainEvent): string {
  return [
    event.signature,
    event.type,
    event.eventIndex ?? 0,
    event.mint ?? "",
    event.owner ?? "",
    event.period ?? "",
  ].join(":");
}

function targetKey(event: ChainEvent): string {
  if (event.type === "distribution") {
    return `distribution:${event.mint ?? ""}:${event.period ?? ""}:${event.owner ?? ""}`;
  }
  if (event.type === "mint_confirmed") return `mint:${event.mint ?? ""}`;
  return `holding:${event.mint ?? ""}:${event.owner ?? ""}`;
}

function projectionValue(event: ChainEvent): string {
  if (event.type === "mint_confirmed") return "confirmed";
  return `${event.tokenAmountRaw ?? event.tokenAmount ?? "missing"}:${event.tokenDecimals ?? "ui"}`;
}

async function recordReconciliation(
  ctx: MutationCtx,
  event: ChainEvent,
  status: "applied" | "unresolved" | "quarantined",
  options: { discrepancy?: unknown; reason?: string } = {},
) {
  await ctx.db.insert("reconciliations", {
    signature: event.signature,
    eventKey: eventKey(event),
    eventIndex: event.eventIndex,
    targetKey: targetKey(event),
    eventType: event.type,
    mint: event.mint,
    slot: event.slot,
    status,
    reason: options.reason,
    projectionValue: projectionValue(event),
    discrepancy: options.discrepancy,
    raw: event.raw ?? event,
    processedAt: Date.now(),
  });
  return { status };
}

async function orderingState(
  ctx: MutationCtx,
  event: ChainEvent,
): Promise<{ kind: "apply" | "equivalent" | "quarantine"; reason?: string }> {
  const explicitTestStub =
    process.env.NODE_ENV === "test" &&
    event.signature.startsWith("STUB-");
  if (event.slot === undefined) {
    return explicitTestStub
      ? { kind: "apply" }
      : { kind: "quarantine", reason: "chain event is missing a valid slot" };
  }
  if (!Number.isSafeInteger(event.slot) || event.slot < 0) {
    return { kind: "quarantine", reason: "invalid chain slot" };
  }
  const sameSlot = await ctx.db
    .query("reconciliations")
    .withIndex("by_target_slot", (q) => q.eq("targetKey", targetKey(event)).eq("slot", event.slot))
    .collect();
  const appliedAtSlot = sameSlot.find((row) => row.status === "applied");
  if (appliedAtSlot) {
    if (appliedAtSlot.projectionValue === projectionValue(event)) return { kind: "equivalent" };
    return {
      kind: "quarantine",
      reason: `conflicting event for target at slot ${event.slot}`,
    };
  }
  const newer = await ctx.db
    .query("reconciliations")
    .withIndex("by_target_status_slot", (q) =>
      q.eq("targetKey", targetKey(event)).eq("status", "applied").gt("slot", event.slot),
    )
    .order("desc")
    .first();
  if (newer) {
    return {
      kind: "quarantine",
      reason: `stale slot ${event.slot}; newer slot ${newer.slot} already applied`,
    };
  }
  return { kind: "apply" };
}

// The idempotent apply CORE, as a plain async fn on MutationCtx. Both the Helius httpAction (via the
// `applyChainEvent` internalMutation) and the 3-3 demo `confirmMintStub` (a public mutation, which
// cannot ctx.runMutation) call THIS — so the demo confirm exercises the exact same chain-wins code the
// real webhook does, never a parallel flip. Idempotency-by-signature lives here so every caller gets it.
export async function applyChainEventInner(ctx: MutationCtx, event: ChainEvent) {
  // Idempotency is event-level: one transaction may carry multiple independent transfers.
  const priorRows = await ctx.db
    .query("reconciliations")
    .withIndex("by_event_key", (q) => q.eq("eventKey", eventKey(event)))
    .collect();
  if (priorRows.some((row) => row.status === "applied")) {
    return { status: "duplicate" as const };
  }
  if (priorRows.some((row) => row.status === "quarantined") && event.evidenceSource !== "rpc") {
    return { status: "quarantined" as const };
  }
  for (const prior of priorRows) {
    if (prior.status === "unresolved") await ctx.db.delete(prior._id);
  }

  if (event.quarantineReason) {
    return await recordReconciliation(ctx, event, "quarantined", {
      reason: event.quarantineReason,
    });
  }
  const ordering = await orderingState(ctx, event);
  if (ordering?.kind === "quarantine") {
    return await recordReconciliation(ctx, event, "quarantined", { reason: ordering.reason });
  }
  if (ordering?.kind === "equivalent") {
    await recordReconciliation(ctx, event, "applied");
    return { status: "duplicate" as const };
  }

  if (event.type === "distribution") {
    return await applyDistribution(ctx, event);
  }
  if (event.type === "mint_confirmed") {
    return await applyMintConfirmation(ctx, event);
  }
  return await applyOwnership(ctx, event);
}

// Idempotent apply of a single chain event to the Convex mirror. Called from the Helius httpAction.
export const applyChainEvent = internalMutation({
  args: eventArgs,
  handler: async (ctx, event) => applyChainEventInner(ctx, event),
});

// mint_confirmed → confirm a PROPERTY's mint (no user holding). Chain reports the mint is on-chain-
// confirmed; Convex's `mintStatus` is flipped to "confirmed" (which unblocks 3-2's listOffering).
// CHAIN WINS: if Convex diverged from the chain-reported state — its prior `mintStatus` was neither the
// expected "minting" nor already "confirmed" (e.g. still "none" because Convex never saw the mint, or it
// was rolled back) — the value is overwritten and the drift stamped on the reconciliations row + logged
// as `chain.discrepancy`. Always audits `mint.confirmed` naming the on-chain signature. Idempotency is
// by signature (in applyChainEventInner) — a duplicate confirmation signature never re-applies.
async function applyMintConfirmation(ctx: MutationCtx, event: ChainEvent) {
  const property = event.mint
    ? await ctx.db.query("properties").withIndex("by_mint", (q) => q.eq("mint", event.mint)).first()
    : null;

  // A confirmation whose mint names no known property can't resolve — unresolved (redrivable if the
  // property appears later), never a bogus "applied".
  if (!property) {
    return await recordReconciliation(ctx, event, "unresolved", { reason: "unknown property mint" });
  }

  const isStub =
    process.env.NODE_ENV === "test" &&
    event.signature.startsWith("STUB-CONFIRM-");
  const operation = await ctx.db
    .query("externalOperations")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", `mint:${property._id}`))
    .unique();
  const operationMatches =
    operation?.kind === "mint" &&
    (operation.status === "submitted" || operation.status === "unknown") &&
    operation.providerReference === event.mint &&
    operation.submittedSignature === event.signature;
  if (!isStub && !operationMatches) {
    return await recordReconciliation(ctx, event, "quarantined", {
      reason: "mint evidence does not match the reserved submitted operation",
    });
  }

  const before = property.mintStatus ?? "none";
  const after = "confirmed" as const;
  const diverged = before !== "minting" && before !== "confirmed";
  const discrepancy = diverged ? { before, after } : undefined;

  await ctx.db.patch(property._id, { mintStatus: after, mintSlot: event.slot });
  if (operationMatches && operation) {
    await ctx.db.patch(operation._id, {
      status: "reconciled",
      reconciledAt: Date.now(),
      lastCheckpoint: "verified_chain_event_reconciled",
      retrySafe: false,
      updatedAt: Date.now(),
    });
  }

  // Always audit the confirmation, naming the on-chain signature. On drift, additionally log the
  // discrepancy (chain overwrote a divergent Convex value) — mirroring applyOwnership's chain.discrepancy.
  await writeAudit(ctx, {
    actor: "helius",
    action: "mint.confirmed",
    target: property._id,
    onchainRef: event.signature,
    meta: { mint: event.mint, before, after },
  });
  if (diverged) {
    await writeAudit(ctx, {
      actor: "helius",
      action: "chain.discrepancy",
      target: property._id,
      onchainRef: event.signature,
      meta: { mint: event.mint, discrepancy },
    });
  }

  await recordReconciliation(ctx, event, "applied", { discrepancy });
  return { status: "applied" as const, discrepancy };
}

// mint / transfer → reconcile a user's holding to the chain-authoritative token balance.
async function applyOwnership(ctx: MutationCtx, event: ChainEvent) {
  // A mint/transfer can't reconcile a balance without a valid, non-negative chain amount. Missing or
  // malformed → unresolved (don't write a bogus 0/negative holding and mark it "applied").
  if (event.tokenAmount === undefined || !Number.isFinite(event.tokenAmount) || event.tokenAmount < 0) {
    return await recordReconciliation(ctx, event, "unresolved", { reason: "missing or invalid token amount" });
  }

  // Resolve routing via indexes: mint → property, owner wallet → user. Unknown refs are logged, never thrown.
  const property = event.mint
    ? await ctx.db.query("properties").withIndex("by_mint", (q) => q.eq("mint", event.mint)).first()
    : null;
  const user = event.owner
    ? await ctx.db.query("users").withIndex("by_wallet", (q) => q.eq("walletAddress", event.owner)).first()
    : null;

  if (!property || !user) {
    return await recordReconciliation(ctx, event, "unresolved", { reason: "unknown property or owner" });
  }

  const holding = await ctx.db
    .query("holdings")
    .withIndex("by_user_property", (q) =>
      q.eq("userId", user._id).eq("propertyId", property._id),
    )
    .unique();

  // Chain wins: the event's token balance overwrites Convex. costBasis stays Convex intent (order
  // side, never chain-authoritative). ownershipPct is NOT ratio-scaled from tokenAmount — that mixed
  // units (USD-seeded vs chain-count) and corrupted the fraction. Instead: use the chain-authoritative
  // fraction (balance / mint supply) when the event carries one; otherwise preserve the existing
  // intent (or 0 for a brand-new holding with no basis yet).
  const before = holding?.tokenAmount;
  const after = event.tokenAmount; // validated finite & non-negative above
  const providedPct =
    typeof event.ownershipPct === "number" &&
    Number.isFinite(event.ownershipPct) &&
    event.ownershipPct >= 0
      ? Math.min(1, event.ownershipPct)
      : undefined;
  const ownershipPct = providedPct ?? holding?.ownershipPct ?? 0;

  if (holding) {
    await ctx.db.patch(holding._id, {
      tokenAmount: after,
      tokenAmountRaw: event.tokenAmountRaw,
      tokenDecimals: event.tokenDecimals,
      chainSlot: event.slot,
      ownershipPct,
    });
  } else {
    await ctx.db.insert("holdings", {
      userId: user._id,
      propertyId: property._id,
      tokenAmount: after,
      tokenAmountRaw: event.tokenAmountRaw,
      tokenDecimals: event.tokenDecimals,
      chainSlot: event.slot,
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

  await recordReconciliation(ctx, event, "applied", { discrepancy });
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
    return await recordReconciliation(ctx, event, "unresolved", { reason: "unknown distribution period" });
  }

  // Unsafe demo confirmations predate recipient-level evidence. Keep that explicit test-only seam while
  // requiring every real webhook payout to identify and exactly match one recipient row.
  const isStub =
    event.signature.startsWith("STUB-DIST-CONFIRM-") &&
    process.env.NODE_ENV === "test";
  let matched = rows.filter((row) => row.status !== "paid");
  if (!isStub) {
    if (!event.owner || (event.tokenAmountRaw === undefined && event.tokenAmount === undefined)) {
      return await recordReconciliation(ctx, event, "quarantined", {
        reason: "distribution evidence is missing recipient or amount",
      });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", event.owner!))
      .first();
    if (!user) return await recordReconciliation(ctx, event, "unresolved", { reason: "unknown payout recipient" });
    matched = rows.filter((row) => row.userId === user._id);
    if (matched.length !== 1) {
      return await recordReconciliation(ctx, event, "quarantined", {
        reason: `ambiguous payout recipient matched ${matched.length} ledger rows`,
      });
    }
    if (matched[0].status === "paid") {
      return await recordReconciliation(ctx, event, "quarantined", {
        reason: "recipient ledger row is already paid by another event",
      });
    }
    if (!distributionAmountMatches(matched[0].netPaid, event)) {
      return await recordReconciliation(ctx, event, "quarantined", {
        reason: "on-chain payout amount does not exactly match the recipient ledger",
      });
    }
    const operation = await ctx.db
      .query("externalOperations")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", `distribution:${property._id}:${event.period}:${matched[0].userId}`),
      )
      .unique();
    const submittedSignature = event.txSig ?? event.signature;
    const expectedBaseUnits = decimalToBaseUnits(String(matched[0].netPaid), 6)?.toString();
    const operationMatches =
      operation?.kind === "distribution_payout" &&
      (operation.status === "submitted" || operation.status === "unknown") &&
      operation.propertyId === property._id &&
      operation.period === event.period &&
      operation.recipientUserId === matched[0].userId &&
      operation.recipientAddress === event.owner &&
      operation.amountBaseUnits === expectedBaseUnits &&
      operation.submittedSignature === submittedSignature;
    if (!operationMatches) {
      return await recordReconciliation(ctx, event, "quarantined", {
        reason: "distribution evidence does not match the reserved submitted payout operation",
      });
    }
  }

  for (const row of matched) {
    await ctx.db.patch(row._id, {
      status: "paid",
      txSig: event.txSig ?? event.signature,
      paidAt: Date.now(),
      paidSlot: event.slot,
    });
    const operation = await ctx.db
      .query("externalOperations")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", `distribution:${property._id}:${event.period}:${row.userId}`),
      )
      .unique();
    if (operation) {
      const eventMatchesSubmission =
        isStub || operation.submittedSignature === (event.txSig ?? event.signature);
      const expectedBaseUnits = decimalToBaseUnits(String(row.netPaid), 6)?.toString();
      if (eventMatchesSubmission && expectedBaseUnits === operation.amountBaseUnits) {
        await ctx.db.patch(operation._id, {
          status: "reconciled",
          reconciledAt: Date.now(),
          lastCheckpoint: "verified_chain_event_reconciled",
          retrySafe: false,
          updatedAt: Date.now(),
        });
      }
    }
  }

  await writeAudit(ctx, {
    actor: "helius",
    action: "income.reconciled",
    target: property._id,
    meta: { signature: event.signature, period: event.period, txSig: event.txSig, rows: matched.length },
  });

  await recordReconciliation(ctx, event, "applied");
  return { status: "applied" as const, rows: matched.length };
}

function distributionAmountMatches(expectedUi: number, event: ChainEvent): boolean {
  if (!Number.isFinite(expectedUi) || expectedUi < 0) return false;
  if (event.tokenAmountRaw !== undefined && event.tokenDecimals !== undefined) {
    if (!/^\d+$/.test(event.tokenAmountRaw) || !Number.isSafeInteger(event.tokenDecimals)) return false;
    const expectedRaw = decimalToBaseUnits(String(expectedUi), event.tokenDecimals);
    return expectedRaw !== undefined && expectedRaw.toString() === event.tokenAmountRaw;
  }
  return event.tokenAmount !== undefined && String(event.tokenAmount) === String(expectedUi);
}

function decimalToBaseUnits(value: string, decimals: number): bigint | undefined {
  if (decimals < 0 || decimals > 18 || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return undefined;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
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

    const baseType = normalizeType(raw.type ?? raw.eventType);
    const signature = firstString(raw.signature, raw.txSignature, raw.txSig, raw.sig);
    if (!baseType || !signature) continue;

    const transfers = Array.isArray(raw.tokenTransfers)
      ? raw.tokenTransfers.filter(
          (value): value is Record<string, unknown> => !!value && typeof value === "object",
        )
      : [];
    const sources = transfers.length > 0 ? transfers : [undefined];

    sources.forEach((transfer, eventIndex) => {
      const postBalance = normalizedPostBalance(raw, transfer);
      const transferAmount = normalizedTransferAmount(raw, transfer);
      const amount = baseType === "distribution" ? transferAmount : postBalance;
      const mint = firstString(raw.mint, postBalance.mint, transfer?.mint);
      const owner =
        baseType === "distribution"
          ? firstString(raw.owner, raw.ownerAddress, transfer?.toUserAccount, transfer?.owner)
          : firstString(postBalance.owner, raw.owner, raw.ownerAddress);
      const type: ChainEventType =
        baseType === "mint" && mint !== undefined && owner === undefined && amount.ui === undefined
          ? "mint_confirmed"
          : baseType;
      const ownershipWebhook = type === "mint" || type === "transfer";
      let quarantineReason: string | undefined;
      if (transactionFailed(raw)) {
        quarantineReason = "webhook describes a failed transaction";
      } else if (ownershipWebhook && !postBalance.complete) {
        quarantineReason = "ownership transfer lacks explicit raw post-balance evidence";
      } else if (ownershipWebhook) {
        quarantineReason =
          "webhook ownership event requires transaction refetch and exact settlePurchase validation";
      }

      events.push({
        type,
        signature,
        eventIndex,
        mint,
        owner,
        tokenAmount: amount.ui,
        tokenAmountRaw: amount.raw,
        tokenDecimals: amount.decimals,
        period: firstString(raw.period),
        txSig: firstString(raw.txSig, raw.signature, raw.txSignature),
        slot: firstNumber(raw.slot),
        evidenceSource: "webhook",
        quarantineReason,
        raw: transfer ? { transaction: item, transfer } : item,
      });
    });
  }
  return events;
}

function transactionFailed(raw: Record<string, unknown>): boolean {
  if (raw.transactionError != null) return true;
  const meta = raw.meta;
  return !!meta && typeof meta === "object" && (meta as Record<string, unknown>).err != null;
}

interface NormalizedAmount {
  ui?: number;
  raw?: string;
  decimals?: number;
  owner?: string;
  mint?: string;
  complete?: boolean;
}

function normalizedPostBalance(
  raw: Record<string, unknown>,
  transfer: Record<string, unknown> | undefined,
): NormalizedAmount {
  const value = transfer?.postTokenBalance ?? transfer?.postBalance ?? raw.postTokenBalance;
  if (!value || typeof value !== "object") return { complete: false };
  const record = value as Record<string, unknown>;
  const amount = firstString(record.amount, record.tokenAmount);
  const decimals = firstNumber(record.decimals);
  const owner = firstString(record.owner, record.ownerAddress);
  const mint = firstString(record.mint);
  if (
    !amount ||
    !/^\d+$/.test(amount) ||
    decimals === undefined ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    !owner
  ) {
    return { complete: false };
  }
  return {
    raw: amount,
    decimals,
    ui: Number(amount) / 10 ** decimals,
    owner,
    mint,
    complete: true,
  };
}

function normalizedTransferAmount(
  raw: Record<string, unknown>,
  transfer: Record<string, unknown> | undefined,
): NormalizedAmount {
  const rawToken = transfer?.rawTokenAmount;
  if (rawToken && typeof rawToken === "object") {
    const record = rawToken as Record<string, unknown>;
    const amount = firstString(record.tokenAmount, record.amount);
    const decimals = firstNumber(record.decimals);
    if (amount && /^\d+$/.test(amount) && decimals !== undefined && Number.isSafeInteger(decimals)) {
      return { raw: amount, decimals, ui: Number(amount) / 10 ** decimals };
    }
  }
  return { ui: firstNumber(transfer?.tokenAmount, transfer?.amount, raw.tokenAmount) };
}

// normalizeType maps a Helius `type`/`eventType` string to the coarse internal family (`mint` /
// `distribution` / `transfer`). The `mint` vs `mint_confirmed` DISTINCTION is NOT made here — it depends
// on the event's SHAPE (does it carry a holder?), not just its type string — so it is decided in
// normalizeHeliusEvent above: a mint-ish event with a property `mint` but no `owner`/`tokenAmount` is a
// property-mint confirmation (`mint_confirmed`, → applyMintConfirmation), while one carrying a holder is
// a user-holding reconcile (`mint`, → applyOwnership). Keeping this function shape-agnostic means both
// the `s.includes("mint")` catch-all and the ownerless-mint promotion stay in exactly one place each.
function normalizeType(t: unknown): ChainEventType | undefined {
  if (typeof t !== "string") return undefined;
  const s = t.toLowerCase();
  if (s.includes("mint")) return "mint";
  if (s.includes("distribut")) return "distribution";
  if (s.includes("transfer")) return "transfer";
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
