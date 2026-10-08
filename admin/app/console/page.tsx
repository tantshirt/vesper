"use client";

import { ArrowRight, CheckCircle, Clock, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "vesper-app/convex/_generated/api";
import { PERMISSIONS } from "vesper-app/convex/roles";
import { PropertyArtwork } from "@/app/components/PropertyArtwork";

type QueueItem = {
  id: string;
  lane: "needs_action" | "blocked" | "awaiting";
  subject: string;
  stage: string;
  blocker: string | null;
  accountability: string | null;
  actionLabel: string;
  href: string;
  propertyId: string | null;
  propertyName: string | null;
  propertyLocation: string | null;
};

type PropertySummary = {
  id: string;
  name: string;
  location: string;
  stageLabel: string;
  completedSteps: number;
  totalSteps: number;
  progressLabel: string;
  nextStep: string;
  primaryAction: { label: string; href: string } | null;
};

const LANE = {
  blocked: { label: "Needs investigation", icon: WarningCircle },
  needs_action: { label: "Ready for you", icon: CheckCircle },
  awaiting: { label: "Waiting for confirmation", icon: Clock },
} as const;

export default function ConsolePage() {
  const me = useQuery(api.rbac.me);
  const queue = useQuery(api.adminOverview.getActionQueue, me ? {} : "skip") as QueueItem[] | undefined;
  const properties = useQuery(api.adminOverview.getPropertySummaries, me ? {} : "skip") as PropertySummary[] | undefined;
  if (!me) return null;

  const firstName = me.name.trim().split(/\s+/)[0] || "there";
  const canViewProperties = me.permissions.includes("property.read");

  return (
    <section className="admin-overview">
      <header className="admin-overview-head admin-home-head">
        <p className="admin-page-context">Home</p>
        <h1>Good to see you, {firstName}.</h1>
        <p>Here is the work that needs attention now, in priority order.</p>
      </header>

      <section className="admin-priority" aria-labelledby="priority-heading">
        <div className="admin-section-heading">
          <div>
            <h2 id="priority-heading">Your work</h2>
            <p>{queue === undefined ? "Checking current work…" : `${queue.length} item${queue.length === 1 ? "" : "s"} within your access`}</p>
          </div>
          {queue && queue.length > 0 && <span className="admin-count" aria-label={`${queue.length} work items`}>{queue.length}</span>}
        </div>

        <div className="admin-priority-list" aria-live="polite">
          {queue === undefined && (
            <div className="admin-loading-rows" role="status">
              <span /><span /><span />
              <span className="sr-only">Loading your work</span>
            </div>
          )}
          {queue?.length === 0 && (
            <div className="admin-empty-state">
              <CheckCircle aria-hidden="true" />
              <div>
                <h3>You are all caught up</h3>
                <p>{canViewProperties ? "There is no work requiring action within your access. You can still review a property below." : "There is no work requiring action within your access."}</p>
              </div>
            </div>
          )}
          {queue?.map((row, index) => {
            const lane = LANE[row.lane];
            const LaneIcon = lane.icon;
            return (
              <article className="admin-priority-row" key={row.id}>
                {row.propertyName && (
                  <div className="admin-priority-image">
                    <PropertyArtwork
                      name={row.propertyName}
                      location={row.propertyLocation}
                      propertyId={row.propertyId ?? undefined}
                      priority={index === 0}
                    />
                  </div>
                )}
                <div className="admin-priority-copy">
                  <p className={`admin-work-state is-${row.lane}`}><LaneIcon aria-hidden="true" />{lane.label}</p>
                  <h3>{row.subject}</h3>
                  {row.propertyLocation && <p className="admin-property-location">{row.propertyLocation}</p>}
                  <p>{row.stage}</p>
                  {row.blocker && <p><strong>Why:</strong> {row.blocker}</p>}
                  {row.accountability && <p><strong>Owner:</strong> {row.accountability}</p>}
                </div>
                <Link className="admin-row-action" href={row.href}>{row.actionLabel}<ArrowRight aria-hidden="true" /></Link>
              </article>
            );
          })}
        </div>
      </section>

      {canViewProperties && (
        <section className="admin-property-preview" aria-labelledby="property-preview-heading">
          <div className="admin-section-heading">
            <div><h2 id="property-preview-heading">Properties</h2><p>A quick look at where each property stands.</p></div>
            <Link href="/console/properties">View all <ArrowRight aria-hidden="true" /></Link>
          </div>
          <div className="admin-property-preview-list">
            {properties === undefined && <p className="admin-queue-empty">Loading properties…</p>}
            {properties?.slice(0, 3).map((property, index) => (
              <Link className="admin-property-preview-row" href={property.primaryAction?.href ?? "/console/properties"} key={property.id}>
                <div className="admin-property-preview-image">
                  <PropertyArtwork name={property.name} location={property.location} propertyId={property.id} priority={index === 0 && queue?.length === 0} />
                </div>
                <div><h3>{property.name}</h3><p>{property.location}</p><span>{property.stageLabel}</span></div>
                <ArrowRight aria-hidden="true" />
              </Link>
            ))}
            {properties?.length === 0 && <p className="admin-queue-empty">No properties are available within your access.</p>}
          </div>
        </section>
      )}

      <details className="admin-account">
        <summary>My account and access</summary>
        <div className="admin-account-body">
          <div><span>Name</span><strong>{me.name}</strong></div>
          <div><span>Email</span><strong>{me.email}</strong></div>
          <div><span>Roles</span><strong>{me.roles.join(", ") || "No roles"}</strong></div>
          <div className="admin-permissions"><span>Permissions</span><ul>{me.permissions.map((permission) => <li key={permission}><code>{permission}</code> {PERMISSIONS[permission]}</li>)}</ul></div>
        </div>
      </details>
    </section>
  );
}
