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
   * The people who contract with users. Elovox isn't incorporated, so there is
   * no company to name — the operators are named individually, which is what
   * an unincorporated venture's terms have to do.
   *
   * Worth knowing: several people running a business together without
   * incorporating is, by default, a general partnership in most US states —
   * which generally means each person can be held personally liable for the
   * whole of the venture's obligations. Forming an LLC is the usual fix, and
   * would replace this line with the company name. Ask a lawyer.
   */
  entity: "Tyson Youm, Arad Mehrabian, Aanya Iyer Us, and Kelleyguo Kaling",

  /** Governing law and the courts that hear disputes. */
  jurisdiction: "the State of New York, USA",

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
