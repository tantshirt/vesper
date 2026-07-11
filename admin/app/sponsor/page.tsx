"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
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

export default function SponsorPage() {
  const org = useQuery(api.sponsor.mySponsorOrg);
  const deals = useQuery(api.sponsor.myDeals);
  const startDeal = useMutation(api.sponsor.startDeal);
  const recordKyb = useMutation(api.sponsor.recordKyb);
  const submitDeal = useMutation(api.sponsor.submitDeal);

  const [propertyName, setPropertyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              return (
                <li
                  key={d._id}
                  style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}
                >
                  <span style={{ color: "var(--ink)", fontWeight: 500 }}>{d.propertyName}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <StatusChip status={dc.status} label={dc.label} />
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
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
