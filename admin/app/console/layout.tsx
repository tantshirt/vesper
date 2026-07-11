import { AdminShell } from "@/app/components/AdminShell";

// The /console subtree is staff-only. proxy.ts gates it at the edge (a WorkOS session is required to
// reach it at all); AdminShell then gates on the RBAC `me` read, and every Convex function it calls
// re-checks server-side. Defense in depth — the UI gate is never the sole enforcement point.
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
