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
 *   - `useWallets()` from "@privy-io/react-auth/solana" → { ready, wallets }
 *     where the embedded wallet's standard metadata has `isPrivyWallet === true`.
 *   - `useSignTransaction()` from "@privy-io/react-auth/solana" signs serialized
 *     transaction bytes and returns signed bytes. We broadcast ourselves so we can confirm + mirror.
 *
 * Consumer copy stays fiat-native — this module never surfaces "USDC".
 */

import { useCallback, useState } from "react";
import { useWallets as useSolanaWallets, useSignTransaction } from "@privy-io/react-auth/solana";
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

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
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
      const wallet = wallets.find(
        (w) => (w.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet === true,
      );
      if (!wallet) {
        setStatus("error");
        setError("Your Vesper account is still being prepared. Please try again in a moment.");
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
        // The endpoint returns the serialized unsigned tx; sign those bytes directly (no
        // deserialize→re-serialize round-trip, which would just reproduce the same bytes).
        const txBytes = base64ToBytes(base64);

        // 2. Sign with the Privy embedded wallet (no broadcast — we do that next).
        setStatus("signing");
        const { signedTransaction } = await signTransaction({
          transaction: txBytes,
          wallet,
          chain: "solana:devnet",
        });
        const signed = VersionedTransaction.deserialize(signedTransaction);

        // 3. Broadcast + confirm on devnet.
        setStatus("confirming");
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(sig, "confirmed");
        // The purchase is now economically settled (USDC debited, tokens delivered). Commit to
        // "confirmed" BEFORE the mirror step so a mirror failure can never surface as a retry-inviting
        // error — a retry would re-broadcast and DOUBLE-CHARGE the buyer.
        setSignature(sig);
        setStatus("confirmed");

        // 4. Mirror the buyer's new holding into Convex (chain stays authoritative). Best-effort: the
        //    on-chain settle is already durable, so a mirror failure is non-fatal — the Helius webhook
        //    (or a later confirm) reconciles the holding. Never flip back to "error" here.
        try {
          await confirmSettlement({ signature: sig });
        } catch {
          // Intentionally swallowed — surfacing this as a failure would invite a double-charging retry.
        }
      } catch (err) {
        // Reached only for a failure BEFORE on-chain confirmation (build / sign / broadcast / confirm),
        // where nothing settled — safe to surface as a retryable error.
        setStatus("error");
        setError(err instanceof Error ? err.message : "Purchase failed");
      }
    },
    [wallets, signTransaction, confirmSettlement],
  );

  return { purchase, status, signature, error };
}
