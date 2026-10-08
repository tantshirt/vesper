"use client";

import { useCallback, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { useAction, useMutation } from "convex/react";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";

type PurchaseChain = "solana:devnet" | "solana:testnet" | "solana:mainnet";

export type PurchaseStatus =
  | "idle"
  | "building"
  | "signing"
  | "submitted"
  | "checking"
  | "reconciling"
  | "complete"
  | "failed_safe"
  | "outcome_unknown";

export interface UsePurchaseResult {
  purchase: (operationId: Id<"orders">) => Promise<void>;
  checkStatus: (operationId: Id<"orders">, signature: string) => Promise<void>;
  status: PurchaseStatus;
  signature: string | null;
  error: string | null;
}

function purchaseNetwork(): { rpcUrl: string; chain: PurchaseChain } {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const chain = process.env.NEXT_PUBLIC_SOLANA_CHAIN;
  if (!rpcUrl || !chain) throw new Error("Purchases are not configured for a Solana network.");
  if (chain !== "solana:devnet" && chain !== "solana:testnet" && chain !== "solana:mainnet") {
    throw new Error("The configured Solana network is invalid.");
  }
  return { rpcUrl, chain };
}

type ConfirmationResult =
  | { status: "confirmed"; unresolved: number }
  | { status: "failed-safe" }
  | { status: "expired-safe" }
  | { status: "not-found" }
  | { status: "rpc-error" };

export function confirmationPresentation(result: ConfirmationResult): {
  status: PurchaseStatus;
  error: string | null;
} {
  switch (result.status) {
    case "confirmed":
      return result.unresolved === 0
        ? { status: "complete", error: null }
        : { status: "reconciling", error: null };
    case "failed-safe":
      return {
        status: "failed_safe",
        error: "The submitted authorization was rejected. No payment or ownership changed.",
      };
    case "expired-safe":
      return {
        status: "failed_safe",
        error: "The authorization expired without landing. You can safely prepare a new purchase.",
      };
    case "not-found":
    case "rpc-error":
      return {
        status: "outcome_unknown",
        error: "We have not found a final result yet. Your reference is saved; check again shortly.",
      };
  }
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return "1".repeat(zeroes) + encoded;
}

export function usePurchase(): UsePurchaseResult {
  const { getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const recordSubmitted = useMutation(api.settlement.recordPurchaseSubmitted);
  const markFailedSafe = useMutation(api.settlement.markPurchaseFailedSafe);
  const markOutcomeUnknown = useMutation(api.settlement.markPurchaseOutcomeUnknown);
  const confirmSettlement = useAction(api.onchainConfirm.confirmSettlement);
  const inFlight = useRef(false);

  const [status, setStatus] = useState<PurchaseStatus>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(
    async (operationId: Id<"orders">, submittedSignature: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStatus("checking");
      setError(null);
      try {
        const result = await confirmSettlement({ operationId, signature: submittedSignature });
        const presentation = confirmationPresentation(result);
        setStatus(presentation.status);
        setError(presentation.error);
      } catch {
        setStatus("outcome_unknown");
        setError("We could not verify the final result yet. Your reference is saved; do not submit again.");
      } finally {
        inFlight.current = false;
      }
    },
    [confirmSettlement],
  );

  const purchase = useCallback(
    async (operationId: Id<"orders">) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      setSignature(null);
      let submittedSignature: string | null = null;
      let authorizationIssued = false;

      const wallet = wallets.find(
        (candidate) =>
          (candidate.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet === true,
      );
      if (!wallet) {
        inFlight.current = false;
        setStatus("failed_safe");
        setError("Your Vesper account is still being prepared. No payment was submitted.");
        return;
      }

      try {
        setStatus("building");
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("Your session expired. Sign in again before authorizing.");
        const response = await fetch("/api/solana-pay/purchase", {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ operationId }),
        });
        const detail = (await response.json().catch(() => ({}))) as {
          error?: string;
          transaction?: string;
          blockhash?: string;
          lastValidBlockHeight?: number;
          chain?: PurchaseChain;
        };
        if (
          !response.ok ||
          !detail.transaction ||
          !detail.blockhash ||
          detail.lastValidBlockHeight === undefined ||
          !detail.chain
        ) {
          throw new Error(detail.error ?? "This purchase cannot be authorized right now.");
        }
        const network = purchaseNetwork();
        if (detail.chain !== network.chain) {
          throw new Error("The purchase network does not match this application.");
        }
        authorizationIssued = true;

        setStatus("signing");
        const { signedTransaction } = await signTransaction({
          transaction: base64ToBytes(detail.transaction),
          wallet,
          chain: detail.chain,
        });
        const signed = VersionedTransaction.deserialize(signedTransaction);
        const buyerIndex = signed.message.staticAccountKeys.findIndex(
          (key) => key.toBase58() === wallet.address,
        );
        const buyerSignature = buyerIndex >= 0 ? signed.signatures[buyerIndex] : undefined;
        if (!buyerSignature?.some((byte) => byte !== 0)) throw new Error("Authorization was not signed");
        submittedSignature = encodeBase58(buyerSignature);
        setSignature(submittedSignature);

        // Persist the deterministic transaction reference before any network submission. From this
        // point onward retrying the purchase is forbidden; recovery checks this exact reference.
        await recordSubmitted({ operationId, signature: submittedSignature });
        setStatus("submitted");

        const connection = new Connection(network.rpcUrl, "finalized");
        const rpcSignature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
        if (rpcSignature !== submittedSignature) throw new Error("Submitted reference mismatch");
        const confirmation = await connection.confirmTransaction(
          {
            signature: submittedSignature,
            blockhash: detail.blockhash,
            lastValidBlockHeight: detail.lastValidBlockHeight,
          },
          "finalized",
        );
        if (confirmation.value.err) {
          const rejected = await confirmSettlement({ operationId, signature: submittedSignature });
          if (rejected.status === "failed-safe" || rejected.status === "expired-safe") {
            const presentation = confirmationPresentation(rejected);
            setStatus(presentation.status);
            setError(presentation.error);
            return;
          }
          throw new Error("The submitted payment was rejected");
        }

        setStatus("checking");
        const result = await confirmSettlement({ operationId, signature: submittedSignature });
        const presentation = confirmationPresentation(result);
        setStatus(presentation.status);
        setError(presentation.error);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Purchase could not be completed";
        if (submittedSignature) {
          await markOutcomeUnknown({
            operationId,
            signature: submittedSignature,
            reason: message,
          }).catch(() => undefined);
          setStatus("outcome_unknown");
          setError("Payment may have completed. Do not submit again; use Check status with the saved reference.");
        } else if (!authorizationIssued) {
          await markFailedSafe({ operationId, reason: message }).catch(() => undefined);
          setStatus("failed_safe");
          setError(`${message} No payment was submitted.`);
        } else {
          setStatus("idle");
          setError("Your authorization is saved. Retry to resume the same transaction; no new authorization will be issued.");
        }
      } finally {
        inFlight.current = false;
      }
    },
    [getAccessToken, wallets, signTransaction, recordSubmitted, markFailedSafe, markOutcomeUnknown, confirmSettlement],
  );

  return { purchase, checkStatus, status, signature, error };
}
