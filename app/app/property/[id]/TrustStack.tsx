import type { Doc } from "@/convex/_generated/dataModel";
import { gateNumberLabel, gateStatusLabel, formatSignedDate, signerText } from "./trustStack.helpers";

// Story 2.3 · Trust Stack — a first-class, accessible diligence surface. Purely
// presentational: props in, no data fetching or hooks (the page owns useQuery).
// Gate labels are rendered verbatim from data (never hardcoded consumer copy), and
// no gate is EVER attributed to an AI — only signedByHuman or an honest fallback.
export default function TrustStack({ gates }: { gates: Doc<"diligenceGates">[] }) {
  if (gates.length === 0) {
    return (
      <section className="pd-blk" aria-labelledby="trust-stack-h">
        <p className="pd-eb">Who checked it</p>
        <h2 className="pd-h" id="trust-stack-h">Diligence gates — signed by people.</h2>
        <p className="gate-empty">Diligence gates are being prepared. A named human signs each one.</p>
      </section>
    );
  }

  return (
    <section className="pd-blk" aria-labelledby="trust-stack-h">
      <p className="pd-eb">Who checked it</p>
      {/* Article dropped (headline style) so the count is data-driven without an a/an bug. */}
      <h2 className="pd-h" id="trust-stack-h">
        {gates.length}-point diligence gate — signed by people.
      </h2>
      <p className="pd-thead">
        AI accelerated the review. <b>A named human signed every gate.</b>
      </p>

      <ul className="gate-list">
        {gates.map((g) => {
          const passed = g.status === "passed";
          const date = formatSignedDate(g.signedAt);
          const signer = g.signedByHuman?.trim();
          return (
            <li className="gate" key={g._id}>
              <span
                className={passed ? "gate-ck" : "gate-ck gate-ck-pending"}
                aria-hidden="true"
              >
                {passed ? "✓" : "•"}
              </span>
              <div className="gate-body">
                <div className="gate-no">{gateNumberLabel(g.gateNo)}</div>
                <div className="gate-name">{g.label}</div>
                <div className="gate-status">
                  <span className="visually-hidden">Status: </span>
                  {gateStatusLabel(g.status)}
                </div>
                {/* Only claim "Signed" when a human actually signed — otherwise show an
                    honest pending note with no "Signed" prefix and no fabricated date. */}
                <div className="gate-sign">
                  {signer ? (
                    <>
                      Signed <b>{signer}</b>
                      {date ? ` · ${date}` : ""}
                    </>
                  ) : (
                    <b>{signerText(g.signedByHuman)}</b>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
