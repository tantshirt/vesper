"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

// E2.1 · Explore — the public front door. Browses vetted properties with no auth (FR1).
// Renders live Convex seed data in the D-Design-System language (matches DD-001 prototype).
export default function ExplorePage() {
  const properties = useQuery(api.properties.listOpen);

  return (
    <main className="ex">
      <header className="ex-head">
        <span className="wm"><i />Vesper</span>
        <span className="avatar">M</span>
      </header>

      <div className="ex-greet">
        <div className="k">Good evening, Maya</div>
        <h1>Own your first square foot.</h1>
      </div>

      <div className="ex-chips">
        <span className="chip on">All</span>
        <span className="chip">Monthly income</span>
        <span className="chip">Lower risk</span>
        <span className="chip">$50 min</span>
      </div>

      {properties === undefined ? (
        <div className="ex-list">
          <div className="pcard skel" /><div className="pcard skel" />
        </div>
      ) : properties.length === 0 ? (
        <p className="ex-empty">No open properties yet. New listings drop regularly — check back.</p>
      ) : (
        <div className="ex-list">
          {properties.map((p) => <PropertyCard key={p._id} p={p} />)}
        </div>
      )}

      <nav className="tabbar">
        <span className="tab on"><b>◇</b>Home</span>
        <span className="tab"><b>⌕</b>Explore</span>
        <span className="tab"><b>◫</b>Portfolio</span>
        <span className="tab"><b>⇄</b>Market</span>
        <span className="tab"><b>❋</b>Learn</span>
      </nav>
    </main>
  );
}

function PropertyCard({ p }: { p: Doc<"properties"> }) {
  const pct = (n: number) => `${(n * 100).toFixed(n * 100 % 1 === 0 ? 0 : 1)}%`;
  const funded = Math.round(p.fundedPct * 100);
  return (
    <Link href={`/property/${p._id}`} className="pcard" aria-label={`Open ${p.name}`}>
      <div className="pcard-img">
        <span className="lit" />
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
