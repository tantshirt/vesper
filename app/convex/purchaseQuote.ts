"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchOffering } from "../lib/solana/dvp";
import {
  deriveWholeTokenPurchaseQuote,
  type PublicPurchaseOperation,
  type PurchasePreparationContext,
} from "./settlement";

/**
 * Node-isolated live quote boundary. Default-runtime queries and mutations remain in settlement.ts;
 * only this action loads web3, Buffer-backed ABI decoding, and the RPC client.
 */
export const preparePurchase = action({
  args: {
    propertyId: v.id("properties"),
    amountUsd: v.number(),
    acknowledgedRiskIds: v.array(v.string()),
    teachBackOwnership: v.string(),
    teachBackLiquidity: v.string(),
  },
  handler: async (ctx, args): Promise<PublicPurchaseOperation> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!Number.isSafeInteger(args.amountUsd) || args.amountUsd <= 0) {
      throw new Error("Invalid amount");
    }
    const identityArgs = {
      subject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier ?? undefined,
      issuer: identity.issuer ?? undefined,
    };
    const context: PurchasePreparationContext = await ctx.runQuery(
      internal.settlement.purchasePreparationContext,
      { propertyId: args.propertyId, ...identityArgs },
    );
    const rpcUrl = process.env.SOLANA_RPC_URL;
    const cluster = process.env.SOLANA_CLUSTER;
    if (
      !rpcUrl ||
      (cluster !== "devnet" && cluster !== "testnet" && cluster !== "mainnet")
    ) {
      throw new Error("Real purchase network is not configured");
    }
    const connection = new Connection(rpcUrl, "confirmed");
    const propertyMint = new PublicKey(context.propertyMint);
    const { offering } = await fetchOffering(connection, propertyMint);
    if (!offering.propertyMint.equals(propertyMint) || offering.closed) {
      throw new Error("Offering unavailable");
    }
    const { tokenAmount, quote } = deriveWholeTokenPurchaseQuote(
      args.amountUsd,
      offering.pricePerToken,
      offering.totalOffering - offering.sold,
    );
    return await ctx.runMutation(internal.settlement.preparePurchaseVerified, {
      ...args,
      ...identityArgs,
      propertyMint: propertyMint.toBase58(),
      tokenAmountRaw: tokenAmount.toString(),
      principalBaseUnits: quote.principalUsdcAmount.toString(),
      platformFeeBaseUnits: quote.platformFeeUsdcAmount.toString(),
      totalBaseUnits: quote.totalUsdcAmount.toString(),
    });
  },
});
