// Every fact the Terms and Privacy pages assert about the business lives
// here, so the legal pages never drift from each other and there's exactly
// one place to edit when something changes.
//
// TODO before launch, the three values marked NEEDS REVIEW must be filled
// in (and the whole of /terms and /privacy read by a lawyer). They're the
// facts only the operator knows; everything else on those pages is drawn
// from what the code actually does. `postalAddress` is the same kind of gap
// and the most urgent of them: it is empty, and CAN-SPAM makes every
// marketing email illegal until it is not.

export const LEGAL = {
  /** Trading name shown throughout the documents. */
  serviceName: "Elovox",

  /**
   * The people who contract with users. Elovox isn't incorporated, so there is
   * no company to name, the operators are named individually, which is what
   * an unincorporated venture's terms have to do.
   *
   * Worth knowing: several people running a business together without
   * incorporating is, by default, a general partnership in most US states —
   * which generally means each person can be held personally liable for the
   * whole of the venture's obligations. Forming an LLC is the usual fix, and
   * would replace this line with the company name. Ask a lawyer.
   */
  entity: "Tyson Youm, Arad Mehrabian, Aanya Iyer, and Kelley Gou",

  /** Governing law and the courts that hear disputes. */
  jurisdiction: "the State of New York, USA",

  /** NEEDS REVIEW: keep in sync with each substantive edit. */
  // Per-document, because they change independently and each page prints its
  // own: bumping one date must never make the other claim a change it didn't
  // have. Same stale-but-honest rule as the sitemap.
  privacyUpdated: "August 5, 2026", // transcript language screening step disclosed
  // Moved off August 5 because the Terms gained an arbitration agreement, a
  // class-action waiver and an indemnity, and those are exactly the clauses
  // whose enforceability turns on the reader having been told they arrived: a
  // date still claiming August would have the page swearing nothing had
  // changed while displaying them. It is also the date the 30-day arbitration
  // opt-out runs from for anyone who already held an account, so it has to be
  // the day the wording actually changed.
  termsUpdated: "September 2, 2026", // arbitration, class-action waiver, indemnity added
  /**
   * The same event as `termsUpdated`, written as a sortable date: it is the
   * string /terms prints as "this is version X" and the string the sign-up
   * screen prints at the moment of consent, so what was accepted and what was
   * published can be compared later. Bump it with `termsUpdated`, in the edit
   * that changes the wording.
   *
   * It lives here, and not in app/terms/page.tsx where it is displayed,
   * because components/AuthForm.tsx cannot import a route module: a
   * "use client" file that does drags the route's `metadata` export across the
   * client boundary and Turbopack refuses to build it. The workaround was a
   * second copy of the literal in AuthForm, which is how the version at the
   * consent point could silently drift from the version on the page — and a
   * version nobody can trust is worth less than no version at all. Only
   * lib/legal.ts is imported by both sides, so only lib/legal.ts can hold it.
   */
  termsVersion: "2026-09-02",
  // Published and then revised the same day: the recording countdown is now
  // announced to screen readers, so it moved off "where we fall short".
  accessibilityUpdated: "August 1, 2026",
  refundsUpdated: "August 1, 2026", // first published
  cookiesUpdated: "August 1, 2026", // first published
  aiUpdated: "August 1, 2026", // first published
  biometricsUpdated: "August 1, 2026", // first published
  childrenUpdated: "August 1, 2026", // first published
  dmcaUpdated: "August 1, 2026", // first published

  /**
   * Public addresses, one per kind of mail. All three are Porkbun forwards
   * onto a single Gmail (see docs/EMAIL-DOMAIN-SETUP.md), so this split costs
   * nothing to run — it buys a filterable, separately-dated intake for the two
   * kinds of mail where the date matters:
   *
   * - `privacy` — GDPR/CCPA erasure, BIPA and COPPA requests all start a
   *   statutory clock on arrival. Mixed into the support queue there is no
   *   defensible record of when one landed.
   * - `security` — researchers try `security@` before they read
   *   /.well-known/security.txt, and RFC 9116 expects the file to name an
   *   address that already works.
   *
   * `support` is the default for everything else, and is deliberately a real
   * monitored mailbox rather than a `noreply@`: it is also MAIL_FROM and the
   * Reply-To on every email the app sends (lib/email/config.ts explains why a
   * no-reply From is a self-inflicted deliverability wound).
   */
  emails: {
    /** The general-purpose address. Footer, terms, refunds, DMCA, LICENSE. */
    support: "support@elovox.app",
    /** Data-rights requests: privacy policy, biometrics (BIPA), children (COPPA). */
    privacy: "privacy@elovox.app",
    /** Vulnerability reports. Must match public/.well-known/security.txt. */
    security: "security@elovox.app",
  },
  /**
   * The physical postal address that CAN-SPAM requires in every commercial
   * message, rendered into both email footers by lib/email/render.ts.
   *
   * EMPTY BY DECISION (2026-09-02), NOT BY OVERSIGHT. 15 U.S.C.
   * §7704(a)(5)(A)(iii) requires a valid physical postal address in every
   * commercial message and the FTC counts each message lacking one as its own
   * violation. Rather than publish an address, the choice was to hold the
   * commercial mail — so `commercialBlocked` in lib/email/send.ts refuses the
   * `lifecycle` and `marketing` categories outright while this is blank.
   *
   * That gate is the enforcement. The commercial sends run from a daily cron
   * (the weekly tips drip pitches the product roughly every fourth message;
   * weeklyProgress, streakAtRisk and winBack all promote it), so "remember not
   * to send" was never a control that could hold. Nothing is held that anyone
   * is owed: `security`, `billing` and `transactional` — lockout notices,
   * receipts, failed-payment warnings — are relationship mail the statute does
   * not reach, and they send exactly as before.
   *
   * FILL THIS IN AND THE HELD MAIL RESUMES on the next cron run, with no other
   * change. A street address, a registered agent's address, or a USPS PO Box /
   * mailbox at a Commercial Mail Receiving Agency all satisfy the statute — a
   * bare email address or a URL does not. An invented address is worse than
   * none, which is why this stays empty until a real one exists.
   *
   * Format it as one line, e.g. "Elovox, 123 Example St, New York, NY 10001".
   */
  postalAddress: "" as string, // blank holds lifecycle + marketing mail; see above

  instagramHandle: "elovox.app",
  instagramUrl: "https://www.instagram.com/elovox.app/",
  siteUrl: "https://elovox.app",

  /** Minimum age to hold an account. See the Children section of both docs. */
  minimumAge: 13,
} as const;

/**
 * Third parties that process user data on Elovox's behalf. Listed in the
 * privacy policy by name because "trusted partners" tells a reader nothing
 * and doesn't satisfy GDPR's disclosure requirement.
 *
 * Keep this in step with the code: adding a processor to the pipeline
 * without adding it here makes the policy inaccurate.
 */
export const SUBPROCESSORS = [
  {
    name: "Google Firebase",
    purpose: "Account sign-in, and storage of your practice history",
    link: "https://firebase.google.com/support/privacy",
  },
  {
    name: "AssemblyAI",
    purpose: "Speech-to-text transcription of your recordings",
    link: "https://www.assemblyai.com/legal/privacy-policy",
  },
  {
    name: "Google (Gemini API)",
    // Also receives the briefs you type: /api/speech sends need, audience,
    // occasion and tone to write a practice speech, and situation and panel
    // to generate interview questions. Neither is a transcript or a frame,
    // so the old purpose string did not cover them.
    purpose:
      "Generating your coaching feedback from the transcript, the camera analysis when you record with video, and writing the practice material you ask for from the brief you type",
    link: "https://ai.google.dev/gemini-api/terms",
  },
  {
    name: "Fish Audio",
    // /api/voice sends the TEXT of Felix's take (thirty to sixty words Gemini
    // wrote from the finished analysis, see lib/felixTake.ts) to be read
    // aloud, and only when the user presses play. Never the recording, never
    // the transcript itself. The audio comes back and is kept on the user's
    // own session so a replay never sends it again. The landing page's
    // sample is a static file and sends nothing.
    purpose:
      "Turning Felix's written take on a report into his voice, only when you press play",
    link: "https://fish.audio/privacy/",
  },
  {
    name: "Stripe",
    purpose: "Subscription payments and billing, Elovox never sees your card details",
    link: "https://stripe.com/privacy",
  },
  {
    name: "Resend",
    purpose:
      "Sending our emails: account and security notices, billing receipts, and the optional ones you can switch off",
    link: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Vercel",
    purpose:
      "Hosting and delivery of the website, and privacy-friendly, cookieless traffic analytics",
    link: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Google reCAPTCHA",
    // App Check tokens are attached to the recording and speech-writing
    // calls (lib/analyze.ts, lib/generated.ts) and verified there. The tips
    // form uses a honeypot and a per-IP limit instead, so "on our forms"
    // claimed a third-party contact that does not happen.
    purpose:
      "Telling real browsers from bots at sign-in and on the recording and speech-writing pipeline, to stop abuse of the paid pipeline",
    link: "https://policies.google.com/privacy",
  },
] as const;
