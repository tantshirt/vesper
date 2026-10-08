import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { effectivePermissions, requireStaff } from "./rbac";
import { allGatesSigned } from "./gates";

export type AdminQueueItem = {
  id: string;
  lane: "needs_action" | "blocked" | "awaiting";
  kind: "compliance" | "gate" | "mint" | "distribution" | "reconciliation";
  propertyId: Id<"properties"> | null;
  propertyName: string | null;
  propertyLocation: string | null;
  subject: string;
  stage: string;
  blocker: string | null;
  accountability: string | null;
  actionLabel: string;
  href: string;
};

export type PropertyContext = {
  id: Id<"properties">;
  name: string;
  location: string;
};

export type PropertyAction = {
  kind: "evidence" | "gates" | "publish" | "investors" | "payments";
  label: string;
  href: string;
};

type PropertyWorkflowStatus =
  | "review"
  | "blocked"
  | "ready_to_publish"
  | "publishing"
  | "ready_to_open"
  | "open"
  | "funded"
  | "closed";

export type PropertySummary = PropertyContext & {
  propertyType: string;
  status: PropertyWorkflowStatus;
  stageLabel: string;
  completedSteps: number;
  totalSteps: 4;
  progressLabel: string;
  nextStep: string;
  primaryAction: PropertyAction | null;
  availableActions: PropertyAction[];
};

function item(input: AdminQueueItem): AdminQueueItem {
  return input;
}

function propertyName(properties: Map<string, Doc<"properties">>, id: Id<"properties">): string {
  return properties.get(id)?.name ?? "Unknown property";
}

function propertyContext(
  properties: Map<string, Doc<"properties">>,
  id: Id<"properties">,
): PropertyContext | null {
  const property = properties.get(id);
  return property
    ? { id: property._id, name: property.name, location: property.location }
    : null;
}

function propertyStage(
  property: Doc<"properties">,
  diligenceComplete: boolean,
  reconciliationBlocked = false,
): Pick<PropertySummary, "status" | "stageLabel" | "completedSteps" | "totalSteps"> {
  if (reconciliationBlocked) {
    return { status: "blocked", stageLabel: "Publishing needs attention", completedSteps: 2, totalSteps: 4 };
  }
  if (property.status === "closed") {
    return { status: "closed", stageLabel: "Closed", completedSteps: 4, totalSteps: 4 };
  }
  if (property.status === "funded") {
    return { status: "funded", stageLabel: "Fully funded", completedSteps: 4, totalSteps: 4 };
  }
  if (property.status === "open") {
    return { status: "open", stageLabel: "Open to investors", completedSteps: 4, totalSteps: 4 };
  }

  const mintStatus = property.mintStatus ?? "none";
  if (mintStatus === "confirmed") {
    return { status: "ready_to_open", stageLabel: "Ready to open", completedSteps: 3, totalSteps: 4 };
  }
  if (mintStatus === "minting") {
    return { status: "publishing", stageLabel: "Publishing", completedSteps: 2, totalSteps: 4 };
  }
  if (diligenceComplete) {
    return { status: "ready_to_publish", stageLabel: "Ready to publish", completedSteps: 1, totalSteps: 4 };
  }
  return { status: "review", stageLabel: "Property review", completedSteps: 0, totalSteps: 4 };
}

function availablePropertyActions(
  permissions: Awaited<ReturnType<typeof effectivePermissions>>,
  propertyId: Id<"properties">,
  status: PropertyWorkflowStatus,
): PropertyAction[] {
  const can = (permission: (typeof permissions)[number]) => permissions.includes(permission);
  const actions: PropertyAction[] = [];
  const query = `?propertyId=${propertyId}`;
  if (can("ai.review")) actions.push({ kind: "evidence", label: "Review documents", href: `/console/diligence${query}` });
  if (can("gate.sign")) actions.push({ kind: "gates", label: "Review approvals", href: `/console/diligence/gates${query}` });
  if (can("mint.execute")) actions.push({ kind: "publish", label: "Manage publishing", href: `/console/mint${query}#property-${propertyId}` });
  if (can("compliance.review")) actions.push({ kind: "investors", label: "Review investors", href: `/console/compliance${query}` });
  if (can("distribution.execute")) actions.push({ kind: "payments", label: "Manage payments", href: `/console/distribution${query}` });

  const allowed = status === "review"
    ? new Set<PropertyAction["kind"]>(["evidence", "gates", "investors"])
    : status === "blocked"
      ? new Set<PropertyAction["kind"]>(["publish"])
      : ["ready_to_publish", "publishing", "ready_to_open"].includes(status)
        ? new Set<PropertyAction["kind"]>(["evidence", "gates", "publish", "investors"])
        : status === "open"
          ? new Set<PropertyAction["kind"]>(["investors", "payments"])
          : new Set<PropertyAction["kind"]>(["investors"]);
  return actions.filter((action) => allowed.has(action.kind));
}

function primaryPropertyAction(
  status: PropertyWorkflowStatus,
  actions: PropertyAction[],
): PropertyAction | null {
  const byKind = (kind: PropertyAction["kind"]) => actions.find((action) => action.kind === kind);
  if (status === "review") return byKind("gates") ?? byKind("evidence") ?? byKind("investors") ?? actions[0] ?? null;
  if (status === "blocked") {
    const publish = byKind("publish");
    return publish ? { ...publish, label: "Review publishing issue" } : null;
  }
  if (["ready_to_publish", "publishing", "ready_to_open"].includes(status)) {
    const publish = byKind("publish");
    if (publish) {
      return {
        ...publish,
        label: status === "publishing" ? "Check publishing status" : status === "ready_to_open" ? "Open property" : "Publish property",
      };
    }
  }
  if (["open", "funded", "closed"].includes(status)) {
    return byKind("payments") ?? byKind("investors") ?? actions[0] ?? null;
  }
  return actions[0] ?? null;
}

// Properties are exposed only to staff with the canonical property.read permission. Each summary
// contains one permission-safe next step; clients never receive an inaccessible destination and do
// not need to reproduce the workflow-state mapping.
export const getPropertySummaries = query({
  args: {},
  handler: async (ctx): Promise<PropertySummary[]> => {
    const staff = await requireStaff(ctx);
    const permissions = await effectivePermissions(ctx, staff);
    if (!permissions.includes("property.read")) return [];

    const properties = await ctx.db.query("properties").take(200);
    const summaries: PropertySummary[] = [];
    const unresolvedMints = new Set(
      (await ctx.db.query("reconciliations").order("desc").take(200))
        .filter((row) => row.status !== "applied" && row.mint)
        .map((row) => row.mint as string),
    );
    for (const property of properties) {
      const state = propertyStage(
        property,
        await allGatesSigned(ctx, property._id),
        Boolean(property.mint && unresolvedMints.has(property.mint)),
      );
      const availableActions = availablePropertyActions(permissions, property._id, state.status);
      const primaryAction = primaryPropertyAction(state.status, availableActions);
      summaries.push({
        id: property._id,
        name: property.name,
        location: property.location,
        propertyType: property.propertyType,
        ...state,
        progressLabel: `${state.completedSteps} of ${state.totalSteps} stages complete`,
        nextStep: primaryAction?.label ?? "No action is assigned to your role",
        primaryAction,
        availableActions,
      });
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// One permission-scoped read model for the overview. It reports only existing records with an
// actionable, blocked, or externally-awaiting state; workspace availability belongs in navigation.
export const getActionQueue = query({
  args: {},
  handler: async (ctx): Promise<AdminQueueItem[]> => {
    const staff = await requireStaff(ctx);
    const permissions = await effectivePermissions(ctx, staff);
    const can = (permission: (typeof permissions)[number]) => permissions.includes(permission);
    const rows: AdminQueueItem[] = [];
    const properties = new Map(
      (await ctx.db.query("properties").take(200)).map((property) => [property._id, property]),
    );

    if (can("ai.review")) {
      const runs = await ctx.db.query("extractionRuns").order("desc").take(400);
      const fields = await ctx.db.query("extractedFields").take(1000);
      const packages = await ctx.db.query("evidencePackages").take(400);
      const latestByProperty = new Map<string, Doc<"extractionRuns">>();
      for (const run of runs) {
        if (!latestByProperty.has(run.propertyId)) latestByProperty.set(run.propertyId, run);
      }
      for (const property of properties.values()) {
        if (property.status !== "gating") continue;
        const latest = latestByProperty.get(property._id);
        const context = propertyContext(properties, property._id);
        const base = {
          propertyId: property._id,
          propertyName: context?.name ?? null,
          propertyLocation: context?.location ?? null,
          subject: property.name,
          accountability: latest?.createdBy ?? null,
          href: `/console/diligence?propertyId=${property._id}`,
        };
        if (!latest) {
          rows.push(item({
            id: `evidence-start:${property._id}`,
            lane: "needs_action",
            kind: "gate",
            ...base,
            stage: "Document review has not started",
            blocker: null,
            actionLabel: "Start document review",
          }));
          continue;
        }
        if (latest.status === "running") {
          rows.push(item({ id: `evidence-running:${latest._id}`, lane: "awaiting", kind: "gate", ...base, stage: "Document review is running", blocker: null, actionLabel: "Check review status" }));
          continue;
        }
        if (latest.status === "failed") {
          rows.push(item({ id: `evidence-failed:${latest._id}`, lane: "blocked", kind: "gate", ...base, stage: "Document review stopped", blocker: "The latest extraction run failed", actionLabel: "Review the failure" }));
          continue;
        }
        const latestFields = fields.filter((field) => field.runId === latest._id);
        const unchecked = latestFields.filter((field) => field.status === "extracted" || field.status === "uncited");
        const assembled = packages.some((entry) => entry.propertyId === property._id && entry.assembledAt >= latest.createdAt);
        if (unchecked.length > 0) {
          rows.push(item({ id: `evidence-check:${latest._id}`, lane: "needs_action", kind: "gate", ...base, stage: `${unchecked.length} extracted fact${unchecked.length === 1 ? " needs" : "s need"} review`, blocker: null, actionLabel: "Review extracted facts" }));
        } else if (!assembled && latestFields.some((field) => field.status === "verified")) {
          rows.push(item({ id: `evidence-assemble:${latest._id}`, lane: "needs_action", kind: "gate", ...base, stage: "Verified evidence is ready to package", blocker: null, actionLabel: "Prepare evidence" }));
        }
      }
    }

    if (can("compliance.review")) {
      const eligibilityRows = await ctx.db.query("eligibility").take(200);
      for (const eligibility of eligibilityRows) {
        const user = await ctx.db.get(eligibility.userId);
        const userLabel = user?.walletAddress
          ? `Investor ${user.walletAddress.slice(0, 4)}…${user.walletAddress.slice(-4)}`
          : `Investor ${eligibility.userId.slice(-6)}`;
        const subject = `${userLabel} · ${propertyName(properties, eligibility.propertyId)}`;
        if (eligibility.amlFlag === "flagged" || user?.kycStatus === "failed") {
          rows.push(item({
            id: `compliance-blocked:${eligibility._id}`,
            lane: "blocked",
            kind: "compliance",
            propertyId: eligibility.propertyId,
            propertyName: propertyContext(properties, eligibility.propertyId)?.name ?? null,
            propertyLocation: propertyContext(properties, eligibility.propertyId)?.location ?? null,
            subject,
            stage: "Compliance hold",
            blocker: eligibility.amlFlag === "flagged" ? "AML screening is flagged" : "Identity verification failed",
            accountability: eligibility.reviewedBy ?? null,
            actionLabel: "Review case",
            href: `/console/compliance?propertyId=${eligibility.propertyId}`,
          }));
        } else if (!eligibility.reviewedBy || eligibility.amlFlag === undefined) {
          rows.push(item({
            id: `compliance-review:${eligibility._id}`,
            lane: "needs_action",
            kind: "compliance",
            propertyId: eligibility.propertyId,
            propertyName: propertyContext(properties, eligibility.propertyId)?.name ?? null,
            propertyLocation: propertyContext(properties, eligibility.propertyId)?.location ?? null,
            subject,
            stage: "Eligibility review",
            blocker: eligibility.amlFlag === undefined ? "AML review has not been recorded" : null,
            accountability: eligibility.reviewedBy ?? null,
            actionLabel: "Review case",
            href: `/console/compliance?propertyId=${eligibility.propertyId}`,
          }));
        }
      }

      const attestations = await ctx.db.query("eligibilityAttestations").take(200);
      for (const attestation of attestations) {
        if (!["waiting_dependencies", "failed", "unknown", "leased", "submitted"].includes(attestation.status)) continue;
        const lane = ["leased", "submitted"].includes(attestation.status) ? "awaiting" : "blocked";
        rows.push(item({
          id: `attestation:${attestation._id}`,
          lane,
          kind: "compliance",
          propertyId: attestation.propertyId,
          propertyName: propertyContext(properties, attestation.propertyId)?.name ?? null,
          propertyLocation: propertyContext(properties, attestation.propertyId)?.location ?? null,
          subject: `Eligibility attestation · ${propertyName(properties, attestation.propertyId)}`,
          stage: lane === "awaiting" ? "On-chain attestation submitted" : "On-chain entitlement blocked",
          blocker: lane === "blocked" ? (attestation.lastError ?? "Required wallet or mint evidence is unavailable") : null,
          accountability: null,
          actionLabel: "Review entitlement",
          href: `/console/compliance?propertyId=${attestation.propertyId}`,
        }));
      }
    }

    if (can("gate.sign")) {
      const gates = await ctx.db.query("diligenceGates").take(400);
      const grouped = new Map<string, Doc<"diligenceGates">[]>();
      for (const gate of gates) {
        const group = grouped.get(gate.propertyId) ?? [];
        group.push(gate);
        grouped.set(gate.propertyId, group);
      }
      for (const property of properties.values()) {
        if (property.status !== "gating" || grouped.has(property._id)) continue;
        rows.push(item({
          id: `gate-setup:${property._id}`,
          lane: "needs_action",
          kind: "gate",
          propertyId: property._id,
          propertyName: property.name,
          propertyLocation: property.location,
          subject: property.name,
          stage: "Approval steps have not been set up",
          blocker: null,
          accountability: null,
          actionLabel: "Set up approvals",
          href: `/console/diligence/gates?propertyId=${property._id}`,
        }));
      }
      for (const [propertyId, propertyGates] of grouped) {
        const failed = propertyGates.filter((gate) => gate.status === "failed");
        const pending = propertyGates.filter((gate) => gate.status === "pending");
        if (failed.length > 0) {
          rows.push(item({
            id: `gate-failed:${propertyId}`,
            lane: "blocked",
            kind: "gate",
            propertyId: propertyId as Id<"properties">,
            propertyName: propertyContext(properties, propertyId as Id<"properties">)?.name ?? null,
            propertyLocation: propertyContext(properties, propertyId as Id<"properties">)?.location ?? null,
            subject: propertyName(properties, propertyId as Id<"properties">),
            stage: "Diligence gates blocked",
            blocker: `${failed.length} gate${failed.length === 1 ? " has" : "s have"} failed`,
            accountability: null,
            actionLabel: "Review gates",
            href: `/console/diligence/gates?propertyId=${propertyId}`,
          }));
        } else if (pending.length > 0) {
          rows.push(item({
            id: `gate-pending:${propertyId}`,
            lane: "needs_action",
            kind: "gate",
            propertyId: propertyId as Id<"properties">,
            propertyName: propertyContext(properties, propertyId as Id<"properties">)?.name ?? null,
            propertyLocation: propertyContext(properties, propertyId as Id<"properties">)?.location ?? null,
            subject: propertyName(properties, propertyId as Id<"properties">),
            stage: "Diligence signature review",
            blocker: `${pending.length} gate${pending.length === 1 ? " is" : "s are"} pending`,
            accountability: null,
            actionLabel: "Review gates",
            href: `/console/diligence/gates?propertyId=${propertyId}`,
          }));
        }
      }
    }

    if (can("mint.execute")) {
      for (const property of properties.values()) {
        const mintStatus = property.mintStatus ?? "none";
        if (mintStatus === "minting") {
          rows.push(item({ id: `mint-awaiting:${property._id}`, lane: "awaiting", kind: "mint", propertyId: property._id, propertyName: property.name, propertyLocation: property.location, subject: property.name, stage: "Mint submitted", blocker: null, accountability: null, actionLabel: "Check mint status", href: `/console/mint?propertyId=${property._id}#property-${property._id}` }));
        } else if (mintStatus === "confirmed" && property.status === "gating") {
          rows.push(item({ id: `mint-list:${property._id}`, lane: "needs_action", kind: "mint", propertyId: property._id, propertyName: property.name, propertyLocation: property.location, subject: property.name, stage: "Mint confirmed; listing review ready", blocker: null, accountability: null, actionLabel: "Review listing", href: `/console/mint?propertyId=${property._id}#property-${property._id}` }));
        } else if (mintStatus === "none" && property.status === "gating") {
          if (await allGatesSigned(ctx, property._id)) {
            rows.push(item({ id: `mint-ready:${property._id}`, lane: "needs_action", kind: "mint", propertyId: property._id, propertyName: property.name, propertyLocation: property.location, subject: property.name, stage: "Diligence complete; mint review ready", blocker: null, accountability: null, actionLabel: "Review mint", href: `/console/mint?propertyId=${property._id}#property-${property._id}` }));
          }
        }
      }
    }

    if (can("distribution.execute")) {
      const operations = await ctx.db.query("externalOperations").order("desc").take(200);
      for (const operation of operations) {
        if (operation.kind !== "escrow_funding" && operation.kind !== "distribution_payout") continue;
        if (["reconciled", "reserved"].includes(operation.status)) continue;
        const awaiting = ["leased", "submitted"].includes(operation.status);
        rows.push(item({
          id: `distribution:${operation._id}`,
          lane: awaiting ? "awaiting" : "blocked",
          kind: "distribution",
          propertyId: operation.propertyId,
          propertyName: propertyContext(properties, operation.propertyId)?.name ?? null,
          propertyLocation: propertyContext(properties, operation.propertyId)?.location ?? null,
          subject: `${propertyName(properties, operation.propertyId)}${operation.period ? ` · ${operation.period}` : ""}`,
          stage: operation.kind === "escrow_funding" ? "Distribution escrow funding" : "Recipient payout",
          blocker: awaiting ? null : (operation.lastError ?? "Provider outcome requires review"),
          accountability: operation.actor || null,
          actionLabel: "Review distribution",
          href: `/console/distribution?propertyId=${operation.propertyId}`,
        }));
      }
    }

    if (can("mint.execute") || can("compliance.review")) {
      const reconciliations = await ctx.db.query("reconciliations").order("desc").take(100);
      for (const reconciliation of reconciliations) {
        if (reconciliation.status === "applied") continue;
        const reconciledProperty = reconciliation.mint
          ? [...properties.values()].find((property) => property.mint === reconciliation.mint)
          : undefined;
        rows.push(item({
          id: `reconciliation:${reconciliation._id}`,
          lane: "blocked",
          kind: "reconciliation",
          propertyId: reconciledProperty?._id ?? null,
          propertyName: reconciledProperty?.name ?? null,
          propertyLocation: reconciledProperty?.location ?? null,
          subject: reconciliation.mint ? `Mint ${reconciliation.mint.slice(0, 8)}…` : `Transaction ${reconciliation.signature.slice(0, 8)}…`,
          stage: reconciliation.status === "quarantined" ? "Chain evidence quarantined" : "Chain reconciliation unresolved",
          blocker: reconciliation.reason ?? "Chain evidence requires investigation",
          accountability: null,
          actionLabel: "Review reconciliation",
          href: can("mint.execute")
            ? `/console/mint${reconciledProperty ? `?propertyId=${reconciledProperty._id}#property-${reconciledProperty._id}` : ""}`
            : `/console/compliance${reconciledProperty ? `?propertyId=${reconciledProperty._id}` : ""}`,
        }));
      }
    }

    const laneOrder = { blocked: 0, needs_action: 1, awaiting: 2 } as const;
    return rows.sort((a, b) => laneOrder[a.lane] - laneOrder[b.lane] || a.subject.localeCompare(b.subject));
  },
});
