"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { formatUsd } from "./invest/[id]/invest.helpers";
import {
  HOME_COPY,
  homeHeroState,
  formatSignedUsd,
  formatSignedPct,
  formatNextDistribution,
  sparklinePoints,
  describeSparkline,
} from "./home.helpers";

// Story 5.1 · Home — the payout is the hero (FR12). When a distribution has landed recently it leads
// with a dusk "Rent just landed +$X" hero (one champagne accent — the star); otherwise it shows the
// next-distribution date. Always: portfolio value, a signed all-time return, income-to-date, and a
// balance sparkline (with a text equivalent). The whole model comes from `api.home.summary`, an
// auth-scoped read over the reconciled mirror — `null` when signed out, so nobody sees another owner's
// stats. All copy/formatting/geometry live in pure, tested helpers (home.helpers.ts). No crypto
// vocabulary and no raw distribution receipt ever surface here. Portfolio affordance links to /explore
// (interim, matching Story 4.5 — the dedicated /portfolio route is Story 5.2).

// Sparkline canvas dimensions (unitless SVG user space; the element scales responsively via CSS).
const SPARK_W = 280;
const SPARK_H = 64;

export default function Home() {
  const { ready, authenticated, login } = usePrivy();
  const { isAuthenticated } = useConvexAuth();

  const summary = useQuery(api.home.summary);
  const ensureUser = useMutation(api.users.ensureUser);

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  // Kept from the E1.1 backbone: summary stays `null` until the user row exists, so this drives the
  // signed-in-but-unprovisioned frame from the loading affordance into the real Home.
  useEffect(() => {
    if (isAuthenticated && summary === null) {
      ensureUser().catch(() => {});
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
          <Link href="/explore">{HOME_COPY.exploreCta}</Link>
        </p>
      </main>
    );
  }

  // Authenticated but the user row isn't provisioned yet (ensureUser in flight) → hold on loading so
  // the stats never flash empty before they exist.
  if (summary === null) {
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
        <Link className="cta" href="/explore">{HOME_COPY.exploreCta}</Link>
      </main>
    );
  }

  // The balance card — portfolio value, signed all-time return, income-to-date, and the sparkline.
  const points = sparklinePoints(summary.balanceSeries, SPARK_W, SPARK_H);
  const sparkDescription = describeSparkline(summary.balanceSeries);
  const nextDate = formatNextDistribution(summary.nextDistributionDate);

  return (
    <main className="wrap">
      {/* No champagne eyebrow dot on the stats view: the fresh-distribution star is the SOLE champagne
          accent here (intent contract), so the eyebrow stays unaccented alongside it. */}
      <p className="eyebrow">{HOME_COPY.eyebrow}</p>

      {/* Fresh-distribution hero (dusk card, one champagne accent — the star). */}
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

      <div className="card balance-card">
        <div className="stat-row">
          <span className="muted">{HOME_COPY.portfolioLabel}</span>
          <b className="stat-figure">{formatUsd(summary.portfolioValue)}</b>
        </div>
        <div className="stat-row">
          <span className="muted">{HOME_COPY.returnLabel}</span>
          <b className="stat-figure">
            {formatSignedUsd(summary.allTimeReturn)} · {formatSignedPct(summary.allTimeReturnPct)}
          </b>
        </div>
        <div className="stat-row">
          <span className="muted">{HOME_COPY.incomeLabel}</span>
          <b className="stat-figure">{formatUsd(summary.incomeToDate)}</b>
        </div>

        {/* Sparkline only when there is at least one balance point; the accessible name lives on the
            role="img" SVG (a single announcement — no duplicate visually-hidden text). */}
        {points && (
          <div className="spark">
            <svg
              viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={sparkDescription}
            >
              <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" />
            </svg>
          </div>
        )}
      </div>

      {/* No fresh distribution → the next-distribution line (honest fallback when none is scheduled). */}
      {heroState === "next" && (
        <div className="stat-row">
          <span className="muted">{HOME_COPY.nextLabel}</span>
          <b className="stat-figure">{nextDate ?? HOME_COPY.nextFallback}</b>
        </div>
      )}

      <Link className="cta ghost" href="/explore">{HOME_COPY.exploreCta}</Link>
    </main>
  );
}
