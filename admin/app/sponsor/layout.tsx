"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";

// Admin Story 6.1 — the WALLED sponsor shell. A SEPARATE route tree from `/console`: the internal
// AdminShell nav is never rendered here, and internal staff never see this surface. proxy.ts gates
// `/sponsor/*` at the edge (a WorkOS session is required); this shell then gates on the `mySponsorOrg`
// read — which resolves to null for anyone who is not a provisioned sponsor — and every Convex
// function it calls re-checks `requireSponsor` server-side. Defense in depth; the UI gate is never the
// sole enforcement point.
//
// Visually LIGHTER + guided than the internal console (per the design-system doc): a single calm
// header with the org name + KYB/Gate 0 status, and a centered guided content column — no dense
// operational sidebar. Tokens only (check:tokens clean).

// KYB/Gate 0 → StatusChip mapping. Never color alone — the chip pairs color + icon + label.
export function kybChip(kybStatus: "none" | "pending" | "passed" | "failed"): {
  status: StatusKind;
  label: string;
} {
  switch (kybStatus) {
    case "passed":
      return { status: "passed", label: "KYB passed" };
    case "failed":
      return { status: "blocked", label: "KYB failed" };
    case "pending":
      return { status: "pending", label: "KYB in review" };
    default:
      return { status: "draft", label: "KYB not started" };
  }
}

export default function SponsorLayout({ children }: { children: React.ReactNode }) {
  const { isLoading: authLoading } = useConvexAuth();
  const org = useQuery(api.sponsor.mySponsorOrg);

  // While the WorkOS token is in flight (authLoading) OR the sponsor read is still resolving
  // (org === undefined), show a calm loading state — never flash "no access" at a granted sponsor.
  if (authLoading || org === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  // org === null → not a provisioned sponsor (an internal staff member, or an ungranted account).
  // The wall holds server-side regardless; this is the friendly UI face of it.
  if (org === null) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: "var(--space-8)" }}>
        <div>
          <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
            No sponsor access
          </h1>
          <p style={{ color: "var(--sub)", maxWidth: "44ch", lineHeight: 1.6 }}>
            This is the Vesper sponsor portal. Your account is signed in but is not a provisioned
            sponsor. If you are a sponsor, ask your Vesper contact to send your invitation.
          </p>
        </div>
      </div>
    );
  }

  const chip = kybChip(org.kybStatus);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-4)",
          padding: "var(--space-5) var(--space-6)",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span
            style={{
              fontFamily: "var(--serif)",
              color: "var(--ink)",
              fontWeight: 600,
              fontSize: "17px",
            }}
          >
            Vesper for Sponsors
          </span>
          <span style={{ color: "var(--sub)", fontSize: "13px" }}>{org.name}</span>
        </div>
        <StatusChip status={chip.status} label={chip.label} title="Gate 0 — Know Your Business" />
      </header>

      <main
        style={{
          maxWidth: "72ch",
          margin: "0 auto",
          padding: "var(--space-8) var(--space-6)",
        }}
      >
        {children}
      </main>
    </div>
  );
}
