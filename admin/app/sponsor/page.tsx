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

      {/* Monthly updates (Story 6.3) */}
      <MonthlyUpdates />
    </div>
  );
}

// MonthlyUpdates (Story 6.3) — the sponsor's monthly-update COMPOSER over the properties their org
// operates, plus the list of updates already published. Every field is required (even a quiet month is
// a full report); the server re-resolves the caller through requireSponsor + the operator link and
// re-validates on every publish, so this component only renders what the server returns. Both sponsor
// roles hold `sponsor.updates`, so the composer shows for all — the server re-checks regardless.
//
// `period` defaults to the previous calendar month (the month a sponsor is reporting on) in UTC, matching
// the server's YYYY-MM period key.
function defaultPeriod(): string {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return prev.toISOString().slice(0, 7);
}

function MonthlyUpdates() {
  const properties = useQuery(api.sponsorUpdates.myOperatedProperties);
  const updates = useQuery(api.sponsorUpdates.listMyUpdates);
  const publishUpdate = useMutation(api.sponsorUpdates.publishUpdate);

  const [propertyId, setPropertyId] = useState<string>("");
  const [period, setPeriod] = useState(defaultPeriod());
  const [occupancy, setOccupancy] = useState("96");
  const [reservesMonths, setReservesMonths] = useState("4");
  const [rentOnTime, setRentOnTime] = useState(true);
  const [operator, setOperator] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the picker to the first operated property once the list loads.
  const firstProperty = properties?.[0]?.id ?? "";
  const selectedProperty = propertyId || firstProperty;

  async function onPublish(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProperty) return;
    setBusy(true);
    setError(null);
    try {
      await publishUpdate({
        propertyId: selectedProperty as Id<"properties">,
        period: period.trim(),
        // Occupancy is entered as a whole-number percent for humans; the server stores the [0,1] fraction.
        occupancy: Number(occupancy) / 100,
        reservesMonths: Number(reservesMonths),
        rentOnTime,
        operator: operator.trim(),
        note: note.trim(),
      });
      // Reset only the free-text fields; keep the property + period selection for the next month.
      setOperator("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish the update.");
    } finally {
      setBusy(false);
    }
  }

  // No operated properties → nothing to author yet. Render a calm empty state rather than an empty form.
  const noProperties = properties !== undefined && properties.length === 0;

  return (
    <section>
      <h2 style={sectionHeading}>Monthly updates</h2>
      <p style={{ color: "var(--sub)", fontSize: "14px", margin: "0 0 var(--space-4)", lineHeight: 1.6 }}>
        Publish a monthly update for each property you operate — every month, including the quiet ones.
        A steady month is still a full report: occupancy, reserves, rent-on-time, and a plain note.
      </p>

      {error && (
        <p role="alert" style={{ color: "var(--loss)", fontSize: "14px" }}>
          {error}
        </p>
      )}

      {noProperties ? (
        <div style={cardStyle}>
          <p style={{ color: "var(--sub)", fontSize: "14px", margin: 0 }}>
            No operated properties yet. Once a property you operate is listed, its monthly-update composer
            appears here.
          </p>
        </div>
      ) : (
        <form
          onSubmit={onPublish}
          style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <label htmlFor="mu-property" style={{ color: "var(--sub)", fontSize: "13px" }}>
              Property
            </label>
            <select
              id="mu-property"
              value={selectedProperty}
              onChange={(e) => setPropertyId(e.target.value)}
              style={{ ...fieldStyle, minWidth: "12rem" }}
            >
              {(properties ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.location}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <label htmlFor="mu-period" style={{ color: "var(--sub)", fontSize: "13px" }}>
                Period (month)
              </label>
              <input
                id="mu-period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                style={fieldStyle}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <label htmlFor="mu-occupancy" style={{ color: "var(--sub)", fontSize: "13px" }}>
                Occupancy (%)
              </label>
              <input
                id="mu-occupancy"
                type="number"
                min={0}
                max={100}
                step={1}
                value={occupancy}
                onChange={(e) => setOccupancy(e.target.value)}
                style={{ ...fieldStyle, width: "7rem" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <label htmlFor="mu-reserves" style={{ color: "var(--sub)", fontSize: "13px" }}>
                Reserves (months)
              </label>
              <input
                id="mu-reserves"
                type="number"
                min={0}
                step={0.5}
                value={reservesMonths}
                onChange={(e) => setReservesMonths(e.target.value)}
                style={{ ...fieldStyle, width: "7rem" }}
              />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", color: "var(--ink)", fontSize: "14px" }}>
            <input
              type="checkbox"
              checked={rentOnTime}
              onChange={(e) => setRentOnTime(e.target.checked)}
            />
            Rent collected on time this month
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <label htmlFor="mu-operator" style={{ color: "var(--sub)", fontSize: "13px" }}>
              Operator
            </label>
            <input
              id="mu-operator"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              placeholder="e.g. Maria Alvarez, Property Manager"
              style={fieldStyle}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <label htmlFor="mu-note" style={{ color: "var(--sub)", fontSize: "13px" }}>
              Note to investors
            </label>
            <textarea
              id="mu-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="A plain summary of the month — even a steady month needs a note."
              rows={3}
              style={{ ...fieldStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </div>

          <button
            type="submit"
            disabled={busy || !selectedProperty || !operator.trim() || !note.trim()}
            style={{
              ...buttonStyle,
              alignSelf: "flex-start",
              opacity: busy || !selectedProperty || !operator.trim() || !note.trim() ? 0.6 : 1,
            }}
          >
            Publish update
          </button>
        </form>
      )}

      {/* Published updates */}
      {updates && updates.length > 0 && (
        <div style={{ marginTop: "var(--space-5)" }}>
          <h3 style={{ ...sectionHeading, marginBottom: "var(--space-3)" }}>Published</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {updates.map((u) => (
              <li key={u.id} style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
                  <span style={{ color: "var(--ink)", fontWeight: 600 }}>{u.propertyName}</span>
                  <span style={{ color: "var(--sub)", fontSize: "13px" }}>{u.period}</span>
                </div>
                <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", color: "var(--sub)", fontSize: "13px" }}>
                  <span>Occupancy {Math.round(u.occupancy * 100)}%</span>
                  <span>Reserves {u.reservesMonths} mo</span>
                  <span>{u.rentOnTime ? "Rent on time" : "Rent delayed"}</span>
                </div>
                <p style={{ color: "var(--ink)", fontSize: "14px", margin: 0, lineHeight: 1.6 }}>{u.note}</p>
                <span style={{ color: "var(--sub)", fontSize: "13px" }}>{u.operator}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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
