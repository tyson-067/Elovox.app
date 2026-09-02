import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section, Bullets } from "@/components/LegalDoc";
import { LEGAL } from "@/lib/legal";
import { pageGraph } from "@/lib/schema";

// Voice & camera notice — a written, public retention & destruction schedule
// for the voice and image data the app handles. Laws like Illinois's BIPA fault
// operators specifically for NOT having a published schedule, so this exists to
// be that document. Every claim must match the pipeline exactly: we send no
// speaker-identification options to the transcriber, and we never write the
// audio or the frames to storage. If that ever changes, this page changes with
// it — see app/api/analyze/route.ts and the Privacy Policy.

const TITLE = "Voice & Camera Data | Elovox";
const DESCRIPTION =
  "How Elovox handles your voice and camera data: no voiceprint, no face template, and audio and video are never stored.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/biometrics" },
  openGraph: {
    type: "article",
    siteName: "Elovox",
    url: "/biometrics",
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

const mailto = `mailto:${LEGAL.emails.privacy}`;
const SITE = "https://elovox.app";
const modified = (() => {
  const d = new Date(LEGAL.biometricsUpdated);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
})();

const PAGE_SCHEMA = {
  "@type": "WebPage",
  "@id": `${SITE}/biometrics#webpage`,
  url: `${SITE}/biometrics`,
  name: TITLE,
  description: DESCRIPTION,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
  ...(modified ? { dateModified: modified } : {}),
};

export default function BiometricsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(PAGE_SCHEMA)) }}
      />
      <LegalDoc
        title="Voice & Camera Data"
        updated={LEGAL.biometricsUpdated}
        intro="Elovox listens to you speak, and watches if you turn the camera on. Voice and face data are sensitive, and some laws treat them specially, so this page states plainly what we do and don't do with them, and exactly how long we keep them."
      >
        <Section heading="We don't identify you">
          <p>
            This is the important part. Elovox does not create a voiceprint, a
            face template, or any other biometric identifier, and it does not try
            to recognize <em>who</em> is speaking or on camera. We turn on none
            of the speaker-identification features our transcription provider
            offers. Your recording is analyzed for <em>how</em> you came across —
            pace, clarity, expression — never to match you to an identity.
          </p>
        </Section>

        <Section heading="What we handle, and for how long">
          <Bullets
            items={[
              "Audio. Your browser records you and sends the audio to our server, which passes it straight to the transcription provider. It is not written to our storage, and we destroy our copy as soon as the transcript comes back — within the seconds it takes to process one recording.",
              "Camera frames (only if you turn the camera on). A small number of still frames — no more than twelve — are sent to the AI model to comment on your delivery, then discarded. They are never written to our storage.",
              "What we keep instead. The transcript, the metrics, and the coaching report are saved to your account, because that's what your progress is made of. The raw audio and the frames are not.",
            ]}
          />
        </Section>

        <Section heading="Consent and control">
          <p>
            Recording only happens when you start a practice run, and the camera
            stays off unless you switch it on — video is never required to use
            Elovox. You can erase your whole account along with everything
            saved to it, or delete individual sessions a few at a time, from{" "}
            <Link href="/account" className="text-accent-strong hover:underline">
              your account settings
            </Link>
            .
          </p>
        </Section>

        <Section heading="Providers">
          <p>
            While your audio or frames are briefly with our transcription and AI
            providers to be processed, their own retention rules apply to the
            copy they hold. They are named, with links to their policies, in the{" "}
            <Link href="/privacy" className="text-accent-strong hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </Section>

        <Section heading="Questions or requests">
          <p>
            Email{" "}
            <a className="text-accent-strong hover:underline" href={mailto}>
              {LEGAL.emails.privacy}
            </a>{" "}
            with anything about your voice or camera data and we&apos;ll respond
            within 30 days.
          </p>
        </Section>
      </LegalDoc>
    </>
  );
}
