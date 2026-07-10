/**
 * Solana Pay Transaction Request endpoint for a primary property purchase.
 *
 * Implements the Solana Pay Transaction Request spec
 * (https://docs.solanapay.com/spec#transaction-request):
 *   - GET  → { label, icon } so a wallet can render the merchant before signing.
 *   - POST → { transaction, message } where `transaction` is a base64 serialized
 *            UNSIGNED VersionedTransaction the wallet then signs + submits.
 *
 * The unsigned tx is built by the framework-agnostic DvP client
 * (`@/lib/solana/dvp`), which fetches the on-chain Offering, prepends idempotent
 * ATA creation, appends `settlePurchase`, and sets feePayer = buyer. The buyer
 * is the ONLY tx-level signer — this route never signs.
 *
 * Consumer copy stays fiat-native: the `message` says "shares", never "USDC".
 */

import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildSettlePurchaseTransaction } from "@/lib/solana/dvp";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const MAX_TOKEN_AMOUNT = 1_000_000;

function solanaPayEnabled(): boolean {
  return process.env.VESPER_ENABLE_SOLANA_PAY === "true";
}

function getConnection(): Connection {
  return new Connection(
    process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL,
    "confirmed",
  );
}

/** Parse + validate `propertyMint` (base58 pubkey) and `tokenAmount` (positive int) from the query. */
function parseParams(url: URL):
  | { ok: true; propertyMint: PublicKey; tokenAmount: number }
  | { ok: false; error: string } {
  const propertyMintRaw = url.searchParams.get("propertyMint");
  const tokenAmountRaw = url.searchParams.get("tokenAmount");

  if (!propertyMintRaw) {
    return { ok: false, error: "Missing required query param: propertyMint" };
  }
  let propertyMint: PublicKey;
  try {
    propertyMint = new PublicKey(propertyMintRaw);
  } catch {
    return { ok: false, error: "Invalid propertyMint (must be a base58 pubkey)" };
  }

  if (!tokenAmountRaw) {
    return { ok: false, error: "Missing required query param: tokenAmount" };
  }
  const tokenAmount = Number(tokenAmountRaw);
  if (!Number.isInteger(tokenAmount) || tokenAmount <= 0 || tokenAmount > MAX_TOKEN_AMOUNT) {
    return { ok: false, error: "Invalid tokenAmount (must be a positive integer)" };
  }

  return { ok: true, propertyMint, tokenAmount };
}

/**
 * GET — merchant metadata. Solana-Pay-compatible wallets call this first to
 * render the label + icon. The icon is an absolute URL derived from the request
 * origin so it resolves regardless of deploy host.
 */
export async function GET(req: Request) {
  if (!solanaPayEnabled()) {
    return NextResponse.json({ error: "Solana Pay is disabled" }, { status: 404 });
  }
  const url = new URL(req.url);
  const params = parseParams(url);
  if (!params.ok) {
    return NextResponse.json({ error: params.error }, { status: 400 });
  }
  return NextResponse.json({
    label: "Vesper",
    icon: new URL("/brand/mark.svg", url.origin).toString(),
  });
}

/**
 * POST — build the unsigned purchase transaction for `account` (the buyer).
 * Body: { account: "<buyer base58 pubkey>" }. Returns base64 of the serialized
 * unsigned VersionedTransaction plus a fiat-native display message.
 */
export async function POST(req: Request) {
  if (!solanaPayEnabled()) {
    return NextResponse.json({ error: "Solana Pay is disabled" }, { status: 404 });
  }
  const url = new URL(req.url);
  const params = parseParams(url);
  if (!params.ok) {
    return NextResponse.json({ error: params.error }, { status: 400 });
  }

  // Read + validate the buyer account from the JSON body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const accountRaw =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).account
      : undefined;
  if (typeof accountRaw !== "string" || accountRaw.length === 0) {
    return NextResponse.json(
      { error: "Missing required field: account" },
      { status: 400 },
    );
  }
  let buyer: PublicKey;
  try {
    buyer = new PublicKey(accountRaw);
  } catch {
    return NextResponse.json(
      { error: "Invalid account (must be a base58 pubkey)" },
      { status: 400 },
    );
  }

  // Build against live devnet. A missing/closed Offering surfaces as a 400 with
  // the underlying reason rather than an opaque 500.
  try {
    const { transaction } = await buildSettlePurchaseTransaction({
      connection: getConnection(),
      buyer,
      propertyMint: params.propertyMint,
      tokenAmount: params.tokenAmount,
    });

    const base64 = Buffer.from(transaction.serialize()).toString("base64");
    const shares = params.tokenAmount === 1 ? "share" : "shares";

    return NextResponse.json({
      transaction: base64,
      message: `Buy ${params.tokenAmount} ${shares} of ${params.propertyMint.toBase58()}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build transaction";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
