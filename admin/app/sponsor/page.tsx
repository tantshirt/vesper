"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Id } from "vesper-app/convex/_generated/dataModel";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { kybChip } from "./layout";

// Admin Story 6.1 — the sponsor onboarding + KYB/Gate 0 entry. The intake checklist / document upload
// / status timeline is Story 6.2; here we only onboard, record KYB (stubbed Middesk seam), and enforce
// the Gate 0 submission check. Every action re-resolves the caller through `requireSponsor` server-side
// and is org-scoped — this page can only ever see and touch the caller's own org.

// A sponsor deal's status → StatusChip. Never color alone.
function dealChip(status: "draft" | "kyb_pending" | "submitted"): { status: StatusKind; label: string } {
  switch (status) {
    case "submitted":
      return { status: "passed", label: "Submitted for review" };
    case "kyb_pending":
      return { status: "pending", label: "KYB pending" };
    default:
      return { status: "draft", label: "Draft" };
  }
}

// A timeline stage state (Story 6.2, derived server-side) → StatusChip. passed = done; needs-you = the
// sponsor must act (warning); pending = waiting on a prerequisite / in review (neutral).
function timelineChip(state: "passed" | "pending" | "needs-you"): { status: StatusKind; label: string } {
  switch (state) {
    case "passed":
      return { status: "passed", label: "Done" };
    case "needs-you":
      return { status: "pending", label: "Needs you" };
    default:
      return { status: "draft", label: "Waiting" };
  }
}

const sectionHeading = {
  fontSize: "13px",
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  marginBottom: "var(--space-3)",
};

const cardStyle = {
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-5)",
  background: "var(--surface)",
};

const buttonStyle = {
  background: "var(--accent)",
  color: "var(--dusk-fg)",
  padding: "var(--space-2) var(--space-4)",
  borderRadius: "var(--radius-md)",
  border: "none",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const ghostButtonStyle = {
  background: "transparent",
  color: "var(--sub)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--hairline)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
};

const fieldStyle = {
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--hairline)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontSize: "14px",
};

export default function SponsorPage() {
  const org = useQuery(api.sponsor.mySponsorOrg);
  const deals = useQuery(api.sponsor.myDeals);
  const startDeal = useMutation(api.sponsor.startDeal);
  const recordKyb = useMutation(api.sponsor.recordKyb);
  const submitDeal = useMutation(api.sponsor.submitDeal);

  const [propertyName, setPropertyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);

  // The layout already gated on `org` (null → "no sponsor access"), so it is present here. Guard for
  // the loading frame anyway so the first paint never throws.
  if (org === undefined || org === null) return null;

  const canManage = org.canManage; // sponsor_principal — the server re-checks sponsor.manage regardless
  const kybPassed = org.kybStatus === "passed";
  const chip = kybChip(org.kybStatus);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      {/* Onboarding intro */}
      <section>
        <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Welcome
        </p>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-3)" }}>
          {org.name}
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          This is your Vesper sponsor portal. Complete <strong>KYB / Gate&nbsp;0</strong> to unlock deal
          submission, then start and submit your property deals for diligence review.
        </p>
      </section>

      {error && (
        <p role="alert" style={{ color: "var(--loss)", fontSize: "14px" }}>
          {error}
        </p>
      )}

      {/* KYB / Gate 0 */}
      <section>
        <h2 style={sectionHeading}>KYB / Gate 0</h2>
        <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}>
          <div>
            <div style={{ color: "var(--ink)", fontWeight: 600, marginBottom: "4px" }}>
              Know Your Business
            </div>
            <p style={{ color: "var(--sub)", fontSize: "14px", margin: 0 }}>
              {kybPassed
                ? "Gate 0 passed — you can submit deals for review."
                : "Gate 0 must pass before any deal can be submitted."}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <StatusChip status={chip.status} label={chip.label} title="Gate 0 — Know Your Business" />
            {canManage && !kybPassed && (
              <button
                style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}
                disabled={busy}
                onClick={() => run(() => recordKyb({ result: "passed" }))}
              >
                Run KYB check
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Deals */}
      <section>
        <h2 style={sectionHeading}>Your deals</h2>

        {canManage && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = propertyName.trim();
              if (!name) return;
              void run(async () => {
                await startDeal({ propertyName: name });
                setPropertyName("");
              });
            }}
            style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}
          >
            <input
              value={propertyName}
              onChange={(e) => setPropertyName(e.target.value)}
              placeholder="Property name"
              aria-label="Property name"
              style={{
                flex: 1,
                padding: "var(--space-2) var(--space-3)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--hairline)",
                background: "var(--bg)",
                color: "var(--ink)",
                fontSize: "14px",
              }}
            />
            <button type="submit" disabled={busy || !propertyName.trim()} style={{ ...buttonStyle, opacity: busy || !propertyName.trim() ? 0.6 : 1 }}>
              Start a deal
            </button>
          </form>
        )}

        {deals === undefined ? (
          <p style={{ color: "var(--sub)" }}>Loading deals…</p>
        ) : deals.length === 0 ? (
          <p style={{ color: "var(--sub)" }}>No deals yet. {canManage ? "Start one above." : ""}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {deals.map((d) => {
              const dc = dealChip(d.status);
              const isOpen = openDealId === d._id;
              return (
                <li key={d._id} style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}>
                    <span style={{ color: "var(--ink)", fontWeight: 500 }}>{d.propertyName}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      <StatusChip status={dc.status} label={dc.label} />
                      <button
                        style={ghostButtonStyle}
                        aria-expanded={isOpen}
                        onClick={() => setOpenDealId(isOpen ? null : d._id)}
                      >
                        {isOpen ? "Hide intake" : "Intake"}
                      </button>
                      {canManage && d.status !== "submitted" && (
                        <button
                          style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}
                          disabled={busy}
                          title={kybPassed ? undefined : "Complete KYB first"}
                          onClick={() => run(() => submitDeal({ dealId: d._id }))}
                        >
                          Submit for review
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && <DealIntake dealId={d._id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// DealIntake (Story 6.2) — the per-deal intake panel: the required-document CHECKLIST, an upload
// control with inline validation/reject reason, and the derived status TIMELINE. Every read/write is
// org-scoped server-side (requireSponsor + deal-ownership assert); this component only renders what the
// server returns. Both sponsor roles hold `sponsor.documents`, so the upload control shows for all —
// the server re-checks the permission on every call regardless.
function DealIntake({ dealId }: { dealId: Id<"sponsorDeals"> }) {
  const checklist = useQuery(api.sponsorIntake.checklistStatus, { dealId });
  const timeline = useQuery(api.sponsorIntake.dealTimeline, { dealId });
  const documents = useQuery(api.sponsorIntake.listDealDocuments, { dealId });
  const uploadDocument = useMutation(api.sponsorIntake.uploadDocument);

  const [kind, setKind] = useState("");
  const [storageRef, setStorageRef] = useState("");
  const [busy, setBusy] = useState(false);
  // The last upload's INLINE outcome — a validation rejection is a business result shown here, never an
  // error toast (the mutation resolves; it does not throw on a rejection).
  const [reject, setReject] = useState<string | null>(null);

  // Default the kind picker to the first still-missing item once the checklist loads.
  const firstMissing = checklist?.find((c) => c.status === "missing")?.kind ?? checklist?.[0]?.kind ?? "";
  const selectedKind = kind || firstMissing;

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    const ref = storageRef.trim();
    if (!selectedKind || !ref) return;
    setBusy(true);
    setReject(null);
    try {
      const res = await uploadDocument({ dealId, kind: selectedKind, storageRef: ref });
      if (res.status === "rejected") {
        setReject(res.rejectReason);
      } else {
        setStorageRef("");
      }
    } catch (err) {
      setReject(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        borderTop: "1px solid var(--hairline)",
        paddingTop: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
      }}
    >
      {/* Checklist */}
      <div>
        <h3 style={{ ...sectionHeading, marginBottom: "var(--space-2)" }}>Required documents</h3>
        {checklist === undefined ? (
          <p style={{ color: "var(--sub)", fontSize: "14px" }}>Loading checklist…</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {checklist.map((item) => (
              <li key={item.kind} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
                <span style={{ color: "var(--ink)", fontSize: "14px" }}>{item.label}</span>
                {item.status === "received" ? (
                  <StatusChip status="passed" label="Received" />
                ) : (
                  <StatusChip status="draft" label="Not uploaded" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Upload control with inline validation */}
      <form onSubmit={onUpload} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <select
            aria-label="Document type"
            value={selectedKind}
            onChange={(e) => setKind(e.target.value)}
            style={{ ...fieldStyle, minWidth: "12rem" }}
          >
            {(checklist ?? []).map((item) => (
              <option key={item.kind} value={item.kind}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            value={storageRef}
            onChange={(e) => setStorageRef(e.target.value)}
            placeholder="File reference (e.g. storage id / URL)"
            aria-label="File reference"
            style={{ ...fieldStyle, flex: 1, minWidth: "12rem" }}
          />
          <button type="submit" disabled={busy || !storageRef.trim()} style={{ ...buttonStyle, opacity: busy || !storageRef.trim() ? 0.6 : 1 }}>
            Upload
          </button>
        </div>
        {reject && (
          <p role="alert" style={{ color: "var(--loss)", fontSize: "13px", margin: 0 }}>
            {reject}
          </p>
        )}
      </form>

      {/* Uploaded documents — includes rejected rows with their reason */}
      {documents && documents.length > 0 && (
        <div>
          <h3 style={{ ...sectionHeading, marginBottom: "var(--space-2)" }}>Uploads</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {documents.map((doc) => (
              <li key={doc._id} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
                  <span style={{ color: "var(--ink)", fontSize: "14px" }}>{doc.kind || "(no type)"}</span>
                  {doc.status === "received" ? (
                    <StatusChip status="passed" label="Received" />
                  ) : (
                    <StatusChip status="blocked" label="Rejected" />
                  )}
                </div>
                {doc.status === "rejected" && doc.rejectReason && (
                  <span style={{ color: "var(--loss)", fontSize: "13px" }}>{doc.rejectReason}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Derived status timeline */}
      <div>
        <h3 style={{ ...sectionHeading, marginBottom: "var(--space-2)" }}>Status timeline</h3>
        {timeline === undefined ? (
          <p style={{ color: "var(--sub)", fontSize: "14px" }}>Loading timeline…</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {timeline.map((stage) => {
              const tc = timelineChip(stage.state);
              return (
                <li key={stage.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
                  <span style={{ color: "var(--ink)", fontSize: "14px" }}>{stage.label}</span>
                  <StatusChip status={tc.status} label={tc.label} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
