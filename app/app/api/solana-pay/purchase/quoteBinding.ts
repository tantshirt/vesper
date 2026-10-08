import type { PurchaseQuote } from "../../../../lib/solana/dvp";

export type BuildIntent = {
  operationId: string;
  walletAddress: string;
  propertyMint: string;
  tokenAmountRaw: string;
  principalBaseUnits: string;
  platformFeeBaseUnits: string;
  totalBaseUnits: string;
  expiresAt: number;
};

function exactUnsignedInteger(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} is invalid`);
  return BigInt(value);
}

export function parseExactUnsignedInteger(value: string, label: string): bigint {
  return exactUnsignedInteger(value, label);
}

export function assertExactOperationQuote(intent: BuildIntent, quote: PurchaseQuote): void {
  if (
    quote.principalUsdcAmount !== exactUnsignedInteger(intent.principalBaseUnits, "principal") ||
    quote.platformFeeUsdcAmount !== exactUnsignedInteger(intent.platformFeeBaseUnits, "platform fee") ||
    quote.totalUsdcAmount !== exactUnsignedInteger(intent.totalBaseUnits, "total")
  ) {
    throw new Error("Live offering terms do not match the prepared order");
  }
}
