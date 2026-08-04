// The site-wide JSON-LD entity nodes, in one place.
//
// Why this file exists: every page's schema references `#organization` and
// `#website` by @id, but those nodes were DEFINED only in the homepage's
// @graph. A validator resolves @id within a single document, so on /about,
// /privacy, /terms, /pricing and /for/* those were dangling references —
// pointing at entities that page never declares. Google treats an unresolved
// publisher edge as absent, which is exactly the signal the Organization node
// exists to assert (see the note in app/page.tsx: "Elovox" is a contested
// name and this is a tie broken on entity signals).
//
// So: emit the same Organization and WebSite nodes alongside whatever node a
// page is really about, and let the @id references resolve locally on every
// document.

import { planFor } from "./pricing";

export const SITE = "https://elovox.app";

export const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "Elovox",
  url: SITE,
  logo: {
    "@type": "ImageObject",
    url: `${SITE}/logo.png`,
    width: 184,
    height: 182,
  },
  description:
    "Elovox makes speaking practice software: record a speech, pitch, or interview answer and get specific coaching on your delivery.",
  sameAs: [
    "https://www.instagram.com/elovox.app/",
    "https://www.tiktok.com/@elovox0",
  ],
};

// Carries the site name for search results. Google reads WebSite.name when
// deciding what to print above the URL, and left to infer it, it tends to
// pick the <title> tail or the domain.
export const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  name: "Elovox",
  url: SITE,
  publisher: { "@id": `${SITE}/#organization` },
};

export const WEBAPP = {
  "@type": "WebApplication",
  "@id": `${SITE}/#webapp`,
  name: "Elovox",
  url: SITE,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any (web browser)",
  publisher: { "@id": `${SITE}/#organization` },
  description:
    "Elovox is a speaking practice app. You record yourself giving a speech, pitch, or interview answer, and Elovox analyzes the recording and returns coaching on your delivery: pace, filler words, pauses, clarity, and how the audience is likely to perceive you.",
  offers: [
    {
      "@type": "Offer",
      name: "Free",
      price: "0",
      priceCurrency: "USD",
      description: "A daily practice topic with three attempts a day.",
    },
    {
      "@type": "Offer",
      name: "Premium",
      // Derived, never typed twice. Every other price-bearing surface (Terms,
      // Refunds, the pricing page itself) reads lib/pricing.ts explicitly so it
      // "can never contradict what checkout actually charges" — this node was
      // the one exception, and it is the one search engines quote back at
      // people. It happened to be right; being right by coincidence is not a
      // property you can rely on through a price change.
      price: planFor("monthly").price.toFixed(2),
      priceCurrency: "USD",
      // Without a billing period this can surface as a bare "$11.99", which
      // reads as a one-off purchase for a monthly subscription.
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: planFor("monthly").price.toFixed(2),
        priceCurrency: "USD",
        billingDuration: 1,
        billingIncrement: 1,
        unitCode: "MON",
      },
      // Mirrors the visible copy's honest wording (see lib/faq.ts): Premium
      // lifts the three-a-day limit, it is not literally unlimited — there is
      // a fair-use ceiling. "Unlimited" here was the one survivor of the
      // billing-honesty pass, live on every page that embeds this node.
      description:
        "Practice with no three-a-day limit, camera coaching, the full speech library, interview practice, and social skills.",
    },
  ],
};

/**
 * Wraps a page's own schema node(s) in a @graph together with the shared
 * Organization and WebSite entities, so every `@id` reference in the document
 * resolves. Pass the node this page is actually about.
 */
export function pageGraph(...nodes: object[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [ORGANIZATION, WEBSITE, ...nodes],
  };
}
