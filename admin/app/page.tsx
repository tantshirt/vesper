import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { authConfigurationIssues, devAdminAuthConfigured, workosAuthConfigured } from "@/lib/authConfig";

// Dynamic: configured WorkOS SSO reads request/session state. Local preview auth bypasses WorkOS.
export const dynamic = "force-dynamic";

function ConfigurationState({ detail }: { detail?: string }) {
  return (
    <main className="admin-centered-state">
      <div>
        <h1>Admin sign-in is not configured</h1>
        <p>{detail ?? "Add the WorkOS credentials listed in admin/.env.local.example, or enable the development preview login."}</p>
        <p>Missing or invalid: <code>{authConfigurationIssues().join(", ") || "WorkOS rejected the configured credentials"}</code></p>
      </div>
    </main>
  );
}

export default async function AdminLanding() {
  const workosConfigured = workosAuthConfigured();
  const devAdminConfigured = devAdminAuthConfigured();

  if (!workosConfigured && devAdminConfigured) redirect("/console");

  if (!workosConfigured) return <ConfigurationState />;

  let signInUrl: string;
  try {
    signInUrl = await getSignInUrl();
  } catch (error) {
    console.error("WorkOS sign-in initialization failed", error);
    return <ConfigurationState detail="WorkOS could not start single sign-on. Check the configured tenant and redirect URI." />;
  }

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
