"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrivy, useSolanaWallets } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  investGateState,
  shouldMirrorWallet,
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
  const ensureUser = useMutation(api.users.ensureUser);
  const setWalletAddress = useMutation(api.users.setWalletAddress);

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

  const state = investGateState({
    privyReady: ready,
    isAuthenticated: authenticated,
    walletAddress: resolvedAddress,
    propertyLoaded: property !== undefined,
    propertyFound: property != null,
  });

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

  // state === "ready" — honest handoff placeholder; E4 wires the calculator here.
  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> {INVEST_COPY.readyEyebrow}</p>
      <h1>{INVEST_COPY.readyTitle}</h1>
      {p && (
        <p className="muted">{p.name} · {p.location}</p>
      )}
      <div className="card">
        <p className="ok"><span aria-hidden="true">✓</span> {INVEST_COPY.readyConfirm}</p>
        <p className="muted">{INVEST_COPY.readyBody}</p>
      </div>
      <button className="cta" disabled aria-disabled="true">
        {INVEST_COPY.readyCta}
      </button>
      <p className="muted">{INVEST_COPY.readyNote}</p>
    </main>
  );
}
