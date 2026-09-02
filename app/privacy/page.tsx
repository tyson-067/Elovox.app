import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section, Bullets } from "@/components/LegalDoc";
import { LEGAL, SUBPROCESSORS } from "@/lib/legal";
import { pageGraph } from "@/lib/schema";

// Privacy policy. Every claim here is meant to describe what the code in
// this repo actually does, if the data pipeline changes (a new processor,
// stored audio, analytics), this page and lib/legal.ts change with it.

const TITLE = "Privacy Policy | Elovox";
const DESCRIPTION =
  "What Elovox collects when you practice speaking, who processes it, how long it's kept, and how to delete it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
  // Stated explicitly. Next inherits `openGraph` from the root layout rather
  // than merging it, so without this the page shared as "Elovox: Speak with
  // Impact" pointing at the homepage — contradicting its own title and
  // canonical on the same document.
  openGraph: {
    type: "article",
    siteName: "Elovox",
    url: "/privacy",
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

// Same literal the rest of the site's JSON-LD uses, so @id refs resolve to one
// entity graph. privacyUpdated is a human string ("July 31, 2026"); parse it
// to ISO for dateModified, and omit the field rather than emit a bad date.
const SITE = "https://elovox.app";
const modified = (() => {
  const d = new Date(LEGAL.privacyUpdated);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
})();

const PAGE_SCHEMA = {
  "@type": "WebPage",
  "@id": `${SITE}/privacy#webpage`,
  url: `${SITE}/privacy`,
  name: TITLE,
  description: DESCRIPTION,
  isPartOf: { "@id": `${SITE}/#website` },
  publisher: { "@id": `${SITE}/#organization` },
  ...(modified ? { dateModified: modified } : {}),
};

export default function PrivacyPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(PAGE_SCHEMA)) }}
      />
      <LegalDoc
      title="Privacy Policy"
      updated={LEGAL.privacyUpdated}
      intro={`Elovox listens to you speak and gives you feedback on how you sounded. That means we handle recordings of your voice, which is personal and sometimes sensitive. This page explains exactly what happens to them, in plain language, because you should be able to tell what you're agreeing to.`}
    >
      <Section heading="The short version">
        <Bullets
          items={[
            "We do not sell your data. There are no advertisers and no ad trackers on this site.",
            "We do not keep your audio or video. Recordings are processed to produce your feedback, then discarded. We store the transcript and the coaching report, not the recording.",
            "We do not use your voice to identify you. Elovox does not create a voiceprint or any biometric identifier, and does not attempt to recognize who is speaking.",
            "We never see your card details. Payments run entirely through Stripe.",
            // Account erasure really is immediate and uncapped
            // (lib/accountDeletion.ts). Per-session deletion is not:
            // app/api/session/delete/route.ts meters it per day and answers
            // "You've used today's delete. It comes back tomorrow." Promising
            // "no waiting" for both was the one claim on this page that
            // offered more protection than the code delivers.
            "You can erase your entire account from your account settings, no email and no waiting. You can also delete individual practice sessions from your history, a few each day.",
          ]}
        />
      </Section>

      <Section heading="Who we are">
        <p>
          {LEGAL.serviceName} is operated by {LEGAL.entity}. For anything in
          this policy, whether a question, a request, or a complaint, email{" "}
          <a className="text-accent-strong hover:underline" href={mailto}>
            {LEGAL.emails.privacy}
          </a>
          . We are the data controller for the information described below.
        </p>
      </Section>

      <Section heading="What we collect">
        <p>
          <strong>Your account.</strong> An email address and a password. The
          password is handled by Google Firebase Authentication and stored only
          as a salted hash. Elovox never receives or stores your actual
          password. We also record whether your email has been verified.
        </p>
        <p>
          <strong>The tips list.</strong> If you leave your email on our
          speaking-tips form, we store that address and use it only to send
          those tips — one a week, and nothing else. It is never sold or
          shared. Every one of those emails has an unsubscribe link that works
          without signing in, or you can email{" "}
          <a className="text-accent-strong hover:underline" href={mailto}>
            {LEGAL.emails.privacy}
          </a>
          .
        </p>
        <p>
          <strong>Emails to your account.</strong> If you have an account, we
          send you things you can&apos;t switch off and things you can. The
          ones you can&apos;t are about your account itself: a warning when
          someone is trying to sign in as you, and anything to do with a
          payment. We think you&apos;d want those, and turning them off would
          leave you in the dark about your own money and security.
          Everything else — a weekly summary of your practice, a nudge about a
          streak you&apos;re about to break, a single note if you&apos;ve been
          away a while — is optional and switchable under Email in your account
          settings, or from the unsubscribe link in any of them. We do not add
          account holders to the tips list, or the tips list to anything else.
        </p>
        <p>
          <strong>Your recordings.</strong> When you practice, your browser
          records audio, and video frames as well if you turn the camera on.
          These are sent to our server so they can be analyzed. See{" "}
          &ldquo;What happens to a recording&rdquo; below.
        </p>
        <p>
          <strong>Your practice history.</strong> The transcript of what you
          said, the metrics we calculate from it (pace, filler words, pauses),
          the coaching report, your score, duration, and the date. This is the
          part that persists, because it&apos;s what your progress is made of.
        </p>
        <p>
          <strong>Billing information.</strong> If you subscribe, we store the
          identifiers Stripe gives us: a customer ID, a subscription ID, your
          plan, its status, and when the current period ends. Your card number
          is entered on Stripe&apos;s own checkout page and never reaches our
          servers.
        </p>
        <p>
          <strong>Limited technical data.</strong> Our servers log requests,
          including IP addresses, which we use to enforce rate limits and to
          stop abuse. We count how many analyses a free account has run each day
          in order to enforce the free-tier limit.
        </p>
        {/* The leaderboard row was the one durable, cross-user projection the
            policy never mentioned. publishRow() in lib/leaderboardServer.ts
            writes it on every scored session, with no opt-in, and
            firestore.rules makes it readable by any signed-in user. Saying
            elsewhere that practice history is protected from other users was
            true of the sessions and silent on the row derived from them. */}
        <p>
          <strong>Your leaderboard row.</strong> Every scored session updates a
          public row holding your XP, your level, your streak, and the display
          name you choose. Any signed-in user can read it, which is what makes
          a leaderboard a leaderboard. Choosing a display name is optional and a
          row without one appears as an anonymous speaker, but the row itself is
          part of practising and there is no way to switch it off. Your signup
          name is never in it, and neither is anything you said.
        </p>
      </Section>

      <Section heading="What happens to a recording">
        <p>
          This is the part most people want to know, so here it is step by step:
        </p>
        <Bullets
          items={[
            "Your browser records you and sends the audio to our server. It is not written to disk on our side.",
            "The audio is passed to AssemblyAI, which transcribes it and returns the words with their timings.",
            "Our server checks that transcript against a list of swear words and slurs. Matches are hashed out before anything else sees them, so the report you get, the copy we save, and the copy Gemini reads are all masked. No person reads your practice to do this.",
            "The transcript and the timing metrics are sent to Google's Gemini API, which writes the coaching feedback.",
            "If you recorded with the camera on (a Premium feature), a small number of still frames, no more than twelve, are sent to Gemini as well, so it can comment on posture, gestures and expression.",
            "The transcript and the finished report are saved to your account. The audio and the video frames are not saved by Elovox.",
          ]}
        />
        <p>
          Once a recording reaches AssemblyAI or Google, their own retention
          rules apply to the copy they hold; both are linked below. If you sign
          out or use Elovox without an account, your practice history is stored
          only in your own browser and never reaches our servers.
        </p>
      </Section>

      <Section heading="Why we&rsquo;re allowed to do this">
        <p>
          If you are in the UK, EU, or another region with similar law, our
          legal bases are: <strong>performance of a contract</strong> for
          everything needed to deliver the coaching you asked for and to bill
          you for it; <strong>legitimate interests</strong> for keeping the
          service secure and preventing abuse; and{" "}
          <strong>your consent</strong> for the camera, which is off unless you
          switch it on and which you can withdraw at any time by turning it off.
        </p>
        <p>
          We also read our own numbers in aggregate to understand and improve
          Elovox — how many people signed up this week, how many practiced
          today, the average score across everyone. Those are counts and
          averages about the whole userbase at once; nothing in them
          identifies you.
        </p>
      </Section>

      <Section heading="Who else processes your data">
        <p>
          We use these companies to run Elovox. They may only process your data
          to provide their service to us, and none of them are permitted to sell
          it:
        </p>
        <ul className="flex flex-col gap-2 pl-5 list-disc marker:text-on-surface-variant">
          {SUBPROCESSORS.map((s) => (
            <li key={s.name}>
              <a
                className="font-semibold text-accent-strong hover:underline"
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.name}
              </a>
              : {s.purpose}
            </li>
          ))}
        </ul>
        <p>
          These providers are based in the United States, so using Elovox
          involves transferring your data there. We may also disclose data if we
          are legally required to, or to protect the rights and safety of our
          users.
        </p>
      </Section>

      <Section heading="How long we keep things">
        <Bullets
          items={[
            "Practice sessions: until you delete them, or until your account is deleted.",
            "Account details: for as long as your account exists.",
            "Billing records: retained by Stripe, and by us in summary form, for as long as tax and accounting law requires.",
            "Server logs: a short operational window, then discarded.",
            "Audio and video: not retained by Elovox at all.",
            // moderationEvents and adminAudit are written server-side and are
            // deliberately not swept by eraseAccount: they are the record of a
            // decision we may have to stand behind after the account it
            // concerned is gone. That is defensible, but it was undisclosed,
            // which is the part that was not.
            "Enforcement and operator-action records: kept after an account closes. If we warn, suspend or close an account, or an operator acts on one, the record of that decision outlives the account, so we can answer for it. It holds what was decided and why, never what you said.",
            // The deletion-reason rows keep their reason/mode/score but lose
            // the uid and session id in step 4 of lib/accountDeletion.ts.
            "Why a session was deleted: kept as an anonymous product signal, with the link to you and to the session removed when your account is deleted.",
          ]}
        />
      </Section>

      <Section heading="Your rights">
        <p>
          Wherever you live, you can ask us to give you a copy of your data,
          correct it, or delete it. Depending on your region you may also have
          the right to object to or restrict certain processing, to receive your
          data in a portable format, and to complain to your local data
          protection authority.
        </p>
        <p>
          If you are in California: we do not sell or share personal information
          as those terms are defined by the CCPA, and we will not discriminate
          against you for exercising any of your rights.
        </p>
        <p>
          The fastest route for most of this is the app itself: you can delete
          individual sessions from your history, and{" "}
          <Link href="/account" className="text-accent-strong hover:underline">
            your account settings
          </Link>{" "}
          will permanently erase your entire account (history, profile, and
          login) along with canceling any subscription. The two exceptions are
          named under &ldquo;How long we keep things&rdquo; above: an
          enforcement or operator-action record, if there is one, and the
          anonymous note of why a session was deleted, which stops being
          connected to you. For anything else, email{" "}
          <a className="text-accent-strong hover:underline" href={mailto}>
            {LEGAL.emails.privacy}
          </a>{" "}
          and we&apos;ll respond within 30 days.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          Elovox is not intended for children under {LEGAL.minimumAge}, and we
          do not knowingly collect their data. If you believe a child under{" "}
          {LEGAL.minimumAge} has given us personal information, email us and we
          will delete it. If you are between {LEGAL.minimumAge}{" "}
          and 18, please use Elovox with a parent or guardian&apos;s permission.
        </p>
      </Section>

      <Section heading="Cookies and tracking">
        <p>
          Elovox sets no advertising cookies and runs no ad trackers. To keep
          you signed in, Firebase Authentication stores a token in your browser
          (in IndexedDB, falling back to local storage); clearing your browser
          data signs you out. When you&apos;re not signed in, your practice
          history is stored in your browser too. We use Google reCAPTCHA to keep
          bots off the paid pipeline, and privacy-friendly, cookieless analytics
          to count page views. The full list of what&apos;s kept on your device,
          and why there&apos;s no cookie banner, is on the{" "}
          <Link href="/cookies" className="text-accent-strong hover:underline">
            cookies &amp; storage
          </Link>{" "}
          page.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          Traffic is encrypted in transit. Practice history is stored under your
          account and protected by database security rules so that other users
          cannot read it. No system is perfectly secure, so we can&apos;t
          promise the impossible, but we don&apos;t retain the most sensitive
          material (your recordings) at all, which is the strongest protection
          available.
        </p>
        <p>
          Inside Elovox, a small number of operators can see account records —
          your email, your plan, how many sessions you&apos;ve run — because
          running the service and answering support mail requires it. What they
          don&apos;t do is browse your recordings, transcripts, or reports:
          those stay private to your account. The one time an operator touches
          a copy of your content is to fulfill an export or deletion you asked
          for yourself, and every such action is logged.
        </p>
      </Section>

      <Section heading="Changes to this policy">
        <p>
          If we change how we handle your data, we&apos;ll update this page and
          move the date at the top. For a significant change we&apos;ll tell you
          in the app or by email before it takes effect.
        </p>
      </Section>
    </LegalDoc>
    </>
  );
}
