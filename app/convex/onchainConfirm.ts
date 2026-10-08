import { action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { findUserByIdentity, isLikelySolanaSignature } from "./security";

// Slice 4 — the "confirm → mirror" bridge for the on-chain purchase flow.
//
// In production a Helius webhook (http.ts `/helius/webhook`) pushes the PurchaseSettled token transfer
// into reconcile.applyChainEvent automatically. That needs a live Helius account + a registered webhook
// per property mint. For the devnet prototype (no Helius account) this action is the pull-based stand-in:
// after the client signs + submits the on-chain `settlePurchase` and the transaction confirms, it calls
// this with the signature. We fetch the confirmed transaction straight from the RPC, read the
// CHAIN-AUTHORITATIVE post-balances, and hand each one to the SAME idempotent reconcile mutation the
// webhook uses. Chain stays the source of truth — the client only supplies a signature, never a balance.
//
// It is safe to call more than once: applyChainEvent dedupes by signature, and a mint that maps to no
// known property (e.g. the USDC leg) is dropped by reconcile as `unresolved`, never mis-applied.

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

// The deployed `vesper_dvp` program id (devnet). Source of truth is `lib/solana/dvp.ts` PROGRAM_ID;
// duplicated as a bare string here so the Convex bundle does not pull in @solana/web3.js + the IDL.
// confirmSettlement mirrors ownership ONLY from a transaction that actually invoked this program — a
// plain SPL transfer or an off-platform trade of the property mint must never be laundered into
// authoritative ownership (it would bypass the eligibility / Reg-A / consent gates the settle path enforces).
const VESPER_DVP_PROGRAM_ID = "CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2";

// The set of mints Convex mirrors as property ownership. Used to drop the USDC legs of a settle tx
// before reconcile, so we emit exactly the ownership event(s) that matter and never pollute the
// reconciliations table with unplaceable USDC balances.
export const knownPropertyMints = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const properties = await ctx.db.query("properties").collect();
    return properties
      .map((p) => p.mint)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
  },
});

// Resolve the calling wallet from the JWT-derived identity. confirmSettlement is an `action` (no
// ctx.db), so the user lookup is delegated here. Returns the caller's mirrored wallet address, which
// BINDS the supplied signature to the caller: only balances owned by this wallet are reconciled, so a
// caller can never drive a reconcile write against another user's holding using a foreign signature.
export const callerWalletAddress = internalQuery({
  args: { subject: v.string(), tokenIdentifier: v.optional(v.string()) },
  handler: async (ctx, { subject, tokenIdentifier }): Promise<string | null> => {
    const user = await findUserByIdentity(ctx, { subject, tokenIdentifier });
    return user?.walletAddress ?? null;
  },
});

// A single SPL/Token-2022 balance entry from the parsed transaction meta.
interface TokenBalance {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number; uiAmount?: number | null };
}

// Extract owner+mint+balance triples from `meta.postTokenBalances` (chain truth after the tx). We use
// the post-balance (not the delta) because reconcile treats tokenAmount as the account's authoritative
// balance and overwrites the Convex mirror with it.
function readPostBalances(meta: unknown): TokenBalance[] {
  if (meta == null || typeof meta !== "object") return [];
  const post = (meta as Record<string, unknown>).postTokenBalances;
  return Array.isArray(post) ? (post as TokenBalance[]) : [];
}

// Does this confirmed transaction actually invoke `programId`? We check the transaction's static
// account keys (any invoked program appears there) plus the top-level and inner instruction program
// ids, so a settle that reaches vesper_dvp via CPI is still recognized. Anything the program never
// touched (e.g. a bare SPL `transfer`) returns false and is refused mirroring.
function txInvokedProgram(result: unknown, programId: string): boolean {
  if (result == null || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;

  const message = ((r.transaction as Record<string, unknown> | undefined)?.message ?? undefined) as
    | Record<string, unknown>
    | undefined;

  // Static account keys — jsonParsed encodes these as { pubkey } objects (or bare strings on some RPCs).
  const accountKeys = Array.isArray(message?.accountKeys) ? (message!.accountKeys as unknown[]) : [];
  for (const k of accountKeys) {
    if (typeof k === "string" && k === programId) return true;
    if (k && typeof k === "object" && (k as Record<string, unknown>).pubkey === programId) return true;
  }

  // Top-level instructions carry an explicit `programId` in jsonParsed.
  const instructions = Array.isArray(message?.instructions) ? (message!.instructions as unknown[]) : [];
  const inner = (r.meta as Record<string, unknown> | undefined)?.innerInstructions;
  const innerIxns = Array.isArray(inner)
    ? (inner as unknown[]).flatMap((g) => {
        const ixns = (g as Record<string, unknown> | null)?.instructions;
        return Array.isArray(ixns) ? (ixns as unknown[]) : [];
      })
    : [];
  for (const ix of [...instructions, ...innerIxns]) {
    if (ix && typeof ix === "object" && (ix as Record<string, unknown>).programId === programId) return true;
  }
  return false;
}

function toBalanceNumber(b: TokenBalance): number | undefined {
  const ui = b.uiTokenAmount;
  if (!ui) return undefined;
  if (typeof ui.uiAmount === "number" && Number.isFinite(ui.uiAmount)) return ui.uiAmount;
  // Fall back to the raw base-unit string scaled by decimals (uiAmount can be null for 0-decimal mints
  // on some RPCs).
  if (typeof ui.amount === "string" && ui.amount.trim() !== "") {
    const raw = Number(ui.amount);
    const decimals = typeof ui.decimals === "number" ? ui.decimals : 0;
    if (Number.isFinite(raw)) return raw / 10 ** decimals;
  }
  return undefined;
}

// Fetch a mint's total supply (ui units) via getTokenSupply. Used to derive a chain-authoritative
// ownership fraction (holder balance / total supply) so an on-chain-native holding — created only by
// reconcile, with no Convex cost-basis intent — still carries a real ownershipPct (the sole weight
// distributions use). undefined on any RPC error or a zero/absent supply (reconcile then preserves intent).
async function fetchMintSupplyUi(rpcUrl: string, mint: string): Promise<number | undefined> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      result?: { value?: { amount?: string; decimals?: number; uiAmount?: number | null } };
    };
    const value = json.result?.value;
    if (!value) return undefined;
    if (typeof value.uiAmount === "number" && Number.isFinite(value.uiAmount) && value.uiAmount > 0) {
      return value.uiAmount;
    }
    if (typeof value.amount === "string" && value.amount.trim() !== "") {
      const raw = Number(value.amount);
      const decimals = typeof value.decimals === "number" ? value.decimals : 0;
      const ui = raw / 10 ** decimals;
      if (Number.isFinite(ui) && ui > 0) return ui;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Explicit result type — also breaks the self-reference type cycle created by calling
// `internal.onchainConfirm.knownPropertyMints` from within this same module.
type ConfirmResult =
  | { status: "rpc-error"; httpStatus?: number; error?: unknown }
  | { status: "not-found" }
  | { status: "confirmed"; applied: number; unresolved: number; balances: number };

export const confirmSettlement = action({
  args: { signature: v.string() },
  handler: async (ctx, { signature }): Promise<ConfirmResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (
      process.env.VESPER_ENABLE_PUBLIC_ONCHAIN_CONFIRM !== "true" &&
      process.env.NODE_ENV !== "test"
    ) {
      throw new Error("Public on-chain confirmation is disabled");
    }
    if (!isLikelySolanaSignature(signature)) throw new Error("Invalid transaction signature");

    // Bind the signature to the caller. Resolve the caller's own mirrored wallet up front; we only
    // reconcile balances this wallet owns, so a foreign signature can never rewrite another user's holding.
    const callerWallet = await ctx.runQuery(internal.onchainConfirm.callerWalletAddress, {
      subject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier ?? undefined,
    });
    if (!callerWallet) throw new Error("No linked wallet for caller");

    const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;

    // Pull the confirmed transaction. jsonParsed gives us postTokenBalances with mint+owner+uiAmount.
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
        ],
      }),
    });

    if (!res.ok) {
      return { status: "rpc-error" as const, httpStatus: res.status };
    }

    const json = (await res.json()) as {
      result?: { slot?: number; meta?: unknown; transaction?: unknown } | null;
      error?: unknown;
    };

    // Not yet visible to this RPC (propagation lag) or an RPC error — the caller can retry.
    if (json.error) return { status: "rpc-error" as const, error: json.error };
    if (!json.result) return { status: "not-found" as const };

    // Require the transaction to actually invoke vesper_dvp. This is the second half of the trust
    // boundary (the first is the owner filter below): only a real DvP settlement — not an arbitrary
    // transfer of a known property mint — is allowed to drive authoritative ownership into the mirror.
    if (!txInvokedProgram(json.result, VESPER_DVP_PROGRAM_ID)) {
      throw new Error("Transaction is not a Vesper settlement");
    }

    const slot = typeof json.result.slot === "number" ? json.result.slot : undefined;
    const allBalances = readPostBalances(json.result.meta);

    // Keep only property-mint balances OWNED BY THE CALLER. Binding on `owner === callerWallet` is the
    // core auth fix: we mirror exactly the caller's own new holding and nothing else, so the vault leg
    // (offering PDA) and any other wallet's leg in the same tx are ignored — a caller can never move
    // another user's mirrored balance, and the single-leg result sidesteps the shared-signature dedup.
    const mints: string[] = await ctx.runQuery(internal.onchainConfirm.knownPropertyMints, {});
    const propertyMints = new Set<string>(mints);
    const balances: TokenBalance[] = allBalances.filter(
      (b) => !!b.mint && propertyMints.has(b.mint) && b.owner === callerWallet,
    );

    // Feed each property-mint post-balance to reconcile. Ownership reconciliation is what makes the
    // buyer's new holding appear in the Convex mirror. We also derive the chain-authoritative ownership
    // fraction (balance / mint supply) and pass it through, so the mirrored holding carries a real
    // ownershipPct even on the on-chain-native path (no Convex cost-basis intent to derive it from).
    const supplyByMint = new Map<string, number | undefined>();
    let applied = 0;
    let unresolved = 0;
    for (const b of balances) {
      if (!b.mint || !b.owner) continue;
      const tokenAmount = toBalanceNumber(b);
      if (tokenAmount === undefined) continue;

      if (!supplyByMint.has(b.mint)) {
        supplyByMint.set(b.mint, await fetchMintSupplyUi(rpcUrl, b.mint));
      }
      const supply = supplyByMint.get(b.mint);
      const ownershipPct =
        supply !== undefined && supply > 0 ? Math.min(1, tokenAmount / supply) : undefined;

      const result = await ctx.runMutation(internal.reconcile.applyChainEvent, {
        type: "transfer",
        signature,
        mint: b.mint,
        owner: b.owner,
        tokenAmount,
        ownershipPct,
        slot,
        raw: b,
      });
      if (result.status === "applied") applied += 1;
      else if (result.status === "unresolved") unresolved += 1;
    }

    return { status: "confirmed" as const, applied, unresolved, balances: balances.length };
  },
});
