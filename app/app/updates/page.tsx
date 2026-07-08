"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import {
  UPDATES_COPY,
  updatesViewState,
  formatOccupancy,
  formatReserves,
  formatRentOnTime,
  describeUpdate,
} from "../updates.helpers";

// Story 5.4 · Property updates — a plain monthly note on every home you own, even the quiet ones (FR15).
// A pure read surface over `api.updates.summary` (auth-scoped; `null` when signed out, so nobody sees
// another owner's updates). One card per owned property renders the named operator, occupancy, reserve
// fund, rent-on-time, and the plain note; a quiet month renders the same card (never hidden); and a
// property whose update is overdue or has never been filed shows a calm awaiting/overdue note — never a
// silent gap. Each card carries a WCAG text equivalent. All copy/formatting live in pure, tested helpers
// (updates.helpers.ts). No crypto vocabulary ever surfaces here.

export default function Updates() {
  const { ready, authenticated, login } = usePrivy();
  const { isAuthenticated } = useConvexAuth();

  const summary = useQuery(api.updates.summary);
  const ensureUser = useMutation(api.users.ensureUser);

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  // Mirrors Home/Portfolio/Income's ladder: summary stays `null` until the user row exists, so this
  // drives the signed-in-but-unprovisioned frame from the loading affordance into the real surface.
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

  // Signed out → the calm welcome, never an updates screen. Gated on Privy's own `authenticated` (not the
  // Convex flag) so a returning, logged-in user whose Convex auth is still propagating falls through to
  // the provisioning loader below instead of flashing the "Sign in" welcome for a frame.
  if (!authenticated) {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {UPDATES_COPY.eyebrow}</p>
        <h1>{UPDATES_COPY.signedOutTitle}</h1>
        <p className="muted">{UPDATES_COPY.signedOutBody}</p>
        <button className="cta" onClick={() => login()}>{UPDATES_COPY.signInCta}</button>
        <p className="muted">
          <Link href="/explore">{UPDATES_COPY.exploreCta}</Link>
        </p>
      </main>
    );
  }

  // Authenticated but the user row isn't provisioned yet (ensureUser in flight) → hold on loading so the
  // updates never flash empty before they exist.
  if (summary === null) {
    return (
      <main className="wrap" role="status" aria-live="polite">
        <p className="muted">{"One moment…"}</p>
      </main>
    );
  }

  // The empty / start state: provisioned owner who owns nothing yet. Calm, honest, single onward
  // affordance into Explore — never a wall.
  if (updatesViewState(summary) === "empty") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {UPDATES_COPY.eyebrow}</p>
        <h1>{UPDATES_COPY.emptyTitle}</h1>
        <p className="muted home-empty">{UPDATES_COPY.emptyBody}</p>
        <Link className="cta" href="/explore">{UPDATES_COPY.exploreCta}</Link>
      </main>
    );
  }

  // The updates view — one card per owned property. Every card renders (quiet months included); an
  // overdue/awaiting property shows the calm note. The visual block is aria-hidden; the single
  // visually-hidden sentence (describeUpdate) is the accessible equivalent for the whole card.
  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> {UPDATES_COPY.eyebrow}</p>
      <h1>{UPDATES_COPY.title}</h1>
      <p className="muted home-empty">{UPDATES_COPY.subtitle}</p>

      {summary.updates.map((c) => (
        <div className="card update-card" key={c.propertyId}>
          <span className="visually-hidden">{describeUpdate(c)}</span>

          <div aria-hidden="true">
            <div className="port-row">
              <span className="port-name">{c.name}</span>
              <span className="muted">{c.location}</span>
            </div>

            {c.latest && (
              <>
                <p className="update-operator muted">
                  {UPDATES_COPY.operatorLabel} {c.latest.operator}
                </p>
                <div className="update-stats">
                  <div className="stat-row update-line">
                    <span className="muted">{UPDATES_COPY.occupancyLabel}</span>
                    <b className="stat-figure">{formatOccupancy(c.latest.occupancy)}</b>
                  </div>
                  <div className="stat-row update-line">
                    <span className="muted">{UPDATES_COPY.reservesLabel}</span>
                    <b className="stat-figure">{formatReserves(c.latest.reservesMonths)}</b>
                  </div>
                  <div className="stat-row update-line">
                    <span className="muted">{UPDATES_COPY.rentLabel}</span>
                    <b className="stat-figure">{formatRentOnTime(c.latest.rentOnTime)}</b>
                  </div>
                </div>
                <p className="update-note">{c.latest.note}</p>
              </>
            )}

            {/* Calm overdue/awaiting note — never a silent gap. Extends the .income-banner soft-tint. */}
            {c.overdue && (
              <p className="update-flag">
                {c.latest ? UPDATES_COPY.overdueNote : UPDATES_COPY.awaitingNote}
              </p>
            )}
          </div>
        </div>
      ))}

      <Link className="cta ghost" href="/explore">{UPDATES_COPY.exploreCta}</Link>
    </main>
  );
}
