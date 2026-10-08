"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "vesper-app/convex/_generated/api";
import { STAFF_ROLES, type StaffRole } from "vesper-app/convex/roles";
import { DataTable, type Column } from "@/app/components/ui/DataTable";
import { StatusChip } from "@/app/components/ui/StatusChip";

// Story 1.4 — the Platform-Admin role matrix. Grants/revocations go through `manageStaffRoles`, which
// is `rbac.manage`-gated AND self-grant / SoD / platform-admin-operational-guarded SERVER-SIDE. This UI
// gate (and the nav gate) is a convenience, never the enforcement point — the Convex mutation re-checks
// and RETURNS `{ blocked, reason }` for a business-rejected grant (rendered loss-red below), while
// `previewGrantConflicts` shows the same conflicts BEFORE submit.

const inputStyle: React.CSSProperties = {
  font: "500 13px var(--sans)",
  color: "var(--ink)",
  background: "var(--surface)",
  border: "1px solid var(--hairline-2)",
  borderRadius: "var(--radius-md)",
  padding: "8px 11px",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  font: "600 11px var(--sans)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

export default function RolesPage() {
  const { isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.rbac.me);
  const canManage = !!me && me.permissions.includes("rbac.manage");

  const manageStaffRoles = useMutation(api.rbacAdmin.manageStaffRoles);

  const [workosId, setWorkosId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ blocked: boolean; message: string } | null>(null);

  // Live conflict preview — skipped until the form names a target and at least one role.
  const previewArgs =
    canManage && workosId.trim() && roles.length > 0
      ? { workosId: workosId.trim(), roles }
      : "skip";
  const preview = useQuery(api.rbacAdmin.previewGrantConflicts, previewArgs);

  const toggleRole = (r: StaffRole) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const submit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await manageStaffRoles({
        workosId: workosId.trim(),
        email: email.trim(),
        name: name.trim(),
        roles,
      });
      if (res.blocked) {
        setResult({ blocked: true, message: res.reason });
      } else {
        setResult({ blocked: false, message: `Granted ${roles.join(", ")} to ${name.trim()}.` });
        setWorkosId("");
        setEmail("");
        setName("");
        setRoles([]);
      }
    } catch (e) {
      setResult({ blocked: true, message: e instanceof Error ? e.message : "Grant failed." });
    } finally {
      setSubmitting(false);
    }
  };

  type RoleRow = { role: StaffRole };
  const roleColumns = useMemo<Column<RoleRow>[]>(
    () => [
      {
        key: "role",
        header: "Role",
        render: (r) => <code style={{ font: "500 13px var(--sans)", color: "var(--ink)" }}>{r.role}</code>,
      },
      {
        key: "selected",
        header: "In this grant",
        render: (r) =>
          roles.includes(r.role) ? (
            <StatusChip status="passed" label="Selected" />
          ) : (
            <span style={{ color: "var(--muted)" }}>—</span>
          ),
      },
      {
        key: "toggle",
        header: "",
        align: "num",
        render: (r) => (
          <button
            type="button"
            onClick={() => toggleRole(r.role)}
            style={{
              cursor: "pointer",
              font: "600 12px var(--sans)",
              color: roles.includes(r.role) ? "var(--sub)" : "var(--surface)",
              background: roles.includes(r.role) ? "var(--chip)" : "var(--accent)",
              border: "0",
              borderRadius: "var(--radius-pill)",
              padding: "6px 14px",
            }}
          >
            {roles.includes(r.role) ? "Remove" : "Add"}
          </button>
        ),
      },
    ],
    [roles],
  );

  if (authLoading || me === undefined) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--sub)" }}>
        Loading…
      </div>
    );
  }

  if (!canManage) {
    return (
      <section style={{ padding: "var(--space-8)", maxWidth: "48ch" }}>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "24px", marginBottom: "var(--space-3)" }}>
          Not permitted
        </h1>
        <p style={{ color: "var(--sub)", lineHeight: 1.6 }}>
          Managing staff roles requires the <code>rbac.manage</code> permission.
        </p>
      </section>
    );
  }

  const conflicts = preview?.conflicts ?? [];
  const canSubmit =
    !submitting &&
    !!workosId.trim() &&
    !!email.trim() &&
    !!name.trim() &&
    roles.length > 0 &&
    !preview?.wouldBlock;

  return (
    <section style={{ padding: "var(--space-6)", maxWidth: "80ch" }}>
      <header style={{ marginBottom: "var(--space-5)" }}>
        <p style={{ color: "var(--sub)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Team administration
        </p>
        <h1 style={{ fontFamily: "var(--serif)", color: "var(--ink)", fontSize: "28px", margin: "var(--space-2) 0 var(--space-1)" }}>
          Manage team access
        </h1>
        <p style={{ color: "var(--sub)", maxWidth: "68ch", lineHeight: 1.6 }}>
          Add or change what a staff member can do. Every change is checked for self-promotion,
          conflicting responsibilities, and the rule that platform administrators cannot perform
          operational work.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginBottom: "var(--space-5)" }}>
        <label style={labelStyle}>
          WorkOS ID
          <input style={inputStyle} value={workosId} onChange={(e) => setWorkosId(e.target.value)} placeholder="user_..." />
        </label>
        <label style={labelStyle}>
          Email
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@vesper.co" />
        </label>
        <label style={labelStyle}>
          Name
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </label>
      </div>

      <DataTable<RoleRow>
        columns={roleColumns}
        rows={STAFF_ROLES.map((role) => ({ role }))}
        rowKey={(r) => r.role}
        caption="Roles"
        subCaption={`${roles.length} selected`}
        showDensityToggle={false}
      />

      {conflicts.length > 0 && (
        <div
          role="alert"
          style={{
            marginTop: "var(--space-4)",
            padding: "var(--space-3) var(--space-4)",
            border: "1px solid var(--loss)",
            borderRadius: "var(--radius-md)",
            color: "var(--loss)",
            background: "var(--surface)",
          }}
        >
          <strong style={{ display: "block", marginBottom: "var(--space-1)" }}>
            This grant would be blocked
          </strong>
          <ul style={{ margin: 0, paddingLeft: "1.2em", lineHeight: 1.6 }}>
            {conflicts.map((c) => (
              <li key={c.kind}>{c.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div
          role="status"
          style={{
            marginTop: "var(--space-4)",
            padding: "var(--space-3) var(--space-4)",
            border: `1px solid ${result.blocked ? "var(--loss)" : "var(--gain)"}`,
            borderRadius: "var(--radius-md)",
            color: result.blocked ? "var(--loss)" : "var(--gain)",
            background: "var(--surface)",
          }}
        >
          {result.message}
        </div>
      )}

      <div style={{ marginTop: "var(--space-5)" }}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          style={{
            cursor: canSubmit ? "pointer" : "not-allowed",
            opacity: canSubmit ? 1 : 0.5,
            font: "600 13px var(--sans)",
            color: "var(--surface)",
            background: "var(--accent)",
            border: "0",
            borderRadius: "var(--radius-pill)",
            padding: "10px 22px",
          }}
        >
          {submitting ? "Granting…" : "Grant roles"}
        </button>
      </div>
    </section>
  );
}
