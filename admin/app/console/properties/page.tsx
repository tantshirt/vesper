"use client";

import { ArrowRight, Buildings, CheckCircle } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "vesper-app/convex/_generated/api";
import { PropertyArtwork } from "@/app/components/PropertyArtwork";

type PropertyAction = {
  kind: "evidence" | "gates" | "publish" | "investors" | "payments";
  label: string;
  href: string;
};

type PropertySummary = {
  id: string;
  name: string;
  location: string;
  propertyType: string;
  status: string;
  stageLabel: string;
  completedSteps: number;
  totalSteps: number;
  progressLabel: string;
  nextStep: string;
  primaryAction: PropertyAction | null;
  availableActions: PropertyAction[];
};

export default function PropertiesPage() {
  const me = useQuery(api.rbac.me);
  const properties = useQuery(api.adminOverview.getPropertySummaries, me ? {} : "skip") as PropertySummary[] | undefined;
  if (!me) return null;

  return (
    <section className="admin-properties-page">
      <header className="admin-overview-head">
        <p className="admin-page-context">Properties</p>
        <h1>Properties in your workspace</h1>
        <p>See where each offering stands, what is complete, and the next step you are allowed to take.</p>
      </header>

      <div className="admin-property-workspace" aria-live="polite">
        {properties === undefined && (
          <div className="admin-loading-rows" role="status"><span /><span /><span /><span className="sr-only">Loading properties</span></div>
        )}
        {properties?.length === 0 && (
          <div className="admin-empty-state">
            <Buildings aria-hidden="true" />
            <div><h2>No properties to show</h2><p>No property records are available within your current access.</p></div>
          </div>
        )}
        {properties?.map((property, index) => (
          <article className="admin-property-row" key={property.id}>
            <div className="admin-property-row-image">
              <PropertyArtwork name={property.name} location={property.location} propertyId={property.id} priority={index === 0} />
              <span className="admin-stage-badge">{property.stageLabel}</span>
            </div>
            <div className="admin-property-row-main">
              <div className="admin-property-title">
                <div><h2>{property.name}</h2><p>{property.location} · {property.propertyType}</p></div>
                <p className="admin-progress-copy"><strong>{property.completedSteps} of {property.totalSteps}</strong> steps complete</p>
              </div>
              <div className="admin-progress-track" role="progressbar" aria-label={`${property.name}: ${property.progressLabel}`} aria-valuemin={0} aria-valuemax={property.totalSteps} aria-valuenow={property.completedSteps}>
                <span style={{ width: `${Math.round((property.completedSteps / property.totalSteps) * 100)}%` }} />
              </div>
              <div className="admin-next-step">
                <CheckCircle aria-hidden="true" />
                <div><span>Next step</span><p>{property.nextStep}</p></div>
              </div>
              <div className="admin-property-actions">
                {property.primaryAction ? (
                  <Link className="admin-primary-link" href={property.primaryAction.href}>{property.primaryAction.label}<ArrowRight aria-hidden="true" /></Link>
                ) : (
                  <span className="admin-no-action">No action is assigned to your role.</span>
                )}
                {property.availableActions.filter((action) => action.href !== property.primaryAction?.href).map((action) => (
                  <Link href={action.href} key={`${property.id}-${action.kind}`}>{action.label}</Link>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
