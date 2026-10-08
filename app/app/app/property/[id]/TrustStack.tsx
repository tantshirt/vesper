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
        <p className="pd-note">
          No completed review is shown yet. Diligence does not guarantee income, future value, or resale.
        </p>
      </section>
    );
  }
  const allSigned = gates.every((g) => g.status === "passed" && g.signedByHuman?.trim());

  return (
    <section className="pd-blk" aria-labelledby="trust-stack-h">
      <p className="pd-eb">Who checked it</p>
      {/* Article dropped (headline style) so the count is data-driven without an a/an bug. */}
      <h2 className="pd-h" id="trust-stack-h">
        {gates.length}-point diligence gate
      </h2>
      <p className="pd-thead">
        The checks below cover the evidence named in each diligence gate.{" "}
        <b>{allSigned ? "A named human signed every gate." : "Each gate shows its current review and signer status."}</b>
      </p>
      <p className="pd-note">
        Diligence review confirms only the checks and evidence shown here. It does not guarantee income,
        future value, or the ability to resell.
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
