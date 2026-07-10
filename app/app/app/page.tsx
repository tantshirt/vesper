"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatUsd } from "./invest/[id]/invest.helpers";
import {
  HOME_COPY,
  homeHeroState,
  formatSignedUsd,
  formatSignedPct,
  formatNextDistribution,
  sparklinePoints,
  sparklineAreaPath,
  describeSparkline,
} from "./home.helpers";

// Story 5.1 · Home — the payout is the hero (FR12). When a distribution has landed recently it leads
// with a dusk "Rent just landed +$X" hero (one champagne accent — the star); otherwise it shows the
// next-distribution date. Always: portfolio value, a signed all-time return, income-to-date, and a
// balance sparkline (with a text equivalent). The whole model comes from `api.home.summary`, an
// auth-scoped read over the reconciled mirror — `null` when signed out, so nobody sees another owner's
// stats. All copy/formatting/geometry live in pure, tested helpers (home.helpers.ts). No crypto
// vocabulary and no raw distribution receipt ever surface here. The balance card's portfolio affordance
// links to the dedicated /portfolio route (Story 5.2); the empty/signed-out Explore CTA stays genuine.

// Sparkline canvas dimensions (unitless SVG user space; the element scales responsively via CSS).
const SPARK_W = 280;
const SPARK_H = 64;

export default function Home() {
  const { ready, authenticated, login } = usePrivy();
  const { isAuthenticated } = useConvexAuth();

  const summary = useQuery(api.home.summary);
  const ensureUser = useMutation(api.users.ensureUser);
  const [provisionError, setProvisionError] = useState(false);

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  // Kept from the E1.1 backbone: summary stays `null` until the user row exists, so this drives the
  // signed-in-but-unprovisioned frame from the loading affordance into the real Home.
  useEffect(() => {
    if (isAuthenticated && summary === null) {
      ensureUser().catch(() => setProvisionError(true));
    }
  }, [isAuthenticated, summary, ensureUser]);

  // Privy still initializing, or the reactive summary hasn't resolved yet → calm loading (no shift).
  if (!ready || summary === undefined) {
    return (
      <main className="wrap">
        <p className="muted" role="status">{"One moment…"}</p>
      </main>
    );
  }

  // Signed out → the calm welcome, never a stats screen. Gated on Privy's own `authenticated` (not the
  // Convex flag) so a returning, logged-in user whose Convex auth is still propagating falls through to
  // the provisioning loader below instead of flashing the "Sign in" welcome for a frame.
  if (!authenticated) {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {HOME_COPY.eyebrow}</p>
        <h1>{HOME_COPY.signedOutTitle}</h1>
        <p className="muted">{HOME_COPY.signedOutBody}</p>
        <button className="cta" onClick={() => login()}>{HOME_COPY.signInCta}</button>
        <p className="muted">
          <Link href="/app/explore">{HOME_COPY.exploreCta}</Link>
        </p>
      </main>
    );
  }

  // Authenticated but the user row isn't provisioned yet (ensureUser in flight) → hold on loading so
  // the stats never flash empty before they exist.
  if (summary === null) {
    if (provisionError) {
      return (
        <main className="wrap">
          <p className="eyebrow"><span className="dot" /> {HOME_COPY.eyebrow}</p>
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

  const heroState = homeHeroState(summary);

  // The empty / start state: provisioned owner with no holdings yet. Calm, honest ($0 income), with a
  // single onward affordance into Explore — never a wall.
  if (heroState === "empty") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {HOME_COPY.eyebrow}</p>
        <h1>{HOME_COPY.emptyTitle}</h1>
        <p className="muted home-empty">{HOME_COPY.emptyBody}</p>
        <Link className="cta" href="/app/explore">{HOME_COPY.exploreCta}</Link>
      </main>
    );
  }

  // The overview: portfolio value hero + sparkline, supporting stats, and a "Your homes" preview.
  const points = sparklinePoints(summary.balanceSeries, SPARK_W, SPARK_H);
  const areaPath = sparklineAreaPath(summary.balanceSeries, SPARK_W, SPARK_H);
  const sparkDescription = describeSparkline(summary.balanceSeries);
  const nextDate = formatNextDistribution(summary.nextDistributionDate);
  // Sign-toned return figure (gain green / loss terracotta / muted at exactly zero).
  const returnTone =
    summary.allTimeReturn > 0 ? " pos" : summary.allTimeReturn < 0 ? " neg" : "";

  return (
    <main className="wrap home-page">
      {/* No champagne eyebrow dot on the overview: the fresh-distribution star (below) is the SOLE
          champagne accent here (intent contract), so the eyebrow stays unaccented alongside it. */}
      <p className="eyebrow">{HOME_COPY.eyebrow}</p>

      {/* Fresh-distribution celebration (dusk card, one champagne star) — sits above the overview. */}
      {heroState === "fresh" && summary.freshDistribution && (
        <div className="home-hero">
          <span className="home-star" aria-hidden="true" />
          <p className="home-star-label">{HOME_COPY.heroStarLabel}</p>
          <p className="home-lead">
            {HOME_COPY.heroLead} {formatSignedUsd(summary.freshDistribution.amount)}
          </p>
          <p className="home-hero-sub">{HOME_COPY.heroSub}</p>
        </div>
      )}

      <div className="home-grid">
        {/* Hero: the portfolio value at scale, a signed all-time return, and the balance sparkline
            (soft gradient area under the accent stroke). Tabular figures never shift on a reactive read. */}
        <section className="card home-value-card" aria-label={HOME_COPY.portfolioLabel}>
          <p className="stat-eyebrow">{HOME_COPY.portfolioLabel}</p>
          <p className="home-value">{formatUsd(summary.portfolioValue)}</p>
          <p className={`home-return${returnTone}`}>
            {formatSignedUsd(summary.allTimeReturn)} · {formatSignedPct(summary.allTimeReturnPct)}{" "}
            {HOME_COPY.returnLabel.toLowerCase()}
          </p>
          {points && (
            <div className="home-spark">
              <svg
                viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={sparkDescription}
              >
                <defs>
                  <linearGradient id="home-spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {areaPath && <path d={areaPath} fill="url(#home-spark-fill)" stroke="none" />}
                <polyline
                  points={points}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}
        </section>

        {/* Supporting stats — income to date · this month · next distribution. */}
        <div className="stat-grid">
          <div className="stat-card">
            <p className="stat-eyebrow">{HOME_COPY.incomeLabel}</p>
            <p className="stat-card-figure">{formatUsd(summary.incomeToDate)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-eyebrow">{HOME_COPY.monthLabel}</p>
            <p className="stat-card-figure">{formatUsd(summary.monthIncome)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-eyebrow">{HOME_COPY.nextLabel}</p>
            <p className="stat-card-figure">{nextDate ?? HOME_COPY.nextFallback}</p>
          </div>
        </div>

        {/* "Your homes" preview — a compact per-holding list that links onward to the full Portfolio. */}
        {summary.holdings.length > 0 && (
          <section className="card home-homes">
            <div className="home-homes-head">
              <p className="eyebrow">{HOME_COPY.homesHeading}</p>
              <Link className="home-link" href="/app/portfolio">
                {HOME_COPY.portfolioCta}
              </Link>
            </div>
            {summary.holdings.map((h) => (
              <div className="port-holding" key={h.propertyId}>
                <div className="port-row">
                  <span className="port-name">{h.name}</span>
                  <b className="stat-figure">{formatUsd(h.value)}</b>
                </div>
                <div className="port-row port-sub">
                  <span className="muted">{h.market}</span>
                  <span className="muted">
                    {HOME_COPY.monthLabel} · {formatUsd(h.monthIncome)}
                  </span>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="actions">
        <Link className="cta" href="/app/portfolio">{HOME_COPY.portfolioCta}</Link>
        <Link className="cta ghost" href="/app/income">{HOME_COPY.incomeCta}</Link>
        <Link className="cta ghost" href="/app/updates">{HOME_COPY.updatesCta}</Link>
        <Link className="cta ghost" href="/app/explore">{HOME_COPY.exploreCta}</Link>
      </div>
    </main>
  );
}
