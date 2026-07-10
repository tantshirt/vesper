"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { propertyImage } from "@/app/components/propertyImage";
import { formatUsd } from "../invest/[id]/invest.helpers";
import {
  PORTFOLIO_COPY,
  portfolioViewState,
  formatAllocationPct,
  formatConcentrationNudge,
  describeHolding,
  type PortfolioAllocation,
} from "../portfolio.helpers";

// Indigo-family segment colors for the allocation donut — brand tokens only (no raw hex), cycled when
// there are more markets than colors.
const DONUT_COLORS = ["var(--accent)", "var(--block-mid)", "var(--midnight)"];

// A calm allocation-by-market ring: one arc per market (share ∝ arc length), drawn clockwise from 12
// o'clock, with a legend beside it. The visible ring is decorative (aria-hidden); the accessible
// equivalent is the sentence in the caller's visually-hidden span.
function AllocationDonut({ allocations }: { allocations: PortfolioAllocation[] }) {
  const R = 48;
  const C = 2 * Math.PI * R;
  const segments = allocations.reduce<{
    offset: number;
    items: Array<PortfolioAllocation & { i: number; len: number; offset: number }>;
  }>((acc, a, i) => {
    const pct = Math.max(0, Math.min(1, a.pct));
    return {
      offset: acc.offset + pct,
      items: [...acc.items, { ...a, i, len: pct * C, offset: acc.offset }],
    };
  }, { offset: 0, items: [] }).items;
  return (
    <div className="alloc-donut" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="alloc-ring">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--hairline-2)" strokeWidth="15" />
        <g transform="rotate(-90 60 60)">
          {segments.map((a) => (
            <circle
              key={a.market}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={DONUT_COLORS[a.i % DONUT_COLORS.length]}
              strokeWidth="15"
              strokeLinecap="butt"
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={-a.offset * C}
            />
          ))}
        </g>
      </svg>
      <ul className="alloc-legend">
        {allocations.map((a, i) => (
          <li key={a.market} className="alloc-legend-row">
            <span
              className="alloc-swatch"
              style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            <span className="alloc-legend-name">{a.market}</span>
            <b className="alloc-legend-pct">{formatAllocationPct(a.pct)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Story 5.2 · Portfolio — value + this-month income + allocation-by-market, with concentration honesty
// (FR13). A pure read surface over `api.portfolio.summary` (auth-scoped; `null` when signed out, so
// nobody sees another owner's holdings). Per-holding rows show cost-basis value + this month's income;
// allocation bars reuse the .fundbar token primitive with a text equivalent; and when a single market
// exceeds 35% of allocation a calm, never-hidden nudge names the market + its share and links to
// diversify. All copy/formatting live in pure, tested helpers (portfolio.helpers.ts). No crypto
// vocabulary and no raw distribution receipt ever surface here.

export default function Portfolio() {
  const { ready, authenticated, login } = usePrivy();
  const { isAuthenticated } = useConvexAuth();

  const summary = useQuery(api.portfolio.summary);
  const ensureUser = useMutation(api.users.ensureUser);
  const [provisionError, setProvisionError] = useState(false);

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  // Mirrors Home's ladder: summary stays `null` until the user row exists, so this drives the
  // signed-in-but-unprovisioned frame from the loading affordance into the real Portfolio.
  useEffect(() => {
    if (isAuthenticated && summary === null) {
      ensureUser().catch(() => setProvisionError(true));
    }
  }, [isAuthenticated, summary, ensureUser]);

  // Privy still initializing, or the reactive summary hasn't resolved yet → calm loading (no shift).
  // Same a11y markup as the provisioning loader below so the status is announced consistently.
  if (!ready || summary === undefined) {
    return (
      <main className="wrap" role="status" aria-live="polite">
        <p className="muted">{"One moment…"}</p>
      </main>
    );
  }

  // Signed out → the calm welcome, never a holdings screen. Gated on Privy's own `authenticated` (not
  // the Convex flag) so a returning, logged-in user whose Convex auth is still propagating falls through
  // to the provisioning loader below instead of flashing the "Sign in" welcome for a frame.
  if (!authenticated) {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {PORTFOLIO_COPY.eyebrow}</p>
        <h1>{PORTFOLIO_COPY.signedOutTitle}</h1>
        <p className="muted">{PORTFOLIO_COPY.signedOutBody}</p>
        <button className="cta" onClick={() => login()}>{PORTFOLIO_COPY.signInCta}</button>
        <p className="muted">
          <Link href="/app/explore">{PORTFOLIO_COPY.exploreCta}</Link>
        </p>
      </main>
    );
  }

  // Authenticated but the user row isn't provisioned yet (ensureUser in flight) → hold on loading so
  // the holdings never flash empty before they exist.
  if (summary === null) {
    if (provisionError) {
      return (
        <main className="wrap">
          <p className="eyebrow"><span className="dot" /> {PORTFOLIO_COPY.eyebrow}</p>
          <h1>We couldn't finish setting up your account.</h1>
          <p className="muted">Please try again. If this keeps happening, sign out and sign back in.</p>
          <button
            className="cta"
            onClick={() => {
              setProvisionError(false);
              ensureUser().catch(() => setProvisionError(true));
            }}
          >
            Try again
          </button>
        </main>
      );
    }
    return (
      <main className="wrap" role="status" aria-live="polite">
        <p className="muted">{"One moment…"}</p>
      </main>
    );
  }

  // The empty / start state: provisioned owner with no holdings yet. Calm, honest, with a single
  // onward affordance into Explore — never a wall, no bars, no nudge.
  if (portfolioViewState(summary) === "empty") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {PORTFOLIO_COPY.eyebrow}</p>
        <h1>{PORTFOLIO_COPY.emptyTitle}</h1>
        <p className="muted home-empty">{PORTFOLIO_COPY.emptyBody}</p>
        <Link className="cta" href="/app/explore">{PORTFOLIO_COPY.exploreCta}</Link>
      </main>
    );
  }

  // The holdings view — totals hero, per-holding rows, the allocation donut, and (when concentrated) the nudge.
  const allocationText = summary.allocations
    .map((a) => `${a.market} ${formatAllocationPct(a.pct)}`)
    .join(", ");

  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> {PORTFOLIO_COPY.eyebrow}</p>
      <h1>{PORTFOLIO_COPY.title}</h1>

      {/* Portfolio totals — cost-basis value at scale + this-month income (tabular; reuses the Home
          value-hero idiom so the two surfaces read as one system). */}
      <section className="card home-value-card port-totals" aria-label={PORTFOLIO_COPY.totalValueLabel}>
        <p className="stat-eyebrow">{PORTFOLIO_COPY.totalValueLabel}</p>
        <p className="home-value">{formatUsd(summary.totalValue)}</p>
        <p className="home-return">
          {PORTFOLIO_COPY.monthIncomeLabel} · {formatUsd(summary.totalMonthIncome)}
        </p>
      </section>

      {/* Concentration nudge — never hidden when present. Calm --warning soft-tint, names the market
          and its share, and offers a constructive diversify link (FR13). */}
      {summary.concentration && (
        <div className="port-nudge" role="note">
          <p className="port-nudge-title">{PORTFOLIO_COPY.nudgeTitle}</p>
          <p className="port-nudge-body">
            {formatConcentrationNudge(summary.concentration.market, summary.concentration.pct)}
          </p>
          <Link className="cta ghost" href="/app/explore">{PORTFOLIO_COPY.diversifyCta}</Link>
        </div>
      )}

      {/* Per-holding rows: property thumbnail + name/market + cost-basis value + this-month income. */}
      <div className="card">
        <p className="eyebrow">{PORTFOLIO_COPY.holdingsHeading}</p>
        {summary.holdings.map((h) => (
          <div className="port-home" key={h.propertyId}>
            <span className="visually-hidden">{describeHolding(h)}</span>
            <img className="port-thumb" src={propertyImage(h.name, h.propertyId)} alt="" aria-hidden="true" />
            <div className="port-home-main" aria-hidden="true">
              <div className="port-row">
                <span className="port-name">{h.name}</span>
                <b className="stat-figure">{formatUsd(h.value)}</b>
              </div>
              <div className="port-row port-sub">
                <span className="muted">{h.market}</span>
                <span className="muted">
                  {PORTFOLIO_COPY.monthIncomeLabel} · {formatUsd(h.monthIncome)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Allocation by market — a donut (share ∝ arc) + legend. The ring/legend are decorative; the
          accessible equivalent is the single visually-hidden sentence. */}
      <div className="card">
        <p className="eyebrow">{PORTFOLIO_COPY.allocationHeading}</p>
        <span className="visually-hidden">
          {PORTFOLIO_COPY.allocationHeading}: {allocationText}.
        </span>
        <AllocationDonut allocations={summary.allocations} />
      </div>

      <div className="actions">
        <Link className="cta" href="/app/income">{PORTFOLIO_COPY.incomeCta}</Link>
        <Link className="cta ghost" href="/app/updates">{PORTFOLIO_COPY.updatesCta}</Link>
        <Link className="cta ghost" href="/app/explore">{PORTFOLIO_COPY.exploreCta}</Link>
      </div>
    </main>
  );
}
