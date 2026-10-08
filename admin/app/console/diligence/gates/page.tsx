"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useQuery, useMutation, useAction } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Id } from "vesper-app/convex/_generated/dataModel";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { MonoData } from "@/app/components/ui/MonoData";
import { ActionSummary } from "@/app/components/ui/ActionSummary";
import { InlineAlert } from "@/app/components/ui/InlineAlert";
import { StageRail } from "@/app/components/ui/StageRail";

// Admin Story 3.1 — the gate SIGNATURE CEREMONY surface (THE SPINE). A `gate.sign`-gated operator
// reviews each gate's assembled 2-2 evidence (fields + citations; uncited fields render as FLAGS, never
// as approvals) and SIGNS the gate as a NAMED HUMAN. Permission is gated here in the UI AND — the real
// enforcement — independently on every Convex request (signGate → 1-2's requireGateSigner). A multi-party
// gate needs a DISTINCT second signer; a fee-conflicted or self-approving signer is BLOCKED server-side,
// surfaced here in loss-red with the required distinct signer. The AI never appears as an approver.

type GateRow = {
  id: string;
  gateNo: number;
  label: string;
  status: "pending" | "passed" | "failed";
  multiParty: boolean;
  required: number;
  signerCount: number;
  signerNames: string[];
  signedByHuman: string | null;
  signedAt: number | null;
  evidencePackageId: string | null;
  remaining: number;
};

type EvidenceField = {
  field: string;
  value: string;
  sourceRef: string | null;
  status: "extracted" | "uncited" | "rejected" | "verified";
};

type EvidencePackage = {
  id: string;
  gateNo: number | null;
  status: "assembled";
  assembledBy: string;
  assembledAt: number;
  note: string | null;
  fields: EvidenceField[];
};

function gateStatus(g: GateRow): { kind: StatusKind; label: string } {
  if (g.status === "passed") return { kind: "complete", label: "Signed" };
  if (g.status === "failed") return { kind: "blocked", label: "Failed" };
  if (g.signerCount > 0) return { kind: "pending", label: `Awaiting ${g.remaining} more` };
  return { kind: "pending", label: "Pending" };
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  font: "600 11px var(--sans)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

const selectStyle: React.CSSProperties = {
  font: "500 13px var(--sans)",
  color: "var(--ink)",
  background: "var(--surface)",
  border: "1px solid var(--hairline-2)",
  borderRadius: "var(--radius-md)",
  padding: "8px 11px",
  minHeight: "44px",
  minWidth: "32ch",
};

export default function GatesPage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canSign = !!me && me.permissions.includes("gate.sign");

  const [propertyId, setPropertyId] = useState<string>("");
  const [beginning, setBeginning] = useState(false);
  const [signing, setSigning] = useState<number | null>(null);
  const [beginError, setBeginError] = useState<string | null>(null);
  // Per-gate SoD/consequence error surfaced in loss-red (keyed by gateNo).
  const [gateError, setGateError] = useState<Record<number, string>>({});

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("propertyId");
    const frame = requested ? requestAnimationFrame(() => setPropertyId(requested)) : null;
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, []);

  const properties = useQuery(api.gates.listGateProperties, canSign ? {} : "skip");
  const workspace = useQuery(
    api.gates.gateWorkspace,
    canSign && propertyId ? { propertyId: propertyId as Id<"properties"> } : "skip",
  );

  const beginGating = useMutation(api.gates.beginGating);
  const signGate = useAction(api.gates.signGate);

  const onBegin = useCallback(async () => {
    if (!propertyId) return;
    setBeginning(true);
    setBeginError(null);
    try {
      await beginGating({ propertyId: propertyId as Id<"properties"> });
    } catch (err) {
      setBeginError(err instanceof Error ? err.message : "The gate workspace could not be created.");
    } finally {
      setBeginning(false);
    }
  }, [beginGating, propertyId]);

  // Evidence packages grouped by their destined gate (null gateNo ⇒ generally available to the property).
  const packagesByGate = useMemo(() => {
    const map = new Map<number | "any", EvidencePackage[]>();
    for (const pkg of (workspace?.evidencePackages ?? []) as EvidencePackage[]) {
      const key = pkg.gateNo ?? "any";
      const arr = map.get(key) ?? [];
      arr.push(pkg);
      map.set(key, arr);
    }
    return map;
  }, [workspace]);

  const onSign = useCallback(
    async (gate: GateRow) => {
      if (!propertyId) return;
      // Attach the first evidence package destined for this gate, if any (evidence, never an approval).
      const pkgs = packagesByGate.get(gate.gateNo) ?? [];
      const evidencePackageId = pkgs[0]?.id as Id<"evidencePackages"> | undefined;
      if (!evidencePackageId) {
        setGateError((current) => ({
          ...current,
          [gate.gateNo]: "A gate-specific evidence package is required before signing.",
        }));
        return;
      }
      setSigning(gate.gateNo);
      setGateError((e) => {
        const next = { ...e };
        delete next[gate.gateNo];
        return next;
      });
      try {
        await signGate({
          propertyId: propertyId as Id<"properties">,
          gateNo: gate.gateNo,
          evidencePackageId,
        });
      } catch (err) {
        // SoD blocks (fee conflict, self-approval), permission denials, and already-signed all land here.
        const msg = err instanceof Error ? err.message : "Signing was blocked.";
        setGateError((e) => ({ ...e, [gate.gateNo]: msg }));
      } finally {
        setSigning(null);
      }
    },
    [signGate, propertyId, packagesByGate],
  );

  if (authLoading || me === undefined) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  if (!canSign) {
    return (
      <section style={{ padding: "var(--space-8)", maxWidth: "50ch" }}>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
          Not permitted
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          Signing diligence gates requires the <code>gate.sign</code> permission, held by ops diligence.
          Platform Admins deliberately hold no operational power and cannot sign. Ask a Platform Admin if
          you need signer access.
        </p>
      </section>
    );
  }

  const gates = (workspace?.gates ?? []) as GateRow[];
  const allSigned = workspace?.allGatesSigned ?? false;
  const selectedProperty = (properties ?? []).find((property) => property.id === propertyId);
  const nextGate = gates.find((gate) => gate.status !== "passed");

  return (
    <section className="a-workflow-page">
      <header style={{ marginBottom: "var(--space-5)" }}>
        <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Property approval
        </p>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-1)" }}>
          Review and approve
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "74ch", lineHeight: 1.6 }}>
          Review the evidence required before this property can reach investors. Every approval is a
          permanent, named-human signature in the activity log. Some checks require a different second
          signer, and fee conflicts or self-approval are blocked. AI findings appear only as evidence and
          flags; AI never approves.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "flex-end", marginBottom: "var(--space-5)" }}>
        <label style={labelStyle}>
          Property
          <select style={selectStyle} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">Select a property…</option>
            {(properties ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.status})
              </option>
            ))}
          </select>
        </label>
        {propertyId && gates.length === 0 && (
          <button
            type="button"
            disabled={beginning}
            onClick={onBegin}
            style={{
              cursor: beginning ? "not-allowed" : "pointer",
              opacity: beginning ? 0.5 : 1,
              font: "600 13px var(--sans)",
              color: "var(--surface)",
              background: "var(--accent)",
              border: "0",
              borderRadius: "var(--radius-pill)",
              padding: "10px 22px",
            }}
          >
            {beginning ? "Beginning…" : "Begin gating (create 8 gates)"}
          </button>
        )}
      </div>

      {beginError && (
        <InlineAlert tone="danger" title="Gate setup stopped" focus>
          {beginError} No gate signature was added. The selected property is preserved.
        </InlineAlert>
      )}

      {propertyId && workspace === undefined && (
        <p style={{ color: "var(--sub)" }}>Loading gate workspace…</p>
      )}

      {propertyId && workspace === null && (
        <p style={{ color: "var(--sub)" }}>Property not found.</p>
      )}

      {propertyId && gates.length > 0 && (
        <>
          <StageRail
            label={`${selectedProperty?.name ?? "Property"} diligence gates`}
            stages={gates.map((gate) => ({
              id: gate.id,
              label: `Gate ${gate.gateNo}: ${gate.label}`,
              detail: gate.status === "passed"
                ? `Signed by ${gate.signerNames.join(", ")}`
                : gate.signerCount > 0
                  ? `${gate.remaining} distinct signature${gate.remaining === 1 ? "" : "s"} remaining`
                  : "Awaiting review",
              state: gate.status === "passed"
                ? "completed"
                : gate.status === "failed"
                  ? "blocked"
                  : gate.gateNo === nextGate?.gateNo
                    ? "current"
                    : "upcoming",
            }))}
          />
          <ActionSummary
            title="Gate ceremony"
            items={[
              { label: "Subject", value: selectedProperty?.name ?? "Selected property" },
              { label: "Current stage", value: allSigned ? "All diligence gates signed" : nextGate ? `Gate ${nextGate.gateNo}: ${nextGate.label}` : "Unavailable" },
              { label: "Consequence", value: "A signature permanently records a named human's evidence review" },
              { label: "Blocker", value: allSigned ? "None reported" : nextGate ? `${nextGate.remaining} required signature${nextGate.remaining === 1 ? "" : "s"} remaining on the current gate` : "Gate state unavailable" },
              { label: "Accountable", value: `${me.name} · gate signer` },
              { label: "Finality", value: "Permanent audit record; minting remains blocked until all gates pass" },
            ]}
            nextAction={allSigned ? "Proceed to mint review." : nextGate ? `Review cited evidence and sign Gate ${nextGate.gateNo}, or leave it unsigned if evidence is insufficient.` : "Wait for gate state to load."}
          />
          {allSigned && (
            <InlineAlert tone="success" title="Gate ceremony complete">
              Subject: {selectedProperty?.name ?? "Selected property"}. Named signers and timestamps are shown on each gate. The gate audit reference is unavailable in this query; use the audit log before mint review.
            </InlineAlert>
          )}
          {/* All-gates-signed advancement indicator. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-4)",
              marginBottom: "var(--space-5)",
              borderRadius: "var(--radius-md)",
              border: `1px solid ${allSigned ? "var(--gain)" : "var(--hairline-2)"}`,
              background: "var(--surface)",
            }}
          >
            <StatusChip
              status={allSigned ? "complete" : "pending"}
              label={allSigned ? "All 8 gates signed" : "Gates outstanding"}
            />
            <span style={{ color: "var(--sub)", fontSize: "13px", lineHeight: 1.5 }}>
              {allSigned
                ? "Every gate is human-signed — this property may advance to mint & listing."
                : "This property cannot advance to mint & listing until every gate is signed."}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {gates.map((g) => {
              const s = gateStatus(g);
              const pkgs = [
                ...(packagesByGate.get(g.gateNo) ?? []),
                ...(packagesByGate.get("any") ?? []),
              ];
              const err = gateError[g.gateNo];
              const isSigning = signing === g.gateNo;
              const hasGateEvidence = (packagesByGate.get(g.gateNo) ?? []).length > 0;
              return (
                <article
                  key={g.id}
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
                        Gate {g.gateNo}
                        {g.multiParty && " · Multi-party"}
                      </p>
                      <h2 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "19px", margin: "4px 0 0" }}>
                        {g.label}
                      </h2>
                    </div>
                    <StatusChip status={s.kind} label={s.label} />
                  </div>

                  {/* Signers so far (named humans; never a system). */}
                  <p style={{ color: "var(--sub)", fontSize: "13px", margin: "var(--space-3) 0 0" }}>
                    {g.signerCount === 0 ? (
                      <span style={{ color: "var(--muted)" }}>No signatures yet.</span>
                    ) : (
                      <>
                        Signed by {g.signerNames.join(", ")}
                        {" · "}
                        {g.signerCount}/{g.required} distinct signer{g.required === 1 ? "" : "s"}
                        {g.signedAt ? ` · ${fmt(g.signedAt)}` : ""}
                      </>
                    )}
                  </p>

                  {/* Assembled 2-2 evidence — fields + citations. Uncited fields are FLAGS, never facts. */}
                  {pkgs.length > 0 && (
                    <div style={{ margin: "var(--space-4) 0 0" }}>
                      <p style={{ color: "var(--muted)", font: "600 11px var(--sans)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px" }}>
                        Evidence (assembled — not an approval)
                      </p>
                      {pkgs.map((pkg) => (
                        <div key={pkg.id} style={{ marginBottom: "var(--space-3)" }}>
                          <p style={{ color: "var(--sub)", fontSize: "12px" }}>
                            Assembled by {pkg.assembledBy} · {fmt(pkg.assembledAt)}
                            {pkg.note ? ` · ${pkg.note}` : ""}
                          </p>
                          {pkg.fields.length === 0 ? (
                            <p style={{ color: "var(--muted)", fontSize: "12px" }}>No fields in this package.</p>
                          ) : (
                            <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "flex", flexDirection: "column", gap: "4px" }}>
                              {pkg.fields.map((f, i) => {
                                const uncited = f.status === "uncited" || !f.sourceRef;
                                return (
                                  <li key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                                    <span style={{ color: "var(--ink)", fontWeight: 500 }}>{f.field}:</span>
                                    <span style={uncited ? { color: "var(--muted)", fontStyle: "italic" } : { color: "var(--ink)" }}>
                                      {f.value}
                                    </span>
                                    {uncited ? (
                                      <StatusChip status="pending" label="Needs source" />
                                    ) : (
                                      <MonoData value={f.sourceRef!} label="source locator" />
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SoD / consequence error surfaced in loss-red, with the required distinct signer. */}
                  {err && (
                    <InlineAlert tone="danger" title={`Gate ${g.gateNo} signature stopped`} focus>
                      {err} No signature was recorded. Your selected property and evidence context are preserved.
                      {g.multiParty && " A distinct second human must provide the remaining signature."}
                    </InlineAlert>
                  )}

                  {/* The sign action — states the consequence before the signer commits. */}
                  {g.status !== "passed" && (
                    <div style={{ margin: "var(--space-4) 0 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" }}>
                      <button
                        type="button"
                        className="a-button a-button-primary"
                        disabled={isSigning || !hasGateEvidence}
                        onClick={() => onSign(g)}
                      >
                        {isSigning ? "Signing…" : hasGateEvidence ? `Sign Gate ${g.gateNo} as ${me.name}` : "Evidence package required"}
                      </button>
                      <span style={{ color: "var(--muted)", fontSize: "12px", lineHeight: 1.5, maxWidth: "60ch" }}>
                        Signing Gate {g.gateNo} attests you reviewed its evidence. It is attributed to you and
                        permanent in the audit log.
                        {g.multiParty && " This is a multi-party gate — it passes only once a distinct second human also signs."}
                      </span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
