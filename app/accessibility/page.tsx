import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section, Bullets } from "@/components/LegalDoc";
import { LEGAL } from "@/lib/legal";
import { pageGraph } from "@/lib/schema";

// Accessibility statement.
//
// Same rule as /privacy: every claim here describes something the code in this
// repo actually does. That rule matters more here than anywhere else on the
// site, because an accessibility statement is the one document where
// overclaiming makes the legal position WORSE, not better. "This site is fully
// WCAG 2.1 AA conformant" is a statement of fact about a product; if a user
// with a screen reader hits a wall on the next screen, that sentence stops
// being marketing and becomes the exhibit. What actually holds up is the
// opposite shape: a specific account of what was built, an honest list of
// where the product still falls short, and a route to a human who answers.
//
// So: no conformance certificate, no claim of an audit nobody ran, no "tested
// with users with disabilities" until we have actually done it and can say who
// and when. Aiming at a standard is a commitment we can keep. Having met it is
// a claim someone can disprove with one screenshot.
//
// When the limitations below get fixed, delete them from the list and move
// LEGAL.accessibilityUpdated. A stale limitation is just as wrong as a stale
// promise.

const TITLE = "Accessibility | Elovox";
const DESCRIPTION =
  "How Elovox approaches accessibility: what we've built, where we know we fall short, and how to tell us when something doesn't work for you.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/accessibility" },
  // Stated explicitly. Next inherits `openGraph` from the root layout rather
  // than merging it, so without this the page shared as "Elovox: Speak with
  // Impact" pointing at the homepage — contradicting its own title and
  // canonical on the same document.
  openGraph: {
    type: "article",
    siteName: "Elovox",
    url: "/accessibility",
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

const mailto = `mailto:${LEGAL.emails.support}`;

// Same literal the rest of the site's JSON-LD uses, so @id refs resolve to one
// entity graph. accessibilityUpdated is a human string ("August 1, 2026");
// parse it to ISO for dateModified, and omit the field rather than emit a bad
// date.
const SITE = "https://elovox.app";
const modified = (() => {
  const d = new Date(LEGAL.accessibilityUpdated);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
})();

const PAGE_SCHEMA = {
  "@type": "WebPage",
  "@id": `${SITE}/accessibility#webpage`,
  url: `${SITE}/accessibility`,
  name: TITLE,
  description: DESCRIPTION,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
  ...(modified ? { dateModified: modified } : {}),
};

export default function AccessibilityPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(PAGE_SCHEMA)) }}
      />
      <LegalDoc
        title="Accessibility"
        updated={LEGAL.accessibilityUpdated}
        intro={`Elovox is a speaking app, which means the way it works can't be the same for everyone. This page says what we've built to make it usable, where we know it still isn't, and how to reach a person if you hit a wall. We'd rather be honest about the gaps than claim we've closed them.`}
      >
        <Section heading="Where we stand">
          <p>
            We build against{" "}
            <a
              className="text-accent-strong hover:underline"
              href="https://www.w3.org/WAI/WCAG21/quickref/"
              target="_blank"
              rel="noopener noreferrer"
            >
              WCAG 2.1 Level AA
            </a>
            , the standard most accessibility law points at. We are not going to
            tell you we&apos;ve fully met it. Elovox has not been through an
            independent audit, and no product this size is perfectly conformant
            on every screen. Treat this page as a description of the work and
            the gaps, not a certificate.
          </p>
        </Section>

        <Section heading="What we've built">
          <p>
            These are things that exist in the product today, not plans:
          </p>
          <Bullets
            items={[
              "Keyboard access. Every page opens with a \"Skip to content\" link, and interactive controls are real buttons and links rather than clickable boxes, so tab, enter and escape behave the way you expect.",
              "Visible focus. Focus rings are styled rather than removed, so you can always see where you are when navigating by keyboard.",
              "Screen reader labeling. Icon-only controls carry text labels, decorative graphics are hidden from assistive tech, and status changes that only show as a spinner or a color are also announced as text.",
              "Reduced motion. The site has a lot of movement in it, and we switch it off if your system is set to reduce motion. The animated pieces fall back to a plain static layout rather than disappearing, so you don't lose any content by turning motion off.",
              "Contrast. We've measured the contrast of text against its background and fixed the places that failed, including our own brand orange, which wasn't readable enough for text and is now only used where it isn't text.",
              "Nothing is explained by color alone. Where a color carries meaning — a strong moment in your transcript, a badge you haven't earned yet — the same thing is also written out for a screen reader.",
              "The recording is announced as it runs. A screen reader hears when recording starts, a warning at thirty seconds left and again at ten, and whether the take ended because you stopped it or because the clock ran out. The countdown itself isn't read out second by second, which would talk over the person trying to speak.",
              "Touch targets. The controls you actually operate — the record button, the navigation, the app's tab bar — are sized for a thumb rather than a cursor.",
              "You always get text. Every practice session returns a written transcript of what you said alongside the coaching, so nothing important is delivered as audio only, and you can export all of it as a file.",
              "The camera is off unless you turn it on. Video is never required to use Elovox, and no analysis depends on you being visible.",
              "Automated checks in our linting flag malformed ARIA and missing image descriptions. They're a floor, not an audit — they warn us, and they catch a narrow set of problems.",
            ]}
          />
        </Section>

        <Section heading="Where we fall short">
          <p>
            The honest part. These are limitations we know about:
          </p>
          <Bullets
            items={[
              "Elovox is built around speaking out loud into a microphone. That is the product, and it means the core experience is not usable if you cannot speak, or cannot speak in a way automated transcription handles well. Speech recognition is measurably worse for some accents, some speech disorders, and some deaf and hard-of-hearing speakers, and the coaching sits on top of that transcript. We have not solved this.",
              "The coaching itself judges delivery — pace, pauses, filler words, and, with the camera on, posture and expression. Those are norms, and they are not neutral. If you stammer, use a communication device, are autistic, or move differently, the feedback can be wrong or unkind in ways we have not fully accounted for.",
              "We have not yet run formal testing with disabled users, and we have not commissioned an independent audit. Our checks so far are automated tooling, keyboard testing, and our own review.",
              "The Daily Minute cuts off at sixty seconds, and that limit can't be extended or turned off. It's the same exercise for everyone, but a fixed time limit is a barrier if you need longer, and WCAG asks that limits be adjustable. Everything else in the app is untimed.",
              "Some secondary links, including the ones in the site footer, are smaller than the target size WCAG asks for. The main controls aren't.",
              "Elovox is only available in English at the moment.",
              "Some parts of the app have had more accessibility attention than others. The public pages and the core practice flow have had the most; newer screens have had the least.",
            ]}
          />
        </Section>

        <Section heading="If speaking isn't the barrier for you">
          <p>
            A few things that may help. You can practice with the camera off,
            which most people do. Apart from the Daily Minute, nothing is on a
            sixty-second clock — a practice run can go up to ten minutes, and
            you stop it whenever you&apos;re done. Your transcript and report
            stay in your history, so you
            can read the feedback at your own pace rather than taking it in
            live. And you can erase your whole account, or delete individual
            sessions a few at a time, from{" "}
            <Link href="/account" className="text-accent-strong hover:underline">
              your account settings
            </Link>
            .
          </p>
        </Section>

        <Section heading="Tell us when something doesn't work">
          <p>
            This is the part we actually want you to use. If any part of Elovox
            is unusable with your assistive technology, or the product assumes
            something about you that isn&apos;t true, email{" "}
            <a className="text-accent-strong hover:underline" href={mailto}>
              {LEGAL.emails.support}
            </a>{" "}
            with what you were trying to do and what happened. Put
            &ldquo;Accessibility&rdquo; in the subject line and it gets read
            first.
          </p>
          <p>
            We aim to reply within 5 business days, and to tell you honestly
            whether we can fix it, when, or that we can&apos;t. If you need
            something from Elovox in another format in the meantime, ask and
            we&apos;ll find a way to get it to you.
          </p>
        </Section>

        <Section heading="Changes to this page">
          <p>
            We update this page when the product changes, in both directions: a
            limitation that gets fixed comes off the list, and a new one that we
            find goes on it. The date at the top moves when it does.
          </p>
        </Section>
      </LegalDoc>
    </>
  );
}
