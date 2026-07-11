"use client";

import { useQuery } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import { PERMISSIONS } from "vesper-app/convex/roles";

// Console home: names the signed-in human (never "admin" or a system label) with their roles and
// resolved permissions. AdminShell already gates loading / no-access, so `me` is a staff record here.
export default function ConsolePage() {
  const me = useQuery(api.rbac.me);
  if (!me) return null;

  return (
    <section style={{ padding: "var(--space-6)", maxWidth: "72ch" }}>
      <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Signed in
      </p>
      <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-1)" }}>
        {me.name}
      </h1>
      <p style={{ color: "var(--sub)", marginBottom: "var(--space-6)" }}>{me.email}</p>

      <h2 style={{ fontSize: "13px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-2)" }}>
        Roles
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-6)" }}>
        {me.roles.map((r) => (
          <span
            key={r}
            style={{
              background: "var(--chip)",
              color: "var(--accent)",
              padding: "var(--space-1) var(--space-3)",
              borderRadius: "var(--radius-pill)",
              fontSize: "13px",
            }}
          >
            {r}
          </span>
        ))}
      </div>

      <h2 style={{ fontSize: "13px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-2)" }}>
        Permissions
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-1)" }}>
        {me.permissions.map((p) => (
          <li key={p} style={{ color: "var(--ink)", display: "flex", gap: "var(--space-2)", alignItems: "baseline" }}>
            <code style={{ fontFamily: "var(--sans)", color: "var(--sub)", fontSize: "12px", minWidth: "16ch" }}>{p}</code>
            <span style={{ color: "var(--sub)" }}>{PERMISSIONS[p]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
