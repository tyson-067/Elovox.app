import type { Metadata } from "next";
import { TRIAL_DAYS, formatUSD, planFor } from "@/lib/pricing";
import { FAQ } from "@/lib/faq";
import { pageGraph } from "@/lib/schema";

// Exists to carry metadata AND the page's structured data. `page.tsx` is a
// client component, it needs useState for the cycle toggle and useAuth for the
// subscriber CTAs, and a client component cannot export `metadata`. Without
// this file the route silently inherits the root layout's title and
// description, so every search result and link preview for /pricing read as
// the homepage.
//
// A layout is the smallest fix: the alternative is splitting page.tsx into a
// server shell wrapping a client body, which buys nothing here because the
// whole page is interactive. It's also the server-side home for the FAQPage
// JSON-LD below, which a client page can't emit cleanly for a crawler.

// Same literal the homepage/about JSON-LD uses, so the @id cross-references
// (publisher -> #organization) resolve to the same entity graph-wide.
const SITE = "https://elovox.app";

const TITLE = "Pricing | Elovox";
// Built from lib/pricing.ts rather than typed out, for the same reason every
// other price-bearing surface is: a hardcoded figure here outlives a price
// change and is what search results quote.
const DESCRIPTION = `Elovox pricing. Free forever with a daily speech and three attempts a day, or Premium from ${formatUSD(
  planFor("annual").perWeek
)}/week (${formatUSD(
  planFor("annual").price
)}/year) for practice with no three-a-day limit, camera coaching, the speech library, and interview practice. Monthly and annual start with a ${TRIAL_DAYS}-day free trial.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: {
    type: "website",
    siteName: "Elovox",
    url: "/pricing",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

// FAQPage structured data, built from the same lib/faq.ts the page renders, so
// the rich result Google may show can never quote an answer the page doesn't.
const FAQ_SCHEMA = {
  "@type": "FAQPage",
  "@id": `${SITE}/pricing#faq`,
  url: `${SITE}/pricing`,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function PricingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <script
        type="application/ld+json"
        // A data block for crawlers and AI search, not executable script.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(FAQ_SCHEMA)) }}
      />
      {children}
    </>
  );
}
