"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Id } from "vesper-app/convex/_generated/dataModel";
import { DataTable, type Column } from "@/app/components/ui/DataTable";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { MonoData } from "@/app/components/ui/MonoData";
import { DecisionPanel } from "@/app/components/ui/DecisionPanel";

// Story 2.1 + 2.2 — the ai.review reviewer's AI-extraction surface. It is a READ + human-review view
// over the extraction engine: permission-gated (ai.review) here in the UI AND independently on every
// Convex request. This surface can start a run, read fields, VERIFY or REJECT a field, and ASSEMBLE the
// verified set into an evidence package — but it has NO approve/sign/mint control. The AI never approves;
// the reviewer never signs. An assembled package is explicitly labelled a hand-off "pending a human
// signer (not an approval)". CITE-OR-REFUSE is honored at render: an uncited field is shown flagged as
// "Needs source" and NEVER as an established value.

type FieldRow = {
  id: string;
  runId: string;
  docId: string;
  field: string;
  value: string;
  sourceRef: string | null;
  confidence: number;
  status: "extracted" | "uncited" | "rejected" | "verified";
  reviewNote: string | null;
  needsSource: boolean;
};

type PackageRow = {
  id: string;
  gateNo: number | null;
  fieldCount: number;
  status: "assembled";
  assembledBy: string;
  assembledAt: number;
  note: string | null;
};

type RunRow = {
  id: string;
  status: "running" | "complete" | "failed";
  model: string;
  createdBy: string;
  createdAt: number;
};

type DiligenceDecision =
  | { kind: "field"; outcome: "verify" | "reject"; row: FieldRow }
  | { kind: "assemble"; fieldIds: string[] };

function statusForField(row: FieldRow): { kind: StatusKind; label: string } {
  if (row.status === "rejected") return { kind: "blocked", label: "Rejected" };
  if (row.status === "verified") return { kind: "complete", label: "Verified" };
  if (row.status === "uncited")
    return { kind: "pending", label: "Needs source" };
  return { kind: "passed", label: "Cited" };
}

function statusForRun(status: RunRow["status"]): {
  kind: StatusKind;
  label: string;
} {
  if (status === "failed") return { kind: "blocked", label: "Failed" };
  if (status === "running") return { kind: "pending", label: "Running" };
  return { kind: "passed", label: "Complete" };
}

function fmtTimestamp(ms: number): string {
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
  minWidth: "28ch",
};

export default function DiligencePage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canReview = !!me && me.permissions.includes("ai.review");

  const [propertyId, setPropertyId] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [decision, setDecision] = useState<DiligenceDecision | null>(null);
  const decisionOrigin = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("propertyId");
    const frame = requested ? requestAnimationFrame(() => setPropertyId(requested)) : null;
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, []);

  const properties = useQuery(
    api.diligenceQueries.listReviewableProperties,
    canReview ? {} : "skip",
  );
  const runs = useQuery(
    api.diligenceQueries.listExtractionRuns,
    canReview && propertyId
      ? { propertyId: propertyId as Id<"properties"> }
      : "skip",
  );
  const fields = useQuery(
    api.diligenceQueries.listExtractedFields,
    canReview && propertyId
      ? { propertyId: propertyId as Id<"properties"> }
      : "skip",
  );
  const packages = useQuery(
    api.diligenceEvidence.listEvidencePackages,
    canReview && propertyId
      ? { propertyId: propertyId as Id<"properties"> }
      : "skip",
  );

  const startExtraction = useMutation(api.diligenceExtract.startExtraction);
  const rejectField = useMutation(api.diligenceExtract.rejectExtractedField);
  const verifyField = useMutation(api.diligenceExtract.verifyExtractedField);
  const assemblePackage = useMutation(
    api.diligenceEvidence.assembleEvidencePackage,
  );

  const onStart = async () => {
    if (!propertyId) return;
    setStarting(true);
    try {
      await startExtraction({ propertyId: propertyId as Id<"properties"> });
    } finally {
      setStarting(false);
    }
  };

  const openDecision = useCallback(
    (next: DiligenceDecision, origin: HTMLButtonElement) => {
      decisionOrigin.current = origin;
      setDecision(next);
    },
    [],
  );

  const closeDecision = useCallback(() => {
    setDecision(null);
    requestAnimationFrame(() => decisionOrigin.current?.focus());
  }, []);

  // The verified fields are the ONLY ones assemble accepts — the button and the mutation agree.
  const verifiedFieldIds = useMemo(
    () =>
      ((fields ?? []) as FieldRow[])
        .filter((f) => f.status === "verified")
        .map((f) => f.id),
    [fields],
  );

  const confirmDecision = useCallback(
    async (rationale: string) => {
      if (!decision) return;
      if (decision.kind === "field") {
        const args = {
          fieldId: decision.row.id as Id<"extractedFields">,
          note: rationale || undefined,
        };
        if (decision.outcome === "verify") await verifyField(args);
        else await rejectField({ ...args, note: rationale });
      } else {
        if (!propertyId)
          throw new Error(
            "Select a property before assembling an evidence package.",
          );
        await assemblePackage({
          propertyId: propertyId as Id<"properties">,
          fieldIds: decision.fieldIds as Id<"extractedFields">[],
          note: rationale || undefined,
        });
      }
      closeDecision();
    },
    [
      assemblePackage,
      closeDecision,
      decision,
      propertyId,
      rejectField,
      verifyField,
    ],
  );

  const fieldColumns = useMemo<Column<FieldRow>[]>(
    () => [
      {
        key: "field",
        header: "Field",
        render: (r) => (
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>
            {r.field}
          </span>
        ),
      },
      {
        key: "value",
        header: "Value",
        render: (r) =>
          // An uncited field is NEVER rendered as an established value — it is muted + italicized and
          // paired with the "Needs source" chip. Only a cited field reads as a plain fact.
          r.needsSource ? (
            <span
              style={{ color: "var(--muted)", fontStyle: "italic" }}
              title="Unverified — needs a source"
            >
              {r.value}
            </span>
          ) : (
            <span style={{ color: "var(--ink)" }}>{r.value}</span>
          ),
      },
      {
        key: "source",
        header: "Source",
        render: (r) =>
          r.sourceRef ? (
            <MonoData value={r.sourceRef} label="source locator" />
          ) : (
            <span style={{ color: "var(--muted)" }} aria-label="no source">
              — no source
            </span>
          ),
      },
      {
        key: "confidence",
        header: "Confidence",
        align: "num",
        render: (r) => (
          <span
            style={{ color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}
          >
            {(r.confidence * 100).toFixed(0)}%
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (r) => {
          const s = statusForField(r);
          return (
            <StatusChip
              status={s.kind}
              label={s.label}
              title={r.reviewNote ?? undefined}
            />
          );
        },
      },
      {
        key: "action",
        header: "",
        align: "num",
        render: (r) => {
          // Terminal, human-set states render their note, not an action.
          if (r.status === "rejected") {
            return (
              <span style={{ color: "var(--muted)" }}>
                {r.reviewNote ?? "rejected"}
              </span>
            );
          }
          if (r.status === "verified") {
            return (
              <span style={{ color: "var(--muted)" }}>
                {r.reviewNote ?? "verified"}
              </span>
            );
          }
          const busy = decision !== null;
          return (
            <span
              style={{
                display: "inline-flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              {/* Only a CITED (extracted) field can be verified — an uncited field lacks a source. */}
              {r.status === "extracted" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(event) =>
                    openDecision(
                      { kind: "field", outcome: "verify", row: r },
                      event.currentTarget,
                    )
                  }
                  style={{
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.5 : 1,
                    font: "600 12px var(--sans)",
                    color: "var(--gain)",
                    background: "var(--surface)",
                    border: "1px solid var(--gain)",
                    borderRadius: "var(--radius-pill)",
                    padding: "6px 14px",
                    minHeight: "44px",
                  }}
                >
                  Verify
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={(event) =>
                  openDecision(
                    { kind: "field", outcome: "reject", row: r },
                    event.currentTarget,
                  )
                }
                style={{
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.5 : 1,
                  font: "600 12px var(--sans)",
                  color: "var(--loss)",
                  background: "var(--surface)",
                  border: "1px solid var(--loss)",
                  borderRadius: "var(--radius-pill)",
                  padding: "6px 14px",
                  minHeight: "44px",
                }}
              >
                Reject
              </button>
            </span>
          );
        },
      },
    ],
    [decision, openDecision],
  );

  const runColumns = useMemo<Column<RunRow>[]>(
    () => [
      {
        key: "createdAt",
        header: "Started",
        render: (r) => (
          <span style={{ color: "var(--sub)", fontSize: "13px" }}>
            {fmtTimestamp(r.createdAt)}
          </span>
        ),
      },
      {
        key: "createdBy",
        header: "By",
        render: (r) => (
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>
            {r.createdBy}
          </span>
        ),
      },
      {
        key: "model",
        header: "Model",
        render: (r) => (
          <code style={{ font: "500 12px var(--sans)", color: "var(--sub)" }}>
            {r.model}
          </code>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (r) => {
          const s = statusForRun(r.status);
          return <StatusChip status={s.kind} label={s.label} />;
        },
      },
    ],
    [],
  );

  const packageColumns = useMemo<Column<PackageRow>[]>(
    () => [
      {
        key: "assembledAt",
        header: "Assembled",
        render: (r) => (
          <span style={{ color: "var(--sub)", fontSize: "13px" }}>
            {fmtTimestamp(r.assembledAt)}
          </span>
        ),
      },
      {
        key: "assembledBy",
        header: "By",
        render: (r) => (
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>
            {r.assembledBy}
          </span>
        ),
      },
      {
        key: "gateNo",
        header: "Gate",
        render: (r) => (
          <span style={{ color: "var(--sub)" }}>
            {r.gateNo === null ? "—" : `Gate ${r.gateNo}`}
          </span>
        ),
      },
      {
        key: "fieldCount",
        header: "Fields",
        align: "num",
        render: (r) => (
          <span
            style={{ color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}
          >
            {r.fieldCount}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        // A package is a HAND-OFF, not an approval — the chip and its title say so explicitly.
        render: () => (
          <StatusChip
            status="pending"
            label="Assembled — pending a human signer (not an approval)"
            title="Assembly confers nothing. A human signer (Gate ceremony) acts on this evidence later."
          />
        ),
      },
      {
        key: "note",
        header: "Note",
        render: (r) => (
          <span style={{ color: "var(--muted)" }}>{r.note ?? "—"}</span>
        ),
      },
    ],
    [],
  );

  if (authLoading || me === undefined) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "grid",
          placeItems: "center",
          color: "var(--sub)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (!canReview) {
    return (
      <section style={{ padding: "var(--space-8)", maxWidth: "48ch" }}>
        <h1
          style={{
            fontFamily: "var(--serif)",
            color: "var(--ink)",
            fontSize: "24px",
            marginBottom: "var(--space-3)",
          }}
        >
          Not permitted
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          Reviewing AI extraction requires the <code>ai.review</code>{" "}
          permission. AI review is advisory — it never approves a gate. Ask a
          Platform Admin if you need reviewer access.
        </p>
      </section>
    );
  }

  const fieldRows = (fields ?? []) as FieldRow[];
  const runRows = (runs ?? []) as RunRow[];
  const selectedProperty = (properties ?? []).find(
    (property) => property.id === propertyId,
  );
  const accountableReviewer = `${me.name} · ${me.roles.join(", ") || "No assigned role"}`;

  return (
    <section style={{ padding: "var(--space-6)" }}>
      <header style={{ marginBottom: "var(--space-5)" }}>
        <p
          style={{
            color: "var(--sub)",
            fontSize: "13px",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Property review
        </p>
        <h1
          style={{
            fontFamily: "var(--serif)",
            color: "var(--ink)",
            fontSize: "28px",
            margin: "var(--space-2) 0 var(--space-1)",
          }}
        >
          Review document evidence
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "72ch", lineHeight: 1.6 }}>
          AI finds facts in the property documents and shows the source for each one. You decide
          whether the evidence supports the fact. Verified evidence is then prepared for a separate
          human signer; reviewing this page never approves the property.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-4)",
          alignItems: "flex-end",
          marginBottom: "var(--space-5)",
        }}
      >
        <label style={labelStyle}>
          Property
          <select
            style={selectStyle}
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
          >
            <option value="">Select a property…</option>
            {(properties ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.status})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!propertyId || starting}
          onClick={onStart}
          style={{
            cursor: !propertyId || starting ? "not-allowed" : "pointer",
            opacity: !propertyId || starting ? 0.5 : 1,
            font: "600 13px var(--sans)",
            color: "var(--surface)",
            background: "var(--accent)",
            border: "0",
            borderRadius: "var(--radius-pill)",
            padding: "10px 22px",
            minHeight: "44px",
          }}
        >
          {starting ? "Starting…" : "Run extraction"}
        </button>
      </div>

      {propertyId && (
        <>
          <div style={{ marginBottom: "var(--space-6)" }}>
            <DataTable<RunRow>
              columns={runColumns}
              rows={runRows}
              rowKey={(r) => r.id}
              caption="Extraction runs"
              subCaption={`${runRows.length} run${runRows.length === 1 ? "" : "s"}`}
              showDensityToggle={false}
              emptyLabel={
                runs === undefined
                  ? "Loading…"
                  : "No runs yet — run extraction to begin."
              }
            />
          </div>

          <DataTable<FieldRow>
            columns={fieldColumns}
            rows={fieldRows}
            rowKey={(r) => r.id}
            caption="Extracted fields"
            subCaption={`${fieldRows.length} field${fieldRows.length === 1 ? "" : "s"} · uncited fields need a source before they are facts`}
            emptyLabel={
              fields === undefined
                ? "Loading…"
                : "No extracted fields for this property yet."
            }
          />

          {decision?.kind === "field" && (
            <DecisionPanel
              key={`${decision.outcome}-${decision.row.id}`}
              title={`${decision.outcome === "verify" ? "Verify" : "Reject"}: ${decision.row.field}`}
              subject={`${decision.row.field} · ${selectedProperty?.name ?? `property ${propertyId}`}`}
              facts={[
                { label: "Extracted value", value: decision.row.value },
                {
                  label: "Source evidence",
                  value: decision.row.sourceRef ?? "No source is recorded",
                },
                {
                  label: "Confidence",
                  value: `${(decision.row.confidence * 100).toFixed(0)}%`,
                },
                {
                  label: "Current status",
                  value: statusForField(decision.row).label,
                },
              ]}
              accountableRole={accountableReviewer}
              consequence={
                decision.outcome === "verify"
                  ? "Marks this extracted value as human-verified against its cited source, making it eligible for evidence-package assembly."
                  : "Rejects this extracted value and excludes it from evidence-package assembly."
              }
              nextAction={
                decision.outcome === "verify"
                  ? "After recording, include the field only in a reviewed evidence package; verification is not gate approval."
                  : "Correct the source data or run extraction again before reconsidering this field."
              }
              rationaleLabel={
                decision.outcome === "verify"
                  ? "Verification note"
                  : "Rejection rationale"
              }
              rationaleRequired={decision.outcome === "reject"}
              confirmLabel={
                decision.outcome === "verify"
                  ? "Record verification"
                  : "Record rejection"
              }
              tone={decision.outcome === "verify" ? "approve" : "block"}
              onConfirm={confirmDecision}
              onCancel={closeDecision}
            />
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "var(--space-3)",
              margin: "var(--space-5) 0 var(--space-6)",
            }}
          >
            <button
              type="button"
              disabled={verifiedFieldIds.length === 0 || decision !== null}
              onClick={(event) =>
                openDecision(
                  { kind: "assemble", fieldIds: [...verifiedFieldIds] },
                  event.currentTarget,
                )
              }
              style={{
                cursor:
                  verifiedFieldIds.length === 0 || decision !== null
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  verifiedFieldIds.length === 0 || decision !== null ? 0.5 : 1,
                font: "600 13px var(--sans)",
                color: "var(--surface)",
                background: "var(--accent)",
                border: "0",
                borderRadius: "var(--radius-pill)",
                padding: "10px 22px",
                minHeight: "44px",
              }}
            >
              {`Review package (${verifiedFieldIds.length} verified)`}
            </button>
            <span
              style={{
                color: "var(--muted)",
                fontSize: "13px",
                lineHeight: 1.5,
                maxWidth: "60ch",
              }}
            >
              Assembly gathers the verified fields into a package for a human
              signer. It is a hand-off, not an approval — the reviewer never
              signs.
            </span>
          </div>

          {decision?.kind === "assemble" && (
            <DecisionPanel
              key={`assemble-${propertyId}-${decision.fieldIds.join("-")}`}
              title="Assemble evidence package"
              subject={selectedProperty?.name ?? `Property ${propertyId}`}
              facts={[
                {
                  label: "Verified evidence",
                  value: `${decision.fieldIds.length} field${decision.fieldIds.length === 1 ? "" : "s"}`,
                },
                {
                  label: "Property status",
                  value: selectedProperty?.status ?? "Unavailable",
                },
                {
                  label: "Approval authority",
                  value:
                    "None. Assembly is a hand-off to a separate human signer.",
                },
              ]}
              accountableRole={accountableReviewer}
              consequence="Creates a fixed evidence package from the currently verified fields. It does not approve a gate or authorize a mint."
              nextAction="Review the assembled package, then hand it to an authorized gate signer for an independent decision."
              rationaleLabel="Package note"
              confirmLabel="Assemble package"
              tone="neutral"
              onConfirm={confirmDecision}
              onCancel={closeDecision}
            />
          )}

          <DataTable<PackageRow>
            columns={packageColumns}
            rows={(packages ?? []) as PackageRow[]}
            rowKey={(r) => r.id}
            caption="Evidence packages"
            subCaption="Assembled — pending a human signer (not an approval)"
            showDensityToggle={false}
            emptyLabel={
              packages === undefined
                ? "Loading…"
                : "No evidence packages assembled for this property yet."
            }
          />
        </>
      )}
    </section>
  );
}
