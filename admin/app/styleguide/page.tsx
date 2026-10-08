"use client";

import { useState } from "react";
import { StatusChip, type StatusKind } from "@/app/components/ui/StatusChip";
import { MonoData } from "@/app/components/ui/MonoData";
import { Money } from "@/app/components/ui/Money";
import { DataTable, type Column } from "@/app/components/ui/DataTable";
import { OnChainActionPanel, type OnChainPhase } from "@/app/components/ui/OnChainActionPanel";

// Styleguide — a DEV/QA verification surface (not a product screen). It demos every
// admin data-layer primitive in every state so the design system can be reviewed
// visually. It is intentionally NOT wired into the console nav.

const ALL_STATUSES: { kind: StatusKind; label?: string }[] = [
  { kind: "passed", label: "Signed" },
  { kind: "blocked", label: "SoD conflict" },
  { kind: "pending", label: "Needs you" },
  { kind: "onchain", label: "On-chain confirmed" },
  { kind: "draft", label: "Draft" },
  { kind: "complete", label: "Complete" },
];

type QueueRow = {
  id: string;
  property: string;
  gate: string;
  status: StatusKind;
  statusLabel: string;
  amount: number;
  ref: string;
};

const ROWS: QueueRow[] = [
  { id: "r1", property: "The Monroe", gate: "Gate 3 · Title", status: "pending", statusLabel: "Needs you", amount: 1_000_000, ref: "0x1E1B4400000000000000000000000000000000000000000000000000004B4B" },
  { id: "r2", property: "Cedar Row", gate: "Gate 6 · Billing", status: "blocked", statusLabel: "SoD conflict", amount: 480_500, ref: "0x9F3A11220000000000000000000000000000000000000000000000000000C7D2" },
  { id: "r3", property: "Harbor 12", gate: "Gate 3 · Title", status: "passed", statusLabel: "Signed", amount: 2_250_000, ref: "5Kd3NBUAdUnhFzBZ7q6z6b7a9QjYWm1Q3xJ4kP8vNtRcE2sLdG9hUf" },
  { id: "r4", property: "Ashfield", gate: "Distribution", status: "onchain", statusLabel: "Reconciled", amount: 18_240.55, ref: "0x77aa00bb0000000000000000000000000000000000000000000000000000FE01" },
  { id: "r5", property: "Belmont", gate: "Gate 1 · Intake", status: "draft", statusLabel: "Draft", amount: 0, ref: "—" },
  { id: "r6", property: "The Monroe", gate: "Gate 8 · Close", status: "complete", statusLabel: "Complete", amount: 1_000_000, ref: "0x1E1B4400000000000000000000000000000000000000000000000000004B4B" },
];

const COLUMNS: Column<QueueRow>[] = [
  { key: "property", header: "Property", render: (r) => <strong style={{ fontWeight: 600 }}>{r.property}</strong> },
  { key: "gate", header: "Gate", render: (r) => r.gate },
  { key: "status", header: "Status", render: (r) => <StatusChip status={r.status} label={r.statusLabel} /> },
  { key: "amount", header: "Units / Amount", align: "num", render: (r) => <Money value={r.amount} currency={r.gate === "Distribution" ? "USD" : "units"} /> },
  { key: "ref", header: "On-chain ref", render: (r) => (r.ref === "—" ? <span style={{ color: "var(--muted)" }}>—</span> : <MonoData value={r.ref} label="on-chain ref" />) },
];

export default function StyleguidePage() {
  const [phase, setPhase] = useState<OnChainPhase>("idle");

  return (
    <div className="sg">
      <header className="sg-head">
        <p className="sg-eyebrow">
          <span className="dot" aria-hidden />
          Admin design system · data layer
        </p>
        <h1 className="sg-title">Operator primitives</h1>
        <p className="sg-lead">
          Every primitive the admin surface adds on top of the canonical Vesper tokens — the operational
          status system, on-chain identifiers, the review-queue table, tabular money, and the on-chain
          action panel. A dev/QA surface, not a product screen.
        </p>
      </header>

      {/* StatusChip */}
      <section className="sg-section">
        <h2 className="sg-section-title">Status system</h2>
        <p className="sg-section-note">
          Every status pairs color + icon + label — never color alone. Semantic tokens only
          (gain / loss / warning), plus accent for on-chain and the champagne dot for the rare earned
          &ldquo;Complete&rdquo; moment.
        </p>
        <div className="sg-row">
          {ALL_STATUSES.map((s) => (
            <StatusChip key={s.kind} status={s.kind} label={s.label} />
          ))}
        </div>
        <div className="sg-row" style={{ marginTop: "var(--space-5)" }}>
          <span className="sg-note">Default labels:</span>
          <StatusChip status="passed" />
          <StatusChip status="blocked" />
          <StatusChip status="pending" />
          <StatusChip status="onchain" />
          <StatusChip status="draft" />
          <StatusChip status="complete" />
        </div>
      </section>

      {/* MonoData */}
      <section className="sg-section">
        <h2 className="sg-section-title">Mono-data — addresses, sigs, hashes</h2>
        <p className="sg-section-note">
          Monospace, tabular, ink. Truncated in the middle; click to copy the full value (and expand).
          Full value on hover.
        </p>
        <div className="sg-stack" style={{ maxWidth: 520 }}>
          <div className="sg-row">
            <span className="sg-note" style={{ minWidth: 110 }}>Mint address</span>
            <MonoData value="0x1E1B44a9E4c17bF6C2D3a5F8901234567890abcdEF01234567890abcd4B4B" label="mint address" />
          </div>
          <div className="sg-row">
            <span className="sg-note" style={{ minWidth: 110 }}>Tx signature</span>
            <MonoData value="5Kd3NBUAdUnhFzBZ7q6z6b7a9QjYWm1Q3xJ4kP8vNtRcE2sLdG9hUf" label="transaction signature" lead={8} tail={6} />
          </div>
          <div className="sg-row">
            <span className="sg-note" style={{ minWidth: 110 }}>Doc hash</span>
            <MonoData value="sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" label="document hash" />
          </div>
          <div className="sg-row">
            <span className="sg-note" style={{ minWidth: 110 }}>Short value</span>
            <MonoData value="0xAB4B" label="short value" />
          </div>
        </div>
      </section>

      {/* Money */}
      <section className="sg-section">
        <h2 className="sg-section-title">Money</h2>
        <p className="sg-section-note">Inter, tabular figures — columns align on the decimal. Signed variants pair a +/− sign with the semantic tint.</p>
        <div className="sg-row" style={{ gap: "var(--space-6)" }}>
          <Money value={1_000_000} currency="units" />
          <Money value={18_240.55} />
          <Money value={4_500.9} signed />
          <Money value={-1_280.4} signed />
          <Money value={0} signed />
        </div>
      </section>

      {/* DataTable */}
      <section className="sg-section">
        <h2 className="sg-section-title">Review-queue table</h2>
        <p className="sg-section-note">
          Sticky blurred header, 44px comfortable rows with a compact (36px) density toggle, status-chip
          cells, tabular money, mono-data IDs, lavender hover. Structure is virtualization-ready.
        </p>
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(r) => r.id}
          caption="Signature queue"
          subCaption={`${ROWS.length} items · toggle density top-right`}
        />
        <div style={{ marginTop: "var(--space-6)" }}>
          <DataTable
            columns={COLUMNS}
            rows={[]}
            rowKey={(r) => r.id}
            caption="Empty state"
            subCaption="No items to review"
            showDensityToggle={false}
            emptyLabel="Nothing in the queue — you're all caught up."
          />
        </div>
      </section>

      {/* OnChainActionPanel */}
      <section className="sg-section">
        <h2 className="sg-section-title">On-chain action panel</h2>
        <p className="sg-section-note">
          Midnight/dusk framing signals &ldquo;this touches the chain.&rdquo; States consequence + cost +
          finality before the confirm, and surfaces the intent → confirmed → reconciled lifecycle. The
          confirm handler is a placeholder in this story.
        </p>
        <div style={{ maxWidth: 620 }}>
          <OnChainActionPanel
            title="Mint The Monroe · 1,000,000 units"
            consequence="This mints The Monroe (1,000,000 units · ACL frozen) on Solana and attributes the mint to you in the permanent audit log."
            meta={[
              { label: "Supply", value: <Money value={1_000_000} currency="units" /> },
              { label: "Network cost", value: "≈ 0.0021 SOL" },
              { label: "Cluster", value: "mainnet-beta" },
            ]}
            confirmLabel="Mint on Solana"
            phase={phase}
            onConfirm={() => setPhase((p) => (p === "idle" ? "intent" : p === "intent" ? "confirmed" : p === "confirmed" ? "reconciled" : "idle"))}
            onCancel={() => setPhase("idle")}
          />
        </div>
        <p className="sg-note" style={{ marginTop: "var(--space-4)" }}>
          Confirm advances the demo lifecycle (idle → intent → confirmed → reconciled); Cancel resets it.
        </p>
      </section>
    </div>
  );
}
