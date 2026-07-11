"use client";

import { useCallback, useMemo, useState } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Id } from "vesper-app/convex/_generated/dataModel";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { Money } from "@/app/components/ui/Money";

// Admin Story 4.1 — the DISTRIBUTION BUILDER + matches-target. A `distribution.execute`-gated operator
// (ops_diligence; NOT platform_admin) turns a closed month's operator numbers into a DRAFT distribution:
// the gross→net waterfall (gross rent → operating costs → management fee INSIDE net, never re-charged →
// reserve → net-per-unit), and confirms the resulting net vs the offering's target yield BEFORE any money
// moves. This surface writes only `scheduled` incomeLedger rows — funding + the on-chain push are 4-2.
// The UI gate here is convenience; every Convex request independently re-enforces distribution.execute.

type PropertyRow = {
  id: string;
  name: string;
  location: string;
  units: number;
  targetNetYield: number;
  holders: number;
};

type Draft = {
  property: { id: string; name: string; status: string; units: number; targetNetYield: number };
  period: string;
  rowCount: number;
  scheduledCount: number;
  paidCount: number;
  totals: { grossShare: number; costs: number; mgmtFee: number; reserve: number; netPaid: number };
  netPerUnit: number;
  basis: number;
  impliedNetYield: number;
  variance: number;
  matchesTarget: boolean;
  reason: string | null;
};

const inputStyle: React.CSSProperties = {
  font: "500 13px var(--sans)",
  color: "var(--ink)",
  background: "var(--surface)",
  border: "1px solid var(--hairline-2)",
  borderRadius: "var(--radius-md)",
  padding: "8px 11px",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  font: "600 11px var(--sans)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

// The current distribution period ("YYYY-MM") in UTC — matches the server's periodFor.
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function matchChip(d: Draft): { status: StatusKind; label: string } {
  return d.matchesTarget
    ? { status: "passed", label: `Matches target ${pct(d.property.targetNetYield)}` }
    : { status: "pending", label: `Variance ${d.variance >= 0 ? "+" : "−"}${(Math.abs(d.variance) * 100).toFixed(2)}pp` };
}

export default function DistributionPage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canDistribute = !!me && me.permissions.includes("distribution.execute");

  const [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [grossRent, setGrossRent] = useState<string>("");
  const [costs, setCosts] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const properties = useQuery(
    api.distributionBuild.listDistributableProperties,
    canDistribute ? {} : "skip",
  );
  const draft = useQuery(
    api.distributionBuild.distributionDraft,
    canDistribute && selected && period
      ? { propertyId: selected as Id<"properties">, period }
      : "skip",
  ) as Draft | null | undefined;

  const build = useMutation(api.distributionBuild.buildDistribution);

  const selectedProp = useMemo(
    () => (properties ?? []).find((p) => p.id === selected) ?? null,
    [properties, selected],
  );

  const grossNum = Number(grossRent);
  const costsNum = Number(costs || "0");
  const netPool = Number.isFinite(grossNum) && Number.isFinite(costsNum)
    ? Math.max(0, Math.round((grossNum - costsNum) * 100) / 100)
    : 0;
  const canBuild = !!selected && !!period && grossRent.trim() !== "" && grossNum > 0 && !busy;

  const onBuild = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await build({
        propertyId: selected as Id<"properties">,
        period,
        grossRentDollars: grossNum,
        costsDollars: costsNum,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Build blocked.");
    } finally {
      setBusy(false);
    }
  }, [build, selected, period, grossNum, costsNum]);

  if (authLoading || me === undefined) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  if (!canDistribute) {
    return (
      <section style={{ padding: "var(--space-8)", maxWidth: "50ch" }}>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
          Not permitted
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          Building a distribution requires the <code>distribution.execute</code> permission, held by ops
          diligence. Platform Admins deliberately hold no operational power and cannot build distributions.
          Ask a Platform Admin if you need distribution access.
        </p>
      </section>
    );
  }

  const rows = (properties ?? []) as PropertyRow[];

  return (
    <section style={{ padding: "var(--space-6)" }}>
      <header style={{ marginBottom: "var(--space-5)" }}>
        <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Distribution
        </p>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-1)" }}>
          Distribution builder
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "76ch", lineHeight: 1.6 }}>
          Turn a closed month&apos;s operator numbers into a <strong>draft</strong> distribution — the
          gross→net waterfall (gross rent → operating costs → <strong>management fee, already inside net</strong>{" "}
          → reserve → net-per-unit) — and confirm the net matches the offering&apos;s target yield before
          any money moves. This builds only a scheduled draft; funding and the on-chain push happen
          separately. Every build is attributed to you in the audit log.
        </p>
      </header>

      {/* PROPERTY PICKER — listed (open) properties WITH holders (the only ones distributable against). */}
      <div style={{ marginBottom: "var(--space-5)" }}>
        <p style={{ ...labelStyle, marginBottom: "var(--space-2)" }}>Property</p>
        {properties === undefined && <p style={{ color: "var(--sub)" }}>Loading properties…</p>}
        {properties !== undefined && rows.length === 0 && (
          <p style={{ color: "var(--sub)" }}>
            No distributable properties — a distribution needs a listed (open) offering with holders.
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
          {rows.map((p) => {
            const on = p.id === selected;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelected(p.id);
                  setError(null);
                }}
                style={{
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "var(--space-3) var(--space-4)",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${on ? "var(--accent)" : "var(--hairline-2)"}`,
                  background: on ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--surface)",
                  minWidth: "22ch",
                }}
              >
                <span style={{ display: "block", fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "16px" }}>
                  {p.name}
                </span>
                <span style={{ display: "block", color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
                  {p.location} · {p.holders} holder{p.holders === 1 ? "" : "s"} · target {pct(p.targetNetYield)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div
          style={{
            padding: "var(--space-5)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--hairline-2)",
            background: "var(--surface)",
          }}
        >
          {/* OPERATOR NUMBERS — period + gross rent + operating costs → net pool. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "flex-end" }}>
            <label style={labelStyle}>
              Period (YYYY-MM)
              <input
                style={{ ...inputStyle, width: "12ch" }}
                value={period}
                onChange={(e) => setPeriod(e.target.value.trim())}
                placeholder="2026-07"
              />
            </label>
            <label style={labelStyle}>
              Gross rent (USD)
              <input
                style={{ ...inputStyle, width: "14ch" }}
                type="number"
                min={0}
                value={grossRent}
                onChange={(e) => setGrossRent(e.target.value)}
                placeholder="0"
              />
            </label>
            <label style={labelStyle}>
              Operating costs (USD)
              <input
                style={{ ...inputStyle, width: "14ch" }}
                type="number"
                min={0}
                value={costs}
                onChange={(e) => setCosts(e.target.value)}
                placeholder="0"
              />
            </label>
            <div style={{ ...labelStyle }}>
              Net pool
              <span style={{ font: "600 15px var(--sans)", color: "var(--ink)", textTransform: "none", letterSpacing: 0 }}>
                <Money value={netPool} />
              </span>
            </div>
            <button
              type="button"
              disabled={!canBuild}
              onClick={onBuild}
              style={{
                cursor: canBuild ? "pointer" : "not-allowed",
                opacity: canBuild ? 1 : 0.5,
                font: "600 13px var(--sans)",
                color: "var(--surface)",
                background: "var(--accent)",
                border: "0",
                borderRadius: "var(--radius-pill)",
                padding: "10px 22px",
              }}
            >
              {busy ? "Building…" : draft && draft.rowCount > 0 ? "Rebuild draft" : "Build draft"}
            </button>
          </div>

          <p style={{ color: "var(--muted)", fontSize: "12px", lineHeight: 1.5, margin: "var(--space-3) 0 0", maxWidth: "80ch" }}>
            The net pool is gross rent minus operating costs. The management fee is already{" "}
            <strong>inside</strong> each holder&apos;s net share (it is not charged again against the pool).
            Rebuilding the same period updates the draft in place — it never duplicates or double-counts.
          </p>

          {error && (
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
              Blocked: {error}
            </p>
          )}

          {/* DRAFT WATERFALL — the reused gross→net split over the scheduled rows + matches-target. */}
          {draft && draft.rowCount > 0 && (
            <div style={{ margin: "var(--space-5) 0 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
                <p style={{ color: "var(--muted)", font: "600 11px var(--sans)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Draft waterfall · {draft.period} · {draft.rowCount} holder{draft.rowCount === 1 ? "" : "s"}
                  {draft.paidCount > 0 ? ` · ${draft.paidCount} already paid` : ""}
                </p>
                <StatusChip {...matchChip(draft)} />
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", font: "500 13px var(--sans)" }}>
                <tbody>
                  <WaterfallRow label="Gross rent share" value={draft.totals.grossShare} strong />
                  <WaterfallRow label="Operating costs" value={-draft.totals.costs} />
                  <WaterfallRow label="Management fee (inside net)" value={-draft.totals.mgmtFee} note="already inside net — not re-charged" />
                  <WaterfallRow label="Reserve" value={-draft.totals.reserve} />
                  <WaterfallRow label="Net distributed" value={draft.totals.netPaid} strong divider />
                </tbody>
              </table>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-5)", margin: "var(--space-4) 0 0", color: "var(--sub)", fontSize: "13px" }}>
                <span>
                  Net per unit: <strong style={{ color: "var(--ink)" }}><Money value={draft.netPerUnit} /></strong>
                </span>
                <span>
                  Implied net yield: <strong style={{ color: "var(--ink)" }}>{pct(draft.impliedNetYield)}</strong>
                </span>
                <span>
                  Target: <strong style={{ color: "var(--ink)" }}>{pct(draft.property.targetNetYield)}</strong>
                </span>
                <span>
                  Invested basis: <strong style={{ color: "var(--ink)" }}><Money value={draft.basis} /></strong>
                </span>
              </div>

              {!draft.matchesTarget && draft.reason && (
                <p
                  style={{
                    margin: "var(--space-3) 0 0",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--warning)",
                    color: "var(--ink)",
                    background: "color-mix(in srgb, var(--warning) 8%, transparent)",
                    fontSize: "13px",
                    lineHeight: 1.5,
                    maxWidth: "80ch",
                  }}
                >
                  Target variance — acknowledge before proceeding: {draft.reason} The draft is saved; the
                  push gate (funding + on-chain) is a separate, later step.
                </p>
              )}
            </div>
          )}

          {draft !== undefined && draft?.rowCount === 0 && !busy && (
            <p style={{ color: "var(--sub)", fontSize: "13px", margin: "var(--space-4) 0 0" }}>
              No draft yet for {selectedProp?.name ?? "this property"} · {period}. Enter the month&apos;s
              gross rent and operating costs, then build the draft.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// One waterfall line — label + a right-aligned signed dollar amount. `strong` bolds the anchor lines
// (gross / net); `divider` draws the hairline above the net total; `note` annotates the mgmt-fee line.
function WaterfallRow({
  label,
  value,
  strong,
  divider,
  note,
}: {
  label: string;
  value: number;
  strong?: boolean;
  divider?: boolean;
  note?: string;
}) {
  return (
    <tr style={{ borderTop: divider ? "1px solid var(--hairline-2)" : undefined }}>
      <td style={{ padding: "8px 0", color: strong ? "var(--ink)" : "var(--sub)", fontWeight: strong ? 600 : 500 }}>
        {label}
        {note && (
          <span style={{ display: "block", color: "var(--muted)", fontSize: "11px", fontWeight: 400 }}>{note}</span>
        )}
      </td>
      <td style={{ padding: "8px 0", textAlign: "right", color: strong ? "var(--ink)" : "var(--sub)", fontWeight: strong ? 600 : 500 }}>
        <Money value={value} signed={value < 0} />
      </td>
    </tr>
  );
}
