"use client";

import { useCallback, useState } from "react";
import { useConvexAuth, useQuery, useMutation, useAction } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Id } from "vesper-app/convex/_generated/dataModel";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { MonoData } from "@/app/components/ui/MonoData";
import { OnChainActionPanel } from "@/app/components/ui/OnChainActionPanel";

// Admin Story 3.2 — the MINT & LISTING console. A `mint.execute`-gated operator (ops_diligence; NOT
// platform_admin) turns a fully-gated (3-1) property into an investable offering. Three walls, all
// re-enforced server-side on every Convex request (this UI gate is convenience, never enforcement):
//   1. GATE WALL — mint is offered ONLY when every diligence gate is signed (allGatesSigned).
//   2. STEP-UP + FINALITY — the mint states exact supply + cost + IRREVERSIBILITY behind a step-up
//      confirm (OnChainActionPanel), the same shell every irreversible on-chain act uses.
//   3. LIST-ONLY-AFTER-CONFIRM — the List action is enabled ONLY once the mint is confirmed on-chain.
// The mint signs through a STUB server-wallet seam; no live keys here. The confirm step stands in for
// the 3-3 Helius reconcile.

type MintRow = {
  id: string;
  name: string;
  location: string;
  status: "gating" | "open" | "funded" | "closed";
  mint: string | null;
  mintStatus: "none" | "minting" | "confirmed";
  supply: number;
  minInvestment: number;
  allGatesSigned: boolean;
};

type ReconRow = {
  id: string;
  signature: string;
  eventType: string;
  mint: string | null;
  status: "applied" | "unresolved";
  discrepancy: unknown;
  processedAt: number;
};

type ReconStatus = {
  recent: ReconRow[];
  unresolvedCount: number;
  discrepancyCount: number;
  hasUnresolved: boolean;
  hasDiscrepancy: boolean;
};

// A nominal network-cost estimate stated before the irreversible mint. The real figure comes from the
// server-wallet fee simulation when the STUB-MINT seam is replaced (rent for the Token-2022 mint +
// initialize_offering + priority fee); shown here so the operator sees a cost before committing.
const EST_NETWORK_COST = "~0.012 SOL (rent + fees)";

function fmtSupply(n: number): string {
  return n.toLocaleString("en-US");
}

function mintChip(r: MintRow): { kind: StatusKind; label: string } {
  if (r.mintStatus === "confirmed") return { kind: "onchain", label: "Mint confirmed" };
  if (r.mintStatus === "minting") return { kind: "pending", label: "Minting — awaiting confirm" };
  if (r.allGatesSigned) return { kind: "passed", label: "Ready to mint" };
  return { kind: "draft", label: "Gates outstanding" };
}

export default function MintPage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canMint = !!me && me.permissions.includes("mint.execute");

  // The property whose mint panel is armed (states finality behind a step-up confirm).
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});

  const console_ = useQuery(api.mint.mintConsole, canMint ? {} : "skip");
  const recon = useQuery(api.mint.reconciliationStatus, canMint ? {} : "skip");
  const mintOffering = useAction(api.mint.mintOffering);
  const confirmMint = useMutation(api.mint.confirmMintStub);
  const listOffering = useMutation(api.mint.listOffering);

  const clearError = useCallback((id: string) => {
    setError((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  }, []);

  const runAction = useCallback(
    async (id: string, fn: () => Promise<unknown>, onDone?: () => void) => {
      setBusy(id);
      clearError(id);
      try {
        await fn();
        onDone?.();
      } catch (err) {
        setError((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Action blocked." }));
      } finally {
        setBusy(null);
      }
    },
    [clearError],
  );

  const onMint = useCallback(
    (r: MintRow) =>
      runAction(
        r.id,
        () => mintOffering({ propertyId: r.id as Id<"properties"> }),
        () => setArmed(null),
      ),
    [runAction, mintOffering],
  );
  const onConfirm = useCallback(
    (r: MintRow) => runAction(r.id, () => confirmMint({ propertyId: r.id as Id<"properties"> })),
    [runAction, confirmMint],
  );
  const onList = useCallback(
    (r: MintRow) => runAction(r.id, () => listOffering({ propertyId: r.id as Id<"properties"> })),
    [runAction, listOffering],
  );

  if (authLoading || me === undefined) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  if (!canMint) {
    return (
      <section style={{ padding: "var(--space-8)", maxWidth: "50ch" }}>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
          Not permitted
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          Minting and listing an offering requires the <code>mint.execute</code> permission, held by ops
          diligence. Platform Admins deliberately hold no operational power and cannot mint. Ask a Platform
          Admin if you need mint access.
        </p>
      </section>
    );
  }

  const rows = (console_ ?? []) as MintRow[];
  const recon_ = recon as ReconStatus | undefined;
  // The reconciliation banner surfaces the on-chain confirm side of the spine: recent confirmations,
  // plus any unresolved event or chain↔Convex discrepancy the operator/compliance should see. The
  // reconcile path is chain-authoritative (chain wins) — this is a read-only monitor, never a control.
  const reconConfirms = (recon_?.recent ?? []).filter(
    (r) => r.eventType === "mint_confirmed" && r.status === "applied",
  );
  const reconAttention = (recon_?.recent ?? []).filter(
    (r) => r.status === "unresolved" || r.discrepancy != null,
  );

  return (
    <section style={{ padding: "var(--space-6)" }}>
      <header style={{ marginBottom: "var(--space-5)" }}>
        <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Mint &amp; listing
        </p>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-1)" }}>
          Mint &amp; listing console
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "74ch", lineHeight: 1.6 }}>
          The irreversible act that turns diligence into an investable offering. A property can be minted
          only once <strong>every</strong> gate is human-signed; the mint states its exact supply, cost, and
          finality behind a step-up confirmation; and an offering can be listed only after its mint is
          confirmed on-chain. The mint signs through a stubbed server wallet — no live keys — and every act
          is attributed to you in the audit log.
        </p>
      </header>

      {/* RECONCILIATION MONITOR (3-3) — the on-chain confirm side of the spine. Chain wins; this is a
          read-only surface. Attention rows (unresolved / discrepancy) lead; recent confirms follow. */}
      {recon_ !== undefined && (recon_.recent.length > 0 || recon_.hasUnresolved || recon_.hasDiscrepancy) && (
        <div
          style={{
            margin: "0 0 var(--space-5)",
            padding: "var(--space-4) var(--space-5)",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${recon_.hasDiscrepancy || recon_.hasUnresolved ? "var(--warning)" : "var(--hairline-2)"}`,
            background: "var(--surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <p style={{ color: "var(--muted)", font: "600 11px var(--sans)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              On-chain reconciliation
            </p>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              {recon_.hasDiscrepancy && (
                <StatusChip status="blocked" label={`${recon_.discrepancyCount} discrepancy${recon_.discrepancyCount === 1 ? "" : "…"} (chain won)`} />
              )}
              {recon_.hasUnresolved && (
                <StatusChip status="pending" label={`${recon_.unresolvedCount} unresolved`} />
              )}
              {!recon_.hasDiscrepancy && !recon_.hasUnresolved && reconConfirms.length > 0 && (
                <StatusChip status="onchain" label={`${reconConfirms.length} confirmed on-chain`} />
              )}
            </div>
          </div>

          <p style={{ color: "var(--sub)", fontSize: "12px", lineHeight: 1.5, margin: "var(--space-2) 0 0", maxWidth: "80ch" }}>
            Chain is authoritative — a confirmation reconciles Convex to on-chain truth (chain wins on any
            divergence). Listing unlocks the instant a property&apos;s mint is confirmed here.
          </p>

          {(reconAttention.length > 0 ? reconAttention : reconConfirms).slice(0, 6).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "var(--space-3) 0 0" }}>
              {(reconAttention.length > 0 ? reconAttention : reconConfirms).slice(0, 6).map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", fontSize: "12px", color: "var(--sub)" }}>
                  <StatusChip
                    status={r.discrepancy != null ? "blocked" : r.status === "unresolved" ? "pending" : "onchain"}
                    label={r.discrepancy != null ? "Discrepancy" : r.status === "unresolved" ? "Unresolved" : "Confirmed"}
                  />
                  <span style={{ color: "var(--muted)" }}>{r.eventType}</span>
                  {r.mint && <MonoData value={r.mint} label="on-chain mint address" />}
                  <MonoData value={r.signature} label="on-chain signature" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {console_ === undefined && <p style={{ color: "var(--sub)" }}>Loading properties…</p>}
      {console_ !== undefined && rows.length === 0 && (
        <p style={{ color: "var(--sub)" }}>No properties yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {rows.map((r) => {
          const chip = mintChip(r);
          const isBusy = busy === r.id;
          const err = error[r.id];
          const isArmed = armed === r.id;
          const canMintThis = r.allGatesSigned && r.mintStatus === "none";
          const canConfirm = r.mintStatus === "minting";
          const canList = r.mintStatus === "confirmed" && r.status !== "open";

          return (
            <article
              key={r.id}
              style={{
                padding: "var(--space-5)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--hairline-2)",
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-4)" }}>
                <div>
                  <p style={{ color: "var(--muted)", font: "600 11px var(--sans)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {r.location} · Status {r.status}
                  </p>
                  <h2 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "20px", margin: "4px 0 0" }}>
                    {r.name}
                  </h2>
                </div>
                <StatusChip status={chip.kind} label={chip.label} />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", margin: "var(--space-3) 0 0", color: "var(--sub)", fontSize: "13px" }}>
                <span>
                  Supply: <strong style={{ color: "var(--ink)" }}>{fmtSupply(r.supply)} units</strong>
                </span>
                <span>
                  Gates:{" "}
                  {r.allGatesSigned ? (
                    <strong style={{ color: "var(--gain)" }}>all signed</strong>
                  ) : (
                    <strong style={{ color: "var(--muted)" }}>outstanding</strong>
                  )}
                </span>
                {r.mint && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    Mint: <MonoData value={r.mint} label="on-chain mint address" />
                  </span>
                )}
              </div>

              {err && (
                <p
                  role="alert"
                  style={{
                    margin: "var(--space-4) 0 0",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--loss)",
                    color: "var(--loss)",
                    background: "color-mix(in srgb, var(--loss) 8%, transparent)",
                    fontSize: "13px",
                    lineHeight: 1.5,
                  }}
                >
                  Blocked: {err}
                </p>
              )}

              {/* MINT — armed only when every gate is signed; states supply + cost + finality behind a
                  step-up confirm (the OnChainActionPanel shell). */}
              {canMintThis && !isArmed && (
                <div style={{ margin: "var(--space-4) 0 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" }}>
                  <button
                    type="button"
                    onClick={() => {
                      clearError(r.id);
                      setArmed(r.id);
                    }}
                    style={{
                      cursor: "pointer",
                      font: "600 13px var(--sans)",
                      color: "var(--surface)",
                      background: "var(--accent)",
                      border: "0",
                      borderRadius: "var(--radius-pill)",
                      padding: "10px 22px",
                    }}
                  >
                    Mint {r.name}…
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: "12px", maxWidth: "60ch", lineHeight: 1.5 }}>
                    Minting is irreversible and permanent on Solana. You will confirm the exact supply and
                    cost, and re-authenticate (step-up), before it fires.
                  </span>
                </div>
              )}

              {canMintThis && isArmed && (
                <div style={{ margin: "var(--space-4) 0 0" }}>
                  <OnChainActionPanel
                    eyebrow="Mint property token"
                    title={`Mint ${r.name} (${fmtSupply(r.supply)} units)`}
                    consequence={
                      <>
                        Creates the frozen-by-default Token-2022 property mint and registers its offering
                        on-chain. This is the point of no return — the token exists on Solana permanently and
                        cannot be un-minted.
                      </>
                    }
                    meta={[
                      { label: "Supply", value: `${fmtSupply(r.supply)} units` },
                      { label: "Network cost", value: EST_NETWORK_COST },
                      { label: "Step-up", value: "Required (hardware re-auth)" },
                    ]}
                    finality="Irreversible · permanent on Solana"
                    confirmLabel={isBusy ? "Minting…" : `Confirm mint as ${me.name}`}
                    onConfirm={() => onMint(r)}
                    onCancel={() => setArmed(null)}
                    phase={isBusy ? "intent" : "idle"}
                    disabled={isBusy}
                  />
                </div>
              )}

              {/* CONFIRM — the distinct 3-3 stand-in that reconciles the mint on-chain, unlocking listing. */}
              {canConfirm && (
                <div style={{ margin: "var(--space-4) 0 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" }}>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onConfirm(r)}
                    style={{
                      cursor: isBusy ? "not-allowed" : "pointer",
                      opacity: isBusy ? 0.5 : 1,
                      font: "600 13px var(--sans)",
                      color: "var(--ink)",
                      background: "var(--surface)",
                      border: "1px solid var(--hairline-2)",
                      borderRadius: "var(--radius-pill)",
                      padding: "10px 22px",
                    }}
                  >
                    {isBusy ? "Confirming…" : "Confirm mint on-chain"}
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: "12px", maxWidth: "60ch", lineHeight: 1.5 }}>
                    Reconciles the mint from chain truth (stands in for the Helius confirm). Listing is
                    disabled until the mint is confirmed.
                  </span>
                </div>
              )}

              {/* LIST — enabled ONLY once the mint is confirmed. Flips the property to open (browsable). */}
              {r.mintStatus === "confirmed" && (
                <div style={{ margin: "var(--space-4) 0 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" }}>
                  <button
                    type="button"
                    disabled={isBusy || !canList}
                    onClick={() => onList(r)}
                    style={{
                      cursor: isBusy || !canList ? "not-allowed" : "pointer",
                      opacity: isBusy || !canList ? 0.5 : 1,
                      font: "600 13px var(--sans)",
                      color: "var(--surface)",
                      background: "var(--accent)",
                      border: "0",
                      borderRadius: "var(--radius-pill)",
                      padding: "10px 22px",
                    }}
                  >
                    {r.status === "open" ? "Listed" : isBusy ? "Listing…" : "List offering (open to investors)"}
                  </button>
                  <span style={{ color: "var(--muted)", fontSize: "12px", maxWidth: "60ch", lineHeight: 1.5 }}>
                    {r.status === "open"
                      ? "This offering is live — investors can browse and invest."
                      : "Flips the property to open. Investors can browse and invest once listed."}
                  </span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
