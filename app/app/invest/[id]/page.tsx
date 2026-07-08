"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrivy, useSolanaWallets } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  investGateState,
  shouldMirrorWallet,
  remainingRegAHeadroom,
  formatUsd,
  INVEST_COPY,
} from "./invest.helpers";

// Story 3.1 · Invest-flow entry — the auth-gated gateway behind Property Detail's "Invest" CTA.
// Unauthenticated → calm passkey/social signup (in place, so the user returns to this property).
// On signup Privy silently pre-generates a self-custodial Solana account; its address is mirrored
// once into the Convex user (audited) and NEVER shown. The invest flow proper (calculator, order,
// settlement) is Epic 4 — this page ends at an honest "account ready → continue" handoff.
export default function InvestPage() {
  const params = useParams<{ id: string }>();
  const propertyId = params.id as Id<"properties">;

  const { ready, authenticated, login, user } = usePrivy();
  const { isAuthenticated } = useConvexAuth();
  const { wallets: solanaWallets } = useSolanaWallets();

  const property = useQuery(api.properties.getWithGates, { id: propertyId });
  const currentUser = useQuery(api.users.currentUser);
  const eligibility = useQuery(api.eligibility.getEligibility, { propertyId });
  const ensureUser = useMutation(api.users.ensureUser);
  const setWalletAddress = useMutation(api.users.setWalletAddress);
  const recordEligibility = useMutation(api.eligibility.recordEligibility);
  const joinWaitlist = useMutation(api.eligibility.joinWaitlist);

  // Local form/submission state for the identity-check + waitlist steps (client-only; the
  // authoritative record lives in Convex). `country` maps to the jurisdiction the mutation records.
  const [country, setCountry] = useState<"us" | "other">("us");
  const [annualIncome, setAnnualIncome] = useState("");
  const [netWorth, setNetWorth] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  // Resolve the embedded Solana address. Select ONLY the Privy-embedded wallet (its
  // `walletClientType` is "privy"). Never fall back to `solanaWallets[0]`: with "wallet" in
  // `loginMethods` a user may have an external Solana wallet ordered first, and mirroring that as
  // the settlement routing key would link an account we did not pre-generate. If the embedded
  // wallet isn't resolvable yet, the `provisioning` gate covers the gap (we never write null).
  // Fall back to the value already mirrored on the Convex user, then to `user.wallet`. Internal only.
  const embeddedSolana = solanaWallets?.find((w) => w.walletClientType === "privy");
  const resolvedAddress =
    embeddedSolana?.address ??
    currentUser?.walletAddress ??
    user?.wallet?.address ??
    null;

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  useEffect(() => {
    if (isAuthenticated && currentUser === null) {
      ensureUser().catch(() => {});
    }
  }, [isAuthenticated, currentUser, ensureUser]);

  // Mirror the embedded address into the read model exactly once. `shouldMirrorWallet` guards
  // against null addresses, a missing user row, and already-linked accounts; the mutation is
  // mirror-once + idempotent server-side. Best-effort: a transient failure is swallowed and the
  // effect re-runs whenever its inputs next change (e.g. the reactive `currentUser` updates).
  useEffect(() => {
    if (isAuthenticated && shouldMirrorWallet(currentUser, resolvedAddress)) {
      setWalletAddress({ walletAddress: resolvedAddress! }).catch(() => {});
    }
  }, [isAuthenticated, currentUser, resolvedAddress, setWalletAddress]);

  // The per-property eligibility doc (undefined = query still resolving, null = no doc yet).
  const eligibilityLoaded = eligibility !== undefined;
  const eligible = eligibility == null ? null : eligibility.eligible;
  // Hold the loading affordance until the reactive user resolves, so a returning verified user
  // never flashes the identity-check step before their status is known.
  const userLoaded = !authenticated || currentUser !== undefined;

  const rawState = investGateState({
    privyReady: ready,
    isAuthenticated: authenticated,
    walletAddress: resolvedAddress,
    propertyLoaded: property !== undefined,
    propertyFound: property != null,
    kycStatus: currentUser?.kycStatus ?? null,
    eligibilityLoaded,
    eligible,
  });
  const state = !userLoaded && rawState !== "loading" ? "loading" : rawState;

  // Submit the (stubbed-Persona) identity check. The hosted Persona flow that would call this same
  // mutation is deferred; here the form is the KYC-result boundary and always reports success.
  async function submitIdentityCheck(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await recordEligibility({
        propertyId,
        jurisdiction: country === "us" ? "United States" : "Somewhere else",
        annualIncome: Number(annualIncome) || 0,
        netWorth: Number(netWorth) || 0,
        verified: true,
      });
    } catch {
      // Best-effort; the reactive state reflects the outcome. Failures leave the user on this step.
    } finally {
      setSubmitting(false);
    }
  }

  async function submitWaitlist() {
    if (joining) return;
    setJoining(true);
    try {
      await joinWaitlist({
        propertyId,
        jurisdiction: eligibility?.jurisdiction ?? (country === "us" ? "United States" : "Somewhere else"),
      });
      setJoined(true);
    } catch {
      // Idempotent server-side; a transient failure just leaves the CTA available to retry.
    } finally {
      setJoining(false);
    }
  }

  const p = property?.property ?? null;

  if (state === "loading") {
    return (
      <main className="wrap">
        <p className="muted" role="status">{INVEST_COPY.loadingLabel}</p>
      </main>
    );
  }

  if (state === "not-found") {
    return (
      <main className="wrap">
        <p className="muted">
          {INVEST_COPY.notFoundTitle}.{" "}
          <Link href="/explore">{INVEST_COPY.notFoundCta}</Link>
        </p>
      </main>
    );
  }

  if (state === "signup") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.signupTitle}</h1>
        {p && (
          <p className="muted">
            {INVEST_COPY.signupContext} {p.name} · {p.location}
          </p>
        )}
        <p className="muted">{INVEST_COPY.signupBody}</p>
        <button className="cta" onClick={() => login()}>
          {INVEST_COPY.signupCta}
        </button>
      </main>
    );
  }

  if (state === "provisioning") {
    return (
      <main className="wrap" role="status" aria-live="polite">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.provisioningTitle}</h1>
        <p className="muted">{INVEST_COPY.provisioningBody}</p>
      </main>
    );
  }

  if (state === "kyc") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.kycTitle}</h1>
        {p && (
          <p className="muted">{p.name} · {p.location}</p>
        )}
        <p className="muted">{INVEST_COPY.kycBody}</p>
        {currentUser?.kycStatus === "failed" && (
          <p className="muted" role="status">{INVEST_COPY.kycRetryNote}</p>
        )}
        <form className="card inv-form" onSubmit={submitIdentityCheck}>
          <label className="inv-field">
            <span className="inv-label">{INVEST_COPY.kycCountryLabel}</span>
            <select
              className="inv-input"
              value={country}
              onChange={(e) => setCountry(e.target.value as "us" | "other")}
            >
              <option value="us">{INVEST_COPY.kycCountryUs}</option>
              <option value="other">{INVEST_COPY.kycCountryOther}</option>
            </select>
          </label>
          <label className="inv-field">
            <span className="inv-label">{INVEST_COPY.kycIncomeLabel}</span>
            <input
              className="inv-input"
              type="number"
              min="0"
              inputMode="numeric"
              required
              value={annualIncome}
              onChange={(e) => setAnnualIncome(e.target.value)}
            />
          </label>
          <label className="inv-field">
            <span className="inv-label">{INVEST_COPY.kycNetWorthLabel}</span>
            <input
              className="inv-input"
              type="number"
              min="0"
              inputMode="numeric"
              required
              value={netWorth}
              onChange={(e) => setNetWorth(e.target.value)}
            />
          </label>
          <p className="muted">{INVEST_COPY.kycAmountHint}</p>
          <button className="cta" type="submit" disabled={submitting} aria-disabled={submitting}>
            {submitting ? INVEST_COPY.kycSubmitting : INVEST_COPY.kycCta}
          </button>
        </form>
      </main>
    );
  }

  if (state === "restricted") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.restrictedTitle}</h1>
        {p && (
          <p className="muted">{p.name} · {p.location}</p>
        )}
        <div className="card">
          <p className="muted">{INVEST_COPY.restrictedBody}</p>
          {joined ? (
            <p className="ok"><span aria-hidden="true">✓</span> {INVEST_COPY.restrictedConfirm}</p>
          ) : (
            <button
              className="cta"
              onClick={submitWaitlist}
              disabled={joining}
              aria-disabled={joining}
            >
              {joining ? INVEST_COPY.restrictedSubmitting : INVEST_COPY.restrictedCta}
            </button>
          )}
        </div>
      </main>
    );
  }

  // state === "eligible" — calm remaining-headroom line, then the still-disabled E4 handoff.
  const headroom = remainingRegAHeadroom(
    currentUser?.regAAnnualLimit,
    currentUser?.regAInvestedThisYear ?? 0,
  );
  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> {INVEST_COPY.eligibleEyebrow}</p>
      <h1>{INVEST_COPY.eligibleTitle}</h1>
      {p && (
        <p className="muted">{p.name} · {p.location}</p>
      )}
      <div className="card">
        <div className="row">
          <span className="muted">{INVEST_COPY.eligibleHeadroomLabel}</span>
          <b className="inv-headroom">{formatUsd(headroom)}</b>
        </div>
        <p className="muted">{INVEST_COPY.eligibleHeadroomNote}</p>
      </div>
      <button className="cta" disabled aria-disabled="true">
        {INVEST_COPY.eligibleCta}
      </button>
      <p className="muted">{INVEST_COPY.eligibleNote}</p>
    </main>
  );
}
