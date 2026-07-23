import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section, Bullets } from "@/components/LegalDoc";
import { LEGAL, SUBPROCESSORS } from "@/lib/legal";

// Privacy policy. Every claim here is meant to describe what the code in
// this repo actually does — if the data pipeline changes (a new processor,
// stored audio, analytics), this page and lib/legal.ts change with it.

export const metadata: Metadata = {
  title: "Privacy Policy — Elovox",
  description:
    "What Elovox collects when you practice speaking, who processes it, how long it's kept, and how to delete it.",
  alternates: { canonical: "/privacy" },
};

const mailto = `mailto:${LEGAL.contactEmail}`;

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      intro={`Elovox listens to you speak and gives you feedback on how you sounded. That means we handle recordings of your voice, which is personal and sometimes sensitive. This page explains exactly what happens to them — in plain language, because you should be able to tell what you're agreeing to.`}
    >
      <Section heading="The short version">
        <Bullets
          items={[
            "We do not sell your data. There are no advertisers and no ad trackers on this site.",
            "We do not keep your audio or video. Recordings are processed to produce your feedback, then discarded — we store the transcript and the coaching report, not the recording.",
            "We do not use your voice to identify you. Elovox does not create a voiceprint or any biometric identifier, and does not attempt to recognise who is speaking.",
            "We never see your card details. Payments run entirely through Stripe.",
            "You can delete any practice session from your history, or erase your entire account, from your account settings — no email, no waiting.",
          ]}
        />
      </Section>

      <Section heading="Who we are">
        <p>
          {LEGAL.serviceName} is operated by {LEGAL.entity}. For anything in
          this policy — questions, requests, complaints — email{" "}
          <a className="text-accent hover:underline" href={mailto}>
            {LEGAL.contactEmail}
          </a>
          . We are the data controller for the information described below.
        </p>
      </Section>

      <Section heading="What we collect">
        <p>
          <strong>Your account.</strong> An email address and a password. The
          password is handled by Google Firebase Authentication and stored only
          as a salted hash — Elovox never receives or stores your actual
          password. We also record whether your email has been verified.
        </p>
        <p>
          <strong>Your onboarding answers.</strong> The multiple-choice answers
          you give when you set up your account (things like whether you&apos;re
          a student or a professional, and what you want to get better at). We
          use these to pick which practice material to show you.
        </p>
        <p>
          <strong>Your recordings.</strong> When you practice, your browser
          records audio, and video frames as well if you turn the camera on.
          These are sent to our server so they can be analysed. See{" "}
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
          identifiers Stripe gives us — a customer ID, a subscription ID, your
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
      </Section>

      <Section heading="What happens to a recording">
        <p>
          This is the part most people want to know, so here it is step by step:
        </p>
        <Bullets
          items={[
            "Your browser records you and sends the audio to our server. It is not written to disk on our side.",
            "The audio is passed to AssemblyAI, which transcribes it and returns the words with their timings.",
            "The transcript and the timing metrics are sent to Google's Gemini API, which writes the coaching feedback.",
            "If you recorded with the camera on (a Premium feature), a small number of still frames — no more than twelve — are sent to Gemini as well, so it can comment on posture, gestures and expression.",
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
                className="font-semibold text-accent hover:underline"
                href={s.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.name}
              </a>{" "}
              — {s.purpose}
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
          <Link href="/account" className="text-accent hover:underline">
            your account settings
          </Link>{" "}
          will permanently erase your entire account — history, profile, and
          login — along with cancelling any subscription. For anything else,
          email{" "}
          <a className="text-accent hover:underline" href={mailto}>
            {LEGAL.contactEmail}
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
          Elovox sets no advertising or analytics cookies. To keep you signed
          in, Firebase Authentication stores a token in your browser&apos;s
          local storage; clearing your browser data signs you out. When
          you&apos;re not signed in, your practice history is stored in local
          storage too.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          Traffic is encrypted in transit. Practice history is stored under your
          account and protected by database security rules so that other users
          cannot read it. No system is perfectly secure, so we can&apos;t
          promise the impossible — but we don&apos;t retain the most sensitive
          material (your recordings) at all, which is the strongest protection
          available.
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
  );
}
