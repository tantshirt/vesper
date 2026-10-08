import {
  action,
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { writeAudit } from "./audit";
import { requirePermission, requireStaff, effectivePermissions, logOperationalDenial } from "./rbac";
import { requireStepUp } from "./security";
import { allGatesSigned } from "./gates";
import { applyChainEventInner } from "./reconcile";

const MINT_LEASE_MS = 60_000;
type OperationStatus = "reserved" | "leased" | "submitted" | "failed" | "unknown" | "reconciled";
type MintReservation =
  | {
      execute: true;
      operationId: Id<"externalOperations">;
      leaseToken: string;
      idempotencyKey: string;
      supply: number;
    }
  | {
      execute: false;
      operationId: Id<"externalOperations">;
      status: OperationStatus;
      mint: string | null;
      signature: string | null;
    };
type MintOfferingResult = {
  minted: boolean;
  mint: string | null;
  signature: string | null;
  mintStatus?: "minting";
  alreadyReserved?: true;
  status?: OperationStatus;
};

function mintProviderEnabled(): boolean {
  return process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" && process.env.VESPER_ENABLE_MINT_STUB === "true");
}

function mintConfirmationStubEnabled(): boolean {
  return process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" && process.env.VESPER_ENABLE_MINT_CONFIRM_STUB === "true");
}

function requireMintProvider(): void {
  if (!mintProviderEnabled()) {
    throw new Error("Property-token mint is disabled until a server-attested provider is configured");
  }
}

// Admin Story 3.2 — the MINT & LISTING console. The irreversible on-chain act that turns a fully-gated
// (3-1) property into an investable offering. THREE walls make it impossible to fat-finger:
//   1. GATE WALL (3-1). mintOffering calls `allGatesSigned` and refuses if ANY gate is unsigned — a
//      property can NEVER be minted with an unsigned gate. This module REUSES that helper; it never
//      reimplements or weakens 3-1.
//   2. STEP-UP (B2 placeholder). The mint requires a step-up re-auth (`requireStepUp`, security.ts) — a
//      documented stub for the real WebAuthn hardware-key challenge (blocker B2).
//   3. LIST-ONLY-AFTER-CONFIRM (3-3). Listing (status gating→open) is gated on `mintStatus:"confirmed"`,
//      which the mint call NEVER sets in the same breath — a distinct confirm step (real Helius reconcile
//      is 3-3; `confirmMintStub` stands in for the demo/tests) owns it, so nothing is listed on an
//      on-chain-unconfirmed mint.
//
// The Token-2022 frozen-by-default mint + `initialize_offering` sign through the `STUB-MINT-` server-
// wallet seam (`mintServerSeam`), mirroring settlement `STUB-DVP-` / eligibilityAttest `STUB-ELIG-` /
// distributionPush `STUB-DIST-`. No live server wallet / real keys exist here; the real Privy-signed
// devnet-acl recipe drops in behind the seam. `mint.execute`-gated throughout (ops_diligence holds it;
// platform_admin deliberately does NOT — denied at 1-1's wall). Every act audits the NAMED human.

// ── mintServerSeam — the STUB-MINT server-wallet signing seam (deferred real on-chain path) ──────────
// In the stub it "signs" synchronously and returns a clearly-marked stub mint address + signature; the
// `requireUnsafeStubs` guard keeps it disabled until a server-attested wallet provider is configured
// (mirrors settlement `dvpSettle`). The REAL path (see app/scripts/devnet-acl.ts for the working
// recipe), signed by the Privy SERVER wallet, is:
//
//   // frozen-by-default Token-2022 property mint (freeze authority = offering PDA):
//   SystemProgram.createAccount({ ...propertyMint, space: getMintLen([ExtensionType.DefaultAccountState]),
//                                 programId: TOKEN_2022_PROGRAM_ID }),
//   createInitializeDefaultAccountStateInstruction(propertyMint, AccountState.Frozen, TOKEN_2022_PROGRAM_ID),
//   createInitializeMint2Instruction(propertyMint, 0 /* decimals */, mintAuthority, offeringPda, TOKEN_2022_PROGRAM_ID),
//   // then register the offering on the Quasar program (app/lib/solana/dvp.ts):
//   buildInitializeOfferingInstruction({ authority, propertyMint, usdcMint, offering, vault, treasury,
//                                        pricePerToken, totalOffering: supply }),
//   // ...all signed + submitted via privy.walletApi.solana.signAndSendTransaction({ walletId: SERVER_WALLET_ID, transaction })
//   // returning the REAL mint pubkey + tx signature (which the 3-3 Helius reconcile then confirms).
export const mintServerSeam = internalAction({
  args: { propertyId: v.id("properties"), supply: v.number(), idempotencyKey: v.string() },
  handler: async (
    _ctx,
    { propertyId, supply, idempotencyKey },
  ): Promise<{ mint: string; signature: string }> => {
    requireMintProvider();
    if (process.env.VESPER_STUB_MINT_PROVIDER_THROW === "true") {
      throw new Error("Mint provider call failed after dispatch");
    }
    return {
      mint: `STUB-MINT-${propertyId}`,
      signature: `STUB-MINTSIG-${idempotencyKey}-${supply}`,
    };
  },
});

// resolveMinter — the permission gate for the ACTION half (mintOffering has no db of its own). Reuses
// 1-1's `requirePermission` on a QueryCtx: platform_admin (no mint.execute) is denied HERE, before any
// gate/step-up/seam work — proving the 1-1 wall. Returns the caller's staff doc so the action can name
// the human. Internal-only.
export const resolveMinter = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"staff">> => {
    return await requirePermission(ctx, "mint.execute");
  },
});

// loadMintTarget — the action's read half: the property's mint state + the SINGLE `allGatesSigned`
// advancement boolean (the gate wall the action gates on). Returns null when the property is missing.
export const loadMintTarget = internalQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    const property = await ctx.db.get(propertyId);
    if (!property) return null;
    return {
      name: property.name,
      status: property.status,
      mint: property.mint ?? null,
      mintStatus: property.mintStatus ?? "none",
      supply: property.offeringSize, // 1:1 token-supply basis (documented stub, mirrors settlement)
      allSigned: await allGatesSigned(ctx, propertyId),
    };
  },
});

export const reserveMintOperation = internalMutation({
  args: { propertyId: v.id("properties"), actor: v.string() },
  handler: async (ctx, { propertyId, actor }) => {
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");
    if (!await allGatesSigned(ctx, propertyId)) {
      throw new Error("Cannot mint: every diligence gate must be signed first");
    }
    const supply = property.offeringSize;
    if (!Number.isSafeInteger(supply) || supply <= 0) {
      throw new Error("Mint supply must be a positive safe integer");
    }
    const idempotencyKey = `mint:${propertyId}`;
    const existing = await ctx.db
      .query("externalOperations")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      if (existing.amountBaseUnits !== String(supply)) {
        await ctx.db.patch(existing._id, {
          status: "unknown",
          retrySafe: false,
          lastCheckpoint: "mint_supply_mismatch_requires_reconciliation",
          lastError: "Offering supply changed after mint reservation",
          updatedAt: Date.now(),
        });
        return {
          execute: false as const,
          operationId: existing._id,
          status: "unknown" as const,
          mint: existing.providerReference ?? null,
          signature: existing.submittedSignature ?? null,
        };
      }
      if (existing.status === "leased" && (existing.leaseExpiresAt ?? 0) <= Date.now()) {
        await ctx.db.patch(existing._id, {
          status: "unknown",
          retrySafe: false,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          lastCheckpoint: "mint_lease_expired_after_possible_provider_effect",
          lastError: "Mint worker lease expired; provider outcome requires reconciliation",
          updatedAt: Date.now(),
        });
        return {
          execute: false as const,
          operationId: existing._id,
          status: "unknown" as const,
          mint: existing.providerReference ?? null,
          signature: existing.submittedSignature ?? null,
        };
      }
      return {
        execute: false as const,
        operationId: existing._id,
        status: existing.status,
        mint: existing.providerReference ?? null,
        signature: existing.submittedSignature ?? null,
      };
    }
    if (property.mint) throw new Error("Property already minted");

    const now = Date.now();
    const leaseToken = `${idempotencyKey}:1:${now}`;
    const operationId = await ctx.db.insert("externalOperations", {
      kind: "mint",
      idempotencyKey,
      status: "leased",
      actor,
      subject: String(propertyId),
      propertyId,
      amountBaseUnits: String(supply),
      desiredConsequence: "create_property_mint_and_initialize_offering",
      attemptCount: 1,
      leaseToken,
      leaseExpiresAt: now + MINT_LEASE_MS,
      lastCheckpoint: "reserved_before_mint_provider_effect",
      retrySafe: false,
      createdAt: now,
      updatedAt: now,
    });
    return { execute: true as const, operationId, leaseToken, idempotencyKey, supply };
  },
});

export const recordMintSubmitted = internalMutation({
  args: {
    operationId: v.id("externalOperations"),
    leaseToken: v.string(),
    mint: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { operationId, leaseToken, mint, signature }) => {
    const operation = await ctx.db.get(operationId);
    if (!operation || operation.kind !== "mint") throw new Error("Mint operation not found");
    if (operation.status !== "leased" || operation.leaseToken !== leaseToken) {
      throw new Error("Mint lease is no longer current");
    }
    const property = await ctx.db.get(operation.propertyId);
    if (!property) throw new Error("Property not found");
    if (property.mint && property.mint !== mint) {
      throw new Error("Property has a different mint; reconciliation required");
    }
    const now = Date.now();
    await ctx.db.patch(operationId, {
      status: "submitted",
      providerReference: mint,
      submittedSignature: signature,
      submittedAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastCheckpoint: "mint_provider_accepted_awaiting_chain_confirmation",
      retrySafe: false,
      updatedAt: now,
    });
    await ctx.db.patch(operation.propertyId, { mint, mintStatus: "minting" });
    await writeAudit(ctx, {
      actor: operation.actor,
      action: "mint.executed",
      target: operation.propertyId,
      onchainRef: signature,
      meta: { mint, supply: Number(operation.amountBaseUnits), mintStatus: "minting", operationId },
    });
    return { minted: true as const, mint, mintStatus: "minting" as const, signature };
  },
});

export const markMintUnknown = internalMutation({
  args: { operationId: v.id("externalOperations"), leaseToken: v.string(), message: v.string() },
  handler: async (ctx, { operationId, leaseToken, message }) => {
    const operation = await ctx.db.get(operationId);
    if (!operation || operation.status !== "leased" || operation.leaseToken !== leaseToken) return;
    await ctx.db.patch(operationId, {
      status: "unknown",
      retrySafe: false,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastCheckpoint: "mint_provider_outcome_unknown_requires_reconciliation",
      lastError: message,
      updatedAt: Date.now(),
    });
  },
});

// Called only by a trusted provider-reconciliation worker after looking up the stable idempotency key.
// It repairs the crash window between provider acceptance and Convex recording; chain confirmation is
// still required before the operation becomes reconciled or the offering can be listed.
export const applyVerifiedMintProviderLookup = internalMutation({
  args: {
    propertyId: v.id("properties"),
    mint: v.string(),
    signature: v.string(),
    amountBaseUnits: v.string(),
  },
  handler: async (ctx, { propertyId, mint, signature, amountBaseUnits }) => {
    const operation = await ctx.db
      .query("externalOperations")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", `mint:${propertyId}`))
      .unique();
    if (!operation || operation.kind !== "mint") throw new Error("Mint operation not found");
    if (operation.amountBaseUnits !== amountBaseUnits) throw new Error("Verified mint lookup amount mismatch");
    if (operation.status === "reconciled") return { status: "reconciled" as const };
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");
    if (property.mint && property.mint !== mint) throw new Error("Verified mint lookup conflicts with property mint");
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "submitted",
      providerReference: mint,
      submittedSignature: signature,
      submittedAt: operation.submittedAt ?? now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastCheckpoint: "verified_provider_lookup_restored_submission",
      lastError: undefined,
      retrySafe: false,
      updatedAt: now,
    });
    await ctx.db.patch(propertyId, { mint, mintStatus: "minting" });
    return { status: "submitted" as const, mint, signature };
  },
});

// ── mintOffering — the irreversible mint (ACTION, mint.execute-gated) ─────────────────────────────────
// An ACTION because it drives the server-wallet signing seam (mintServerSeam). Flow, first-failing-wall
// wins:
//   1. resolveMinter — mint.execute (platform_admin denied here, before anything else).
//   2. load the target; refuse if missing OR already minted (IDEMPOTENT — no double server-wallet mint).
//   3. GATE WALL (3-1): refuse unless every gate is signed (allGatesSigned). Never weakened here.
//   4. requireStepUp — the B2 step-up placeholder for this irreversible act.
//   5. mintServerSeam — the STUB-MINT sign.
//   6. recordMint — persist properties.mint + mintStatus:"minting" and audit mint.executed (named human).
export const mintOffering = action({
  args: { propertyId: v.id("properties") },
  handler: async (
    ctx,
    { propertyId },
  ): Promise<MintOfferingResult> => {
    // INV2: a mint.execute denial on this ACTION is durably logged (survives the re-throw) — see
    // logOperationalDenial. A denied caller (e.g. platform_admin) leaves an `rbac.denied.durable` trace.
    let staff: Doc<"staff">;
    try {
      staff = await ctx.runQuery(internal.mint.resolveMinter, {});
    } catch (err) {
      await logOperationalDenial(ctx, err, "mint.execute", propertyId);
      throw err;
    }
    const actor = staff.email || staff.name || staff.workosId;

    // STEP-UP (B2 placeholder) — the irreversible act requires a step-up re-auth. Stub seam.
    requireStepUp(ctx, "mint.execute");
    // Definite configuration refusal is checked before reserving an operation. After reservation, any
    // provider exception is conservatively unknown because dispatch may have occurred.
    requireMintProvider();
    const reservation: MintReservation = await ctx.runMutation(internal.mint.reserveMintOperation, {
      propertyId,
      actor,
    });
    if (!reservation.execute) {
      return {
        minted: reservation.status === "submitted" || reservation.status === "reconciled",
        alreadyReserved: true as const,
        status: reservation.status,
        mint: reservation.mint ?? null,
        signature: reservation.signature ?? null,
      };
    }
    try {
      const result: { mint: string; signature: string } = await ctx.runAction(internal.mint.mintServerSeam, {
        propertyId,
        supply: reservation.supply,
        idempotencyKey: reservation.idempotencyKey,
      });
      return await ctx.runMutation(internal.mint.recordMintSubmitted, {
        operationId: reservation.operationId,
        leaseToken: reservation.leaseToken,
        ...result,
      });
    } catch (error) {
      await ctx.runMutation(internal.mint.markMintUnknown, {
        operationId: reservation.operationId,
        leaseToken: reservation.leaseToken,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

// recordMint — the WRITE half (internalMutation). Sets properties.mint + mintStatus:"minting" (intent,
// on-chain-unconfirmed) and audits `mint.executed` to the NAMED human, threading the on-chain signature
// through `onchainRef`. Idempotent backstop: a property already minted refuses (guards a concurrent race
// the action's pre-check could miss). Called ONLY from mintOffering after every wall cleared.
export const recordMint = internalMutation({
  args: {
    propertyId: v.id("properties"),
    actor: v.string(),
    mint: v.string(),
    signature: v.string(),
    supply: v.number(),
  },
  handler: async (ctx, { propertyId, actor, mint, signature, supply }) => {
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");
    if (property.mint) throw new Error("Property already minted"); // idempotent — never double-mint

    await ctx.db.patch(propertyId, { mint, mintStatus: "minting" });
    await writeAudit(ctx, {
      actor, // the named human who executed the mint — never a system
      action: "mint.executed",
      target: propertyId,
      onchainRef: signature,
      meta: { mint, supply, mintStatus: "minting" },
    });
    return { minted: true as const, mint, mintStatus: "minting" as const, signature };
  },
});

// confirmMintStub — the 3-3 demo confirm that flips mintStatus "minting" → "confirmed". The REAL confirm
// is the Helius webhook → reconcile path (http.ts → applyChainEvent) applying chain truth; this stub is
// exposed (mint.execute-gated, `requireUnsafeStubs`) so the demo/tests can reach the LIST step. It does
// NOT flip the status itself — it SYNTHESIZES the Helius mint-confirmation event and drives it through
// the SAME chain-wins apply path (reconcile.applyChainEventInner), so the demo exercises the real
// reconcile code (idempotency-by-signature, discrepancy stamping, the mint.confirmed audit) rather than
// a parallel flip. Deliberately DISTINCT from the mint call — a mint is never confirmed in the same
// breath it is executed. Idempotent: a property already confirmed is a no-op.
export const confirmMintStub = mutation({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    await requirePermission(ctx, "mint.execute");
    if (!mintConfirmationStubEnabled()) throw new Error("Mint confirmation stub is disabled");
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");
    if (property.mintStatus === "confirmed") {
      return { mintStatus: "confirmed" as const, alreadyConfirmed: true }; // idempotent
    }
    if (!property.mint || property.mintStatus !== "minting") {
      throw new Error("Cannot confirm a mint that has not been executed");
    }
    // Synthesize the on-chain mint-confirmation and route it through the reconcile apply path. The
    // signature is deterministic per property so a re-run is an idempotent no-op at the reconcile layer
    // too (belt-and-braces with the `confirmed` early-return above). The apply audits `mint.confirmed`
    // (actor "helius") naming this signature — the chain event, not the operator, owns the confirmation.
    await applyChainEventInner(ctx, {
      type: "mint_confirmed",
      signature: `STUB-CONFIRM-${propertyId}`,
      mint: property.mint,
    });
    const operation = await ctx.db
      .query("externalOperations")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", `mint:${propertyId}`))
      .unique();
    if (operation && operation.providerReference === property.mint) {
      await ctx.db.patch(operation._id, {
        status: "reconciled",
        reconciledAt: Date.now(),
        lastCheckpoint: "verified_chain_event_reconciled",
        retrySafe: false,
        updatedAt: Date.now(),
      });
    }
    return { mintStatus: "confirmed" as const, alreadyConfirmed: false };
  },
});

// reconciliationStatus — the console's reconciliation monitor read. Gated on mint.execute OR
// compliance.review (ops watches the mint spine; compliance oversees chain drift). Returns the most
// recent reconciliations plus rollup flags so the console banner can surface any unresolved event or
// chain↔Convex discrepancy at a glance. Read-only — never mutates the mirror.
export const reconciliationStatus = query({
  args: {},
  handler: async (ctx) => {
    const staff = await requireStaff(ctx);
    const perms = await effectivePermissions(ctx, staff);
    if (!perms.includes("mint.execute") && !perms.includes("compliance.review")) {
      throw new Error("Not permitted: mint.execute or compliance.review");
    }

    const recent = await ctx.db.query("reconciliations").order("desc").take(50);
    const rows = recent.map((r) => ({
      id: r._id,
      signature: r.signature,
      eventType: r.eventType,
      mint: r.mint ?? null,
      status: r.status as "applied" | "unresolved",
      discrepancy: r.discrepancy ?? null,
      processedAt: r.processedAt,
    }));
    const unresolved = rows.filter((r) => r.status === "unresolved");
    const discrepancies = rows.filter((r) => r.discrepancy != null);
    return {
      recent: rows,
      unresolvedCount: unresolved.length,
      discrepancyCount: discrepancies.length,
      hasUnresolved: unresolved.length > 0,
      hasDiscrepancy: discrepancies.length > 0,
    };
  },
});

// ── listOffering — flip gating→open, ONLY after the mint is confirmed (mutation, mint.execute) ────────
// The listing act. Refuses unless mintStatus is "confirmed" (list-only-after-on-chain-confirm) — a
// minted-but-unconfirmed property cannot be listed. On success flips status gating→open (now investor-
// browsable; listOpen filters status:"open") and audits `offering.listed`. Idempotent: an already-open
// property is a no-op (never re-audited).
export const listOffering = mutation({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    const staff = await requirePermission(ctx, "mint.execute");
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");

    if (property.mintStatus !== "confirmed") {
      throw new Error("Cannot list: the mint must be confirmed on-chain first");
    }
    if (property.status === "open") {
      return { status: "open" as const, alreadyListed: true }; // idempotent
    }
    if (property.status !== "gating") {
      throw new Error(`Cannot list a ${property.status} property`);
    }

    await ctx.db.patch(propertyId, { status: "open" });
    await writeAudit(ctx, {
      actor: staff.email || staff.name || staff.workosId,
      action: "offering.listed",
      target: propertyId,
      onchainRef: property.mint ?? undefined,
      meta: { mint: property.mint },
    });
    return { status: "open" as const, alreadyListed: false };
  },
});

// mintConsole — the console read (query, mint.execute-gated): every property with its gate-signature
// state, mint state, and supply, so the operator sees at a glance which are ready to mint (allGatesSigned
// + not yet minted), minting (awaiting confirm), or confirmed (ready to list).
export const mintConsole = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "mint.execute");
    const properties = await ctx.db.query("properties").take(200);
    const rows = [];
    for (const p of properties) {
      rows.push({
        id: p._id,
        name: p.name,
        location: p.location,
        status: p.status,
        mint: p.mint ?? null,
        mintStatus: (p.mintStatus ?? "none") as "none" | "minting" | "confirmed",
        supply: p.offeringSize,
        minInvestment: p.minInvestment,
        allGatesSigned: await allGatesSigned(ctx, p._id),
      });
    }
    return rows;
  },
});
