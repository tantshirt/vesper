import { getSignInUrl } from "@workos-inc/authkit-nextjs";

// Dynamic: getSignInUrl reads request/session state and calls WorkOS, so this must not be
// prerendered at build time (a missing tenant would then fail the build instead of surfacing at
// request time, which is the honest place for a misconfiguration to show up).
export const dynamic = "force-dynamic";

// Signed-out SSO front door. Do NOT swallow a getSignInUrl() failure into a silent fallback — a
// misconfigured WorkOS tenant must surface loudly here, not masquerade as a working sign-in until a
// human clicks a dead button. If getSignInUrl throws, the error page is the correct, visible outcome.
export default async function AdminLanding() {
  const signInUrl = await getSignInUrl();

  return (
    <main className="admin-landing" style={{ maxWidth: "480px", margin: "0 auto", padding: "var(--space-10) var(--space-6)" }}>
      <p className="eyebrow" style={{ color: "var(--sub)", letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "13px" }}>
        Vesper
      </p>
      <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "32px", margin: "var(--space-3) 0 var(--space-4)" }}>
        Admin &amp; supply control plane
      </h1>
      <p style={{ color: "var(--sub)", lineHeight: 1.6, marginBottom: "var(--space-7)" }}>
        Staff access only. Sign in with your organization&apos;s single sign-on to continue.
      </p>
      <a
        href={signInUrl}
        style={{
          display: "inline-block",
          background: "var(--accent)",
          color: "var(--dusk-fg)",
          padding: "var(--space-3) var(--space-6)",
          borderRadius: "var(--radius-md)",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Sign in with SSO
      </a>
    </main>
  );
}
