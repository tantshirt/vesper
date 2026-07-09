"use client";

/**
 * PurchaseButton — minimal end-to-end wiring of the `usePurchase` flow.
 *
 * A single button that builds → signs (via the Privy embedded wallet) → submits
 * → confirms → mirrors a primary purchase, with plain status text. This is the
 * prototype surface; real screens compose the hook with the design system.
 *
 * Copy stays fiat-native (shares, dollars) — never "USDC".
 */

import { usePurchase } from "@/lib/solana/usePurchase";

const STATUS_LABEL: Record<string, string> = {
  idle: "",
  building: "Preparing your purchase…",
  signing: "Confirm in your wallet…",
  confirming: "Settling on-chain…",
  confirmed: "Purchase complete.",
  error: "Something went wrong.",
};

export function PurchaseButton({
  propertyMint,
  tokenAmount = 1,
}: {
  propertyMint: string;
  tokenAmount?: number;
}) {
  const { purchase, status, signature, error } = usePurchase();
  const busy =
    status === "building" || status === "signing" || status === "confirming";

  const shares = tokenAmount === 1 ? "share" : "shares";

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void purchase(propertyMint, tokenAmount)}
      >
        {busy ? "Working…" : `Buy ${tokenAmount} ${shares}`}
      </button>

      {status !== "idle" && (
        <p role="status">{STATUS_LABEL[status] ?? status}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {signature && (
        <p>
          Confirmed:{" "}
          <code>
            {signature.slice(0, 8)}…{signature.slice(-8)}
          </code>
        </p>
      )}
    </div>
  );
}
