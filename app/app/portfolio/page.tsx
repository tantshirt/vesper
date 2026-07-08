"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { formatUsd } from "../invest/[id]/invest.helpers";
import {
  PORTFOLIO_COPY,
  portfolioViewState,
  formatAllocationPct,
  allocationBarWidth,
  formatConcentrationNudge,
  describeHolding,
} from "../portfolio.helpers";

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

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  // Mirrors Home's ladder: summary stays `null` until the user row exists, so this drives the
  // signed-in-but-unprovisioned frame from the loading affordance into the real Portfolio.
  useEffect(() => {
    if (isAuthenticated && summary === null) {
      ensureUser().catch(() => {});
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
          <Link href="/explore">{PORTFOLIO_COPY.exploreCta}</Link>
        </p>
      </main>
    );
  }

  // Authenticated but the user row isn't provisioned yet (ensureUser in flight) → hold on loading so
  // the holdings never flash empty before they exist.
  if (summary === null) {
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
        <Link className="cta" href="/explore">{PORTFOLIO_COPY.exploreCta}</Link>
      </main>
    );
  }

  // The holdings view — per-holding rows, allocation-by-market bars, and (when concentrated) the nudge.
  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> {PORTFOLIO_COPY.eyebrow}</p>
      <h1>{PORTFOLIO_COPY.title}</h1>

      {/* Portfolio totals — cost-basis value + this-month income across all holdings (tabular). */}
      <div className="balance-card">
        <div className="stat-row">
          <span className="muted">{PORTFOLIO_COPY.totalValueLabel}</span>
          <b className="stat-figure">{formatUsd(summary.totalValue)}</b>
        </div>
        <div className="stat-row">
          <span className="muted">{PORTFOLIO_COPY.monthIncomeLabel}</span>
          <b className="stat-figure">{formatUsd(summary.totalMonthIncome)}</b>
        </div>
      </div>

      {/* Concentration nudge — never hidden when present. Calm --warning soft-tint, names the market
          and its share, and offers a constructive diversify link (FR13). */}
      {summary.concentration && (
        <div className="port-nudge" role="note">
          <p className="port-nudge-title">{PORTFOLIO_COPY.nudgeTitle}</p>
          <p className="port-nudge-body">
            {formatConcentrationNudge(summary.concentration.market, summary.concentration.pct)}
          </p>
          <Link className="cta ghost" href="/explore">{PORTFOLIO_COPY.diversifyCta}</Link>
        </div>
      )}

      {/* Per-holding rows: name, market, cost-basis value, this-month income (tabular figures). */}
      <div className="card">
        <p className="eyebrow">{PORTFOLIO_COPY.holdingsHeading}</p>
        {summary.holdings.map((h) => (
          <div className="port-holding" key={h.propertyId}>
            <span className="visually-hidden">{describeHolding(h)}</span>
            <div className="port-row" aria-hidden="true">
              <span className="port-name">{h.name}</span>
              <b className="stat-figure">{formatUsd(h.value)}</b>
            </div>
            <div className="port-row port-sub" aria-hidden="true">
              <span className="muted">{h.market}</span>
              <span className="muted">
                {PORTFOLIO_COPY.monthIncomeLabel} · {formatUsd(h.monthIncome)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Allocation-by-market bars (token .fundbar primitive). The share reads as text next to each
          market (the bar's accessible equivalent); the bar itself is decorative (aria-hidden). */}
      <div className="card">
        <p className="eyebrow">{PORTFOLIO_COPY.allocationHeading}</p>
        {summary.allocations.map((a) => (
          <div className="alloc-row" key={a.market}>
            <div className="alloc-head">
              <span className="port-name">{a.market}</span>
              <b className="stat-figure">{formatAllocationPct(a.pct)}</b>
            </div>
            <div className="alloc-bar" aria-hidden="true">
              <i style={{ width: allocationBarWidth(a.pct) }} />
            </div>
          </div>
        ))}
      </div>

      <Link className="cta ghost" href="/explore">{PORTFOLIO_COPY.exploreCta}</Link>
    </main>
  );
}
