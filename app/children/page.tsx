import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section, Bullets } from "@/components/LegalDoc";
import { LEGAL } from "@/lib/legal";
import { pageGraph } from "@/lib/schema";

// Children's privacy. Consolidates the under-13 and 13-17 handling into one
// findable page, and gives parents a clear route to a deletion. Keep the age
// figures sourced from LEGAL so they can't drift from the age gate.

const TITLE = "Children's Privacy | Elovox";
const DESCRIPTION = `Elovox is for ages ${LEGAL.minimumAge}+. How we handle younger users, teens, and parental requests.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/children" },
  openGraph: {
    type: "article",
    siteName: "Elovox",
    url: "/children",
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
  const d = new Date(LEGAL.childrenUpdated);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
})();

const PAGE_SCHEMA = {
  "@type": "WebPage",
  "@id": `${SITE}/children#webpage`,
  url: `${SITE}/children`,
  name: TITLE,
  description: DESCRIPTION,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
  ...(modified ? { dateModified: modified } : {}),
};

export default function ChildrenPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(PAGE_SCHEMA)) }}
      />
      <LegalDoc
        title="Children's Privacy"
        updated={LEGAL.childrenUpdated}
        intro={`Elovox is built for ages ${LEGAL.minimumAge} and up. Because the app records voices and can use a camera, we take younger users seriously. Here's how it works.`}
      >
        <Section heading={`Under ${LEGAL.minimumAge}`}>
          <p>
            Elovox is not for children under {LEGAL.minimumAge}, and we
            don&apos;t knowingly collect their information. When someone tells us
            they&apos;re under {LEGAL.minimumAge}, we stop them from creating an
            account. If you believe a child under {LEGAL.minimumAge} has given us
            personal information anyway, email{" "}
            <a className="text-accent-strong hover:underline" href={mailto}>
              {LEGAL.contactEmail}
            </a>{" "}
            and we&apos;ll delete it.
          </p>
        </Section>

        <Section heading={`If you're ${LEGAL.minimumAge}–17`}>
          <p>
            You&apos;re welcome to use Elovox with a parent or guardian&apos;s
            permission. Because practice runs record your voice — and your camera
            if you switch it on — it&apos;s worth showing a parent what the app
            does before you go deep. The camera is always off unless you turn it
            on.
          </p>
        </Section>

        <Section heading="For parents and guardians">
          <p>What Elovox holds for an account is small and in your control:</p>
          <Bullets
            items={[
              "An email and password, the practice transcripts and coaching reports, and basic progress stats. We do not keep the audio or video from practice sessions.",
              "No voiceprint or face template is ever created, and we don't try to identify anyone — see the voice & camera notice.",
              "There are no ads and no ad tracking anywhere in Elovox.",
            ]}
          />
          <p>
            To see, correct, or delete your child&apos;s information, email{" "}
            <a className="text-accent-strong hover:underline" href={mailto}>
              {LEGAL.contactEmail}
            </a>
            . Deleting the account erases the history, the profile, and the
            login. The fuller picture is in the{" "}
            <Link href="/privacy" className="text-accent-strong hover:underline">
              Privacy Policy
            </Link>{" "}
            and the{" "}
            <Link href="/biometrics" className="text-accent-strong hover:underline">
              voice &amp; camera notice
            </Link>
            .
          </p>
        </Section>
      </LegalDoc>
    </>
  );
}
