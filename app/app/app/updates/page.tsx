"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { propertyImage } from "@/app/components/propertyImage";
import {
  UPDATES_COPY,
  updatesViewState,
  formatOccupancy,
  formatReserves,
  formatRentOnTime,
  describeUpdate,
} from "../updates.helpers";

// Reserve-fund runway is shown as a meter out of a healthy 6-month target (capped at full).
const RESERVE_TARGET_MONTHS = 6;

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
  const [provisionError, setProvisionError] = useState(false);

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  // Mirrors Home/Portfolio/Income's ladder: summary stays `null` until the user row exists, so this
  // drives the signed-in-but-unprovisioned frame from the loading affordance into the real surface.
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
          <Link href="/app/explore">{UPDATES_COPY.exploreCta}</Link>
        </p>
      </main>
    );
  }

  // Authenticated but the user row isn't provisioned yet (ensureUser in flight) → hold on loading so the
  // updates never flash empty before they exist.
  if (summary === null) {
    if (provisionError) {
      return (
        <main className="wrap">
          <p className="eyebrow"><span className="dot" /> {UPDATES_COPY.eyebrow}</p>
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

  // The empty / start state: provisioned owner who owns nothing yet. Calm, honest, single onward
  // affordance into Explore — never a wall.
  if (updatesViewState(summary) === "empty") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {UPDATES_COPY.eyebrow}</p>
        <h1>{UPDATES_COPY.emptyTitle}</h1>
        <p className="muted home-empty">{UPDATES_COPY.emptyBody}</p>
        <Link className="cta" href="/app/explore">{UPDATES_COPY.exploreCta}</Link>
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

      {summary.updates.map((c) => {
        // Split "Name, Role" into an avatar initial + name + role (role optional).
        const [opName, ...opRest] = (c.latest?.operator ?? "").split(",");
        const opNameSafe = opName.trim() || "Operator update";
        const opRole = opRest.join(",").trim();
        const initial = opNameSafe.charAt(0).toUpperCase();
        const reserveFill = c.latest
          ? Math.max(
              0,
              Math.min(100, Math.round((c.latest.reservesMonths / RESERVE_TARGET_MONTHS) * 100)),
            )
          : 0;

        return (
          <div className="card update-card" key={c.propertyId}>
            <span className="visually-hidden">{describeUpdate(c)}</span>

            <div aria-hidden="true">
              <div className="update-top">
                <img className="update-thumb" src={propertyImage(c.name, c.propertyId)} alt="" />
                <div className="update-id">
                  <span className="update-name">{c.name}</span>
                  <span className="update-loc">{c.location}</span>
                </div>
              </div>

              {c.latest && (
                <>
                  <div className="update-operator-row">
                    <span className="update-avatar">{initial}</span>
                    <div>
                      <span className="update-op-name">{opNameSafe}</span>
                      {opRole && <span className="update-op-role">{opRole}</span>}
                    </div>
                  </div>

                  <div className="update-strip">
                    <div className="update-stat">
                      <span className="update-stat-label">{UPDATES_COPY.occupancyLabel}</span>
                      <b className="update-stat-val">{formatOccupancy(c.latest.occupancy)}</b>
                      <div className="update-meter">
                        <i style={{ width: formatOccupancy(c.latest.occupancy) }} />
                      </div>
                    </div>
                    <div className="update-stat">
                      <span className="update-stat-label">{UPDATES_COPY.reservesLabel}</span>
                      <b className="update-stat-val">{formatReserves(c.latest.reservesMonths)}</b>
                      <div className="update-meter">
                        <i style={{ width: `${reserveFill}%` }} />
                      </div>
                    </div>
                    <div className="update-stat">
                      <span className="update-stat-label">{UPDATES_COPY.rentLabel}</span>
                      <span className={`update-pill ${c.latest.rentOnTime ? "ok" : "late"}`}>
                        {formatRentOnTime(c.latest.rentOnTime)}
                      </span>
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
        );
      })}

      <div className="actions">
        <Link className="cta ghost" href="/app/explore">{UPDATES_COPY.exploreCta}</Link>
      </div>
    </main>
  );
}
