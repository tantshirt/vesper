"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MARKET_COPY, targetYieldDisclosure } from "./content";

export default function MarketPage() {
  const properties = useQuery(api.properties.listOpen);

  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> {MARKET_COPY.eyebrow}</p>
      <h1>{MARKET_COPY.title}</h1>

      <section className="card" aria-labelledby="market-state-title">
        <p className="ok">Current availability</p>
        <h2 id="market-state-title" className="pd-h">{MARKET_COPY.unavailableTitle}</h2>
        <p className="muted">{MARKET_COPY.unavailableBody}</p>
        <p className="muted">{MARKET_COPY.restrictionBody}</p>
      </section>

      <section aria-labelledby="market-properties-title">
        <h2 id="market-properties-title" className="pd-h">Open properties</h2>
        {properties === undefined ? (
          <p className="muted" role="status">Checking current availability…</p>
        ) : properties.length === 0 ? (
          <p className="muted">There are no open properties to show.</p>
        ) : (
          properties.map((property) => (
            <article className="card" key={property._id}>
              <div className="row"><b>{property.name}</b><span>{MARKET_COPY.primaryOnly}</span></div>
              <p className="muted">{property.location} · {property.propertyType}</p>
              <p className="muted">{targetYieldDisclosure(property.targetNetYield)}</p>
              <p className="muted">{MARKET_COPY.dataUnavailable}</p>
              <Link className="cta ghost" href={`/app/property/${property._id}`}>View property</Link>
            </article>
          ))
        )}
      </section>

      <div className="actions">
        <Link className="cta" href="/app/explore">{MARKET_COPY.exploreCta}</Link>
        <Link className="cta ghost" href="/app/learn">{MARKET_COPY.learnCta}</Link>
      </div>
    </main>
  );
}
