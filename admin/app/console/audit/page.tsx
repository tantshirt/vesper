"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useQuery, usePaginatedQuery } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import { DataTable, type Column } from "@/app/components/ui/DataTable";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { MonoData } from "@/app/components/ui/MonoData";

// Story 1.3 — the regulator-facing Audit view. It is a READ surface over the append-only trail:
// permission-gated (audit.read) here in the UI AND independently on every listAudit request. The nav
// entry is likewise gated, but neither UI gate is the enforcement point — the Convex query re-checks.
//
// Actions that map to an operational status render as a StatusChip (color + icon + label, never color
// alone); everything else renders as plain action text. On-chain references render with MonoData
// (middle-truncated, click-to-copy). Only tokens + the 1-5 primitives supply color/type.

type AuditRow = {
  id: string;
  actor: string;
  action: string;
  target: string;
  onchainRef: string | null;
  meta: unknown;
  timestamp: number;
};

// Map an audit action to an operational StatusChip kind, or null to render it as plain text. Keyed on
// the action's semantics so a compliance reader scans the trail by color the same way they scan a
// review queue. Unknown/neutral actions stay plain — a chip would imply a status the action lacks.
function statusForAction(action: string): StatusKind | null {
  if (/(\.thawed|\.verified|\.passed|\.signed|\.granted)$/.test(action)) return "passed";
  if (/(\.frozen|\.denied|\.failed|\.missed|\.revoked|\.blocked)$/.test(action)) return "blocked";
  if (/(mint\.|distribution\.|\.executed|\.confirmed|\.reconciled)/.test(action)) return "onchain";
  if (/(\.recorded|\.pending|\.scheduled|\.joined|\.created)$/.test(action)) return "pending";
  return null;
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

export default function AuditPage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);

  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const canRead = !!me && me.permissions.includes("audit.read");

  // Build the (pagination-less) filter args. Empty fields are omitted so the optional validators see
  // absence, not an empty string that would match nothing. Date inputs bound the day inclusively.
  const filterArgs = useMemo(() => {
    const args: {
      actor?: string;
      action?: string;
      target?: string;
      timeStart?: number;
      timeEnd?: number;
    } = {};
    if (actor.trim()) args.actor = actor.trim();
    if (action.trim()) args.action = action.trim();
    if (target.trim()) args.target = target.trim();
    if (dateFrom) {
      const t = new Date(`${dateFrom}T00:00:00`).getTime();
      if (!Number.isNaN(t)) args.timeStart = t;
    }
    if (dateTo) {
      const t = new Date(`${dateTo}T23:59:59.999`).getTime();
      if (!Number.isNaN(t)) args.timeEnd = t;
    }
    return args;
  }, [actor, action, target, dateFrom, dateTo]);

  const { results, status, loadMore } = usePaginatedQuery(
    api.auditQueries.listAudit,
    canRead ? filterArgs : "skip",
    { initialNumItems: 50 },
  );

  const columns = useMemo<Column<AuditRow>[]>(
    () => [
      {
        key: "timestamp",
        header: "When",
        render: (r) => <span style={{ color: "var(--sub)", fontSize: "13px" }}>{fmtTimestamp(r.timestamp)}</span>,
      },
      {
        key: "actor",
        header: "Actor",
        render: (r) => <span style={{ color: "var(--ink)", fontWeight: 500 }}>{r.actor}</span>,
      },
      {
        key: "action",
        header: "Action",
        render: (r) => {
          const kind = statusForAction(r.action);
          return kind ? (
            <StatusChip status={kind} label={r.action} title={r.action} />
          ) : (
            <span style={{ color: "var(--ink)", font: "500 13px var(--sans)" }}>{r.action}</span>
          );
        },
      },
      {
        key: "target",
        header: "Target",
        render: (r) => <span style={{ color: "var(--sub)", fontSize: "13px" }}>{r.target}</span>,
      },
      {
        key: "onchainRef",
        header: "On-chain ref",
        render: (r) =>
          r.onchainRef ? (
            <MonoData value={r.onchainRef} label="on-chain reference" />
          ) : (
            <span style={{ color: "var(--muted)" }} aria-label="none">
              —
            </span>
          ),
      },
    ],
    [],
  );

  // Gate the not-permitted state on Convex auth still loading AND `me` still resolving — never on
  // `me === null` alone, which would flash "Not permitted" at granted staff on every load (1-1 pattern).
  if (authLoading || me === undefined) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  if (!canRead) {
    return (
      <section style={{ padding: "var(--space-8)", maxWidth: "48ch" }}>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
          Not permitted
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          Viewing the audit trail requires the <code>audit.read</code> permission. Ask a Platform Admin
          if you need oversight access.
        </p>
      </section>
    );
  }

  const rows = (results ?? []) as AuditRow[];

  return (
    <section style={{ padding: "var(--space-6)" }}>
      <header style={{ marginBottom: "var(--space-5)" }}>
        <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Oversight
        </p>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-1)" }}>
          Audit trail
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "68ch", lineHeight: 1.6 }}>
          The append-only record of every attributed action — newest first. Filter by actor, action, or
          date.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginBottom: "var(--space-5)" }}>
        <label style={labelStyle}>
          Actor
          <input style={inputStyle} value={actor} onChange={(e) => setActor(e.target.value)} placeholder="e.g. Priya Desai" />
        </label>
        <label style={labelStyle}>
          Action
          <input style={inputStyle} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. acl" />
        </label>
        <label style={labelStyle}>
          Target
          <input style={inputStyle} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target id" />
        </label>
        <label style={labelStyle}>
          From
          <input style={inputStyle} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={labelStyle}>
          To
          <input style={inputStyle} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      <DataTable<AuditRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Audit entries"
        subCaption={`${rows.length} shown${status === "CanLoadMore" ? " · more available" : ""}`}
        emptyLabel={status === "LoadingFirstPage" ? "Loading…" : "No audit entries match these filters."}
      />

      {status === "CanLoadMore" && (
        <div style={{ marginTop: "var(--space-4)", display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => loadMore(50)}
            style={{
              cursor: "pointer",
              font: "600 13px var(--sans)",
              color: "var(--surface)",
              background: "var(--accent)",
              border: "0",
              borderRadius: "var(--radius-pill)",
              padding: "9px 20px",
            }}
          >
            Load more
          </button>
        </div>
      )}
    </section>
  );
}
