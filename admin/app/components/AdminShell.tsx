"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import type { Permission } from "vesper-app/convex/roles";

// Desktop-first admin shell. The nav is FILTERED by the permissions `me` returns — but this is a
// convenience, never the enforcement point: every admin Convex function independently resolves the
// caller through requireStaff/requirePermission. Nav entries link ONLY to routes a story has actually
// built; a later story adds its own entry when it ships the route (no dead links).
type NavItem = { href: string; label: string; perm?: Permission; exact?: boolean };
const NAV: NavItem[] = [
  { href: "/console", label: "Overview", exact: true }, // Story 1.1
  { href: "/console/roles", label: "Roles", perm: "rbac.manage" }, // Story 1.4 — gated on rbac.manage
  { href: "/console/break-glass", label: "Break-glass", perm: "breakglass.use" }, // Story 1.4 — gated on breakglass.use
  { href: "/console/audit", label: "Audit", perm: "audit.read" }, // Story 1.3 — gated on audit.read
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/console";
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);

  // Gate the "No staff access" state on Convex's AUTH-LOADING state (authLoading) AND on the `me`
  // query still loading (me === undefined) — never on `me === null` alone. While the WorkOS token is
  // in flight authLoading is true, and until the RBAC read resolves `me` is undefined; showing "No
  // staff access" in either window would flash it at granted staff on every load.
  if (authLoading || me === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  if (me === null) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: "var(--space-8)" }}>
        <div>
          <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
            No staff access
          </h1>
          <p style={{ color: "var(--sub)", maxWidth: "42ch", lineHeight: 1.6 }}>
            Your account is authenticated but has not been granted a staff role. Staff access is
            grant-only — ask a Platform Admin to grant your roles.
          </p>
        </div>
      </div>
    );
  }

  const items = NAV.filter((n) => !n.perm || me.permissions.includes(n.perm));

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary">
        <Link href="/console" className="sidebar-brand" aria-label="Vesper Admin home"
          style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontWeight: 600 }}>
          Vesper Admin
        </Link>
        <nav className="sidebar-nav">
          {items.map((n) => {
            const on = isActive(pathname, n.href, n.exact);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`snav${on ? " on" : ""}`}
                aria-current={on ? "page" : undefined}
              >
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">{(me.name.trim().charAt(0) || "?").toUpperCase()}</span>
          <span className="sidebar-foot-name">{me.name}</span>
        </div>
      </aside>

      <div className="shell-main">
        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}
