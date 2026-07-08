"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  truncateAddress,
  explorerAddressUrl,
  explorerTxUrl,
  holderSummary,
} from "./proof.helpers";

// Story 2.4 · On-chain proof — the on-demand, public/no-auth proof view. This is the ONLY
// screen where crypto vocabulary (mint, token, holders, DvP, Token ACL, explorer) appears.
// It renders ONLY real chain-mirrored facts; absent facts show honest pending/empty states,
// never a fabricated mint, holder, or receipt.
export default function ProofPage() {
  const params = useParams<{ id: string }>();
  const id = params.id as Id<"properties">;
  const data = useQuery(api.properties.getOnChainProof, { id });

  if (data === undefined) {
    return (
      <main className="proof">
        <p className="pd-loading">Loading…</p>
      </main>
    );
  }
  if (data === null) {
    return (
      <main className="proof">
        <p className="pd-loading">
          Property not found. <Link href="/explore">Back to Explore</Link>
        </p>
      </main>
    );
  }

  const { name, mint, spvName, holderCount, receipts } = data;

  return (
    <main className="proof">
      <header className="pd-head">
        <Link href={`/property/${id}`} className="ibtn" aria-label={`Back to ${name}`}>
          ‹
        </Link>
        <span className="wm">
          <i />
          Vesper
        </span>
        <span className="ibtn" aria-hidden>
          ↗
        </span>
      </header>

      <div className="proof-intro">
        <p className="pd-eb">On-chain proof</p>
        <h1 className="pd-name">{name} — provable on-chain</h1>
        <p className="pd-sub">
          The on-chain facts we publish for {name} — verifiable on the public ledger as the
          offering settles. Nothing here is required to browse or invest.
        </p>
      </div>

      {/* Facet 1 — mint + explorer address link (honest pending when not yet anchored) */}
      <section className="pd-blk" aria-labelledby="proof-mint-h">
        <p className="pd-eb">The token</p>
        <h2 className="pd-h" id="proof-mint-h">Token mint</h2>
        {mint ? (
          <div className="proof-fact">
            <code className="proof-addr">{truncateAddress(mint)}</code>
            <a
              className="proof-ex"
              href={explorerAddressUrl(mint)}
              target="_blank"
              rel="noreferrer"
            >
              View on explorer ↗
            </a>
          </div>
        ) : (
          <p className="proof-empty">
            Not yet anchored — the token is created when the offering closes.
          </p>
        )}
      </section>

      {/* Facet 2 — holder view (honest empty at zero) */}
      <section className="pd-blk" aria-labelledby="proof-holders-h">
        <p className="pd-eb">Who owns it</p>
        <h2 className="pd-h" id="proof-holders-h">Holders</h2>
        <p className={holderCount > 0 ? "proof-count" : "proof-empty"}>
          {holderSummary(holderCount)}
        </p>
      </section>

      {/* Facet 3 — DvP settlement receipts (honest empty when none, each links to its tx) */}
      <section className="pd-blk" aria-labelledby="proof-dvp-h">
        <p className="pd-eb">How it settled</p>
        <h2 className="pd-h" id="proof-dvp-h">DvP settlement receipts</h2>
        {receipts.length > 0 ? (
          <ul className="proof-list">
            {receipts.map((r) => (
              <li className="proof-receipt" key={r.dvpTxSig}>
                <code className="proof-addr">{truncateAddress(r.dvpTxSig)}</code>
                <a
                  className="proof-ex"
                  href={explorerTxUrl(r.dvpTxSig)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="proof-empty">No settlements recorded yet.</p>
        )}
      </section>

      {/* Facet 4 — Token ACL disclosure (structural policy copy, not a per-user read) */}
      <section className="pd-blk" aria-labelledby="proof-acl-h">
        <p className="pd-eb">The rules on-chain</p>
        <h2 className="pd-h" id="proof-acl-h">Token ACL</h2>
        <p className="proof-policy">
          {spvName} tokens are a restricted <b>Token-2022</b> asset, <b>frozen by default</b>. Each
          account self-thaws only when it is eligible to hold the token — ineligible receipt is
          blocked on-chain, not by us. Eligibility is enforced by the token program itself.
        </p>
      </section>

      {/* Facet 5 — explorer links */}
      <section className="pd-blk" aria-labelledby="proof-links-h">
        <p className="pd-eb">Verify it yourself</p>
        <h2 className="pd-h" id="proof-links-h">Explorer links</h2>
        {mint ? (
          <a
            className="proof-ex"
            href={explorerAddressUrl(mint)}
            target="_blank"
            rel="noreferrer"
          >
            Open the mint on Solana Explorer ↗
          </a>
        ) : (
          <p className="proof-empty">
            Explorer links appear once the token is anchored on-chain.
          </p>
        )}
      </section>

      <div className="proof-foot">
        <Link href={`/property/${id}`} className="proof-back">
          ‹ Back to {name}
        </Link>
      </div>
    </main>
  );
}
