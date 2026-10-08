import Link from "next/link";
import { notFound } from "next/navigation";

const PAGES = {
  about: {
    title: "About Vesper",
    body:
      "Vesper is a technology platform for exploring fractional real estate ownership. The current application is a prototype and demo data is illustrative.",
  },
  disclosures: {
    title: "Disclosures",
    body:
      "Figures, properties, yields, income projections, and availability shown in this prototype are illustrative. Nothing on this site is an offer to sell or a solicitation to buy any security.",
  },
  terms: {
    title: "Terms",
    body:
      "Use of this prototype is for evaluation only. Production terms of service must be reviewed and approved before any live investor onboarding or transaction flow is enabled.",
  },
  privacy: {
    title: "Privacy",
    body:
      "This prototype uses authentication and backend services to render account-specific data. A production privacy policy must be approved before collecting real investor information.",
  },
  "risk-factors": {
    title: "Risk Factors",
    body:
      "Real estate investing involves risk, including loss of principal, reduced or paused income, valuation changes, tenant risk, operating expense increases, and limited liquidity.",
  },
} as const;

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = PAGES[slug as keyof typeof PAGES];
  if (!page) notFound();

  return (
    <main className="legal-page">
      <Link href="/" className="legal-back">Back to Vesper</Link>
      <p className="eyebrow">Vesper</p>
      <h1>{page.title}</h1>
      <p className="muted">{page.body}</p>
    </main>
  );
}
