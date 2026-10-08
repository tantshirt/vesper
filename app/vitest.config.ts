import { defineConfig } from "vitest/config";

// convex-test runs Convex functions in an edge-like runtime; inline the package so its ESM resolves.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    env: { HELIUS_WEBHOOK_SECRET: "test-secret" },
  },
});
