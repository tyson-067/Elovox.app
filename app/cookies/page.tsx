import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section, Bullets } from "@/components/LegalDoc";
import { LEGAL } from "@/lib/legal";
import { pageGraph } from "@/lib/schema";

// Cookie & storage notice. Elovox sets no first-party cookies and runs no ad
// trackers, so this page's job is mostly to say that plainly — and to disclose
// the two Google/Vercel pieces that DO run (reCAPTCHA, cookieless analytics),
// which the privacy policy previously didn't name. Keep it factual: every key
// listed here is one the app actually writes.

const TITLE = "Cookies & Storage | Elovox";
const DESCRIPTION =
  "What Elovox stores in your browser, and why there's no cookie banner: no ad trackers, no first-party cookies.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/cookies" },
  openGraph: {
    type: "article",
    siteName: "Elovox",
    url: "/cookies",
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
const modified = (() => {
  const d = new Date(LEGAL.cookiesUpdated);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
})();

const PAGE_SCHEMA = {
  "@type": "WebPage",
  "@id": `${SITE}/cookies#webpage`,
  url: `${SITE}/cookies`,
  name: TITLE,
  description: DESCRIPTION,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
  ...(modified ? { dateModified: modified } : {}),
};

export default function CookiesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(PAGE_SCHEMA)) }}
      />
      <LegalDoc
        title="Cookies & Storage"
        updated={LEGAL.cookiesUpdated}
        intro="Elovox sets no advertising cookies and runs no ad trackers. It does keep a few things in your browser to work at all — to remember you're signed in, and to hold your practice history when you're not. Here's the whole list."
      >
        <Section heading="No cookie banner, and why">
          <p>
            We don&apos;t show a cookie consent popup because we don&apos;t do
            the thing those popups exist for: there are no advertising cookies,
            no cross-site tracking, and nothing here is sold or shared. Every
            item below is functional — the app genuinely needs it to do what you
            asked — so there&apos;s nothing to opt out of without breaking the
            product.
          </p>
        </Section>

        <Section heading="What we store on your device">
          <Bullets
            items={[
              "Sign-in, via Firebase Authentication. To keep you logged in, Firebase stores a token in your browser (in IndexedDB, with local storage as a fallback). Clearing your browser data signs you out.",
              "Your practice history when you're signed out. If you use Elovox without an account, your sessions live only in your browser's local storage and never reach our servers.",
              "Small preferences. A handful of local-storage keys remember things like your last choices and one-time notices, so the app doesn't nag you twice.",
            ]}
          />
          <p>
            None of this is a cookie in the tracking sense, and none of it
            follows you to other websites.
          </p>
        </Section>

        <Section heading="Two third-party pieces that run">
          <Bullets
            items={[
              "Google reCAPTCHA. It runs in the background to tell real browsers from bots at sign-in and on our forms, which is what stops strangers from burning our paid transcription and AI budget. It's a Google service and may set its own cookie in Google's domain. We use it only for abuse prevention.",
              "Vercel Analytics. We count page views to see what's used, with a privacy-friendly, cookieless setup — no cookie, no cross-site identifier, no selling.",
            ]}
          />
        </Section>

        <Section heading="Managing it">
          <p>
            Clearing your browser&apos;s site data for Elovox removes everything
            above (and signs you out). Your account itself, and any history saved
            to it, is separate — you can erase all of that from{" "}
            <Link href="/account" className="text-accent-strong hover:underline">
              your account settings
            </Link>
            . For the full picture of what we collect and who processes it, see
            the{" "}
            <Link href="/privacy" className="text-accent-strong hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </Section>
      </LegalDoc>
    </>
  );
}
