"use client";

import { useCallback, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Id } from "vesper-app/convex/_generated/dataModel";
import { ActionSummary } from "@/app/components/ui/ActionSummary";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { MonoData } from "@/app/components/ui/MonoData";
import { OnChainActionPanel, type OnChainPhase } from "@/app/components/ui/OnChainActionPanel";
import { StageRail, type StageItem } from "@/app/components/ui/StageRail";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";

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

type MintResult = {
  minted: boolean;
  status?: "reserved" | "leased" | "submitted" | "failed" | "unknown" | "reconciled";
};

const EST_NETWORK_COST = "Estimate unavailable until provider preflight";

function fmtSupply(value: number) {
  return value.toLocaleString("en-US");
}

function chip(row: MintRow, phase?: OnChainPhase): { kind: StatusKind; label: string } {
  if (row.status === "open") return { kind: "complete", label: "Listed" };
  if (row.mintStatus === "confirmed") return { kind: "onchain", label: "Network confirmed" };
  if (phase === "unknown") return { kind: "blocked", label: "Outcome unknown" };
  if (row.mintStatus === "minting" || phase === "awaiting_confirmation") {
    return { kind: "pending", label: "Waiting for confirmation" };
  }
  if (row.allGatesSigned) return { kind: "passed", label: "Ready to mint" };
  return { kind: "draft", label: "Gates outstanding" };
}

function stages(row: MintRow, phase?: OnChainPhase): StageItem[] {
  const blocked = phase === "unknown";
  const gateDone = row.allGatesSigned;
  const submitted = row.mintStatus !== "none" || phase === "awaiting_confirmation" || blocked;
  const confirmed = row.mintStatus === "confirmed";
  const listed = row.status === "open";
  return [
    { id: "gates", label: "Diligence signed", state: gateDone ? "completed" : "current", detail: gateDone ? "All gates complete" : "Human signatures required" },
    { id: "mint", label: "Mint submitted", state: submitted ? "completed" : gateDone ? "current" : "upcoming" },
    { id: "confirm", label: "Network confirmation", state: blocked ? "blocked" : confirmed ? "completed" : submitted ? "current" : "upcoming", detail: blocked ? "Reconciliation required" : undefined },
    { id: "list", label: "Offering listed", state: listed ? "completed" : confirmed ? "current" : "upcoming" },
  ];
}

export default function MintPage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canMint = !!me && me.permissions.includes("mint.execute");
  const rows = (useQuery(api.mint.mintConsole, canMint ? {} : "skip") ?? []) as MintRow[];
  const recon = useQuery(api.mint.reconciliationStatus, canMint ? {} : "skip") as ReconStatus | undefined;
  const mintOffering = useAction(api.mint.mintOffering);
  const listOffering = useMutation(api.mint.listOffering);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<Record<string, OnChainPhase>>({});
  const [error, setError] = useState<Record<string, string>>({});

  const clearError = useCallback((id: string) => {
    setError((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const onMint = useCallback(async (row: MintRow) => {
    setBusy(row.id);
    clearError(row.id);
    setPhase((current) => ({ ...current, [row.id]: "submitting" }));
    try {
      const result = await mintOffering({ propertyId: row.id as Id<"properties"> }) as MintResult;
      const next: OnChainPhase = result.status === "unknown"
        ? "unknown"
        : result.status === "reconciled"
          ? "reconciled"
          : "awaiting_confirmation";
      setPhase((current) => ({ ...current, [row.id]: next }));
      setArmed(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Mint submission could not be verified.";
      const knownPreflight = /disabled|permission|gate|step-up|not found|already minted/i.test(message);
      setPhase((current) => ({ ...current, [row.id]: knownPreflight ? "failed_safe" : "unknown" }));
      setError((current) => ({ ...current, [row.id]: message }));
    } finally {
      setBusy(null);
    }
  }, [clearError, mintOffering]);

  const onList = useCallback(async (row: MintRow) => {
    setBusy(row.id);
    clearError(row.id);
    try {
      await listOffering({ propertyId: row.id as Id<"properties"> });
    } catch (cause) {
      setError((current) => ({ ...current, [row.id]: cause instanceof Error ? cause.message : "Listing was blocked." }));
    } finally {
      setBusy(null);
    }
  }, [clearError, listOffering]);

  if (authLoading || me === undefined) return <div className="admin-centered-state">Loading…</div>;
  if (!canMint) return <section className="a-workflow-page"><h1>Not permitted</h1><p>Minting requires the <code>mint.execute</code> permission.</p></section>;

  const attention = recon?.recent.filter((item) => item.status === "unresolved" || item.discrepancy != null) ?? [];

  return (
    <section className="a-workflow-page">
      <header className="a-workflow-head">
        <p className="admin-eyebrow">Property publishing</p>
        <h1>Publish a property</h1>
        <p>Turn an approved property into an investable offering. Review the supply and final consequence before submitting, then wait for verified network confirmation before publishing. A submitted or unknown operation is never retried from this screen.</p>
      </header>

      {(recon?.hasUnresolved || recon?.hasDiscrepancy) && (
        <InlineAlert tone="warning" title="Reconciliation needs attention">
          {recon.unresolvedCount} unresolved and {recon.discrepancyCount} discrepant recent event{recon.unresolvedCount + recon.discrepancyCount === 1 ? "" : "s"}. Review evidence before any next action.
          {attention.slice(0, 4).map((item) => <div key={item.id}><MonoData value={item.signature} label="network signature" /></div>)}
        </InlineAlert>
      )}

      {rows.length === 0 && <p>No properties are available.</p>}
      <div className="a-workflow-stack">
        {rows.map((row) => {
          const currentPhase = phase[row.id] ?? (row.mintStatus === "minting" ? "awaiting_confirmation" : row.status === "open" ? "reconciled" : "idle");
          const state = chip(row, currentPhase);
          const blocked = currentPhase === "unknown";
          const nextAction = blocked
            ? "Reconcile the stable operation reference with provider and network evidence. Do not submit again."
            : !row.allGatesSigned
              ? "Complete every diligence gate."
              : row.mintStatus === "none"
                ? "Review the exact supply, consequence, and signer before submitting."
                : row.mintStatus === "minting"
                  ? "Wait for network confirmation; investigate through reconciliation if it becomes stale."
                  : row.status !== "open"
                    ? "List the confirmed offering."
                    : "No action required.";

          return (
            <article className="a-workflow-card" id={`property-${row.id}`} key={row.id}>
              <div className="a-workflow-title-row"><div><p className="a-kicker">{row.location}</p><h2>{row.name}</h2></div><StatusChip status={state.kind} label={state.label} /></div>
              <StageRail label={`${row.name} mint stages`} stages={stages(row, currentPhase)} />
              <ActionSummary
                title={`${row.name} operation`}
                items={[
                  { label: "Subject", value: row.name },
                  { label: "Supply", value: `${fmtSupply(row.supply)} units` },
                  { label: "Consequence", value: "Create the property mint and initialize its offering" },
                  { label: "Cost", value: EST_NETWORK_COST },
                  { label: "Finality", value: "Network confirmation required before listing" },
                  { label: "Blocker", value: blocked ? "External outcome is unknown" : !row.allGatesSigned ? "Unsigned diligence gates" : "None reported" },
                  { label: "Accountable", value: `${me.name} · mint operator` },
                ]}
                nextAction={nextAction}
              />

              {error[row.id] && <InlineAlert tone={blocked ? "warning" : "danger"} title={blocked ? "Outcome unknown" : "Action stopped"} focus>{error[row.id]} {blocked ? "The operation may have reached the provider. Reconciliation is required; do not retry." : "No confirmed external effect is shown. Your context is preserved."}</InlineAlert>}

              {row.mintStatus === "none" && row.allGatesSigned && !blocked && armed !== row.id && (
                <button className="a-button a-button-primary" type="button" onClick={() => { clearError(row.id); setArmed(row.id); }}>Review mint</button>
              )}
              {row.mintStatus === "none" && row.allGatesSigned && !blocked && armed === row.id && (
                <OnChainActionPanel
                  eyebrow="Mint property token"
                  title={`Mint ${row.name}`}
                  consequence={`Create ${fmtSupply(row.supply)} frozen-by-default property units and initialize the offering. The token cannot be removed after network confirmation.`}
                  meta={[{ label: "Property", value: row.name }, { label: "Supply", value: `${fmtSupply(row.supply)} units` }, { label: "Cost", value: EST_NETWORK_COST }, { label: "Signer", value: me.name }]}
                  finality="After submission, wait for reconciliation before taking any repeat action."
                  confirmLabel={busy === row.id ? "Submitting…" : `Submit as ${me.name}`}
                  onConfirm={() => onMint(row)}
                  onCancel={() => setArmed(null)}
                  phase={currentPhase}
                  disabled={busy === row.id}
                  details={row.mint ? <MonoData value={row.mint} label="mint address" /> : "Operation identifier is unavailable in this query."}
                />
              )}
              {row.mintStatus === "minting" && <OnChainActionPanel eyebrow="Network confirmation" title={`${row.name} was submitted`} consequence="The provider accepted a mint operation. Listing remains locked until verified network evidence arrives." phase="awaiting_confirmation" details={row.mint ? <MonoData value={row.mint} label="mint address" /> : "Mint address unavailable."} />}
              {blocked && <OnChainActionPanel eyebrow="Reconciliation required" title={`${row.name} has an unknown outcome`} consequence="The external effect may have happened. A provider and network evidence check must resolve it before any further mint action." phase="unknown" details={row.mint ? <MonoData value={row.mint} label="mint address" /> : "Provider reference is unavailable in this query."} />}
              {row.mintStatus === "confirmed" && row.status !== "open" && <button className="a-button a-button-primary" type="button" disabled={busy === row.id} onClick={() => onList(row)}>{busy === row.id ? "Listing…" : "List confirmed offering"}</button>}
              {row.status === "open" && <InlineAlert tone="success" title="Offering listed">Subject: {row.name}. Network reference: {row.mint ? <MonoData value={row.mint} label="mint address" /> : "unavailable"}. Actor and completion timestamp are unavailable in this query; use the audit log for attribution.</InlineAlert>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
