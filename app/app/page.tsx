"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";

// E1.1 proof-of-wiring screen: sign in with Privy → Convex trusts the JWT →
// currentUser resolves reactively → ensureUser writes the user + an audit entry.
export default function Home() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { isAuthenticated } = useConvexAuth();

  const currentUser = useQuery(api.users.currentUser);
  const ensureUser = useMutation(api.users.ensureUser);

  // Provision the Convex user once Convex has accepted the Privy token.
  useEffect(() => {
    if (isAuthenticated && currentUser === null) {
      ensureUser().catch(() => {});
    }
  }, [isAuthenticated, currentUser, ensureUser]);

  if (!ready) return <main className="wrap"><p className="muted">Loading…</p></main>;

  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> Vesper · E1.1 backbone</p>
      <h1>Own real estate income, quietly.</h1>

      {!authenticated ? (
        <>
          <p className="muted">Sign in to verify the Privy → Convex reactive backbone.</p>
          <button className="cta" onClick={() => login()}>Sign in</button>
        </>
      ) : (
        <div className="card">
          <p className="ok">✓ Signed in with Privy</p>
          <Row k="Privy DID (sub)" v={user?.id ?? "—"} />
          <Row k="Convex trusts JWT" v={isAuthenticated ? "yes (customJwt verified)" : "verifying…"} />
          <Row
            k="Convex user (reactive)"
            v={currentUser === undefined ? "loading…" : currentUser === null ? "provisioning…" : currentUser._id}
          />
          <Row k="Embedded wallet" v={currentUser?.walletAddress ?? user?.wallet?.address ?? "pre-generating…"} />
          <button className="cta ghost" onClick={() => logout()}>Sign out</button>
        </div>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span className="muted">{k}</span>
      <code>{v}</code>
    </div>
  );
}
