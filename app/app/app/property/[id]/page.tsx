"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import TrustStack from "./TrustStack";
import { propertyImage } from "@/app/components/propertyImage";

// E2.2 · Property Detail — the signature trust screen (public). Live property + diligence gates.
export default function PropertyPage() {
  const params = useParams<{ id: string }>();
  const data = useQuery(api.properties.getWithGates, { id: params.id as Id<"properties"> });

  if (data === undefined) return <main className="pd"><p className="pd-loading">Loading…</p></main>;
  if (data === null) return <main className="pd"><p className="pd-loading">Property not found. <Link href="/app/explore">Back to Explore</Link></p></main>;

  const { property: p, gates } = data;
  const pct = (n: number) => `${(n * 100).toFixed(n * 100 % 1 === 0 ? 0 : 1)}%`;
  const funded = Math.round(p.fundedPct * 100);
  const signedGateCount = gates.filter(
    (gate) => gate.status === "passed" && gate.signedByHuman?.trim(),
  ).length;
  const diligenceLabel =
    gates.length > 0 ? `${signedGateCount}/${gates.length} gates signed` : "Review pending";

  return (
    <main className="pd">
      <header className="pd-head">
        <Link href="/app/explore" className="ibtn" aria-label="Back to Explore">‹</Link>
        <span className="wm"><i />Vesper</span>
        <span className="ibtn" aria-hidden>↗</span>
      </header>

      <div className="pd-hero">
        <img className="pd-photo" src={propertyImage(p.name, p._id)} alt={`${p.name} at dusk`} />
        <div className="pd-hero-b">
          <span className="fund-pill">FUNDING · {funded}%</span>
        </div>
      </div>

      <div className="pd-id">
        <div>
          <h1 className="pd-name">{p.name}</h1>
          <p className="pd-sub">{p.location} · {p.propertyType} · {p.units} units</p>
        </div>
        <span className="pd-verified">{diligenceLabel}</span>
      </div>

      <div className="pd-tags">
        <span className="ptag">${p.minInvestment} min</span>
        <span className="ptag">Monthly income</span>
      </div>

      <div className="pd-metric">
        <div className="pd-eb">Target net yield</div>
        <div className="metric">{pct(p.targetNetYield)}<small> / year</small></div>
        <p className="pd-note">Net of every fee. Target, not guaranteed.</p>
      </div>

      <section className="pd-blk">
        <p className="pd-eb">Is it real?</p>
        <h2 className="pd-h">What you own</h2>
        <div className="own">
          <div className="own-item"><span className="own-num">01</span><div><h4>A legal share</h4><p>Shares in <b>{p.spvName}</b>, the company that owns {p.name} — a recorded ownership stake, not an IOU.</p></div></div>
          <div className="own-item"><span className="own-num">02</span><div><h4>Monthly rent</h4><p>Your share of net rent, paid to your Vesper balance on a predictable monthly schedule.</p></div></div>
          <div className="own-item"><span className="own-num">03</span><div><h4>A share of the upside</h4><p>And your share of the proceeds if the building is ever sold, after debts and fees.</p></div></div>
        </div>
      </section>

      <section className="pd-blk">
        <p className="pd-eb">Can you get out?</p>
        <h2 className="pd-h">Selling, honestly.</h2>
        <div className="liq">
          <div className="lrow"><span>Resale</span><b>Not currently available</b></div>
          <div className="lrow"><span>Live market data</span><b>Not available</b></div>
        </div>
        <p className="liq-foot">
          There are no current bids, spread, last-sale price, or time-to-fill data to show. Any future
          resale will be subject to investor eligibility and offering transfer restrictions.
        </p>
        <Link href="/app/market" className="proof-link">View market availability</Link>
      </section>

      <TrustStack gates={gates} />

      <section className="pd-blk">
        <p className="pd-eb">The property</p>
        <h2 className="pd-h">Facts of record.</h2>
        <div className="facts">
          <div className="fact"><div className="fk">Units</div><div className="fv">{p.units}</div></div>
          <div className="fact"><div className="fk">Min invest</div><div className="fv">${p.minInvestment}</div></div>
          <div className="fact"><div className="fk">Offering</div><div className="fv">${p.offeringSize.toLocaleString()}</div></div>
          <div className="fact"><div className="fk">Structure</div><div className="fv">{p.spvName}</div></div>
        </div>
      </section>

      <Link href={`/app/property/${p._id}/proof`} className="proof-link">See the public proof ↗</Link>

      <div className="pd-spacer" />
      <div className="pd-bar">
        <div className="pd-bar-meta">
          Target net yield {pct(p.targetNetYield)} · Target, not guaranteed.
          <b>Invest from ${p.minInvestment}</b>
        </div>
        <Link href={`/app/invest/${p._id}`} className="cta">Invest</Link>
      </div>
    </main>
  );
}
