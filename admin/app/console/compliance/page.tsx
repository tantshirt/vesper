"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Id } from "vesper-app/convex/_generated/dataModel";
import { DataTable, type Column } from "@/app/components/ui/DataTable";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { MonoData } from "@/app/components/ui/MonoData";
import { Money } from "@/app/components/ui/Money";
import { DecisionPanel } from "@/app/components/ui/DecisionPanel";

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

function aclStatus(state: ComplianceCase["tokenAclState"]): {
  kind: StatusKind;
  label: string;
} {
  return state === "thawed"
    ? { kind: "passed", label: "Thawed" }
    : { kind: "blocked", label: "Frozen" };
}

function kycStatus(status: ComplianceCase["kycStatus"]): {
  kind: StatusKind;
  label: string;
} {
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

function capState(state: CapUsageRow["state"]): {
  kind: StatusKind;
  label: string;
} {
  if (state === "ok") return { kind: "passed", label: "Within cap" };
  if (state === "near") return { kind: "pending", label: "Near cap" };
  if (state === "over") return { kind: "blocked", label: "Over cap" };
  return { kind: "blocked", label: "No cap" }; // no-limit ⇒ blocking, like settlement's unset-limit gate
}

// Story 5.3 — the MARKETING SIGN-OFF gate. Public/marketing copy has a lifecycle draft → signed_off |
// blocked. Nothing ships unsigned: only a `signed_off` item is shippable (the server helper
// `isMarketingSignedOff` is the gate a public-render path consults). Only compliance.review may sign off
// or block (with a mandatory note). The regulator-ready record is the EXISTING 1-3 audit export — linked
// below, never rebuilt here.
type MarketingItem = {
  id: string;
  propertyId: string | null;
  kind: string;
  body: string;
  status: "draft" | "signed_off" | "blocked";
  submittedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: number;
  reviewedAt: number | null;
};

type ComplianceDecision =
  | { kind: "eligibility"; row: ComplianceCase; eligible: boolean }
  | { kind: "acl"; row: ComplianceCase; state: "freeze" | "thaw" }
  | { kind: "aml"; row: ComplianceCase; flag: "clear" | "flagged" }
  | { kind: "marketing"; row: MarketingItem; outcome: "sign_off" | "block" };

function marketingStatus(status: MarketingItem["status"]): {
  kind: StatusKind;
  label: string;
} {
  if (status === "signed_off") return { kind: "passed", label: "Signed off" };
  if (status === "blocked") return { kind: "blocked", label: "Blocked" };
  return { kind: "draft", label: "Draft" };
}

const btnBase: React.CSSProperties = {
  font: "600 12px var(--sans)",
  background: "var(--surface)",
  borderRadius: "var(--radius-pill)",
  padding: "6px 14px",
  minHeight: "44px",
};

export default function CompliancePage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canReview = !!me && me.permissions.includes("compliance.review");
  const canFreeze = !!me && me.permissions.includes("freeze.execute");

  const [decision, setDecision] = useState<ComplianceDecision | null>(null);
  const [requestedPropertyId, setRequestedPropertyId] = useState<string | null>(null);
  const decisionOrigin = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("propertyId");
    const frame = requestAnimationFrame(() => setRequestedPropertyId(requested));
    return () => cancelAnimationFrame(frame);
  }, []);

  const queue = useQuery(
    api.compliance.listComplianceQueue,
    canReview ? {} : "skip",
  );

  const capUsage = useQuery(
    api.compliance.listCapUsage,
    canReview ? {} : "skip",
  );

  const marketing = useQuery(
    api.marketing.listMarketingQueue,
    canReview ? {} : "skip",
  );

  const adjudicate = useMutation(api.compliance.adjudicateEligibility);
  const setAcl = useMutation(api.compliance.setTokenAclState);
  const screenAml = useMutation(api.compliance.screenAml);
  const signOffMarketing = useMutation(api.marketing.signOffMarketing);
  const blockMarketing = useMutation(api.marketing.blockMarketing);

  const openDecision = useCallback(
    (next: ComplianceDecision, origin: HTMLButtonElement) => {
      decisionOrigin.current = origin;
      setDecision(next);
    },
    [],
  );

  const closeDecision = useCallback(() => {
    setDecision(null);
    requestAnimationFrame(() => decisionOrigin.current?.focus());
  }, []);

  const confirmDecision = useCallback(
    async (rationale: string) => {
      if (!decision) return;
      if (decision.kind === "eligibility") {
        await adjudicate({
          userId: decision.row.userId as Id<"users">,
          propertyId: decision.row.propertyId as Id<"properties">,
          eligible: decision.eligible,
          reason: rationale,
        });
      } else if (decision.kind === "acl") {
        await setAcl({
          userId: decision.row.userId as Id<"users">,
          propertyId: decision.row.propertyId as Id<"properties">,
          state: decision.state,
        });
      } else if (decision.kind === "aml") {
        await screenAml({
          userId: decision.row.userId as Id<"users">,
          propertyId: decision.row.propertyId as Id<"properties">,
          flag: decision.flag,
        });
      } else if (decision.outcome === "sign_off") {
        await signOffMarketing({
          id: decision.row.id as Id<"marketingContent">,
          note: rationale || undefined,
        });
      } else {
        await blockMarketing({
          id: decision.row.id as Id<"marketingContent">,
          note: rationale,
        });
      }
      closeDecision();
    },
    [
      adjudicate,
      blockMarketing,
      closeDecision,
      decision,
      screenAml,
      setAcl,
      signOffMarketing,
    ],
  );

  const columns = useMemo<Column<ComplianceCase>[]>(
    () => [
      {
        key: "user",
        header: "Investor",
        render: (r) => (
          <MonoData value={r.userHandle} label="investor handle" />
        ),
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
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>
              {r.reviewedBy}
            </span>
          ) : (
            <span style={{ color: "var(--muted)" }}>— self-service</span>
          ),
      },
      {
        key: "actions",
        header: "",
        align: "num",
        render: (r) => {
          const disabled = decision !== null;
          return (
            <span
              style={{
                display: "inline-flex",
                gap: "8px",
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={(event) =>
                  openDecision(
                    { kind: "eligibility", row: r, eligible: true },
                    event.currentTarget,
                  )
                }
                style={{
                  ...btnBase,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  color: "var(--gain)",
                  border: "1px solid var(--gain)",
                }}
              >
                Eligible
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={(event) =>
                  openDecision(
                    { kind: "eligibility", row: r, eligible: false },
                    event.currentTarget,
                  )
                }
                style={{
                  ...btnBase,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  color: "var(--loss)",
                  border: "1px solid var(--loss)",
                }}
              >
                Ineligible
              </button>
              {canFreeze &&
                (r.tokenAclState === "thawed" ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={(event) =>
                      openDecision(
                        { kind: "acl", row: r, state: "freeze" },
                        event.currentTarget,
                      )
                    }
                    style={{
                      ...btnBase,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.5 : 1,
                      color: "var(--loss)",
                      border: "1px solid var(--hairline-2)",
                    }}
                  >
                    Freeze
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={(event) =>
                      openDecision(
                        { kind: "acl", row: r, state: "thaw" },
                        event.currentTarget,
                      )
                    }
                    style={{
                      ...btnBase,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.5 : 1,
                      color: "var(--gain)",
                      border: "1px solid var(--hairline-2)",
                    }}
                  >
                    Thaw
                  </button>
                ))}
              <button
                type="button"
                disabled={disabled}
                onClick={(event) =>
                  openDecision(
                    { kind: "aml", row: r, flag: "flagged" },
                    event.currentTarget,
                  )
                }
                title="Record a stubbed AML flag on this case"
                style={{
                  ...btnBase,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  color: "var(--sub)",
                  border: "1px solid var(--hairline-2)",
                }}
              >
                Flag AML
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={(event) =>
                  openDecision(
                    { kind: "aml", row: r, flag: "clear" },
                    event.currentTarget,
                  )
                }
                title="Record a stubbed AML clear on this case"
                style={{
                  ...btnBase,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  color: "var(--sub)",
                  border: "1px solid var(--hairline-2)",
                }}
              >
                Clear AML
              </button>
            </span>
          );
        },
      },
    ],
    [canFreeze, decision, openDecision],
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

  const marketingColumns = useMemo<Column<MarketingItem>[]>(
    () => [
      {
        key: "kind",
        header: "Kind",
        render: (r) => (
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>{r.kind}</span>
        ),
      },
      {
        key: "body",
        header: "Copy",
        render: (r) => (
          <span
            style={{
              color: "var(--sub)",
              display: "inline-block",
              maxWidth: "48ch",
              lineHeight: 1.5,
            }}
            title={r.body}
          >
            {r.body}
          </span>
        ),
      },
      {
        key: "submittedBy",
        header: "Submitted by",
        render: (r) => (
          <span style={{ color: "var(--sub)" }}>{r.submittedBy}</span>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (r) => {
          const s = marketingStatus(r.status);
          return (
            <StatusChip
              status={s.kind}
              label={s.label}
              title={r.reviewNote ? `Note: ${r.reviewNote}` : undefined}
            />
          );
        },
      },
      {
        key: "reviewedBy",
        header: "Reviewed by",
        render: (r) =>
          r.reviewedBy ? (
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>
              {r.reviewedBy}
            </span>
          ) : (
            <span style={{ color: "var(--muted)" }}>— pending</span>
          ),
      },
      {
        key: "actions",
        header: "",
        align: "num",
        render: (r) => {
          const disabled = decision !== null;
          // A signed-off item is done — the gate is open; only a draft/blocked item takes a decision.
          if (r.status === "signed_off") {
            return <span style={{ color: "var(--muted)" }}>—</span>;
          }
          return (
            <span
              style={{
                display: "inline-flex",
                gap: "8px",
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={(event) =>
                  openDecision(
                    { kind: "marketing", row: r, outcome: "sign_off" },
                    event.currentTarget,
                  )
                }
                style={{
                  ...btnBase,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  color: "var(--gain)",
                  border: "1px solid var(--gain)",
                }}
              >
                Sign off
              </button>
              {r.status !== "blocked" && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) =>
                    openDecision(
                      { kind: "marketing", row: r, outcome: "block" },
                      event.currentTarget,
                    )
                  }
                  style={{
                    ...btnBase,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                    color: "var(--loss)",
                    border: "1px solid var(--loss)",
                  }}
                >
                  Block
                </button>
              )}
            </span>
          );
        },
      },
    ],
    [decision, openDecision],
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
          Adjudicating compliance cases requires the{" "}
          <code>compliance.review</code> permission. Ask a Platform Admin if you
          need compliance access.
        </p>
      </section>
    );
  }

  const allRows = (queue ?? []) as ComplianceCase[];
  const rows = requestedPropertyId ? allRows.filter((row) => row.propertyId === requestedPropertyId) : allRows;
  const capRows = (capUsage ?? []) as CapUsageRow[];
  const allMarketingRows = (marketing ?? []) as MarketingItem[];
  const marketingRows = requestedPropertyId
    ? allMarketingRows.filter((row) => row.propertyId === requestedPropertyId)
    : allMarketingRows;
  const canExport = me.permissions.includes("audit.export");

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
          Investor reviews
        </p>
        <h1
          style={{
            fontFamily: "var(--serif)",
            color: "var(--ink)",
            fontSize: "28px",
            margin: "var(--space-2) 0 var(--space-1)",
          }}
        >
          Review investor eligibility
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "72ch", lineHeight: 1.6 }}>
          Decide whether an investor can receive property shares. Marking someone ineligible keeps
          their property token <strong>frozen</strong>, so it cannot receive shares. Every override
          requires a reason and records the named reviewer. AML screening shown here is a recorded test
          input, not a live vendor call; investment limits and marketing approval remain separate checks.
        </p>
      </header>

      <DataTable<ComplianceCase>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Compliance queue"
        subCaption={`${rows.length} case${rows.length === 1 ? "" : "s"} · adjudication requires a recorded reason`}
        emptyLabel={
          queue === undefined
            ? "Loading…"
            : "No eligibility cases to review yet."
        }
      />

      {decision && decision.kind !== "marketing" && (
        <DecisionPanel
          key={`${decision.kind}-${decision.row.id}-${decision.kind === "eligibility" ? String(decision.eligible) : decision.kind === "acl" ? decision.state : decision.flag}`}
          title={
            decision.kind === "eligibility"
              ? `${decision.eligible ? "Mark eligible" : "Mark ineligible"}: ${decision.row.userHandle}`
              : decision.kind === "acl"
                ? `${decision.state === "freeze" ? "Freeze" : "Thaw"} token access: ${decision.row.userHandle}`
                : `${decision.flag === "flagged" ? "Flag" : "Clear"} AML review: ${decision.row.userHandle}`
          }
          subject={`${decision.row.userHandle} · property ${decision.row.propertyId}`}
          facts={[
            {
              label: "KYC evidence",
              value: kycStatus(decision.row.kycStatus).label,
            },
            {
              label: "Jurisdiction",
              value: decision.row.jurisdiction || "Not recorded",
            },
            {
              label: "Current ACL",
              value: aclStatus(decision.row.tokenAclState).label,
            },
            {
              label: "Current AML input",
              value: decision.row.amlFlag ?? "Not screened",
            },
          ]}
          accountableRole={`${me.name} · ${me.roles.join(", ") || "No assigned role"}`}
          consequence={
            decision.kind === "eligibility"
              ? decision.eligible
                ? "Records this investor as eligible and schedules token-account thaw attestation."
                : "Records this investor as ineligible and keeps token access frozen."
              : decision.kind === "acl"
                ? decision.state === "freeze"
                  ? "Freezes token access and schedules the corresponding on-chain eligibility attestation."
                  : "Thaws token access and schedules the corresponding on-chain eligibility attestation."
                : `Records the reviewer-supplied AML input as ${decision.flag}. This is not a live provider result and does not itself change token access.`
          }
          nextAction={
            decision.kind === "aml"
              ? "After recording, adjudicate eligibility separately using the available case evidence."
              : "After recording, verify the updated case and on-chain attestation state before relying on it."
          }
          rationaleLabel={
            decision.kind === "eligibility"
              ? "Adjudication rationale"
              : "Reviewer note"
          }
          rationaleRequired={decision.kind === "eligibility"}
          confirmLabel="Record decision"
          tone={
            decision.kind === "eligibility" && decision.eligible
              ? "approve"
              : decision.kind === "acl" && decision.state === "thaw"
                ? "approve"
                : decision.kind === "aml" && decision.flag === "clear"
                  ? "approve"
                  : "block"
          }
          onConfirm={confirmDecision}
          onCancel={closeDecision}
        />
      )}

      <div style={{ marginTop: "var(--space-7)" }}>
        <header style={{ marginBottom: "var(--space-4)" }}>
          <h2
            style={{
              fontFamily: "var(--serif)",
              color: "var(--ink)",
              fontSize: "22px",
              margin: "0 0 var(--space-1)",
            }}
          >
            Reg A+ cap usage
          </h2>
          <p style={{ color: "var(--sub)", maxWidth: "72ch", lineHeight: 1.6 }}>
            Read-only oversight of every investor&apos;s Reg A+ per-investor
            headroom. The status mirrors the exact rule the settlement gate
            enforces — an unset cap or an investor at/over their limit is{" "}
            <strong>blocking</strong>, and ≥80% consumed reads as{" "}
            <strong>near cap</strong>. This view never blocks a purchase itself;
            enforcement lives in settlement.
          </p>
        </header>

        <DataTable<CapUsageRow>
          columns={capColumns}
          rows={capRows}
          rowKey={(r) => r.userId}
          caption="Cap usage"
          subCaption={`${capRows.length} investor${capRows.length === 1 ? "" : "s"} with a computed cap · oversight mirrors settlement's enforcement rule`}
          emptyLabel={
            capUsage === undefined
              ? "Loading…"
              : "No investors with a computed Reg A+ cap yet."
          }
        />
      </div>

      <div style={{ marginTop: "var(--space-7)" }}>
        <header style={{ marginBottom: "var(--space-4)" }}>
          <h2
            style={{
              fontFamily: "var(--serif)",
              color: "var(--ink)",
              fontSize: "22px",
              margin: "0 0 var(--space-1)",
            }}
          >
            Marketing sign-off
          </h2>
          <p style={{ color: "var(--sub)", maxWidth: "72ch", lineHeight: 1.6 }}>
            Public/marketing copy <strong>cannot ship unsigned</strong>. Each
            item is a draft until a compliance officer signs it off — the
            counsel gate — or blocks it with a mandatory note. A block records
            the reason; a sign-off records the named reviewer. The Reg A+
            pre-authorization marketing limits (B4) are the criteria you apply
            here, weighed at sign-off — an optional policy note captures your
            rationale.
          </p>
        </header>

        <DataTable<MarketingItem>
          columns={marketingColumns}
          rows={marketingRows}
          rowKey={(r) => r.id}
          caption="Marketing queue"
          subCaption={`${marketingRows.length} item${marketingRows.length === 1 ? "" : "s"} · only a signed-off item is shippable · a block requires a note`}
          emptyLabel={
            marketing === undefined
              ? "Loading…"
              : "No marketing copy submitted for review yet."
          }
        />

        {decision?.kind === "marketing" && (
          <DecisionPanel
            key={`marketing-${decision.row.id}-${decision.outcome}`}
            title={`${decision.outcome === "sign_off" ? "Sign off" : "Block"}: ${decision.row.kind}`}
            subject={`${decision.row.kind} · ${decision.row.propertyId ? `property ${decision.row.propertyId}` : "general content"}`}
            facts={[
              { label: "Submitted by", value: decision.row.submittedBy },
              {
                label: "Current status",
                value: marketingStatus(decision.row.status).label,
              },
              { label: "Copy under review", value: decision.row.body },
              {
                label: "Existing note",
                value: decision.row.reviewNote ?? "None",
              },
            ]}
            accountableRole={`${me.name} · ${me.roles.join(", ") || "No assigned role"}`}
            consequence={
              decision.outcome === "sign_off"
                ? "Marks this exact copy as signed off and eligible to pass the marketing publication gate."
                : "Blocks this exact copy from passing the marketing publication gate."
            }
            nextAction={
              decision.outcome === "sign_off"
                ? "After recording, verify the queue shows signed off before publishing."
                : "Return the blocked copy and rationale to its submitter for correction."
            }
            rationaleLabel={
              decision.outcome === "sign_off"
                ? "Policy rationale"
                : "Blocking rationale"
            }
            rationaleRequired={decision.outcome === "block"}
            confirmLabel={
              decision.outcome === "sign_off"
                ? "Record sign-off"
                : "Record block"
            }
            tone={decision.outcome === "sign_off" ? "approve" : "block"}
            onConfirm={confirmDecision}
            onCancel={closeDecision}
          />
        )}
      </div>

      <div style={{ marginTop: "var(--space-7)" }}>
        <header style={{ marginBottom: "var(--space-3)" }}>
          <h2
            style={{
              fontFamily: "var(--serif)",
              color: "var(--ink)",
              fontSize: "22px",
              margin: "0 0 var(--space-1)",
            }}
          >
            Regulator-ready audit export
          </h2>
          <p style={{ color: "var(--sub)", maxWidth: "72ch", lineHeight: 1.6 }}>
            The regulator-ready record is the append-only audit trail — every
            compliance decision here (adjudications, ACL freezes/thaws,
            marketing sign-offs and blocks) is written to it, naming the human.
            Export it from the Audit console; this surface links to that
            existing export rather than duplicating it.
          </p>
        </header>
        {canExport ? (
          <Link
            href="/console/audit"
            style={{
              ...btnBase,
              display: "inline-block",
              textDecoration: "none",
              color: "var(--ink)",
              border: "1px solid var(--hairline-2)",
            }}
          >
            Open the Audit trail &amp; export &rarr;
          </Link>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: "13px" }}>
            Exporting the audit trail requires the <code>audit.export</code>{" "}
            permission.
          </p>
        )}
      </div>
    </section>
  );
}
