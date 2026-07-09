import { action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Slice 4 — the "confirm → mirror" bridge for the on-chain purchase flow.
//
// In production a Helius webhook (http.ts `/helius/webhook`) pushes the PurchaseSettled token transfer
// into reconcile.applyChainEvent automatically. That needs a live Helius account + a registered webhook
// per property mint. For the devnet prototype (no Helius account) this action is the pull-based stand-in:
// after the client signs + submits the on-chain `settle_purchase` and the transaction confirms, it calls
// this with the signature. We fetch the confirmed transaction straight from the RPC, read the
// CHAIN-AUTHORITATIVE post-balances, and hand each one to the SAME idempotent reconcile mutation the
// webhook uses. Chain stays the source of truth — the client only supplies a signature, never a balance.
//
// It is safe to call more than once: applyChainEvent dedupes by signature, and a mint that maps to no
// known property (e.g. the USDC leg) is dropped by reconcile as `unresolved`, never mis-applied.

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

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

// Explicit result type — also breaks the self-reference type cycle created by calling
// `internal.onchainConfirm.knownPropertyMints` from within this same module.
type ConfirmResult =
  | { status: "rpc-error"; httpStatus?: number; error?: unknown }
  | { status: "not-found" }
  | { status: "confirmed"; applied: number; unresolved: number; balances: number };

export const confirmSettlement = action({
  args: { signature: v.string() },
  handler: async (ctx, { signature }): Promise<ConfirmResult> => {
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
      result?: { slot?: number; meta?: unknown } | null;
      error?: unknown;
    };

    // Not yet visible to this RPC (propagation lag) or an RPC error — the caller can retry.
    if (json.error) return { status: "rpc-error" as const, error: json.error };
    if (!json.result) return { status: "not-found" as const };

    const slot = typeof json.result.slot === "number" ? json.result.slot : undefined;
    const allBalances = readPostBalances(json.result.meta);

    // Keep only property-mint balances (drops the USDC legs). The vault leg (owner = offering PDA)
    // still won't resolve to a user and is recorded `unresolved` by reconcile; the buyer leg is what
    // reconciles the new holding. reconcile's own dedup (delete-unresolved-and-redrive, applied wins)
    // makes the outcome order-independent even though every leg shares one signature.
    const mints: string[] = await ctx.runQuery(internal.onchainConfirm.knownPropertyMints, {});
    const propertyMints = new Set<string>(mints);
    const balances: TokenBalance[] = allBalances.filter(
      (b) => !!b.mint && propertyMints.has(b.mint),
    );

    // Feed each property-mint post-balance to reconcile. Ownership reconciliation is what makes the
    // buyer's new holding appear in the Convex mirror.
    let applied = 0;
    let unresolved = 0;
    for (const b of balances) {
      if (!b.mint || !b.owner) continue;
      const tokenAmount = toBalanceNumber(b);
      if (tokenAmount === undefined) continue;

      const result = await ctx.runMutation(internal.reconcile.applyChainEvent, {
        type: "transfer",
        signature,
        mint: b.mint,
        owner: b.owner,
        tokenAmount,
        slot,
        raw: b,
      });
      if (result.status === "applied") applied += 1;
      else if (result.status === "unresolved") unresolved += 1;
    }

    return { status: "confirmed" as const, applied, unresolved, balances: balances.length };
  },
});
