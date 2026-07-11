"use client";

import { useCallback, useMemo, useState } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Id } from "vesper-app/convex/_generated/dataModel";
import { DataTable, type Column } from "@/app/components/ui/DataTable";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { MonoData } from "@/app/components/ui/MonoData";
import { Money } from "@/app/components/ui/Money";

// Story 5.1 — the compliance officer's KYC/AML adjudication → Token-ACL surface. It is a review queue
// over the SAME `eligibility` data the consumer self-service path writes — NOT a second eligibility
// system. Permission-gated (compliance.review) here AND independently on every Convex request. The
// officer can: adjudicate a case eligible/ineligible WITH A RECORDED REASON (ineligible ⇒ the token
// stays frozen and cannot receive tokens), freeze/thaw the ACL directly (freeze.execute), and record a
// stubbed AML screen. Every action is audited to the named human server-side. This surface builds NO
// Reg A+ cap enforcement (5-2) and no marketing sign-off (5-3).

type ComplianceCase = {
  id: string;
  userId: string;
  propertyId: string;
  userHandle: string;
  kycStatus: "none" | "pending" | "verified" | "failed";
  eligible: boolean;
  jurisdiction: string;
  tokenAclState: "frozen" | "thawed";
  amlFlag: "clear" | "flagged" | null;
  reviewedBy: string | null;
  reviewReason: string | null;
};

function aclStatus(state: ComplianceCase["tokenAclState"]): { kind: StatusKind; label: string } {
  return state === "thawed"
    ? { kind: "passed", label: "Thawed" }
    : { kind: "blocked", label: "Frozen" };
}

function kycStatus(status: ComplianceCase["kycStatus"]): { kind: StatusKind; label: string } {
  if (status === "verified") return { kind: "passed", label: "Verified" };
  if (status === "failed") return { kind: "blocked", label: "Failed" };
  if (status === "pending") return { kind: "pending", label: "Pending" };
  return { kind: "draft", label: "None" };
}

// Story 5.2 — Reg A+ cap OVERSIGHT (read-only). `regACapStatus` on the server MIRRORS settlement's
// enforcement rule, so this view can never disagree with the gate that actually blocks a purchase.
type CapUsageRow = {
  userId: string;
  handle: string;
  kycStatus: ComplianceCase["kycStatus"];
  limit: number | null;
  invested: number;
  remaining: number;
  state: "no-limit" | "ok" | "near" | "over";
};

function capState(state: CapUsageRow["state"]): { kind: StatusKind; label: string } {
  if (state === "ok") return { kind: "passed", label: "Within cap" };
  if (state === "near") return { kind: "pending", label: "Near cap" };
  if (state === "over") return { kind: "blocked", label: "Over cap" };
  return { kind: "blocked", label: "No cap" }; // no-limit ⇒ blocking, like settlement's unset-limit gate
}

const btnBase: React.CSSProperties = {
  font: "600 12px var(--sans)",
  background: "var(--surface)",
  borderRadius: "var(--radius-pill)",
  padding: "6px 14px",
};

export default function CompliancePage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canReview = !!me && me.permissions.includes("compliance.review");
  const canFreeze = !!me && me.permissions.includes("freeze.execute");

  const [busy, setBusy] = useState<string | null>(null);

  const queue = useQuery(
    api.compliance.listComplianceQueue,
    canReview ? {} : "skip",
  );

  const capUsage = useQuery(
    api.compliance.listCapUsage,
    canReview ? {} : "skip",
  );

  const adjudicate = useMutation(api.compliance.adjudicateEligibility);
  const setAcl = useMutation(api.compliance.setTokenAclState);
  const screenAml = useMutation(api.compliance.screenAml);

  const onAdjudicate = useCallback(
    async (row: ComplianceCase, eligible: boolean) => {
      const reason = window.prompt(
        `Reason for marking this case ${eligible ? "ELIGIBLE (thaw)" : "INELIGIBLE (freeze)"}? (required)`,
      );
      if (reason === null) return; // cancelled
      if (!reason.trim()) {
        window.alert("A non-empty reason is required to adjudicate.");
        return;
      }
      setBusy(row.id);
      try {
        await adjudicate({
          userId: row.userId as Id<"users">,
          propertyId: row.propertyId as Id<"properties">,
          eligible,
          reason,
        });
      } finally {
        setBusy(null);
      }
    },
    [adjudicate],
  );

  const onSetAcl = useCallback(
    async (row: ComplianceCase, state: "freeze" | "thaw") => {
      setBusy(row.id);
      try {
        await setAcl({
          userId: row.userId as Id<"users">,
          propertyId: row.propertyId as Id<"properties">,
          state,
        });
      } finally {
        setBusy(null);
      }
    },
    [setAcl],
  );

  const onScreen = useCallback(
    async (row: ComplianceCase, flag: "clear" | "flagged") => {
      setBusy(row.id);
      try {
        await screenAml({
          userId: row.userId as Id<"users">,
          propertyId: row.propertyId as Id<"properties">,
          flag,
        });
      } finally {
        setBusy(null);
      }
    },
    [screenAml],
  );

  const columns = useMemo<Column<ComplianceCase>[]>(
    () => [
      {
        key: "user",
        header: "Investor",
        render: (r) => <MonoData value={r.userHandle} label="investor handle" />,
      },
      {
        key: "kyc",
        header: "KYC",
        render: (r) => {
          const s = kycStatus(r.kycStatus);
          return <StatusChip status={s.kind} label={s.label} />;
        },
      },
      {
        key: "jurisdiction",
        header: "Jurisdiction",
        render: (r) => (
          <span style={{ color: "var(--sub)" }}>{r.jurisdiction || "—"}</span>
        ),
      },
      {
        key: "aml",
        header: "AML",
        render: (r) =>
          r.amlFlag === "flagged" ? (
            <StatusChip status="blocked" label="Flagged" />
          ) : r.amlFlag === "clear" ? (
            <StatusChip status="passed" label="Clear" />
          ) : (
            <span style={{ color: "var(--muted)" }}>Not screened</span>
          ),
      },
      {
        key: "acl",
        header: "Token ACL",
        render: (r) => {
          const s = aclStatus(r.tokenAclState);
          return (
            <StatusChip
              status={s.kind}
              label={s.label}
              title={r.reviewReason ? `Reason: ${r.reviewReason}` : undefined}
            />
          );
        },
      },
      {
        key: "reviewedBy",
        header: "Reviewed by",
        render: (r) =>
          r.reviewedBy ? (
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>{r.reviewedBy}</span>
          ) : (
            <span style={{ color: "var(--muted)" }}>— self-service</span>
          ),
      },
      {
        key: "actions",
        header: "",
        align: "num",
        render: (r) => {
          const disabled = busy === r.id;
          return (
            <span style={{ display: "inline-flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAdjudicate(r, true)}
                style={{ ...btnBase, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, color: "var(--gain)", border: "1px solid var(--gain)" }}
              >
                Eligible
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAdjudicate(r, false)}
                style={{ ...btnBase, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, color: "var(--loss)", border: "1px solid var(--loss)" }}
              >
                Ineligible
              </button>
              {canFreeze &&
                (r.tokenAclState === "thawed" ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSetAcl(r, "freeze")}
                    style={{ ...btnBase, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, color: "var(--loss)", border: "1px solid var(--hairline-2)" }}
                  >
                    Freeze
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSetAcl(r, "thaw")}
                    style={{ ...btnBase, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, color: "var(--gain)", border: "1px solid var(--hairline-2)" }}
                  >
                    Thaw
                  </button>
                ))}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onScreen(r, "flagged")}
                title="Record a stubbed AML flag on this case"
                style={{ ...btnBase, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, color: "var(--sub)", border: "1px solid var(--hairline-2)" }}
              >
                Flag AML
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onScreen(r, "clear")}
                title="Record a stubbed AML clear on this case"
                style={{ ...btnBase, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, color: "var(--sub)", border: "1px solid var(--hairline-2)" }}
              >
                Clear AML
              </button>
            </span>
          );
        },
      },
    ],
    [busy, canFreeze, onAdjudicate, onSetAcl, onScreen],
  );

  const capColumns = useMemo<Column<CapUsageRow>[]>(
    () => [
      {
        key: "user",
        header: "Investor",
        render: (r) => <MonoData value={r.handle} label="investor handle" />,
      },
      {
        key: "kyc",
        header: "KYC",
        render: (r) => {
          const s = kycStatus(r.kycStatus);
          return <StatusChip status={s.kind} label={s.label} />;
        },
      },
      {
        key: "limit",
        header: "Reg A+ cap",
        align: "num",
        render: (r) =>
          r.limit === null ? (
            <span style={{ color: "var(--muted)" }}>—</span>
          ) : (
            <Money value={r.limit} currency="USD" />
          ),
      },
      {
        key: "invested",
        header: "Invested",
        align: "num",
        render: (r) => <Money value={r.invested} currency="USD" />,
      },
      {
        key: "remaining",
        header: "Remaining",
        align: "num",
        render: (r) => <Money value={r.remaining} currency="USD" signed />,
      },
      {
        key: "state",
        header: "Status",
        render: (r) => {
          const s = capState(r.state);
          return <StatusChip status={s.kind} label={s.label} />;
        },
      },
    ],
    [],
  );

  if (authLoading || me === undefined) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  if (!canReview) {
    return (
      <section style={{ padding: "var(--space-8)", maxWidth: "48ch" }}>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
          Not permitted
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          Adjudicating compliance cases requires the <code>compliance.review</code> permission. Ask a
          Platform Admin if you need compliance access.
        </p>
      </section>
    );
  }

  const rows = (queue ?? []) as ComplianceCase[];
  const capRows = (capUsage ?? []) as CapUsageRow[];

  return (
    <section style={{ padding: "var(--space-6)" }}>
      <header style={{ marginBottom: "var(--space-5)" }}>
        <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Compliance
        </p>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-1)" }}>
          KYC / AML adjudication
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "72ch", lineHeight: 1.6 }}>
          The compliance safety net over investor eligibility. Adjudicating a case ineligible keeps its
          property token <strong>frozen</strong> — it cannot receive tokens — and every override records a
          mandatory reason and the named reviewer. AML screening is a stubbed input recorded for the
          reviewer, not a live vendor call. Reg A+ cap enforcement and marketing sign-off live elsewhere.
        </p>
      </header>

      <DataTable<ComplianceCase>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Compliance queue"
        subCaption={`${rows.length} case${rows.length === 1 ? "" : "s"} · adjudication requires a recorded reason`}
        emptyLabel={queue === undefined ? "Loading…" : "No eligibility cases to review yet."}
      />

      <div style={{ marginTop: "var(--space-7)" }}>
        <header style={{ marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "22px", margin: "0 0 var(--space-1)" }}>
            Reg A+ cap usage
          </h2>
          <p style={{ color: "var(--sub)", maxWidth: "72ch", lineHeight: 1.6 }}>
            Read-only oversight of every investor&apos;s Reg A+ per-investor headroom. The status mirrors
            the exact rule the settlement gate enforces — an unset cap or an investor at/over their limit
            is <strong>blocking</strong>, and ≥80% consumed reads as <strong>near cap</strong>. This view
            never blocks a purchase itself; enforcement lives in settlement.
          </p>
        </header>

        <DataTable<CapUsageRow>
          columns={capColumns}
          rows={capRows}
          rowKey={(r) => r.userId}
          caption="Cap usage"
          subCaption={`${capRows.length} investor${capRows.length === 1 ? "" : "s"} with a computed cap · oversight mirrors settlement's enforcement rule`}
          emptyLabel={capUsage === undefined ? "Loading…" : "No investors with a computed Reg A+ cap yet."}
        />
      </div>
    </section>
  );
}
