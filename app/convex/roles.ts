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

// The sponsor role partition WITHIN the staff table (Admin Story 6.1). Sponsors are `staff` rows —
// never consumer `users` — carrying exactly one of these roles; `requireSponsor` (sponsor.ts) admits
// only these and resolves the caller to a single `sponsorOrgId`. Named here so the tenant-isolation
// primitive, the schema, and the provisioning path all read the SAME definition of "is a sponsor".
export const SPONSOR_ROLES = ["sponsor_principal", "sponsor_ops"] as const;
export type SponsorRole = (typeof SPONSOR_ROLES)[number];

// Validator for a single sponsor role — reused by the schema (`sponsorMembers.role`) and the
// internal `provisionSponsor` grant path so a non-sponsor role can never be written into a membership.
export const sponsorRoleValidator = v.union(
  v.literal("sponsor_principal"),
  v.literal("sponsor_ops"),
);

// The single "is this role a sponsor role?" predicate. One definition, read by every guard, so the
// role-partition wall cannot drift between the enforcement primitive and the read surface.
export function isSponsorRole(role: string): boolean {
  return role === "sponsor_principal" || role === "sponsor_ops";
}

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
  // Admin Story 6.2: upload/manage a deal's intake documents. Granted to BOTH sponsor roles because
  // Sofia (sponsor_ops) does the uploading per her persona — this is deliberately WIDER than
  // sponsor.manage (which stays principal-only for startDeal/submitDeal). Not operational (touches no
  // money/ownership/eligibility on chain), so it is a plain tenant-scoped capability.
  "sponsor.documents": "Upload/manage sponsor deal documents",
  "rbac.manage": "Configure staff roles and permissions",
  "breakglass.use": "Invoke time-boxed break-glass access",
  // Admin Story 1.3: OVERSIGHT permissions over the append-only audit trail (read the trail / export
  // it for regulators). These are NOT operational — they touch no money/ownership/eligibility on
  // chain — so platform_admin MAY hold them without violating "Platform-Admin has no operational
  // powers." They only ever read; there is no write/patch/delete of auditLog anywhere.
  "audit.read": "View the append-only audit trail",
  "audit.export": "Export the audit trail for regulators",
} as const;

export type Permission = keyof typeof PERMISSIONS;

// The four OPERATIONAL permissions — the ones that touch money / ownership / eligibility / gates on
// chain. Platform-Admin holds NONE of them (ROLE_PERMISSIONS below), and Story 1.4's grant surface
// refuses to combine any of them with `platform_admin`. Named here once so "operational" has a single
// definition every guard reads from, rather than a hand-copied list that could drift.
export const OPERATIONAL_PERMISSIONS = [
  "gate.sign",
  "mint.execute",
  "freeze.execute",
  "distribution.execute",
] as const satisfies readonly Permission[];

// rolesWithOperationalPower — the subset of the given roles whose derived permissions include ANY
// operational permission. Used by the platform-admin-operational grant guard (rbacAdmin.ts) so it can
// name the offending roles in the rejection reason.
export function rolesWithOperationalPower(roles: readonly string[]): StaffRole[] {
  const op = new Set<string>(OPERATIONAL_PERMISSIONS);
  return roles.filter((r) => {
    const perms = ROLE_PERMISSIONS[r as StaffRole];
    return perms ? perms.some((p) => op.has(p)) : false;
  }) as StaffRole[];
}

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
    // Oversight read of the trail (not export) — diligence sees the record, compliance owns export.
    "audit.read",
  ],
  compliance: ["property.read", "compliance.review", "freeze.execute", "audit.read", "audit.export"],
  ai_reviewer: ["property.read", "ai.review"],
  sponsor_principal: ["sponsor.read", "sponsor.manage", "sponsor.documents"],
  // sponsor_ops (Sofia) uploads intake documents but cannot start/submit deals — sponsor.documents
  // WITHOUT sponsor.manage. This is the split the 6.2 intake flow depends on.
  sponsor_ops: ["sponsor.read", "sponsor.documents"],
  // audit.read/export are oversight, not operational — platform_admin holds them without gaining any
  // money/ownership/eligibility power.
  platform_admin: ["rbac.manage", "breakglass.use", "audit.read", "audit.export"],
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
