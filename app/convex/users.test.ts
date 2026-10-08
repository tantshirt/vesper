import { generateKeyPairSync, sign } from "node:crypto";
import { convexTest } from "convex-test";
import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { parseSolanaPublicKey, verifyWalletChallengeSignature } from "./users";

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

const IDENTITY = "did:privy:wallet-owner";

function walletSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const walletAddress = new PublicKey(spki.subarray(spki.length - 32)).toBase58();
  return {
    walletAddress,
    sign: (message: string) => sign(null, Buffer.from(message), privateKey).toString("base64"),
  };
}

async function seedUser(t: ReturnType<typeof convexTest>, privyId = IDENTITY) {
  return await t.run((ctx) =>
    ctx.db.insert("users", { privyId, kycStatus: "none", createdAt: Date.now() }),
  );
}

afterEach(() => vi.unstubAllEnvs());

describe("wallet ownership linking", () => {
  test("links only after a valid domain/identity/address-bound Ed25519 signature", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const wallet = walletSigner();
    const actor = t.withIdentity({ subject: IDENTITY });
    const challenge = await actor.mutation(api.users.requestWalletLinkChallenge, {
      walletAddress: wallet.walletAddress,
    });

    expect(challenge.message).toContain(`Address: ${wallet.walletAddress}`);
    expect(challenge.message).toContain(IDENTITY);
    expect(challenge.message).toContain("Domain: vesper.finance");
    await actor.mutation(api.users.confirmWalletAddress, {
      challengeId: challenge.challengeId,
      signature: wallet.sign(challenge.message),
    });

    const result = await t.run(async (ctx) => ({
      user: await ctx.db.get(userId),
      challenge: await ctx.db
        .query("walletLinkChallenges")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      actions: (await ctx.db.query("auditLog").collect()).map((row) => row.action),
    }));
    expect(result.user?.walletAddress).toBe(wallet.walletAddress);
    expect(result.challenge?.consumedAt).toBeTypeOf("number");
    expect(result.actions).toContain("user.wallet_linked");
    expect(result.actions).toContain("user.wallet_challenge_consumed");
  });

  test("rejects replay, a different identity, and a signature from another key", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    await seedUser(t, "did:privy:attacker");
    const wallet = walletSigner();
    const attackerWallet = walletSigner();
    const owner = t.withIdentity({ subject: IDENTITY });
    const challenge = await owner.mutation(api.users.requestWalletLinkChallenge, {
      walletAddress: wallet.walletAddress,
    });

    await expect(
      t.withIdentity({ subject: "did:privy:attacker" }).mutation(api.users.confirmWalletAddress, {
        challengeId: challenge.challengeId,
        signature: wallet.sign(challenge.message),
      }),
    ).rejects.toThrow("not found");
    await expect(
      owner.mutation(api.users.confirmWalletAddress, {
        challengeId: challenge.challengeId,
        signature: attackerWallet.sign(challenge.message),
      }),
    ).rejects.toThrow("verification failed");

    const signature = wallet.sign(challenge.message);
    await owner.mutation(api.users.confirmWalletAddress, {
      challengeId: challenge.challengeId,
      signature,
    });
    await expect(
      owner.mutation(api.users.confirmWalletAddress, {
        challengeId: challenge.challengeId,
        signature,
      }),
    ).rejects.toThrow("already used");
  });

  test("rejects expired challenges and malformed public keys/signatures", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    const wallet = walletSigner();
    const actor = t.withIdentity({ subject: IDENTITY });
    const challenge = await actor.mutation(api.users.requestWalletLinkChallenge, {
      walletAddress: wallet.walletAddress,
    });
    await t.run((ctx) => ctx.db.patch(challenge.challengeId, { expiresAt: Date.now() - 1 }));
    await expect(
      actor.mutation(api.users.confirmWalletAddress, {
        challengeId: challenge.challengeId,
        signature: wallet.sign(challenge.message),
      }),
    ).rejects.toThrow("expired");
    expect(() => parseSolanaPublicKey("1111111111111111111111111111111O")).toThrow(
      "Invalid Solana address",
    );
    await expect(
      verifyWalletChallengeSignature({
        walletAddress: wallet.walletAddress,
        message: challenge.message,
        signature: "not-base64",
      }),
    ).rejects.toThrow("Invalid wallet signature");
  });

  test("legacy unverified linking is disabled in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const t = convexTest(schema, modules);
    await seedUser(t);
    const wallet = walletSigner();
    await expect(
      t.withIdentity({ subject: IDENTITY }).mutation(api.users.setWalletAddress, {
        walletAddress: wallet.walletAddress,
      }),
    ).rejects.toThrow("Signed wallet ownership proof is required");
  });

  test("legacy unverified linking requires an explicit development runtime and flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_ALLOW_UNVERIFIED_WALLET_MIGRATION", "true");
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const wallet = walletSigner();
    const actor = t.withIdentity({ subject: IDENTITY });

    await expect(
      actor.mutation(api.users.setWalletAddress, { walletAddress: wallet.walletAddress }),
    ).rejects.toThrow("Signed wallet ownership proof is required");

    vi.stubEnv("VESPER_RUNTIME_ENV", "development");
    await actor.mutation(api.users.setWalletAddress, { walletAddress: wallet.walletAddress });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.walletAddress).toBe(wallet.walletAddress);
  });
});
