"use client";

import { useCallback, useMemo, useState } from "react";
import { useConvexAuth, useQuery, useMutation, useAction } from "convex/react";
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

type PauseReason = "insufficient_cash_flow" | "missing_operator_numbers" | "other";

type PayStatus = {
  period: string;
  mint: string | null;
  rowCount: number;
  scheduledCount: number;
  pushedCount: number;
  paidCount: number;
  missedCount: number;
  pauseReason: PauseReason | null;
  pauseNote: string | null;
  netTotal: number;
  escrow:
    | { funded: true; fundedAmount: number; custodyRef: string; fundedBy: string; fundedAt: number }
    | { funded: false };
};

// The structured pause reasons (mirrors the incomeLedger.pauseReason union) with human labels for the
// reason picker + the status view. A pause is NEVER silent — the operator must pick one.
const PAUSE_REASONS: { value: PauseReason; label: string }[] = [
  { value: "insufficient_cash_flow", label: "Insufficient cash flow" },
  { value: "missing_operator_numbers", label: "Missing operator numbers" },
  { value: "other", label: "Other" },
];

function pauseReasonLabel(r: PauseReason | null): string {
  return PAUSE_REASONS.find((x) => x.value === r)?.label ?? "Paused";
}

// The at-a-glance lifecycle status for the period, driven off the pay-status counts: paid → pushed →
// paused (missed-with-reason) → scheduled → none.
function lifecycle(s: PayStatus | null | undefined): { status: StatusKind; label: string } {
  if (!s || s.rowCount === 0) return { status: "draft", label: "No draft" };
  if (s.paidCount > 0 && s.paidCount === s.rowCount) return { status: "complete", label: "Paid · reconciled" };
  if (s.missedCount > 0) return { status: "blocked", label: `Paused · ${pauseReasonLabel(s.pauseReason)}` };
  if (s.pushedCount > 0) return { status: "onchain", label: "Pushed · awaiting reconcile" };
  if (s.scheduledCount > 0) return { status: "pending", label: "Scheduled" };
  return { status: "draft", label: "Draft" };
}

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

  const payStatus = useQuery(
    api.distributionPay.distributionPayStatus,
    canDistribute && selected && period
      ? { propertyId: selected as Id<"properties">, period }
      : "skip",
  ) as PayStatus | null | undefined;

  const build = useMutation(api.distributionBuild.buildDistribution);
  const fundEscrow = useMutation(api.distributionPay.fundDistributionEscrow);
  const pushDist = useAction(api.distributionPay.pushDistribution);
  const confirmDist = useMutation(api.distributionPay.confirmDistributionStub);
  const pauseDist = useMutation(api.distributionPay.pauseDistribution);
  const resumeDist = useMutation(api.distributionPay.resumeDistribution);

  // The pay-lane action state (fund / push / confirm / pause / resume) is separate from the build state so
  // a push error never clears a build error and vice-versa.
  const [payBusy, setPayBusy] = useState<null | "fund" | "push" | "confirm" | "pause" | "resume">(null);
  const [payError, setPayError] = useState<string | null>(null);
  // The push is IRREVERSIBLE — it must state consequence + cost + finality and demand an explicit
  // confirm before firing (the server independently re-enforces step-up).
  const [pushArming, setPushArming] = useState(false);
  // The pause reason picker (4-3) — a pause is NEVER silent; the operator must pick a structured reason.
  const [pauseArming, setPauseArming] = useState(false);
  const [pauseReason, setPauseReason] = useState<PauseReason>("insufficient_cash_flow");
  const [pauseNote, setPauseNote] = useState("");

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

  const onFund = useCallback(async () => {
    if (!selected) return;
    setPayBusy("fund");
    setPayError(null);
    try {
      await fundEscrow({ propertyId: selected as Id<"properties">, period });
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Funding blocked.");
    } finally {
      setPayBusy(null);
    }
  }, [fundEscrow, selected, period]);

  const onPush = useCallback(async () => {
    if (!selected) return;
    setPayBusy("push");
    setPayError(null);
    try {
      await pushDist({ propertyId: selected as Id<"properties">, period });
      setPushArming(false);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Push blocked.");
    } finally {
      setPayBusy(null);
    }
  }, [pushDist, selected, period]);

  const onConfirm = useCallback(async () => {
    if (!selected) return;
    setPayBusy("confirm");
    setPayError(null);
    try {
      await confirmDist({ propertyId: selected as Id<"properties">, period });
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Confirm blocked.");
    } finally {
      setPayBusy(null);
    }
  }, [confirmDist, selected, period]);

  const onPause = useCallback(async () => {
    if (!selected) return;
    setPayBusy("pause");
    setPayError(null);
    try {
      await pauseDist({
        propertyId: selected as Id<"properties">,
        period,
        reason: pauseReason,
        note: pauseNote.trim() === "" ? undefined : pauseNote.trim(),
      });
      setPauseArming(false);
      setPauseNote("");
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Pause blocked.");
    } finally {
      setPayBusy(null);
    }
  }, [pauseDist, selected, period, pauseReason, pauseNote]);

  const onResume = useCallback(async () => {
    if (!selected) return;
    setPayBusy("resume");
    setPayError(null);
    try {
      await resumeDist({ propertyId: selected as Id<"properties">, period });
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Resume blocked.");
    } finally {
      setPayBusy(null);
    }
  }, [resumeDist, selected, period]);

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

          {/* STATUS VIEW (4-3) — the period's lifecycle at a glance (scheduled / pushed / paid /
              paused-with-reason). Reconciliation status is read from the same pay-status counts. */}
          {draft && draft.rowCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", margin: "var(--space-5) 0 0" }}>
              <p style={{ color: "var(--muted)", font: "600 11px var(--sans)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Status · {period}
              </p>
              <StatusChip {...lifecycle(payStatus)} />
            </div>
          )}

          {/* PAUSED-WITH-REASON (4-3) — a paused period's rows are `missed` carrying a structured reason
              that feeds the consumer's "why paused" income state. It CANNOT be pushed until resumed. */}
          {selected && (payStatus?.missedCount ?? 0) > 0 && (
            <div
              style={{
                margin: "var(--space-5) 0 0",
                padding: "var(--space-5)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--warning)",
                background: "color-mix(in srgb, var(--warning) 8%, var(--surface))",
              }}
            >
              <p style={{ color: "var(--muted)", font: "600 11px var(--sans)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "var(--space-2)" }}>
                Paused · {period}
              </p>
              <p style={{ color: "var(--ink)", fontSize: "14px", lineHeight: 1.5, fontWeight: 600 }}>
                {pauseReasonLabel(payStatus?.pauseReason ?? null)}
              </p>
              {payStatus?.pauseNote && (
                <p style={{ color: "var(--sub)", fontSize: "13px", lineHeight: 1.5, marginTop: "var(--space-1)" }}>
                  {payStatus.pauseNote}
                </p>
              )}
              <p style={{ color: "var(--sub)", fontSize: "12px", lineHeight: 1.5, margin: "var(--space-2) 0 var(--space-3)", maxWidth: "76ch" }}>
                Owners see this reason on their Income view — the distribution is never silently withheld.
                Resume once the blocker clears to make the period pushable again.
              </p>
              <button
                type="button"
                disabled={payBusy !== null}
                onClick={onResume}
                style={{
                  cursor: payBusy !== null ? "not-allowed" : "pointer",
                  opacity: payBusy !== null ? 0.5 : 1,
                  font: "600 13px var(--sans)",
                  color: "var(--surface)",
                  background: "var(--accent)",
                  border: "0",
                  borderRadius: "var(--radius-pill)",
                  padding: "10px 22px",
                }}
              >
                {payBusy === "resume" ? "Resuming…" : "Resume distribution"}
              </button>
              {payError && (
                <p
                  role="alert"
                  style={{
                    margin: "var(--space-3) 0 0",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--loss)",
                    color: "var(--loss)",
                    background: "color-mix(in srgb, var(--loss) 8%, transparent)",
                    fontSize: "13px",
                    lineHeight: 1.5,
                  }}
                >
                  Blocked: {payError}
                </p>
              )}
            </div>
          )}

          {/* FUND + PUSH LANE (4-2) — fund the escrow (B1 custody stub), then push on-chain behind a
              step-up re-auth stating the irreversible consequence + cost. The paid flip is owned by
              reconcile — the push only records signatures; Convex never self-settles. */}
          {draft && draft.rowCount > 0 && draft.scheduledCount > 0 && (
            <div
              style={{
                margin: "var(--space-5) 0 0",
                padding: "var(--space-5)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--hairline-2)",
                background: "color-mix(in srgb, var(--accent) 3%, var(--surface))",
              }}
            >
              <p style={{ color: "var(--muted)", font: "600 11px var(--sans)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "var(--space-3)" }}>
                Fund &amp; push · {draft.period}
              </p>

              {/* PAY-STATUS VIEW — escrow / pushed / paid at a glance. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-5)", marginBottom: "var(--space-4)", fontSize: "13px", color: "var(--sub)" }}>
                <span>
                  Escrow:{" "}
                  <strong style={{ color: payStatus?.escrow.funded ? "var(--gain)" : "var(--ink)" }}>
                    {payStatus === undefined
                      ? "…"
                      : payStatus?.escrow.funded
                        ? <>funded · <Money value={payStatus.escrow.fundedAmount} /></>
                        : "not funded"}
                  </strong>
                </span>
                <span>
                  Pushed: <strong style={{ color: "var(--ink)" }}>{payStatus?.pushedCount ?? 0}</strong> / {draft.rowCount}
                </span>
                <span>
                  Paid: <strong style={{ color: "var(--ink)" }}>{payStatus?.paidCount ?? 0}</strong> / {draft.rowCount}
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", alignItems: "center" }}>
                {/* FUND — the B1 custody stub. Idempotent (re-fund updates in place). */}
                <button
                  type="button"
                  disabled={payBusy !== null}
                  onClick={onFund}
                  style={{
                    cursor: payBusy !== null ? "not-allowed" : "pointer",
                    opacity: payBusy !== null ? 0.5 : 1,
                    font: "600 13px var(--sans)",
                    color: "var(--ink)",
                    background: "var(--surface)",
                    border: "1px solid var(--hairline-2)",
                    borderRadius: "var(--radius-pill)",
                    padding: "10px 20px",
                  }}
                >
                  {payBusy === "fund" ? "Funding…" : payStatus?.escrow.funded ? "Re-fund escrow" : "Fund escrow"}
                </button>

                {/* PUSH — irreversible. Arms a confirmation stating consequence + cost + finality. */}
                {!pushArming ? (
                  <button
                    type="button"
                    disabled={payBusy !== null || !payStatus?.escrow.funded}
                    onClick={() => {
                      setPayError(null);
                      setPushArming(true);
                    }}
                    title={payStatus?.escrow.funded ? undefined : "Fund the escrow before pushing"}
                    style={{
                      cursor: payBusy !== null || !payStatus?.escrow.funded ? "not-allowed" : "pointer",
                      opacity: payBusy !== null || !payStatus?.escrow.funded ? 0.5 : 1,
                      font: "600 13px var(--sans)",
                      color: "var(--surface)",
                      background: "var(--accent)",
                      border: "0",
                      borderRadius: "var(--radius-pill)",
                      padding: "10px 22px",
                    }}
                  >
                    Push distribution
                  </button>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                      padding: "var(--space-3) var(--space-4)",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--loss)",
                      background: "color-mix(in srgb, var(--loss) 8%, transparent)",
                      maxWidth: "62ch",
                    }}
                  >
                    <p style={{ color: "var(--ink)", fontSize: "13px", lineHeight: 1.5, fontWeight: 600 }}>
                      Pays {draft.rowCount} owner{draft.rowCount === 1 ? "" : "s"} ·{" "}
                      <Money value={draft.totals.netPaid} /> · this on-chain push is{" "}
                      <span style={{ textTransform: "uppercase" }}>irreversible</span>.
                    </p>
                    <p style={{ color: "var(--sub)", fontSize: "12px", lineHeight: 1.5 }}>
                      Confirming requires a step-up re-authentication. The push records the on-chain
                      signatures; owners are marked paid only once the chain confirms.
                    </p>
                    <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-1)" }}>
                      <button
                        type="button"
                        disabled={payBusy !== null}
                        onClick={onPush}
                        style={{
                          cursor: payBusy !== null ? "not-allowed" : "pointer",
                          opacity: payBusy !== null ? 0.5 : 1,
                          font: "600 13px var(--sans)",
                          color: "var(--surface)",
                          background: "var(--loss)",
                          border: "0",
                          borderRadius: "var(--radius-pill)",
                          padding: "9px 20px",
                        }}
                      >
                        {payBusy === "push" ? "Pushing…" : "Confirm push (step-up)"}
                      </button>
                      <button
                        type="button"
                        disabled={payBusy !== null}
                        onClick={() => setPushArming(false)}
                        style={{
                          cursor: payBusy !== null ? "not-allowed" : "pointer",
                          font: "600 13px var(--sans)",
                          color: "var(--sub)",
                          background: "transparent",
                          border: "1px solid var(--hairline-2)",
                          borderRadius: "var(--radius-pill)",
                          padding: "9px 20px",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* CONFIRM — the reconcile stub (demo stand-in for the Helius confirm) flips pushed → paid. */}
                {(payStatus?.pushedCount ?? 0) > 0 && (
                  <button
                    type="button"
                    disabled={payBusy !== null}
                    onClick={onConfirm}
                    title="Stand-in for the Helius reconcile — chain owns the paid flip"
                    style={{
                      cursor: payBusy !== null ? "not-allowed" : "pointer",
                      opacity: payBusy !== null ? 0.5 : 1,
                      font: "600 13px var(--sans)",
                      color: "var(--ink)",
                      background: "var(--surface)",
                      border: "1px solid var(--hairline-2)",
                      borderRadius: "var(--radius-pill)",
                      padding: "10px 20px",
                    }}
                  >
                    {payBusy === "confirm" ? "Confirming…" : "Confirm on-chain (reconcile)"}
                  </button>
                )}

                {/* PAUSE (4-3) — pause the period WITH a structured reason (never silent). Only a
                    not-yet-pushed, not-yet-paid draft can be paused; the reason feeds the consumer. */}
                {(payStatus?.pushedCount ?? 0) === 0 && (payStatus?.paidCount ?? 0) === 0 && (
                  !pauseArming ? (
                    <button
                      type="button"
                      disabled={payBusy !== null}
                      onClick={() => {
                        setPayError(null);
                        setPauseArming(true);
                      }}
                      style={{
                        cursor: payBusy !== null ? "not-allowed" : "pointer",
                        opacity: payBusy !== null ? 0.5 : 1,
                        font: "600 13px var(--sans)",
                        color: "var(--warning)",
                        background: "var(--surface)",
                        border: "1px solid var(--warning)",
                        borderRadius: "var(--radius-pill)",
                        padding: "10px 20px",
                      }}
                    >
                      Pause distribution
                    </button>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--space-2)",
                        padding: "var(--space-3) var(--space-4)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--warning)",
                        background: "color-mix(in srgb, var(--warning) 8%, transparent)",
                        maxWidth: "62ch",
                      }}
                    >
                      <p style={{ color: "var(--ink)", fontSize: "13px", lineHeight: 1.5, fontWeight: 600 }}>
                        Pause requires a reason — owners will see it on their Income view.
                      </p>
                      <label style={labelStyle}>
                        Reason
                        <select
                          style={{ ...inputStyle, width: "28ch" }}
                          value={pauseReason}
                          onChange={(e) => setPauseReason(e.target.value as PauseReason)}
                        >
                          {PAUSE_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={labelStyle}>
                        Note (optional)
                        <input
                          style={{ ...inputStyle, width: "40ch" }}
                          value={pauseNote}
                          onChange={(e) => setPauseNote(e.target.value)}
                          placeholder="Context for owners (optional)"
                        />
                      </label>
                      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-1)" }}>
                        <button
                          type="button"
                          disabled={payBusy !== null}
                          onClick={onPause}
                          style={{
                            cursor: payBusy !== null ? "not-allowed" : "pointer",
                            opacity: payBusy !== null ? 0.5 : 1,
                            font: "600 13px var(--sans)",
                            color: "var(--surface)",
                            background: "var(--warning)",
                            border: "0",
                            borderRadius: "var(--radius-pill)",
                            padding: "9px 20px",
                          }}
                        >
                          {payBusy === "pause" ? "Pausing…" : "Confirm pause"}
                        </button>
                        <button
                          type="button"
                          disabled={payBusy !== null}
                          onClick={() => setPauseArming(false)}
                          style={{
                            cursor: payBusy !== null ? "not-allowed" : "pointer",
                            font: "600 13px var(--sans)",
                            color: "var(--sub)",
                            background: "transparent",
                            border: "1px solid var(--hairline-2)",
                            borderRadius: "var(--radius-pill)",
                            padding: "9px 20px",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>

              {payError && (
                <p
                  role="alert"
                  style={{
                    margin: "var(--space-3) 0 0",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--loss)",
                    color: "var(--loss)",
                    background: "color-mix(in srgb, var(--loss) 8%, transparent)",
                    fontSize: "13px",
                    lineHeight: 1.5,
                  }}
                >
                  Blocked: {payError}
                </p>
              )}

              <p style={{ color: "var(--muted)", fontSize: "12px", lineHeight: 1.5, margin: "var(--space-3) 0 0", maxWidth: "80ch" }}>
                Fund the escrow first, then push. The push records the on-chain signatures but never marks
                anyone paid — the <strong>scheduled → paid</strong> flip is owned by the reconcile
                (chain-authoritative). A failed push marks no one paid and can be retried without double-paying.
              </p>
            </div>
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
