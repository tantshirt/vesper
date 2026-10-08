"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import {
  House,
  MagnifyingGlass,
  Buildings,
  CurrencyDollar,
  Newspaper,
  type Icon,
} from "@phosphor-icons/react";
import { Logo } from "./Logo";

// Shared navigation for the authenticated app. One source of truth for both the
// desktop left sidebar and the mobile bottom tab bar (only built screens — no Market/Learn yet).
// Icons are Phosphor (regular weight → `fill` + accent when the tab is active), replacing the old
// Unicode glyphs so the nav reads as a real, consistent icon set.
type NavItem = { href: string; label: string; icon: Icon; exact?: boolean };
const NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: House, exact: true },
  { href: "/app/explore", label: "Explore", icon: MagnifyingGlass },
  { href: "/app/portfolio", label: "Portfolio", icon: Buildings },
  { href: "/app/income", label: "Income", icon: CurrencyDollar },
  { href: "/app/updates", label: "Updates", icon: Newspaper },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/app";
  const { authenticated, user } = usePrivy();
  // Top-level tab screens show the mobile tab bar; pushed detail/flow screens
  // (property/invest) rely on their own back button + action bar instead.
  const showTabBar = NAV.some((n) => isActive(pathname, n.href, n.exact));
  const accountLabel =
    user?.email?.address?.split("@")[0] ??
    user?.phone?.number ??
    (authenticated ? "Account" : "Guest");
  const accountInitial = accountLabel.trim().charAt(0).toUpperCase() || "A";

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary">
        <Link href="/app" className="sidebar-brand" aria-label="Vesper home">
          <Logo size={24} />
        </Link>
        <nav className="sidebar-nav">
          {NAV.map((n) => {
            const on = isActive(pathname, n.href, n.exact);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`snav${on ? " on" : ""}`}
                aria-current={on ? "page" : undefined}
              >
                <Icon size={20} weight={on ? "fill" : "regular"} aria-hidden="true" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">{accountInitial}</span>
          <span className="sidebar-foot-name">{accountLabel}</span>
        </div>
      </aside>

      <div className="shell-main">
        <div className="shell-content">{children}</div>
      </div>

      {showTabBar && (
        <nav className="tabbar" aria-label="Primary">
          {NAV.map((n) => {
            const on = isActive(pathname, n.href, n.exact);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`tab${on ? " on" : ""}`}
                aria-current={on ? "page" : undefined}
              >
                <Icon size={22} weight={on ? "fill" : "regular"} aria-hidden="true" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
