// Story 2.4 · On-chain proof — pure formatting/URL helpers (no JSX/React), so the
// edge-case logic (truncation, honest pending/empty states, explorer URLs) is isolated
// and unit-testable. NEVER fabricate a mint, holder count, or receipt: absent facts map
// to honest pending/empty strings, never invented data.

// Public Solana explorer cluster. Env-overridable so a real (e.g. mainnet) mint links to the
// right cluster on this trust surface; falls back to devnet for the demo asset.
export const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

// head…tail truncation for base58 addresses/signatures. Short inputs (≤ head+tail+1)
// render unchanged so no ellipsis is shown when there's nothing to hide.
export function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

// Public Solana explorer link to an account/mint address on the given cluster.
export function explorerAddressUrl(addr: string, cluster: string = SOLANA_CLUSTER): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${cluster}`;
}

// Public Solana explorer link to a transaction signature on the given cluster.
export function explorerTxUrl(sig: string, cluster: string = SOLANA_CLUSTER): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
}

// Holder facet summary. Honest empty at 0; otherwise a singular/plural owner count.
export function holderSummary(count: number): string {
  if (count <= 0) return "No positions have settled yet";
  return `${count} ${count === 1 ? "owner" : "owners"} on-chain`;
}
