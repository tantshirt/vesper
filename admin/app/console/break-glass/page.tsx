"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import { PERMISSIONS, type Permission } from "vesper-app/convex/roles";
import { DataTable, type Column } from "@/app/components/ui/DataTable";
import { StatusChip } from "@/app/components/ui/StatusChip";

// Story 1.4 — invoke and monitor audited, time-boxed break-glass. `invokeBreakGlass` is
// `breakglass.use`-gated, demands a NON-EMPTY reason, and bounds the window server-side; the elevation
// is enforced through the one permission path and lapses the instant it expires. This UI gate is a
// convenience — the Convex mutation re-checks every field. The active list is the compliance-visible
// record (server-gated on `audit.read`).

const MAX_MINUTES = 60;

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

function fmt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ActiveRow = {
  id: string;
  workosId: string;
  scope: string[];
  reason: string;
  invokedBy: string;
  createdAt: number;
  expiresAt: number;
};

export default function BreakGlassPage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canUse = !!me && me.permissions.includes("breakglass.use");

  const invokeBreakGlass = useMutation(api.breakGlass.invokeBreakGlass);
  const revokeBreakGlass = useMutation(api.breakGlass.revokeBreakGlass);

  const active = useQuery(api.breakGlass.listActiveBreakGlass, canUse ? {} : "skip");

  const [workosId, setWorkosId] = useState("");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(MAX_MINUTES);
  const [scope, setScope] = useState<Permission[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const permKeys = Object.keys(PERMISSIONS) as Permission[];
  const toggleScope = (p: Permission) =>
    setScope((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await invokeBreakGlass({
        workosId: workosId.trim(),
        scope,
        reason: reason.trim(),
        durationMinutes: minutes,
      });
      setWorkosId("");
      setReason("");
      setScope([]);
      setMinutes(MAX_MINUTES);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to invoke break-glass.");
    } finally {
      setSubmitting(false);
    }
  };

  const columns = useMemo<Column<ActiveRow>[]>(
    () => [
      {
        key: "workosId",
        header: "Staff",
        render: (r) => <span style={{ color: "var(--ink)", font: "500 13px var(--sans)" }}>{r.workosId}</span>,
      },
      {
        key: "scope",
        header: "Scope",
        render: (r) => (
          <span style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
            {r.scope.map((s) => (
              <code
                key={s}
                style={{
                  background: "var(--chip)",
                  color: "var(--accent)",
                  padding: "2px var(--space-2)",
                  borderRadius: "var(--radius-pill)",
                  font: "500 12px var(--sans)",
                }}
              >
                {s}
              </code>
            ))}
          </span>
        ),
      },
      {
        key: "reason",
        header: "Reason",
        render: (r) => <span style={{ color: "var(--sub)", fontSize: "13px" }}>{r.reason}</span>,
      },
      {
        key: "invokedBy",
        header: "Invoked by",
        render: (r) => <span style={{ color: "var(--sub)", fontSize: "13px" }}>{r.invokedBy}</span>,
      },
      {
        key: "expiresAt",
        header: "Expires",
        render: (r) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
            <StatusChip status="pending" label={fmt(r.expiresAt)} />
          </span>
        ),
      },
      {
        key: "revoke",
        header: "",
        align: "num",
        render: (r) => (
          <button
            type="button"
            onClick={() => revokeBreakGlass({ id: r.id as never })}
            style={{
              cursor: "pointer",
              font: "600 12px var(--sans)",
              color: "var(--loss)",
              background: "var(--surface)",
              border: "1px solid var(--loss)",
              borderRadius: "var(--radius-pill)",
              padding: "6px 14px",
            }}
          >
            Revoke
          </button>
        ),
      },
    ],
    [revokeBreakGlass],
  );

  if (authLoading || me === undefined) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  if (!canUse) {
    return (
      <section style={{ padding: "var(--space-8)", maxWidth: "48ch" }}>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
          Not permitted
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          Invoking break-glass requires the <code>breakglass.use</code> permission.
        </p>
      </section>
    );
  }

  const rows = (active ?? []) as ActiveRow[];
  const canSubmit = !submitting && !!workosId.trim() && !!reason.trim() && scope.length > 0;

  return (
    <section style={{ padding: "var(--space-6)", maxWidth: "82ch" }}>
      <header style={{ marginBottom: "var(--space-5)" }}>
        <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Emergency access
        </p>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-1)" }}>
          Break-glass
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "68ch", lineHeight: 1.6 }}>
          Grant a staff member a time-boxed set of permissions with a mandatory reason. Every
          invocation is audited and expires automatically (max {MAX_MINUTES} minutes).
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
        <label style={labelStyle}>
          Staff WorkOS ID
          <input style={inputStyle} value={workosId} onChange={(e) => setWorkosId(e.target.value)} placeholder="user_..." />
        </label>
        <label style={labelStyle}>
          Duration (min)
          <input
            style={{ ...inputStyle, width: "8ch" }}
            type="number"
            min={1}
            max={MAX_MINUTES}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(1, Math.min(MAX_MINUTES, Number(e.target.value) || 1)))}
          />
        </label>
        <label style={{ ...labelStyle, flex: "1 1 24ch" }}>
          Reason (required)
          <input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this elevation needed?" />
        </label>
      </div>

      <div style={{ marginBottom: "var(--space-4)" }}>
        <p style={{ ...labelStyle, marginBottom: "var(--space-2)" }}>Scope</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {permKeys.map((p) => {
            const on = scope.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => toggleScope(p)}
                title={PERMISSIONS[p]}
                style={{
                  cursor: "pointer",
                  font: "500 12px var(--sans)",
                  color: on ? "var(--surface)" : "var(--sub)",
                  background: on ? "var(--accent)" : "var(--chip)",
                  border: "0",
                  borderRadius: "var(--radius-pill)",
                  padding: "6px 14px",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: "var(--space-4)",
            padding: "var(--space-3) var(--space-4)",
            border: "1px solid var(--loss)",
            borderRadius: "var(--radius-md)",
            color: "var(--loss)",
            background: "var(--surface)",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginBottom: "var(--space-7)" }}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          style={{
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.5,
            font: "600 13px var(--sans)",
            color: "var(--surface)",
            background: "var(--accent)",
            border: "0",
            borderRadius: "var(--radius-pill)",
            padding: "10px 22px",
          }}
        >
          {submitting ? "Invoking…" : "Invoke break-glass"}
        </button>
      </div>

      <DataTable<ActiveRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Active break-glass grants"
        subCaption={`${rows.length} active`}
        showDensityToggle={false}
        emptyLabel={active === undefined ? "Loading…" : "No active break-glass grants."}
      />
    </section>
  );
}
