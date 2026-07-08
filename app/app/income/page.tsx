"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { formatUsdCents } from "../invest/[id]/calculator.helpers";
import { formatDistributionDate } from "../invest/[id]/confirmation.helpers";
import {
  INCOME_COPY,
  STATUS_LABEL,
  incomeViewState,
  isMissed,
  formatMatchesTarget,
  formatBelowTarget,
  describeWaterfall,
  describeHistoryRow,
} from "../income.helpers";

// Story 5.3 · Income — itemize each distribution, confirm whether it matches the target yield, show
// history + the next distribution date, and never go silent on a missed payment (FR14). A pure read
// surface over `api.income.summary` (auth-scoped; `null` when signed out, so nobody sees another
// owner's income). The latest distribution renders as an itemized gross→net waterfall (with a text
// equivalent) plus a calm matches-target chip or below-target variance note; a non-paid latest surfaces
// an honest --warning banner with an onward link toward the home's update; and a most-recent-first
// history lists month + net + status. All copy/formatting live in pure, tested helpers
// (income.helpers.ts). No crypto vocabulary, no "USDC" label, and no raw distribution receipt ever
// surface here. Money uses cents precision — Income is the legibility surface (O3).

export default function Income() {
  const { ready, authenticated, login } = usePrivy();
  const { isAuthenticated } = useConvexAuth();

  const summary = useQuery(api.income.summary);
  const ensureUser = useMutation(api.users.ensureUser);

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  // Mirrors Home/Portfolio's ladder: summary stays `null` until the user row exists, so this drives the
  // signed-in-but-unprovisioned frame from the loading affordance into the real Income surface.
  useEffect(() => {
    if (isAuthenticated && summary === null) {
      ensureUser().catch(() => {});
    }
  }, [isAuthenticated, summary, ensureUser]);

  // Privy still initializing, or the reactive summary hasn't resolved yet → calm loading (no shift).
  if (!ready || summary === undefined) {
    return (
      <main className="wrap" role="status" aria-live="polite">
        <p className="muted">{"One moment…"}</p>
      </main>
    );
  }

  // Signed out → the calm welcome, never an income screen. Gated on Privy's own `authenticated` (not the
  // Convex flag) so a returning, logged-in user whose Convex auth is still propagating falls through to
  // the provisioning loader below instead of flashing the "Sign in" welcome for a frame.
  if (!authenticated) {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INCOME_COPY.eyebrow}</p>
        <h1>{INCOME_COPY.signedOutTitle}</h1>
        <p className="muted">{INCOME_COPY.signedOutBody}</p>
        <button className="cta" onClick={() => login()}>{INCOME_COPY.signInCta}</button>
        <p className="muted">
          <Link href="/explore">{INCOME_COPY.exploreCta}</Link>
        </p>
      </main>
    );
  }

  // Authenticated but the user row isn't provisioned yet (ensureUser in flight) → hold on loading so the
  // income never flashes empty before it exists.
  if (summary === null) {
    return (
      <main className="wrap" role="status" aria-live="polite">
        <p className="muted">{"One moment…"}</p>
      </main>
    );
  }

  // The empty state: no distributions yet. Distinguish the provisioned-with-holdings owner (their first
  // income is on the way — name the expected date) from the no-holdings owner (a calm start + Explore).
  if (incomeViewState(summary) === "empty") {
    if (!summary.hasHoldings) {
      return (
        <main className="wrap">
          <p className="eyebrow"><span className="dot" /> {INCOME_COPY.eyebrow}</p>
          <h1>{INCOME_COPY.noHoldingsTitle}</h1>
          <p className="muted home-empty">{INCOME_COPY.noHoldingsBody}</p>
          <Link className="cta" href="/explore">{INCOME_COPY.exploreCta}</Link>
        </main>
      );
    }
    const expected = formatDistributionDate(
      summary.nextDistributionDate ?? summary.firstDistributionDate ?? undefined,
    );
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INCOME_COPY.eyebrow}</p>
        <h1>{INCOME_COPY.emptyTitle}</h1>
        <p className="muted home-empty">{INCOME_COPY.emptyBody}</p>
        <div className="stat-row">
          <span className="muted">{INCOME_COPY.firstExpectedLabel}</span>
          <b className="stat-figure">{expected ?? INCOME_COPY.nextFallback}</b>
        </div>
        <Link className="cta ghost" href="/explore">{INCOME_COPY.exploreCta}</Link>
      </main>
    );
  }

  // The income state — the latest distribution's waterfall + matches/variance, the honest banner when
  // the latest is missed, the history list, and the next-distribution date.
  const latest = summary.latest!;
  const nextDate = formatDistributionDate(summary.nextDistributionDate ?? undefined);

  return (
    <main className="wrap">
      <p className="eyebrow">{INCOME_COPY.eyebrow}</p>
      <h1>{INCOME_COPY.title}</h1>

      {/* Honest banner — a latest distribution that did not pay. Never hidden, never silent: it explains
          the miss and links onward toward the home's update (interim target; the /updates route is 5.4).
          Keyed off status !== "paid" so a future "paused" state is covered identically. */}
      {isMissed(latest.status) && (
        <div className="income-banner" role="note">
          <p className="income-banner-title">{INCOME_COPY.bannerTitle}</p>
          <p className="income-banner-body">{INCOME_COPY.bannerBody}</p>
          <Link className="cta ghost" href={`/property/${latest.propertyId}`}>
            {INCOME_COPY.updateCta}
          </Link>
        </div>
      )}

      {/* The itemized gross→net waterfall (DD-002 order). The visual rows are aria-hidden; the accessible
          equivalent is the single visually-hidden sentence (a payout reads exactly for assistive tech). */}
      <div className="card">
        <p className="eyebrow">{INCOME_COPY.breakdownHeading}</p>
        <span className="visually-hidden">{describeWaterfall(latest)}</span>
        <div className="income-waterfall" aria-hidden="true">
          <div className="stat-row income-line">
            <span className="muted">{INCOME_COPY.grossLabel}</span>
            <b className="stat-figure">{formatUsdCents(latest.grossShare)}</b>
          </div>
          <div className="stat-row income-line">
            <span className="muted">{INCOME_COPY.costsLabel}</span>
            <b className="stat-figure">−{formatUsdCents(latest.costs)}</b>
          </div>
          <div className="stat-row income-line">
            <span className="muted">{INCOME_COPY.mgmtLabel}</span>
            <b className="stat-figure">−{formatUsdCents(latest.mgmtFee)}</b>
          </div>
          <div className="stat-row income-line">
            <span className="muted">{INCOME_COPY.reserveLabel}</span>
            <b className="stat-figure">−{formatUsdCents(latest.reserve)}</b>
          </div>
          <div className="stat-row income-net">
            <span>{INCOME_COPY.netLabel}</span>
            <b className="income-net-figure">{formatUsdCents(latest.netPaid)}</b>
          </div>
        </div>

        {/* Matches-target chip (calm gain soft-tint) — or, below target, a calm variance note. Only a
            paid distribution asserts a target match; a missed one shows neither (the banner speaks). */}
        {latest.status === "paid" &&
          (latest.target.matchesTarget ? (
            <p className="income-chip">{formatMatchesTarget(latest.target.targetYield)}</p>
          ) : (
            <p className="income-variance">
              {formatBelowTarget(latest.target.realizedYield, latest.target.targetYield)}
            </p>
          ))}
      </div>

      {/* Next-distribution date (honest fallback when none is scheduled). */}
      <div className="stat-row">
        <span className="muted">{INCOME_COPY.nextLabel}</span>
        <b className="stat-figure">{nextDate ?? INCOME_COPY.nextFallback}</b>
      </div>

      {/* Income history — most-recent-first (month + net + status). The latest also appears here; its
          detailed waterfall is the card above. Each row carries a text equivalent. */}
      <div className="card">
        <p className="eyebrow">{INCOME_COPY.historyHeading}</p>
        {summary.history.map((row, i) => (
          <div className="income-row" key={`${row.period}-${i}`}>
            <span className="visually-hidden">{describeHistoryRow(row)}</span>
            <div className="port-row" aria-hidden="true">
              <span className="port-name">{row.period}</span>
              <b className="stat-figure">{formatUsdCents(row.netPaid)}</b>
            </div>
            <div className="port-row port-sub" aria-hidden="true">
              <span className="muted">{STATUS_LABEL[row.status]}</span>
            </div>
          </div>
        ))}
      </div>

      <Link className="cta ghost" href="/explore">{INCOME_COPY.exploreCta}</Link>
    </main>
  );
}
