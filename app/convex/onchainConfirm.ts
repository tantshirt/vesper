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

type PurchaseChain = "solana:devnet" | "solana:testnet" | "solana:mainnet";

function purchaseNetwork(): { rpcUrl: string; chain: PurchaseChain } {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const cluster = process.env.SOLANA_CLUSTER;
  if (!rpcUrl || !cluster) throw new Error("Real purchase network is not configured");
  if (cluster !== "devnet" && cluster !== "testnet" && cluster !== "mainnet") {
    throw new Error("Real purchase cluster is invalid");
  }
  return { rpcUrl, chain: `solana:${cluster}` };
}

export function isBlockhashExpired(
  currentBlockHeight: unknown,
  lastValidBlockHeight: number,
): currentBlockHeight is number {
  return (
    typeof currentBlockHeight === "number" &&
    Number.isSafeInteger(currentBlockHeight) &&
    currentBlockHeight > lastValidBlockHeight
  );
}

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
  // `issuer` MUST be threaded through: reconstructing the identity without it makes isWorkosIdentity
  // return false, silently disarming the scope wall on exactly this path (where a manufactured
  // colliding row would be exploited).
  args: {
    subject: v.string(),
    tokenIdentifier: v.optional(v.string()),
    issuer: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { subject, tokenIdentifier, issuer },
  ): Promise<string | null> => {
    const user = await findUserByIdentity(ctx, {
      subject,
      tokenIdentifier,
      issuer,
    });
    return user?.walletAddress ?? null;
  },
});

// A single SPL/Token-2022 balance entry from the parsed transaction meta.
interface TokenBalance {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
    decimals?: number;
    uiAmount?: number | null;
  };
}

interface SettleEvidence {
  eventIndex: number;
  mint: string;
  owner: string;
  tokenAccount: string;
  tokenAmountRaw: string;
  tokenDecimals: number;
  purchasedAmountRaw: string;
  principalBaseUnits: string;
  platformFeeBaseUnits: string;
  totalBaseUnits: string;
}

export interface ExpectedSettlementEvidence {
  buyer: string;
  propertyMint: string;
  tokenAmountRaw: string;
  principalBaseUnits: string;
  platformFeeBaseUnits: string;
  totalBaseUnits: string;
  offering?: string;
  authority?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  chain?: PurchaseChain;
}

const SETTLE_PURCHASE_DISCRIMINATOR = 1;
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value: string): Uint8Array | undefined {
  if (value.length === 0) return new Uint8Array();
  let numeric = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return undefined;
    numeric = numeric * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (numeric > 0n) {
    bytes.unshift(Number(numeric & 0xffn));
    numeric >>= 8n;
  }
  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === "1")
    leadingZeros += 1;
  return Uint8Array.from([
    ...new Array<number>(leadingZeros).fill(0),
    ...bytes,
  ]);
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1)
    value = (value << 8n) | BigInt(data[offset + i]);
  return value;
}

function accountKey(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const pubkey = (value as Record<string, unknown>).pubkey;
    if (typeof pubkey === "string") return pubkey;
  }
  return undefined;
}

function signerKeys(message: Record<string, unknown> | undefined): Set<string> {
  if (!Array.isArray(message?.accountKeys)) return new Set();
  const entries = message.accountKeys as unknown[];
  const signers = new Set<string>();
  entries.forEach((entry, index) => {
    const key = accountKey(entry);
    if (!key) return;
    const explicitSigner =
      entry != null &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).signer === true;
    const required = (message.header as Record<string, unknown> | undefined)
      ?.numRequiredSignatures;
    if (explicitSigner || (typeof required === "number" && index < required)) {
      signers.add(key);
    }
  });
  return signers;
}

function expectedAmount(value: string): bigint | undefined {
  return /^\d+$/.test(value) ? BigInt(value) : undefined;
}

function rawAmount(balance: TokenBalance | undefined): bigint | undefined {
  const amount = balance?.uiTokenAmount?.amount;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) return undefined;
  return BigInt(amount);
}

function balanceAt(
  balances: TokenBalance[],
  accountIndex: number,
): TokenBalance | undefined {
  return balances.find((balance) => balance.accountIndex === accountIndex);
}

/** Validate successful, exact top-level Quasar settlePurchase instructions and their token deltas. */
export function validateSettlePurchaseTransaction(
  result: unknown,
  callerWallet: string,
  knownMints: ReadonlySet<string>,
  expectedSettlements: ReadonlyMap<string, ExpectedSettlementEvidence>,
): SettleEvidence[] {
  if (result == null || typeof result !== "object")
    throw new Error("Invalid transaction result");
  const record = result as Record<string, unknown>;
  const meta = record.meta as Record<string, unknown> | undefined;
  if (!meta || meta.err !== null)
    throw new Error("Transaction failed or has no execution metadata");

  const message = (record.transaction as Record<string, unknown> | undefined)
    ?.message as Record<string, unknown> | undefined;
  const keys = Array.isArray(message?.accountKeys)
    ? (message.accountKeys as unknown[]).map(accountKey)
    : [];
  const transactionSigners = signerKeys(message);
  const instructions = Array.isArray(message?.instructions)
    ? message.instructions
    : [];
  const pre = readTokenBalances(meta.preTokenBalances);
  const post = readTokenBalances(meta.postTokenBalances);
  const grouped = new Map<
    string,
    { instructionIndex: number; accounts: string[]; amount: bigint }
  >();

  instructions.forEach((value, instructionIndex) => {
    if (!value || typeof value !== "object") return;
    const ix = value as Record<string, unknown>;
    if (ix.programId !== VESPER_DVP_PROGRAM_ID) return;
    if (
      !Array.isArray(ix.accounts) ||
      ix.accounts.length !== 12 ||
      typeof ix.data !== "string"
    )
      return;
    const accounts = (ix.accounts as unknown[]).map((account) =>
      typeof account === "number" ? keys[account] : accountKey(account),
    );
    if (accounts.some((account) => !account)) return;
    const data = decodeBase58(ix.data);
    if (!data || data.length !== 9 || data[0] !== SETTLE_PURCHASE_DISCRIMINATOR)
      return;
    const amount = readU64LE(data, 1);
    if (amount <= 0n) return;
    const resolved = accounts as string[];
    const expected = expectedSettlements.get(resolved[2]);
    if (
      resolved[0] !== callerWallet ||
      !knownMints.has(resolved[2]) ||
      resolved[9] !== TOKEN_2022_PROGRAM_ID ||
      resolved[10] !== TOKEN_PROGRAM_ID ||
      !transactionSigners.has(resolved[11]) ||
      !expected ||
      expected.buyer !== callerWallet ||
      expected.propertyMint !== resolved[2] ||
      expected.tokenAmountRaw !== amount.toString() ||
      (expected.offering !== undefined && expected.offering !== resolved[1]) ||
      (expected.authority !== undefined && expected.authority !== resolved[11])
    )
      return;
    const groupKey = `${resolved[2]}:${resolved[5]}`;
    const prior = grouped.get(groupKey);
    grouped.set(groupKey, {
      instructionIndex: prior?.instructionIndex ?? instructionIndex,
      accounts: resolved,
      amount: (prior?.amount ?? 0n) + amount,
    });
  });

  const groupsPerMint = new Map<string, number>();
  for (const { accounts } of grouped.values()) {
    groupsPerMint.set(accounts[2], (groupsPerMint.get(accounts[2]) ?? 0) + 1);
  }
  if ([...groupsPerMint.values()].some((count) => count > 1)) {
    throw new Error("Transaction has ambiguous settlement token accounts");
  }

  // Balance metadata is transaction-level, so multiple settlements sharing one payment route are
  // verified against the sum of their prepared totals rather than double-counting the same delta.
  const expectedPaymentByRoute = new Map<string, bigint>();
  for (const { accounts } of grouped.values()) {
    const expected = expectedSettlements.get(accounts[2]);
    if (!expected) continue;
    const principal = expectedAmount(expected.principalBaseUnits);
    const platformFee = expectedAmount(expected.platformFeeBaseUnits);
    const total = expectedAmount(expected.totalBaseUnits);
    if (
      principal === undefined ||
      platformFee === undefined ||
      total === undefined ||
      principal + platformFee !== total
    )
      continue;
    const route = `${accounts[6]}:${accounts[7]}`;
    expectedPaymentByRoute.set(
      route,
      (expectedPaymentByRoute.get(route) ?? 0n) + total,
    );
  }

  const evidence: SettleEvidence[] = [];
  for (const { instructionIndex, accounts, amount } of grouped.values()) {
    const expected = expectedSettlements.get(accounts[2]);
    if (!expected) continue;
    const principal = expectedAmount(expected.principalBaseUnits);
    const platformFee = expectedAmount(expected.platformFeeBaseUnits);
    const total = expectedAmount(expected.totalBaseUnits);
    const expectedRouteTotal = expectedPaymentByRoute.get(
      `${accounts[6]}:${accounts[7]}`,
    );
    if (
      principal === undefined ||
      platformFee === undefined ||
      total === undefined ||
      principal + platformFee !== total ||
      expectedRouteTotal === undefined
    )
      continue;
    const buyerPropertyIndex = keys.indexOf(accounts[5]);
    const buyerUsdcIndex = keys.indexOf(accounts[6]);
    const treasuryIndex = keys.indexOf(accounts[7]);
    if (buyerPropertyIndex < 0 || buyerUsdcIndex < 0 || treasuryIndex < 0)
      continue;

    const propertyPre = balanceAt(pre, buyerPropertyIndex);
    const propertyPost = balanceAt(post, buyerPropertyIndex);
    const buyerUsdcPre = balanceAt(pre, buyerUsdcIndex);
    const buyerUsdcPost = balanceAt(post, buyerUsdcIndex);
    const treasuryPre = balanceAt(pre, treasuryIndex);
    const treasuryPost = balanceAt(post, treasuryIndex);
    const propertyBefore = rawAmount(propertyPre) ?? 0n;
    const propertyAfter = rawAmount(propertyPost);
    const buyerUsdcBefore = rawAmount(buyerUsdcPre);
    const buyerUsdcAfter = rawAmount(buyerUsdcPost);
    const treasuryBefore = rawAmount(treasuryPre);
    const treasuryAfter = rawAmount(treasuryPost);
    if (
      propertyAfter === undefined ||
      propertyAfter - propertyBefore !== amount ||
      propertyPost?.mint !== accounts[2] ||
      propertyPost.owner !== callerWallet ||
      buyerUsdcBefore === undefined ||
      buyerUsdcAfter === undefined ||
      treasuryBefore === undefined ||
      treasuryAfter === undefined ||
      buyerUsdcPre?.mint !== accounts[3] ||
      buyerUsdcPost?.mint !== accounts[3] ||
      buyerUsdcPost.owner !== callerWallet ||
      treasuryPost?.mint !== accounts[3] ||
      buyerUsdcBefore - buyerUsdcAfter !== expectedRouteTotal ||
      treasuryAfter - treasuryBefore !== expectedRouteTotal
    )
      continue;
    evidence.push({
      eventIndex: instructionIndex,
      mint: accounts[2],
      owner: callerWallet,
      tokenAccount: accounts[5],
      tokenAmountRaw: propertyAfter.toString(),
      tokenDecimals: propertyPost.uiTokenAmount?.decimals ?? 0,
      purchasedAmountRaw: amount.toString(),
      principalBaseUnits: expected.principalBaseUnits,
      platformFeeBaseUnits: expected.platformFeeBaseUnits,
      totalBaseUnits: expected.totalBaseUnits,
    });
  }
  if (evidence.length === 0)
    throw new Error("Transaction has no verifiable Vesper settlement");
  return evidence;
}

type PreparedSettlementEvidence =
  | (ExpectedSettlementEvidence & {
      blockhash: string;
      lastValidBlockHeight: number;
      chain: PurchaseChain;
    })
  | null;

/** Server-authoritative P5 quote hook. Missing prepared evidence quarantines confirmation. */
export const preparedSettlementEvidence = internalQuery({
  args: { operationId: v.id("orders"), signature: v.string(), callerWallet: v.string() },
  handler: async (
    ctx,
    { operationId, signature, callerWallet },
  ): Promise<PreparedSettlementEvidence> => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_signature", (q) => q.eq("dvpTxSig", signature))
      .unique();
    if (
      !order ||
      order._id !== operationId ||
      order.walletAddress !== callerWallet ||
      !order.propertyMint ||
      !order.tokenAmountRaw ||
      !order.principalBaseUnits ||
      !order.platformFeeBaseUnits ||
      !order.totalBaseUnits ||
      !order.authorizedBlockhash ||
      order.authorizedLastValidBlockHeight === undefined ||
      !order.authorizedChain
    )
      return null;
    return {
      buyer: callerWallet,
      propertyMint: order.propertyMint,
      tokenAmountRaw: order.tokenAmountRaw,
      principalBaseUnits: order.principalBaseUnits,
      platformFeeBaseUnits: order.platformFeeBaseUnits,
      totalBaseUnits: order.totalBaseUnits,
      blockhash: order.authorizedBlockhash,
      lastValidBlockHeight: order.authorizedLastValidBlockHeight,
      chain: order.authorizedChain,
      // P5 may persist Offering/authority addresses later; the on-chain program still enforces
      // has_one(authority), and transactionSigners proves account 11 actually signed.
    };
  },
});

function readTokenBalances(value: unknown): TokenBalance[] {
  return Array.isArray(value) ? (value as TokenBalance[]) : [];
}

function toBalanceNumber(b: TokenBalance): number | undefined {
  const ui = b.uiTokenAmount;
  if (!ui) return undefined;
  if (typeof ui.uiAmount === "number" && Number.isFinite(ui.uiAmount))
    return ui.uiAmount;
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
async function fetchMintSupplyUi(
  rpcUrl: string,
  mint: string,
): Promise<number | undefined> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenSupply",
        params: [mint],
      }),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      result?: {
        value?: {
          amount?: string;
          decimals?: number;
          uiAmount?: number | null;
        };
      };
    };
    const value = json.result?.value;
    if (!value) return undefined;
    if (
      typeof value.uiAmount === "number" &&
      Number.isFinite(value.uiAmount) &&
      value.uiAmount > 0
    ) {
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
  | { status: "failed-safe" }
  | { status: "expired-safe" }
  | {
      status: "confirmed";
      applied: number;
      unresolved: number;
      balances: number;
    };

export const confirmSettlement = action({
  args: { operationId: v.id("orders"), signature: v.string() },
  handler: async (ctx, { operationId, signature }): Promise<ConfirmResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (
      process.env.VESPER_ENABLE_PUBLIC_ONCHAIN_CONFIRM !== "true" &&
      process.env.NODE_ENV !== "test"
    ) {
      throw new Error("Public on-chain confirmation is disabled");
    }
    if (!isLikelySolanaSignature(signature))
      throw new Error("Invalid transaction signature");

    // Bind the signature to the caller. Resolve the caller's own mirrored wallet up front; we only
    // reconcile balances this wallet owns, so a foreign signature can never rewrite another user's holding.
    const callerWallet = await ctx.runQuery(
      internal.onchainConfirm.callerWalletAddress,
      {
        subject: identity.subject,
        tokenIdentifier: identity.tokenIdentifier ?? undefined,
        issuer: identity.issuer ?? undefined,
      },
    );
    if (!callerWallet) throw new Error("No linked wallet for caller");

    const { rpcUrl, chain } = purchaseNetwork();
    const expected = await ctx.runQuery(
      internal.onchainConfirm.preparedSettlementEvidence,
      {
        operationId,
        signature,
        callerWallet,
      },
    );
    if (!expected) throw new Error("Transaction has no prepared settlement evidence");
    if (expected.chain !== chain) throw new Error("Purchase chain configuration changed");

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
          {
            encoding: "jsonParsed",
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          },
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

    // Not yet visible may mean propagation lag or a transaction that never landed. It becomes
    // retryable only after finalized block height proves the stored validity window has elapsed.
    if (json.error) return { status: "rpc-error" as const, error: json.error };
    if (!json.result) {
      const heightResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBlockHeight",
          params: [{ commitment: "finalized" }],
        }),
      });
      if (!heightResponse.ok) return { status: "rpc-error" as const, httpStatus: heightResponse.status };
      const heightJson = (await heightResponse.json()) as { result?: unknown; error?: unknown };
      if (heightJson.error) return { status: "rpc-error" as const, error: heightJson.error };
      if (isBlockhashExpired(heightJson.result, expected.lastValidBlockHeight)) {
        await ctx.runMutation(internal.settlement.recordVerifiedPurchaseExpiry, {
          operationId,
          signature,
          observedBlockHeight: heightJson.result,
        });
        return { status: "expired-safe" as const };
      }
      return { status: "not-found" as const };
    }

    const slot =
      typeof json.result.slot === "number" ? json.result.slot : undefined;
    if (slot === undefined || !Number.isSafeInteger(slot) || slot < 0) {
      throw new Error("Transaction has no valid slot");
    }
    const mints: string[] = await ctx.runQuery(
      internal.onchainConfirm.knownPropertyMints,
      {},
    );
    const propertyMints = new Set<string>(mints);
    const transactionMeta = json.result.meta as { err?: unknown } | undefined;
    if (transactionMeta?.err != null) {
      await ctx.runMutation(internal.settlement.recordVerifiedPurchaseFailure, {
        operationId,
        signature,
        slot,
      });
      return { status: "failed-safe" as const };
    }
    const settlements = validateSettlePurchaseTransaction(
      json.result,
      callerWallet,
      propertyMints,
      new Map([[expected.propertyMint, expected]]),
    );

    // Feed each property-mint post-balance to reconcile. Ownership reconciliation is what makes the
    // buyer's new holding appear in the Convex mirror. We also derive the chain-authoritative ownership
    // fraction (balance / mint supply) and pass it through, so the mirrored holding carries a real
    // ownershipPct even on the on-chain-native path (no Convex cost-basis intent to derive it from).
    const supplyByMint = new Map<string, number | undefined>();
    let applied = 0;
    let unresolved = 0;
    for (const settlement of settlements) {
      const b: TokenBalance = {
        mint: settlement.mint,
        owner: settlement.owner,
        uiTokenAmount: {
          amount: settlement.tokenAmountRaw,
          decimals: settlement.tokenDecimals,
        },
      };
      const tokenAmount = toBalanceNumber(b);
      if (
        tokenAmount === undefined ||
        !Number.isSafeInteger(Number(settlement.tokenAmountRaw))
      ) {
        const result = await ctx.runMutation(
          internal.reconcile.applyChainEvent,
          {
            type: "transfer",
            signature,
            eventIndex: settlement.eventIndex,
            mint: settlement.mint,
            owner: settlement.owner,
            tokenAmountRaw: settlement.tokenAmountRaw,
            tokenDecimals: settlement.tokenDecimals,
            slot,
            evidenceSource: "rpc",
            quarantineReason:
              "raw token balance cannot be represented safely by the numeric mirror",
            raw: settlement,
          },
        );
        if (result.status === "unresolved" || result.status === "quarantined")
          unresolved += 1;
        continue;
      }

      if (!supplyByMint.has(settlement.mint)) {
        supplyByMint.set(
          settlement.mint,
          await fetchMintSupplyUi(rpcUrl, settlement.mint),
        );
      }
      const supply = supplyByMint.get(settlement.mint);
      const ownershipPct =
        supply !== undefined && supply > 0
          ? Math.min(1, tokenAmount / supply)
          : undefined;

      const result = await ctx.runMutation(internal.reconcile.applyChainEvent, {
        type: "transfer",
        signature,
        eventIndex: settlement.eventIndex,
        mint: settlement.mint,
        owner: settlement.owner,
        tokenAmount,
        tokenAmountRaw: settlement.tokenAmountRaw,
        tokenDecimals: settlement.tokenDecimals,
        ownershipPct,
        slot,
        evidenceSource: "rpc",
        raw: settlement,
      });
      if (result.status === "applied") applied += 1;
      else if (
        result.status === "unresolved" ||
        result.status === "quarantined"
      )
        unresolved += 1;
    }

    await ctx.runMutation(internal.settlement.recordVerifiedPurchaseEvidence, {
      operationId,
      signature,
      slot,
      mirrorComplete: unresolved === 0,
    });
    return {
      status: "confirmed" as const,
      applied,
      unresolved,
      balances: settlements.length,
    };
  },
});
