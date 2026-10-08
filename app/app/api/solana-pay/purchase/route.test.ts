import { afterEach, describe, expect, test, vi } from "vitest";
import { POST, purchaseNetwork } from "./route";
import { assertExactOperationQuote, type BuildIntent } from "./quoteBinding";

afterEach(() => vi.unstubAllEnvs());

const intent: BuildIntent = {
  operationId: "order-1",
  walletAddress: "buyer",
  propertyMint: "mint",
  tokenAmountRaw: "2",
  principalBaseUnits: "100000000",
  platformFeeBaseUnits: "900000",
  totalBaseUnits: "100900000",
  expiresAt: Date.now() + 60_000,
};

describe("purchase signer quote binding", () => {
  test("accepts exact live parity", () => {
    expect(() =>
      assertExactOperationQuote(intent, {
        principalUsdcAmount: 100_000_000n,
        platformFeeUsdcAmount: 900_000n,
        totalUsdcAmount: 100_900_000n,
      }),
    ).not.toThrow();
  });

  test.each([
    { principalUsdcAmount: 5_000_000_000n, platformFeeUsdcAmount: 45_000_000n, totalUsdcAmount: 5_045_000_000n },
    { principalUsdcAmount: 100_000_000n, platformFeeUsdcAmount: 899_999n, totalUsdcAmount: 100_899_999n },
    { principalUsdcAmount: 100_000_000n, platformFeeUsdcAmount: 900_000n, totalUsdcAmount: 100_900_001n },
  ])("rejects tampered or stale economics", (quote) => {
    expect(() => assertExactOperationQuote(intent, quote)).toThrow(
      "Live offering terms do not match the prepared order",
    );
  });
});

describe("purchase endpoint boundary", () => {
  test("requires an explicit RPC and cluster when real purchasing is enabled", () => {
    vi.stubEnv("SOLANA_RPC_URL", "");
    vi.stubEnv("SOLANA_CLUSTER", "");
    expect(() => purchaseNetwork()).toThrow("not configured");
  });

  test("returns the explicitly configured chain without a devnet fallback", () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
    vi.stubEnv("SOLANA_CLUSTER", "mainnet");
    expect(purchaseNetwork().chain).toBe("solana:mainnet");
  });

  test("fails closed when real purchase is disabled", async () => {
    vi.stubEnv("VESPER_ENABLE_REAL_PURCHASE", "");
    const response = await POST(new Request("http://localhost/api/solana-pay/purchase", { method: "POST" }));
    expect(response.status).toBe(404);
  });

  test("requires authentication before reading a prepared operation", async () => {
    vi.stubEnv("VESPER_ENABLE_REAL_PURCHASE", "true");
    const response = await POST(new Request("http://localhost/api/solana-pay/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationId: "order-1" }),
    }));
    expect(response.status).toBe(401);
  });

  test("rejects direct economic parameters without a prepared operation", async () => {
    vi.stubEnv("VESPER_ENABLE_REAL_PURCHASE", "true");
    const response = await POST(new Request("http://localhost/api/solana-pay/purchase", {
      method: "POST",
      headers: { authorization: "Bearer test", "content-type": "application/json" },
      body: JSON.stringify({ propertyMint: "attacker", tokenAmount: 1, totalBaseUnits: "1" }),
    }));
    expect(response.status).toBe(400);
  });
});
