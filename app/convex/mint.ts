import {
  action,
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { writeAudit } from "./audit";
import { requirePermission } from "./rbac";
import { requireStepUp, requireUnsafeStubs } from "./security";
import { allGatesSigned } from "./gates";

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
  args: { propertyId: v.id("properties"), supply: v.number() },
  handler: async (
    _ctx,
    { propertyId, supply },
  ): Promise<{ mint: string; signature: string }> => {
    requireUnsafeStubs("Property-token mint");
    return {
      mint: `STUB-MINT-${propertyId}`,
      signature: `STUB-MINTSIG-${propertyId}-${supply}`,
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
  ): Promise<{ minted: true; mint: string; mintStatus: "minting"; signature: string }> => {
    const staff = await ctx.runQuery(internal.mint.resolveMinter, {});
    const actor = staff.email || staff.name || staff.workosId;

    const target = await ctx.runQuery(internal.mint.loadMintTarget, { propertyId });
    if (!target) throw new Error("Property not found");

    // Idempotent — a property already minted refuses re-mint. Caught BEFORE the seam so a second attempt
    // never fires a duplicate on-chain mint.
    if (target.mint) throw new Error("Property already minted");

    // GATE WALL (3-1) — the spine. A property cannot be minted with any unsigned gate. REUSES 3-1.
    if (!target.allSigned) {
      throw new Error("Cannot mint: every diligence gate must be signed first");
    }

    // STEP-UP (B2 placeholder) — the irreversible act requires a step-up re-auth. Stub seam.
    requireStepUp(ctx, "mint.execute");

    // STUB-MINT server-wallet seam — the deferred real frozen-by-default Token-2022 mint + init offering.
    const { mint, signature } = await ctx.runAction(internal.mint.mintServerSeam, {
      propertyId,
      supply: target.supply,
    });

    return await ctx.runMutation(internal.mint.recordMint, {
      propertyId,
      actor,
      mint,
      signature,
      supply: target.supply,
    });
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

// confirmMintStub — the 3-3 stand-in that flips mintStatus "minting" → "confirmed". The REAL confirm is
// the Helius reconcile path (Story 3-3) applying chain truth; this stub is exposed (mint.execute-gated)
// so the demo/tests can reach the LIST step. Deliberately DISTINCT from the mint call — a mint is never
// confirmed in the same breath it is executed. Idempotent: a property already confirmed is a no-op.
export const confirmMintStub = mutation({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, { propertyId }) => {
    const staff = await requirePermission(ctx, "mint.execute");
    const property = await ctx.db.get(propertyId);
    if (!property) throw new Error("Property not found");
    if (property.mintStatus === "confirmed") {
      return { mintStatus: "confirmed" as const }; // idempotent
    }
    if (!property.mint || property.mintStatus !== "minting") {
      throw new Error("Cannot confirm a mint that has not been executed");
    }
    await ctx.db.patch(propertyId, { mintStatus: "confirmed" });
    await writeAudit(ctx, {
      actor: staff.email || staff.name || staff.workosId,
      action: "mint.confirmed",
      target: propertyId,
      onchainRef: property.mint,
      meta: { mint: property.mint },
    });
    return { mintStatus: "confirmed" as const };
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
