import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section, Bullets } from "@/components/LegalDoc";
import { LEGAL } from "@/lib/legal";
import { pageGraph } from "@/lib/schema";

// Copyright / DMCA policy. Elovox hosts very little user-to-user content today
// (essentially just leaderboard handles), but the takedown route should exist
// before it's needed, not after. This page is the notice-and-takedown process
// and the contact for it. Note: DMCA §512(c) safe harbor also requires a
// designated agent REGISTERED with the US Copyright Office — a separate,
// non-code step for the operators; this page is necessary but not by itself
// sufficient for that protection.

const TITLE = "Copyright & DMCA | Elovox";
const DESCRIPTION =
  "How to report copyright infringement on Elovox, and how we handle takedown notices.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/dmca" },
  openGraph: {
    type: "article",
    siteName: "Elovox",
    url: "/dmca",
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

const mailto = `mailto:${LEGAL.contactEmail}`;
const SITE = "https://elovox.app";
const modified = (() => {
  const d = new Date(LEGAL.dmcaUpdated);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
})();

const PAGE_SCHEMA = {
  "@type": "WebPage",
  "@id": `${SITE}/dmca#webpage`,
  url: `${SITE}/dmca`,
  name: TITLE,
  description: DESCRIPTION,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
  ...(modified ? { dateModified: modified } : {}),
};

export default function DmcaPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(PAGE_SCHEMA)) }}
      />
      <LegalDoc
        title="Copyright & DMCA"
        updated={LEGAL.dmcaUpdated}
        intro="We respect copyright, and we expect the people who use Elovox to as well. If you believe something on Elovox infringes your copyright, here's how to tell us, and what we'll do."
      >
        <Section heading="What's here to report">
          <p>
            Most of what you create in Elovox — your recordings, transcripts, and
            the briefs you type — is private to your own account and never shown
            to anyone else. The one thing other users can see is the display name
            you pick for the leaderboard. So a copyright report will almost always
            be about a public handle; if that ever changes, this process covers
            whatever is public.
          </p>
        </Section>

        <Section heading="Sending a takedown notice">
          <p>
            Email{" "}
            <a className="text-accent-strong hover:underline" href={mailto}>
              {LEGAL.contactEmail}
            </a>{" "}
            with &ldquo;Copyright&rdquo; in the subject line and include:
          </p>
          <Bullets
            items={[
              "The work you say is infringed, and enough to identify it.",
              "What on Elovox you're reporting, with enough detail for us to find it (a link, a handle, a screenshot).",
              "Your name, and contact details we can reach you at.",
              "A statement that you have a good-faith belief the use isn't authorized by the owner, its agent, or the law.",
              "A statement, under penalty of perjury, that your notice is accurate and that you are the owner or authorized to act for them.",
              "Your physical or electronic signature.",
            ]}
          />
          <p>
            A notice missing these may be one we can&apos;t act on, so please
            include them all.
          </p>
        </Section>

        <Section heading="What we do with it">
          <p>
            When we get a complete notice, we remove or disable the reported
            material if it&apos;s still up, and we tell the person who posted it.
            If you&apos;re that person and you think it was a mistake or you had
            the right to use it, you can send a counter-notice to the same
            address, and we&apos;ll pass it along. Accounts that repeatedly
            infringe are closed.
          </p>
        </Section>

        <Section heading="Don't misuse this">
          <p>
            Filing a knowingly false report carries real legal liability. Please
            only use it for a genuine copyright claim, not to remove something you
            simply dislike. For everything else about using Elovox, see the{" "}
            <Link href="/terms" className="text-accent-strong hover:underline">
              Terms of Service
            </Link>
            .
          </p>
        </Section>
      </LegalDoc>
    </>
  );
}
