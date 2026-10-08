"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
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
  aggregateHistoryByPeriod,
  monthAbbrev,
  formatPeriodLabel,
} from "../income.helpers";

// One line of the gross→net waterfall: a label, a bar whose width ∝ the amount (relative to gross), and
// the signed figure. Deductions read muted; the net line carries the single champagne accent (the bar
// fill) with a readable ink figure. Purely visual — the card's visually-hidden sentence is the a11y text.
function WaterfallRow({
  label,
  amount,
  width,
  tone,
  isNet,
}: {
  label: string;
  amount: string;
  width: string;
  tone: "gross" | "deduct" | "net";
  isNet?: boolean;
}) {
  return (
    <div className={`wf-row${isNet ? " is-net" : ""}`}>
      <span className="wf-label">{label}</span>
      <div className="wf-track">
        <div className={`wf-fill ${tone}`} style={{ width }} />
      </div>
      <span className={`wf-amount ${tone}`}>{amount}</span>
    </div>
  );
}

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
  const [provisionError, setProvisionError] = useState(false);

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  // Mirrors Home/Portfolio's ladder: summary stays `null` until the user row exists, so this drives the
  // signed-in-but-unprovisioned frame from the loading affordance into the real Income surface.
  useEffect(() => {
    if (isAuthenticated && summary === null) {
      ensureUser().catch(() => setProvisionError(true));
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
          <Link href="/app/explore">{INCOME_COPY.exploreCta}</Link>
        </p>
      </main>
    );
  }

  // Authenticated but the user row isn't provisioned yet (ensureUser in flight) → hold on loading so the
  // income never flashes empty before it exists.
  if (summary === null) {
    if (provisionError) {
      return (
        <main className="wrap">
          <p className="eyebrow"><span className="dot" /> {INCOME_COPY.eyebrow}</p>
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

  // The empty state: no distributions yet. Distinguish the provisioned-with-holdings owner (their first
  // income is on the way — name the expected date) from the no-holdings owner (a calm start + Explore).
  if (incomeViewState(summary) === "empty") {
    if (!summary.hasHoldings) {
      return (
        <main className="wrap">
          <p className="eyebrow"><span className="dot" /> {INCOME_COPY.eyebrow}</p>
          <h1>{INCOME_COPY.noHoldingsTitle}</h1>
          <p className="muted home-empty">{INCOME_COPY.noHoldingsBody}</p>
          <Link className="cta" href="/app/explore">{INCOME_COPY.exploreCta}</Link>
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
        <Link className="cta ghost" href="/app/explore">{INCOME_COPY.exploreCta}</Link>
      </main>
    );
  }

  // The income state — the latest distribution's waterfall + matches/variance, the honest banner when
  // the latest is missed, the history list, and the next-distribution date.
  const latest = summary.latest!;
  const nextDate = formatDistributionDate(summary.nextDistributionDate ?? undefined);
  // Collapse the per-distribution history into one row per month (three same-month rows would read as
  // noise); the bar chart runs oldest → newest as a timeline.
  const history = aggregateHistoryByPeriod(summary.history);
  const chart = [...history].reverse();
  const maxNet = Math.max(1, ...chart.map((r) => (r.status === "paid" ? r.netPaid : 0)));
  // Waterfall bar widths are relative to gross (guarded against a zero gross); a small floor keeps tiny
  // deductions visible.
  const gross = latest.grossShare > 0 ? latest.grossShare : 1;
  const barW = (n: number) => {
    const safe = Number.isFinite(n) ? Math.max(0, n) : 0;
    if (safe === 0) return "0%";
    return `${Math.max(3, Math.min(100, Math.round((safe / gross) * 100)))}%`;
  };

  return (
    <main className="wrap">
      <p className="eyebrow">{INCOME_COPY.eyebrow}</p>
      <h1>{INCOME_COPY.title}</h1>

      {/* Honest banner — a latest distribution that did not pay. Never hidden, never silent: it explains
          the miss and links onward to the property-updates surface (Story 5.4), where the latest operator
          note on the home lives. Keyed off status !== "paid" so a future "paused" state is covered too. */}
      {isMissed(latest.status) && (
        <div className="income-banner" role="note">
          <p className="income-banner-title">{INCOME_COPY.bannerTitle}</p>
          <p className="income-banner-body">{INCOME_COPY.bannerBody}</p>
          <Link className="cta ghost" href="/app/updates">
            {INCOME_COPY.updateCta}
          </Link>
        </div>
      )}

      {/* This distribution — the itemized gross→net waterfall (DD-002 order) as proportional bars. The
          visual is aria-hidden; the accessible equivalent is the single visually-hidden sentence. */}
      <div className="card">
        <div className="income-head">
          <p className="eyebrow">{INCOME_COPY.breakdownHeading}</p>
          {latest.status === "paid" && (
            <span className="income-period">{formatPeriodLabel(latest.period)}</span>
          )}
        </div>
        <span className="visually-hidden">{describeWaterfall(latest)}</span>
        {latest.status === "paid" ? (
          <div className="wf" aria-hidden="true">
            <WaterfallRow label={INCOME_COPY.grossLabel} amount={formatUsdCents(latest.grossShare)} width={barW(latest.grossShare)} tone="gross" />
            <WaterfallRow label={INCOME_COPY.costsLabel} amount={`−${formatUsdCents(latest.costs)}`} width={barW(latest.costs)} tone="deduct" />
            <WaterfallRow label={INCOME_COPY.mgmtLabel} amount={`−${formatUsdCents(latest.mgmtFee)}`} width={barW(latest.mgmtFee)} tone="deduct" />
            <WaterfallRow label={INCOME_COPY.reserveLabel} amount={`−${formatUsdCents(latest.reserve)}`} width={barW(latest.reserve)} tone="deduct" />
            <WaterfallRow label={INCOME_COPY.netLabel} amount={formatUsdCents(latest.netPaid)} width={barW(latest.netPaid)} tone="net" isNet />
          </div>
        ) : (
          <p className="muted">{STATUS_LABEL[latest.status]}</p>
        )}

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
      <div className="stat-row income-next">
        <span className="muted">{INCOME_COPY.nextLabel}</span>
        <b className="stat-figure">{nextDate ?? INCOME_COPY.nextFallback}</b>
      </div>

      {/* Income history — a monthly net-income bar chart (trend) over the by-month list (month + net +
          status). Each list row carries a text equivalent; the chart is decorative (aria-hidden). */}
      <div className="card">
        <p className="eyebrow">{INCOME_COPY.historyHeading}</p>
        {chart.length > 1 && (
          <div className="income-bars" aria-hidden="true">
            {chart.map((r) => (
              <div className="ibar" key={r.period}>
                <div className="ibar-track">
                  <div
                    className={`ibar-fill${r.status === "paid" ? "" : " off"}`}
                    style={{
                      height: `${Math.max(4, Math.round(((r.status === "paid" ? r.netPaid : 0) / maxNet) * 100))}%`,
                    }}
                  />
                </div>
                <span className="ibar-tick">{monthAbbrev(r.period)}</span>
              </div>
            ))}
          </div>
        )}
        {history.map((row) => (
          <div className="income-row" key={row.period}>
            <span className="visually-hidden">{describeHistoryRow(row)}</span>
            <div className="port-row" aria-hidden="true">
              <span className="port-name">{formatPeriodLabel(row.period)}</span>
              <b className="stat-figure">{formatUsdCents(row.netPaid)}</b>
            </div>
            <div className="port-row port-sub" aria-hidden="true">
              <span className="muted">{STATUS_LABEL[row.status]}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="actions">
        <Link className="cta ghost" href="/app/explore">{INCOME_COPY.exploreCta}</Link>
      </div>
    </main>
  );
}
