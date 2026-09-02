// Every fact the Terms and Privacy pages assert about the business lives
// here, so the legal pages never drift from each other and there's exactly
// one place to edit when something changes.
//
// TODO before launch, the three values marked NEEDS REVIEW must be filled
// in (and the whole of /terms and /privacy read by a lawyer). They're the
// facts only the operator knows; everything else on those pages is drawn
// from what the code actually does.

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
  termsUpdated: "August 5, 2026", // automated language screening + strike thresholds disclosed
  // Published and then revised the same day: the recording countdown is now
  // announced to screen readers, so it moved off "where we fall short".
  accessibilityUpdated: "August 1, 2026",
  refundsUpdated: "August 1, 2026", // first published
  cookiesUpdated: "August 1, 2026", // first published
  aiUpdated: "August 1, 2026", // first published
  biometricsUpdated: "August 1, 2026", // first published
  childrenUpdated: "August 1, 2026", // first published
  dmcaUpdated: "August 1, 2026", // first published

  contactEmail: "elovox.app@gmail.com",
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
      "Sending our emails — account and security notices, billing receipts, and the optional ones you can switch off",
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
