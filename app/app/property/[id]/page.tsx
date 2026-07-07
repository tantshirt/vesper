"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// E2.2 · Property Detail — the signature trust screen (public). Live property + diligence gates.
export default function PropertyPage() {
  const params = useParams<{ id: string }>();
  const data = useQuery(api.properties.getWithGates, { id: params.id as Id<"properties"> });

  if (data === undefined) return <main className="pd"><p className="pd-loading">Loading…</p></main>;
  if (data === null) return <main className="pd"><p className="pd-loading">Property not found. <Link href="/explore">Back to Explore</Link></p></main>;

  const { property: p, gates } = data;
  const pct = (n: number) => `${(n * 100).toFixed(n * 100 % 1 === 0 ? 0 : 1)}%`;
  const funded = Math.round(p.fundedPct * 100);
  const date = (ms?: number) => ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <main className="pd">
      <header className="pd-head">
        <Link href="/explore" className="ibtn" aria-label="Back to Explore">‹</Link>
        <span className="wm"><i />Vesper</span>
        <span className="ibtn" aria-hidden>↗</span>
      </header>

      <div className="pd-hero" role="img" aria-label={`${p.name} at dusk`}>
        <span className="pd-glow" />
        <span className="pd-lit" />
        <div className="pd-hero-b">
          <span className="fund-pill">FUNDING · {funded}%</span>
        </div>
      </div>

      <div className="pd-id">
        <div>
          <h1 className="pd-name">{p.name}</h1>
          <p className="pd-sub">{p.location} · {p.propertyType} · {p.units} units</p>
        </div>
        <span className="pd-verified">✓ Verified</span>
      </div>

      <div className="pd-tags">
        <span className="ptag">${p.minInvestment} min</span>
        <span className="ptag">Monthly income</span>
      </div>

      <div className="pd-metric">
        <div className="pd-eb">Target net yield</div>
        <div className="metric">{pct(p.targetNetYield)}<small> / year</small></div>
        <p className="pd-note">Net of every fee. A target, not a guarantee.</p>
      </div>

      <section className="pd-blk">
        <p className="pd-eb">Is it real?</p>
        <h2 className="pd-h">What you own</h2>
        <div className="own">
          <div className="own-item"><span className="own-num">01</span><div><h4>A legal share</h4><p>Tokens in <b>{p.spvName}</b>, the company that owns {p.name} — a recorded ownership stake, not an IOU.</p></div></div>
          <div className="own-item"><span className="own-num">02</span><div><h4>Monthly rent</h4><p>Your share of net rent, in USDC, on a predictable monthly schedule.</p></div></div>
          <div className="own-item"><span className="own-num">03</span><div><h4>A share of the upside</h4><p>And your share of the proceeds if the building is ever sold, after debts and fees.</p></div></div>
        </div>
      </section>

      <section className="pd-blk">
        <p className="pd-eb">Can you get out?</p>
        <h2 className="pd-h">Selling, honestly.</h2>
        <div className="liq">
          <div className="lrow"><span>Est. time to sell</span><b>~3–6 weeks</b></div>
          <div className="lrow"><span>Lock-up</span><b>None</b></div>
        </div>
        <p className="liq-foot">⚠ Liquidity is never guaranteed — your order may not fill right away. No “Sell now” button that isn't true.</p>
      </section>

      <section className="pd-blk">
        <p className="pd-eb">Who checked it</p>
        <h2 className="pd-h">An {gates.length}-point diligence gate — signed by people.</h2>
        <p className="pd-thead">AI accelerated the review. <b>A named human signed every gate.</b></p>
        {gates.map((g) => (
          <div className="gate" key={g._id}>
            <span className="gate-ck">{g.status === "passed" ? "✓" : "…"}</span>
            <div>
              <div className="gate-name">{g.label}</div>
              <div className="gate-sign">Signed <b>{g.signedByHuman ?? "—"}</b>{g.signedAt ? ` · ${date(g.signedAt)}` : ""}</div>
            </div>
          </div>
        ))}
      </section>

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

      <div className="pd-spacer" />
      <div className="pd-bar">
        <div className="pd-bar-meta">{p.name} · {pct(p.targetNetYield)}<b>Invest from ${p.minInvestment}</b></div>
        <Link href={`/invest/${p._id}`} className="cta">Invest</Link>
      </div>
    </main>
  );
}
