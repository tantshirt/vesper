"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Logo } from "./Logo";

// Faithful port of the Brand "Vesper Landing" design canvas. Light-only, token-driven.
// Scroll-reveal + count-up mirror the canvas behaviour (respecting reduced-motion).
const FAQ = [
  { q: "What exactly do I own?", a: "Shares representing an interest in the LLC that owns a specific building. That share entitles you to a proportional cut of the property's net rental income and, if it's ever sold, the sale proceeds after debts and fees. It is a real ownership stake — not a loan, a fund, or a promise." },
  { q: "How and when do I get paid?", a: "Rent is collected, expenses and reserves are paid, and the remainder is distributed to owners on a monthly schedule — proportional to what you hold. You can reinvest distributions or withdraw them when supported by your account." },
  { q: "Can I sell my shares?", a: "Yes — when a secondary market is available, you can list your shares with no lockup on most properties. That said, a buyer has to be willing to purchase at your price, so liquidity is never guaranteed and your order may not fill immediately." },
  { q: "What are the fees?", a: "A one-time platform fee is shown clearly at checkout before you confirm, and a small annual management fee is already reflected in each property's target net yield. No hidden spreads, no surprise charges. Every fee is disclosed on the property page." },
  { q: "What are the risks?", a: "Real estate can lose value, tenants can leave, and repairs can eat into income — so distributions can fall or pause, and you could get back less than you put in. These are real investments, not savings accounts. Every property page shows its downside scenario in plain language before you commit." },
];

export function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.add("lp-anim");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const reveals = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const counts = Array.from(root.querySelectorAll<HTMLElement>("[data-count-to]"));
    const fmt = (v: number, dec: number) =>
      new Intl.NumberFormat("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    const paint = (el: HTMLElement, val: number) => {
      const dec = parseInt(el.dataset.countDecimals || "0", 10);
      el.textContent = (el.dataset.countPrefix || "") + fmt(val, dec) + (el.dataset.countSuffix || "");
    };

    if (reduce) {
      reveals.forEach((el) => el.classList.add("in"));
      counts.forEach((el) => paint(el, parseFloat(el.dataset.countTo || "0")));
      return;
    }
    if (!("IntersectionObserver" in window)) {
      reveals.forEach((el) => el.classList.add("in"));
      counts.forEach((el) => paint(el, parseFloat(el.dataset.countTo || "0")));
      return;
    }

    const io = new IntersectionObserver(
      (ents) => ents.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      }),
      { threshold: 0.14, rootMargin: "0px 0px -7% 0px" },
    );
    reveals.forEach((el) => io.observe(el));

    counts.forEach((el) => paint(el, 0));
    const io2 = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target as HTMLElement;
      io2.unobserve(el);
      const to = parseFloat(el.dataset.countTo || "0");
      const dur = 1500;
      let start: number | null = null;
      const tick = (t: number) => {
        if (start === null) start = t;
        let p = Math.min(1, (t - start) / dur);
        p = 1 - Math.pow(1 - p, 3);
        paint(el, to * p);
        if (p < 1) requestAnimationFrame(tick); else paint(el, to);
      };
      requestAnimationFrame(tick);
    }), { threshold: 0.5 });
    counts.forEach((el) => io2.observe(el));

    return () => { io.disconnect(); io2.disconnect(); };
  }, []);

  return (
    <div className="lp" ref={rootRef}>
      {/* NAV */}
      <header className="lp-nav">
        <div className="lp-nav-in">
          <Link href="#top" aria-label="Vesper"><Logo size={30} /></Link>
          <nav className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#properties">Properties</a>
            <a href="#own">What you own</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="lp-nav-right">
            <Link href="/app" className="lp-signin">Sign in</Link>
            <Link href="/app" className="cta">Get started</Link>
          </div>
        </div>
      </header>

      <main id="top">
        {/* HERO */}
        <section>
          <div className="lp-hero-in">
            <div className="lp-hero-copy" data-reveal>
              <span className="lp-chip"><i />Real estate shares · income while you rest</span>
              <h1 className="lp-h1">Own the building.<br /><span className="acc">Not the mortgage.</span></h1>
              <p className="lp-lead">Vesper turns income-producing property into shares you can own from $50. Real buildings, real monthly rent, no landlording — the evening star keeps watch while you rest.</p>
              <div className="lp-actions">
                <Link href="/app/explore" className="cta">Explore properties</Link>
                <a href="#how" className="cta ghost">See how it works</a>
              </div>
              <div className="lp-hero-facts"><span>$50 minimum</span><em>·</em><span>Monthly rent to your balance</span><em>·</em><span>Sell on the secondary market</span></div>
            </div>
            <div className="lp-hero-media" data-reveal>
              <div className="lp-hero-frame"><img src="/brand/properties/hero.png" alt="A building at dusk, lit from within" /></div>
              <div className="lp-hero-tag">
                <img src="/brand/star.svg" alt="" />
                <div>
                  <span className="k">Rent paid overnight · The Monroe</span><br />
                  <span className="v">+$3.42 <small>to your balance</small></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="lp-band lp-white">
          <div className="lp-sec">
            <div className="lp-prob-head" data-reveal>
              <span className="lp-eyebrow">The state of ownership</span>
              <h2 className="lp-h2">Real estate built the American middle class.<br />Then it priced most people out.</h2>
              <p className="lp-prob-sub">For a century, the surest way to build wealth was to own property and collect the rent. Today the door is a down payment most people can't reach — and a mortgage most don't want.</p>
            </div>
            <div className="lp-statcards">
              <div className="lp-statcard" data-reveal><b data-count-to="34" data-count-suffix="%">34%</b><span>of U.S. adults own no real estate at all — not a home, not a share of one.</span></div>
              <div className="lp-statcard" data-reveal><b data-count-to="67500" data-count-prefix="$">$67,500</b><span>is the typical down payment on a median U.S. home — before you own a thing.</span></div>
              <div className="lp-statcard" data-reveal><b data-count-to="11" data-count-suffix=" yrs">11 yrs</b><span>of saving to reach it on a median income — while rents keep climbing.</span></div>
            </div>
          </div>
        </section>

        {/* PIVOT */}
        <section className="lp-cream">
          <div className="lp-pivot">
            <div className="lp-pivot-in" data-reveal>
              <img src="/brand/mark.svg" alt="" />
              <h2 className="lp-h2 xl">There is a quieter way to own.</h2>
              <p>Buy a share of a real, income-producing building for as little as $50. Earn your share of the rent every month. Sell when you're ready. No mortgage, no tenants calling at midnight.</p>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="lp-band lp-white" id="how">
          <div className="lp-sec">
            <div className="lp-how-head" data-reveal>
              <span className="lp-eyebrow">How it works</span>
              <h2 className="lp-h2">Three steps. Then it runs on its own.</h2>
            </div>
            <div className="lp-cards3">
              <div className="lp-howcard" data-reveal><span className="lp-num">01</span><h3>Choose a property</h3><p>Browse vetted, income-producing buildings. Every listing clears an 8-point diligence gate before it reaches you — title, inspection, financials, and more.</p></div>
              <div className="lp-howcard" data-reveal><span className="lp-num">02</span><h3>Own a real share</h3><p>Your investment buys shares in the LLC that owns the building. It's a legal share of a real asset, recorded for you and settled only when all checks pass.</p></div>
              <div className="lp-howcard" data-reveal><span className="lp-num">03</span><h3>Collect the rent</h3><p>Your share of net rent lands in your balance every month, automatically. Reinvest it, or withdraw it. Either way, it arrives while you sleep.</p></div>
            </div>
          </div>
        </section>

        {/* WHAT YOU OWN — sticky */}
        <section className="lp-band lp-cream" id="own">
          <div className="lp-sec">
            <div className="lp-own-grid">
              <div className="lp-own-sticky">
                <div className="lp-own-card" data-reveal>
                  <div className="lp-own-cardhead">
                    <div className="lp-own-thumb"><img src="/brand/properties/the-monroe.png" alt="The Monroe" /></div>
                    <div><div className="lp-own-name">The Monroe</div><div className="lp-own-loc">Tampa, FL · Multifamily · 8 units</div></div>
                  </div>
                  <div className="lp-own-stats">
                    <div className="lp-own-row"><span>You own</span><b>0.0214%</b></div>
                    <div className="lp-own-row"><span>This month's rent</span><b className="gain">+$3.42</b></div>
                    <div className="lp-own-row"><span>Lifetime income</span><b>$41.80</b></div>
                  </div>
                  <div className="lp-own-chip"><img src="/brand/star-accent.svg" alt="" /><span>Next distribution · Aug 1</span></div>
                </div>
              </div>
              <div className="lp-own-scroll">
                <div className="lp-own-block" data-reveal><span className="lp-own-kicker">01 · A legal share</span><h3>Shares in the company that owns the building.</h3><p>Each property is held by its own LLC. Your shares are a real, recorded ownership stake, not an IOU or a pooled fund.</p></div>
                <div className="lp-own-block" data-reveal><span className="lp-own-kicker">02 · Monthly rent</span><h3>Your share of the net rent, every month.</h3><p>After expenses and reserves, the building's rent is distributed to owners — proportional to what you hold, paid on a predictable monthly schedule.</p></div>
                <div className="lp-own-block" data-reveal><span className="lp-own-kicker">03 · A share of the upside</span><h3>And your share when the property sells.</h3><p>If the building is sold, you receive your share of the proceeds after debts and fees. Until then, you can list your shares on the secondary market — though liquidity is never guaranteed.</p></div>
              </div>
            </div>
          </div>
        </section>

        {/* INCOME MOMENT — dusk full bleed */}
        <section className="lp-income">
          <div className="lp-income-in" data-reveal>
            <img src="/brand/star.svg" alt="" />
            <h2>Rent arrives while you sleep.</h2>
            <p>A $500 stake in a 6% property earns roughly <b>$2.50 a month</b> — quietly, on schedule, without a single email to a tenant. The evening star keeps watch; you don't have to.</p>
            <Link href="/app/explore" className="lp-btn-light">Find your first property</Link>
          </div>
        </section>

        {/* PROPERTIES */}
        <section className="lp-band lp-white" id="properties">
          <div className="lp-sec">
            <div className="lp-props-head" data-reveal>
              <div className="lp-props-head-l">
                <span className="lp-eyebrow">Open for investment</span>
                <h2 className="lp-h2">Real buildings, open now.</h2>
              </div>
              <Link href="/app/explore" className="lp-signin" style={{ color: "var(--accent)" }}>View all properties →</Link>
            </div>
            <div className="lp-props-grid">
              <Link href="/app/explore" className="lp-pcard" data-reveal>
                <div className="lp-pcard-img"><img src="/brand/properties/the-monroe.png" alt="The Monroe" /><span className="lp-pcard-badge">Funding · 74%</span></div>
                <div className="lp-pcard-b">
                  <div><div className="lp-pcard-title"><span className="pn">The Monroe</span><span className="yld">6.2%</span></div><div className="lp-pcard-loc">Tampa, FL · Multifamily · 8 units</div></div>
                  <div className="lp-pcard-tags"><span className="lp-tag">$50 min</span><span className="lp-tag">Monthly income</span><span className="lp-tag mod">Moderate risk</span></div>
                </div>
              </Link>
              <Link href="/app/explore" className="lp-pcard" data-reveal>
                <div className="lp-pcard-img"><img src="/brand/properties/cedar-row.png" alt="Cedar Row" /><span className="lp-pcard-badge is-new">New</span></div>
                <div className="lp-pcard-b">
                  <div><div className="lp-pcard-title"><span className="pn">Cedar Row</span><span className="yld">5.7%</span></div><div className="lp-pcard-loc">Columbus, OH · Townhomes · 12 units</div></div>
                  <div className="lp-pcard-tags"><span className="lp-tag">$50 min</span><span className="lp-tag">Monthly income</span><span className="lp-tag low">Lower risk</span></div>
                </div>
              </Link>
              <Link href="/app/explore" className="lp-pcard" data-reveal>
                <div className="lp-pcard-img"><img src="/brand/properties/alder-court.png" alt="Alder Court" /><span className="lp-pcard-badge">Funding · 41%</span></div>
                <div className="lp-pcard-b">
                  <div><div className="lp-pcard-title"><span className="pn">Alder Court</span><span className="yld">6.8%</span></div><div className="lp-pcard-loc">Raleigh, NC · Mixed-use · 6 units</div></div>
                  <div className="lp-pcard-tags"><span className="lp-tag">$50 min</span><span className="lp-tag">Monthly income</span><span className="lp-tag high">Higher yield</span></div>
                </div>
              </Link>
            </div>
          </div>
        </section>

        {/* TRUST BAND */}
        <section className="lp-band lp-cream">
          <div className="lp-sec">
            <div className="lp-trust" data-reveal>
              <div><b data-count-to="50" data-count-prefix="$">$50</b><span>minimum to begin</span></div>
              <div><b data-count-to="6.1" data-count-decimals="1" data-count-suffix="%">6.1%</b><span>average target net yield</span></div>
              <div><b data-count-to="1240000" data-count-prefix="$">$1,240,000</b><span>in rent distributed to owners</span></div>
              <div><b data-count-to="4800">4,800</b><span>owners earning alongside you</span></div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="lp-band lp-white" id="faq">
          <div className="lp-sec">
            <div className="lp-faq-wrap">
              <div className="lp-faq-head" data-reveal>
                <span className="lp-eyebrow">Straight answers</span>
                <h2 className="lp-h2">Questions worth asking.</h2>
              </div>
              <div className="lp-faq" data-reveal>
                {FAQ.map((item) => (
                  <details className="lp-faq-item" key={item.q}>
                    <summary>{item.q}</summary>
                    <p>{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="lp-band lp-cream" id="cta">
          <div className="lp-final" data-reveal>
            <h2 className="lp-h2 xl">Start owning tonight, from $50.</h2>
            <p>Open an account in minutes. Browse properties, invest what you like, and watch the first rent arrive.</p>
            <div className="lp-final-actions">
              <Link href="/app" className="cta">Create your account</Link>
              <Link href="/app/explore" className="cta ghost">Browse properties</Link>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="lp-foot">
        <div className="lp-foot-in">
          <div className="lp-foot-top">
            <div className="lp-foot-brand">
              <Logo size={28} reversed />
              <p>Real estate income that quietly works while you rest.</p>
            </div>
            <div className="lp-foot-col"><b>Product</b><a href="#how">How it works</a><a href="#properties">Properties</a><a href="#own">What you own</a></div>
            <div className="lp-foot-col"><b>Company</b><Link href="/legal/about">About</Link><Link href="/legal/disclosures">Disclosures</Link><a href="#faq">FAQ</a></div>
            <div className="lp-foot-col"><b>Legal</b><Link href="/legal/terms">Terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/risk-factors">Risk factors</Link></div>
          </div>
          <div className="lp-foot-legal">
            <p>Vesper is a technology platform, not a bank, broker-dealer, or investment adviser. Investing in real estate involves risk, including possible loss of principal. Rental income, target yields, and appreciation are projections, not guarantees, and may change. Property interests may be securities offered under applicable exemptions and may be subject to holding and transfer restrictions; secondary-market liquidity is not guaranteed. All figures, properties, and returns shown on this page are illustrative and for demonstration only. Nothing here is an offer to sell or a solicitation to buy any security, nor investment, legal, or tax advice — consult your own advisers before investing.</p>
            <span>© 2026 Vesper. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
