import Link from "next/link";
import { LEARN_COPY, LEARN_SECTIONS } from "./content";

export default function LearnPage() {
  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> {LEARN_COPY.eyebrow}</p>
      <h1>{LEARN_COPY.title}</h1>
      <p className="muted">{LEARN_COPY.intro}</p>

      {LEARN_SECTIONS.map((section) => (
        <article className="card" key={section.eyebrow}>
          <p className="eyebrow">{section.eyebrow}</p>
          <h2 className="pd-h">{section.title}</h2>
          <p className="muted">{section.body}</p>
        </article>
      ))}

      <div className="actions">
        <Link className="cta" href="/app/explore">{LEARN_COPY.exploreCta}</Link>
        <Link className="cta ghost" href="/app/market">{LEARN_COPY.marketCta}</Link>
      </div>
    </main>
  );
}
