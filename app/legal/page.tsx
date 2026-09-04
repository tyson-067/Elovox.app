import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { pageGraph } from "@/lib/schema";

// The legal hub: one findable index of every policy, so the footer can carry a
// single "Legal" link instead of a dozen. Each entry is a real page in this
// app. Keep this list in step with the footer and the sitemap.

const TITLE = "Legal | Elovox";
const DESCRIPTION =
  "Every Elovox policy in one place: terms, privacy, refunds, accessibility, and more.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/legal" },
  openGraph: {
    type: "website",
    siteName: "Elovox",
    url: "/legal",
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

const SITE = "https://elovox.app";
const PAGE_SCHEMA = {
  "@type": "WebPage",
  "@id": `${SITE}/legal#webpage`,
  url: `${SITE}/legal`,
  name: TITLE,
  description: DESCRIPTION,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
};

const DOCS: { href: string; title: string; blurb: string }[] = [
  {
    href: "/terms",
    title: "Terms of Service",
    blurb: "The agreement between you and Elovox.",
  },
  {
    href: "/privacy",
    title: "Privacy Policy",
    blurb: "What we collect, who processes it, and how to delete it.",
  },
  {
    href: "/refunds",
    title: "Refunds & Cancellation",
    blurb: "How to cancel, what renews, and when we refund.",
  },
  {
    href: "/biometrics",
    title: "Voice & Camera Data",
    blurb: "No voiceprint, no face template, and audio is never stored.",
  },
  {
    href: "/ai",
    title: "How Felix works",
    blurb: "The coaching is AI-generated: what that means and its limits.",
  },
  {
    href: "/cookies",
    title: "Cookies & Storage",
    blurb: "What's kept in your browser, and why there's no cookie banner.",
  },
  {
    href: "/children",
    title: "Children's Privacy",
    blurb: `Elovox is for ages ${LEGAL.minimumAge}+; how we handle younger users.`,
  },
  {
    href: "/accessibility",
    title: "Accessibility",
    blurb: "What we've built, where we fall short, and how to reach us.",
  },
  {
    href: "/dmca",
    title: "Copyright & DMCA",
    blurb: "How to report infringement and how we handle notices.",
  },
];

export default function LegalHubPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(PAGE_SCHEMA)) }}
      />
      <article className="mx-auto max-w-2xl py-[var(--space-page-y)]">
        <h1 className="font-headline text-3xl font-bold tracking-tight text-primary md:text-4xl">
          Legal
        </h1>
        <p className="mt-3 text-base leading-relaxed text-on-surface">
          Everything in one place. We try to write these in plain language you
          can actually get through. If any of it isn&apos;t clear, email{" "}
          <a
            className="text-accent-strong hover:underline"
            href={`mailto:${LEGAL.emails.support}`}
          >
            {LEGAL.emails.support}
          </a>
          .
        </p>

        <ul className="rule-list mt-10">
          {DOCS.map((d) => (
            <li key={d.href}>
              <Link href={d.href} className="block pr-8">
                <span className="sweep-hover sweep-strong font-headline text-h4 font-semibold text-primary">
                  {d.title}
                </span>
                <span className="mt-1 block text-body-sm text-on-surface-variant">
                  {d.blurb}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </article>
    </>
  );
}
