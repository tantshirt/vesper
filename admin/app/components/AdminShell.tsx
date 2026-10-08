"use client";

import { List, X } from "@phosphor-icons/react";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "vesper-app/convex/_generated/api";
import type { Permission } from "vesper-app/convex/roles";
import { DevAdminLogin } from "./DevAdminLogin";

type NavItem = {
  href: string;
  label: string;
  perm?: Permission;
  exact?: boolean;
  relatedPaths?: string[];
};
type NavGroup = { label: string; items: NavItem[] };

// Primary navigation follows the jobs staff came here to do. The implementation-specific property
// tools (evidence, gate signing, and publishing) remain available from each property workspace.
const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/console", label: "Home", exact: true },
      {
        href: "/console/properties",
        label: "Properties",
        perm: "property.read",
        relatedPaths: ["/console/diligence", "/console/mint"],
      },
      { href: "/console/compliance", label: "Investor reviews", perm: "compliance.review" },
      { href: "/console/distribution", label: "Payments", perm: "distribution.execute" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/console/roles", label: "Team access", perm: "rbac.manage" },
      { href: "/console/break-glass", label: "Emergency access", perm: "breakglass.use" },
      { href: "/console/audit", label: "Activity log", perm: "audit.read" },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.relatedPaths ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

function Navigation({ groups, pathname, onNavigate }: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="sidebar-nav">
      {groups.map((group) => (
        <div className="sidebar-nav-group" key={group.label}>
          <p className="sidebar-nav-label">{group.label}</p>
          {group.items.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`snav${active ? " on" : ""}`}
                aria-current={pathname === item.href ? "page" : active ? "location" : undefined}
                onClick={onNavigate}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/console";
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const previousPathRef = useRef(pathname);

  useEffect(() => {
    if (previousPathRef.current !== pathname) {
      previousPathRef.current = pathname;
      setMenuOpen(false);
      requestAnimationFrame(() => mainRef.current?.focus());
    }
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const drawer = drawerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer?.querySelector<HTMLElement>("a, button")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;

      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeAtDesktop);
    return () => desktop.removeEventListener("change", closeAtDesktop);
  }, []);

  if (authLoading || me === undefined) {
    return <div className="admin-centered-state" role="status">Loading…</div>;
  }

  if (!isAuthenticated) {
    if (process.env.NEXT_PUBLIC_VESPER_DEV_ADMIN_AUTH === "true") {
      return <DevAdminLogin />;
    }
    return (
      <div className="admin-centered-state">
        <div>
          <h1>Admin sign-in is not configured</h1>
          <p>Add the local WorkOS AuthKit credentials listed in <code>admin/.env.local.example</code>.</p>
        </div>
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="admin-centered-state">
        <div>
          <h1>No staff access</h1>
          <p>
            Your account is authenticated but has not been granted a staff role. Staff access is
            grant-only. Ask a Platform Admin to grant your roles.
          </p>
        </div>
      </div>
    );
  }

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.perm || me.permissions.includes(item.perm)),
  })).filter((group) => group.items.length > 0);
  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  return (
    <div className="shell admin-shell">
      <header className="admin-mobile-header">
        <Link href="/console" className="admin-mobile-brand" aria-label="Vesper Admin home">
          Vesper Admin
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className="admin-menu-button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls="admin-mobile-navigation"
          onClick={() => (menuOpen ? closeMenu(true) : setMenuOpen(true))}
        >
          {menuOpen ? <X aria-hidden="true" /> : <List aria-hidden="true" />}
        </button>
      </header>

      <aside className="sidebar admin-desktop-sidebar" aria-label="Primary">
        <Link href="/console" className="sidebar-brand" aria-label="Vesper Admin home">
          Vesper Admin
        </Link>
        <Navigation groups={groups} pathname={pathname} />
        <div className="sidebar-foot">
          <span className="avatar" aria-hidden="true">{(me.name.trim().charAt(0) || "?").toUpperCase()}</span>
          <span className="sidebar-foot-name">{me.name}</span>
        </div>
      </aside>

      {menuOpen && (
        <div className="admin-drawer-layer">
          <button className="admin-drawer-backdrop" type="button" aria-label="Close navigation" onClick={() => closeMenu(true)} />
          <aside
            ref={drawerRef}
            id="admin-mobile-navigation"
            className="admin-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Primary navigation"
          >
            <div className="admin-drawer-head">
              <span>Navigation</span>
              <button type="button" className="admin-menu-button" aria-label="Close navigation" onClick={() => closeMenu(true)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <Navigation groups={groups} pathname={pathname} onNavigate={() => closeMenu(true)} />
            <div className="sidebar-foot">
              <span className="avatar" aria-hidden="true">{(me.name.trim().charAt(0) || "?").toUpperCase()}</span>
              <span className="sidebar-foot-name">{me.name}</span>
            </div>
          </aside>
        </div>
      )}

      <main ref={mainRef} className="shell-main" id="main-content" tabIndex={-1}>
        <div className="shell-content">{children}</div>
      </main>
    </div>
  );
}
