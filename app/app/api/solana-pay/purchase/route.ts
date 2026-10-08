import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getTokenAccount, TOKEN_PROGRAM_ID } from "../../../../lib/solana/token";
import { api } from "../../../../convex/_generated/api";
import {
  applyPlatformSettlementAuthorization,
  buildSettlePurchaseTransaction,
  type PlatformSettlementSignerProvider,
} from "../../../../lib/solana/dvp";
import {
  assertExactOperationQuote,
  parseExactUnsignedInteger,
  type BuildIntent,
} from "./quoteBinding";

function purchaseEnabled(): boolean {
  return process.env.VESPER_ENABLE_REAL_PURCHASE === "true";
}

function bearerToken(req: Request): string | null {
  const value = req.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

type PurchaseChain = "solana:devnet" | "solana:testnet" | "solana:mainnet";

export function purchaseNetwork(): { connection: Connection; chain: PurchaseChain } {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const cluster = process.env.SOLANA_CLUSTER;
  if (!rpcUrl || !cluster) {
    throw new Error("Real purchase network is not configured");
  }
  if (cluster !== "devnet" && cluster !== "testnet" && cluster !== "mainnet") {
    throw new Error("Real purchase cluster is invalid");
  }
  try {
    new URL(rpcUrl);
  } catch {
    throw new Error("Real purchase RPC URL is invalid");
  }
  return {
    connection: new Connection(rpcUrl, "confirmed"),
    chain: `solana:${cluster}`,
  };
}

function convexClient(token: string): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Convex is not configured");
  const client = new ConvexHttpClient(url);
  client.setAuth(token);
  return client;
}

function signerProvider(operationId: string): PlatformSettlementSignerProvider {
  const url = process.env.VESPER_SETTLEMENT_SIGNER_URL;
  const token = process.env.VESPER_SETTLEMENT_SIGNER_TOKEN;
  const authorityRaw = process.env.VESPER_SETTLEMENT_SIGNER_AUTHORITY;
  if (!url || !token || !authorityRaw) {
    throw new Error("Platform settlement signer provider is not configured");
  }
  const authority = new PublicKey(authorityRaw);
  return {
    authority,
    async signSettlement(request) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          purpose: "vesper-primary-purchase",
          operationId,
          authority: request.offering.authority.toBase58(),
          buyer: request.buyer.toBase58(),
          propertyMint: request.propertyMint.toBase58(),
          tokenAmountRaw: request.tokenAmount.toString(),
          principalBaseUnits: request.quote.principalUsdcAmount.toString(),
          platformFeeBaseUnits: request.quote.platformFeeUsdcAmount.toString(),
          totalBaseUnits: request.quote.totalUsdcAmount.toString(),
          transaction: Buffer.from(request.transaction.serialize()).toString("base64"),
        }),
      });
      if (!response.ok) throw new Error("Platform settlement signer rejected the order");
      const body = (await response.json()) as { transaction?: unknown };
      if (typeof body.transaction !== "string") throw new Error("Platform signer returned no transaction");
      return VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
    },
  };
}

export async function GET(req: Request) {
  if (!purchaseEnabled()) {
    return NextResponse.json({ error: "Purchases are unavailable" }, { status: 404 });
  }
  const origin = new URL(req.url).origin;
  return NextResponse.json({ label: "Vesper", icon: new URL("/brand/mark.svg", origin).toString() });
}

export async function POST(req: Request) {
  if (!purchaseEnabled()) {
    return NextResponse.json({ error: "Purchases are unavailable" }, { status: 404 });
  }
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let operationId: string;
  try {
    const body = (await req.json()) as { operationId?: unknown };
    if (typeof body.operationId !== "string" || body.operationId.length === 0) {
      return NextResponse.json({ error: "Prepared order required" }, { status: 400 });
    }
    operationId = body.operationId;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const convex = convexClient(token);
    const network = purchaseNetwork();
    const claimId = crypto.randomUUID();
    const claim = await convex.mutation(api.settlement.claimPurchaseAuthorization, {
      operationId: operationId as never,
      claimId,
    });
    if (claim.status === "expired") {
      return NextResponse.json({ error: "This prepared order is no longer available" }, { status: 409 });
    }
    if (claim.status === "in_progress") {
      return NextResponse.json({ error: "This authorization is still being prepared" }, { status: 409 });
    }
    if (claim.status === "issued") {
      return NextResponse.json({
        operationId,
        transaction: claim.transaction,
        blockhash: claim.blockhash,
        lastValidBlockHeight: claim.lastValidBlockHeight,
        chain: claim.chain,
        message: "Review and authorize this property purchase.",
      });
    }
    const intent = claim.intent as BuildIntent;
    const { connection, chain } = network;
    const buyer = new PublicKey(intent.walletAddress);
    const propertyMint = new PublicKey(intent.propertyMint);
    const tokenAmount = parseExactUnsignedInteger(intent.tokenAmountRaw, "token amount");
    const built = await buildSettlePurchaseTransaction({
      connection,
      buyer,
      propertyMint,
      tokenAmount,
    });
    assertExactOperationQuote(intent, built.quote);

    let spendableBaseUnits = 0n;
    try {
      const paymentAccount = await getTokenAccount(
        connection,
        built.buyerUsdc,
        "confirmed",
        TOKEN_PROGRAM_ID,
      );
      if (!paymentAccount.owner.equals(buyer) || !paymentAccount.mint.equals(built.offering.usdcMint)) {
        throw new Error("Canonical payment account does not match this order");
      }
      spendableBaseUnits = paymentAccount.amount;
    } catch {
      // Missing or malformed canonical payment custody is never replaced by the Convex read model.
    }
    if (spendableBaseUnits < built.quote.totalUsdcAmount) {
      throw new Error("Insufficient spendable funds");
    }

    const authorized = await applyPlatformSettlementAuthorization(
      {
        transaction: built.transaction,
        offering: built.offering,
        offeringAddress: built.offeringAddress,
        buyer,
        propertyMint,
        tokenAmount,
        quote: built.quote,
      },
      signerProvider(intent.operationId),
    );
    const canonical = await convex.mutation(api.settlement.finalizePurchaseAuthorization, {
      operationId: operationId as never,
      claimId,
      transaction: Buffer.from(authorized.serialize()).toString("base64"),
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
      chain,
    });
    return NextResponse.json({
      operationId: intent.operationId,
      transaction: canonical.transaction,
      blockhash: canonical.blockhash,
      lastValidBlockHeight: canonical.lastValidBlockHeight,
      chain: canonical.chain,
      message: "Review and authorize this property purchase.",
    });
  } catch (error) {
    console.error("[purchase] unable to authorize prepared order", error);
    const message = error instanceof Error ? error.message : "Purchase could not be prepared";
    const status = /not authenticated|not found/i.test(message) ? 401 : /expired|cannot be authorized/i.test(message) ? 409 : 422;
    const publicMessage =
      status === 401
        ? "Authentication required"
        : status === 409
          ? "This prepared order is no longer available"
          : /insufficient spendable funds/i.test(message)
            ? "Insufficient spendable funds"
            : "Purchase could not be prepared";
    return NextResponse.json({ error: publicMessage }, { status });
  }
}
