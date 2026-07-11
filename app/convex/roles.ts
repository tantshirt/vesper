import { v } from "convex/values";

// Single source of truth for staff roles, the permission catalog, and the role → permission map.
// Imported by BOTH the Convex enforcement layer (rbac.ts) and the admin UI (via the workspace
// `vesper-app/convex/roles` export), so server enforcement and UI rendering cannot drift.
//
// Permissions are DERIVED from roles on every request and never stored (see permissionsForRoles).
// There is exactly ONE derivation path — a second copy of the truth is the very drift this denies.

export const STAFF_ROLES = [
  "ops_diligence",
  "compliance",
  "ai_reviewer",
  "sponsor_principal",
  "sponsor_ops",
  "platform_admin",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

// Convex validator for a single staff role. Reused by the schema (`staff.roles`) and the grant path
// so an unknown role literal can never be written into the store.
export const roleValidator = v.union(
  v.literal("ops_diligence"),
  v.literal("compliance"),
  v.literal("ai_reviewer"),
  v.literal("sponsor_principal"),
  v.literal("sponsor_ops"),
  v.literal("platform_admin"),
);

// The permission catalog: every capability the admin surface gates on, with a human label.
// The four *operational* permissions — gate.sign, mint.execute, freeze.execute, distribution.execute
// — touch money / ownership / eligibility on chain. Platform-Admin holds NONE of them (see below).
export const PERMISSIONS = {
  "property.read": "View properties, diligence gates, and evidence",
  "diligence.review": "Record diligence review findings",
  "compliance.review": "Record compliance review decisions",
  "ai.review": "Produce AI review artifacts (advisory — never an approver)",
  "gate.sign": "Sign a diligence gate",
  "mint.execute": "Execute a property-token mint",
  "freeze.execute": "Freeze or thaw a token ACL",
  "distribution.execute": "Execute an income distribution",
  "sponsor.read": "View own sponsor-deal data (tenant-isolated)",
  "sponsor.manage": "Manage own sponsor-deal submissions",
  "rbac.manage": "Configure staff roles and permissions",
  "breakglass.use": "Invoke time-boxed break-glass access",
} as const;

export type Permission = keyof typeof PERMISSIONS;

// Role → permissions. Platform-Admin deliberately holds NO operational permission — it configures
// RBAC and holds break-glass only. NOTE: this table alone does not make "Platform-Admin has no
// operational power" *structurally* true — it holds `rbac.manage`, the power to grant, so it can
// escalate the moment Story 1.4 builds a grant UI. Story 1.4 must add the missing constraints
// (no self-grant; granting an operational role is itself an SoD-checked act). See spec Design Notes.
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  ops_diligence: [
    "property.read",
    "diligence.review",
    "gate.sign",
    "mint.execute",
    "distribution.execute",
  ],
  compliance: ["property.read", "compliance.review", "freeze.execute"],
  ai_reviewer: ["property.read", "ai.review"],
  sponsor_principal: ["sponsor.read", "sponsor.manage"],
  sponsor_ops: ["sponsor.read"],
  platform_admin: ["rbac.manage", "breakglass.use"],
};

// THE single permission-derivation path. A role change takes effect immediately because permissions
// are recomputed here on every request; there is no stored, drift-prone copy. Unknown roles are
// ignored (defensive — the validator already blocks them at write time).
export function permissionsForRoles(roles: readonly string[]): Permission[] {
  const out = new Set<Permission>();
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role as StaffRole];
    if (perms) for (const p of perms) out.add(p);
  }
  return [...out];
}
