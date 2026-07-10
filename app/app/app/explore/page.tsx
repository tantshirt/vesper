"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { propertyImage } from "@/app/components/propertyImage";

// E2.1 · Explore — the public front door. Browses vetted properties with no auth (FR1).
// Renders live Convex seed data in the D-Design-System language (matches DD-001 prototype).
export default function ExplorePage() {
  const properties = useQuery(api.properties.listOpen);
  const [filter, setFilter] = useState<"all" | "income" | "lower" | "min50">("all");
  const visibleProperties = useMemo(() => {
    if (!properties) return [];
    if (filter === "income") return properties.filter((p) => p.targetNetYield > 0);
    if (filter === "lower") return properties.filter((p) => p.targetNetYield <= 0.065);
    if (filter === "min50") return properties.filter((p) => p.minInvestment <= 50);
    return properties;
  }, [filter, properties]);

  return (
    <main className="ex">
      <header className="ex-head">
        <span className="wm"><i />Vesper</span>
        <Link href="/app" className="ex-signin">Sign in</Link>
      </header>

      <div className="ex-greet">
        <div className="k">Good evening</div>
        <h1>Own your first square foot.</h1>
      </div>

      <div className="ex-chips" aria-label="Property filters">
        {[
          ["all", "All"],
          ["income", "Monthly income"],
          ["lower", "Lower target yield"],
          ["min50", "$50 min"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip${filter === id ? " on" : ""}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id as typeof filter)}
          >
            {label}
          </button>
        ))}
      </div>

      {properties === undefined ? (
        <div className="ex-list">
          <div className="pcard skel" /><div className="pcard skel" />
        </div>
      ) : visibleProperties.length === 0 ? (
        <p className="ex-empty">No open properties yet. New listings drop regularly — check back.</p>
      ) : (
        <div className="ex-list">
          {visibleProperties.map((p) => <PropertyCard key={p._id} p={p} />)}
        </div>
      )}
    </main>
  );
}

function PropertyCard({ p }: { p: Doc<"properties"> }) {
  const pct = (n: number) => `${(n * 100).toFixed(n * 100 % 1 === 0 ? 0 : 1)}%`;
  const funded = Math.round(p.fundedPct * 100);
  return (
    <Link href={`/app/property/${p._id}`} className="pcard" aria-label={`Open ${p.name}`}>
      <div className="pcard-img">
        <img className="pcard-photo" src={propertyImage(p.name, p._id)} alt={p.name} loading="lazy" />
        <span className="badge">FUNDING · {funded}%</span>
        <span className="yield">{pct(p.targetNetYield)}</span>
      </div>
      <div className="pcard-b">
        <div className="pn">{p.name}</div>
        <div className="ps">{p.location} · {p.propertyType} · {p.units} units</div>
        <div className="ptags">
          <span className="ptag">${p.minInvestment} min</span>
          <span className="ptag">Monthly income</span>
        </div>
        <div className="fundbar"><i style={{ width: `${funded}%` }} /></div>
        <div className="fundmeta"><span>{p.spvName}</span><span>{funded}%</span></div>
      </div>
    </Link>
  );
}
