// Every fact the Terms and Privacy pages assert about the business lives
// here, so the legal pages never drift from each other and there's exactly
// one place to edit when something changes.
//
// TODO before launch — the three values marked NEEDS REVIEW must be filled
// in (and the whole of /terms and /privacy read by a lawyer). They're the
// facts only the operator knows; everything else on those pages is drawn
// from what the code actually does.

export const LEGAL = {
  /** Trading name shown throughout the documents. */
  serviceName: "Elovox",

  /**
   * NEEDS REVIEW: the legal entity that contracts with users. If you haven't
   * incorporated, this is you personally, by name — a sole proprietor's terms
   * name the individual. Don't leave it as a placeholder at launch: terms
   * signed by nobody are hard to enforce.
   */
  entity: "[LEGAL ENTITY — e.g. Elovox LLC, or your full legal name]",

  /**
   * NEEDS REVIEW: governing law and the courts that hear disputes. Normally
   * where the entity is based or incorporated.
   */
  jurisdiction: "[STATE/COUNTRY — e.g. the State of California, USA]",

  /** NEEDS REVIEW: keep in sync with each substantive edit. */
  lastUpdated: "July 23, 2026",

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
    purpose:
      "Generating your coaching feedback from the transcript, and the camera analysis when you record with video",
    link: "https://ai.google.dev/gemini-api/terms",
  },
  {
    name: "Stripe",
    purpose: "Subscription payments and billing — Elovox never sees your card details",
    link: "https://stripe.com/privacy",
  },
  {
    name: "Vercel",
    purpose: "Hosting and delivery of the website",
    link: "https://vercel.com/legal/privacy-policy",
  },
] as const;
