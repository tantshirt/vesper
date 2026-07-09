"use client";

/**
 * usePurchase — the client-side signing hook that drives a primary property
 * purchase end to end via the buyer's Privy embedded Solana wallet.
 *
 * Flow (status transitions in parentheses):
 *   idle
 *   → (building)   POST /api/solana-pay/purchase → base64 unsigned tx
 *   → (signing)    Privy embedded wallet signs the deserialized VersionedTransaction
 *   → (confirming) sendRawTransaction + confirmTransaction on devnet
 *   → (confirmed)  Convex confirmSettlement mirrors the buyer's new holding
 *   → (error)      any step failed; `error` holds the message
 *
 * Privy API used (verified against the INSTALLED @privy-io/react-auth, dist/dts
 * — package.json reports 2.25.0, not 2.4.0):
 *   - `useSolanaWallets()` from "@privy-io/react-auth/solana" → { ready, wallets }
 *     where `wallets: ConnectedSolanaWallet[]`. The embedded wallet has
 *     `walletClientType === "privy"`.
 *   - `useSignTransaction()` from "@privy-io/react-auth/solana" →
 *     { signTransaction({ transaction, connection, address? }) } which returns
 *     the SIGNED SupportedSolanaTransaction (Transaction | VersionedTransaction)
 *     WITHOUT broadcasting. We broadcast ourselves so we can confirm + mirror.
 *
 * Consumer copy stays fiat-native — this module never surfaces "USDC".
 */

import { useCallback, useState } from "react";
import { useSolanaWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { useAction } from "convex/react";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { api } from "@/convex/_generated/api";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

export type PurchaseStatus =
  | "idle"
  | "building"
  | "signing"
  | "confirming"
  | "confirmed"
  | "error";

export interface UsePurchaseResult {
  /** Kick off a purchase of `tokenAmount` whole shares of `propertyMint`. */
  purchase: (propertyMint: string, tokenAmount: number) => Promise<void>;
  status: PurchaseStatus;
  /** The confirmed transaction signature, once submitted. */
  signature: string | null;
  /** A human-readable error message when `status === "error"`. */
  error: string | null;
}

function rpcUrl(): string {
  // NEXT_PUBLIC_ so the browser bundle can read it; falls back to devnet.
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
}

export function usePurchase(): UsePurchaseResult {
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const confirmSettlement = useAction(api.onchainConfirm.confirmSettlement);

  const [status, setStatus] = useState<PurchaseStatus>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const purchase = useCallback(
    async (propertyMint: string, tokenAmount: number) => {
      setError(null);
      setSignature(null);

      // Resolve the buyer's embedded Solana wallet (Privy-managed).
      const wallet =
        wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
      if (!wallet) {
        setStatus("error");
        setError("No Solana wallet available. Please sign in first.");
        return;
      }

      const connection = new Connection(rpcUrl(), "confirmed");

      try {
        // 1. Ask the endpoint to build the unsigned tx for this buyer.
        setStatus("building");
        const res = await fetch(
          `/api/solana-pay/purchase?propertyMint=${encodeURIComponent(
            propertyMint,
          )}&tokenAmount=${encodeURIComponent(String(tokenAmount))}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ account: wallet.address }),
          },
        );
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(
            (detail as { error?: string }).error ??
              `Failed to build transaction (HTTP ${res.status})`,
          );
        }
        const { transaction: base64 } = (await res.json()) as {
          transaction: string;
        };
        const tx = VersionedTransaction.deserialize(
          Buffer.from(base64, "base64"),
        );

        // 2. Sign with the Privy embedded wallet (no broadcast — we do that next).
        setStatus("signing");
        const signed = (await signTransaction({
          transaction: tx,
          connection,
          address: wallet.address,
        })) as VersionedTransaction;

        // 3. Broadcast + confirm on devnet.
        setStatus("confirming");
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(sig, "confirmed");
        setSignature(sig);

        // 4. Mirror the buyer's new holding into Convex (chain stays authoritative).
        await confirmSettlement({ signature: sig });

        setStatus("confirmed");
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Purchase failed");
      }
    },
    [wallets, signTransaction, confirmSettlement],
  );

  return { purchase, status, signature, error };
}
