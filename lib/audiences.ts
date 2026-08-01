// Per-audience landing pages (/for/<slug>). One generic homepage can't tell a
// nervous interviewee and a founder pitching investors that Elovox is FOR
// them, in their words. Each entry drives a tailored page: the outcome
// headline, the modes that matter to that person, and a proof line. Kept as
// data (not five near-identical page files) so the shared /for/[audience]
// template renders them all and the homepage "Who it's for" cards link in.

export interface AudienceMode {
  title: string;
  body: string;
}

export interface Audience {
  slug: string;
  /** Short label used on the homepage card and the breadcrumb. */
  who: string;
  eyebrow: string;
  headline: string;
  headlineAccent: string; // the serif/gradient tail of the headline
  sub: string;
  /** Two or three short paragraphs, the tailored pitch. */
  body: string[];
  modes: AudienceMode[];
  /** The one line that names the payoff, shown above the CTA. */
  payoff: string;
  metaTitle: string;
  metaDescription: string;
}

export const AUDIENCES: Audience[] = [
  {
    slug: "job-candidates",
    who: "Job candidates",
    eyebrow: "For job candidates",
    headline: "Walk in already having",
    headlineAccent: "said it out loud.",
    sub: "Rehearse the hard interview questions before the room, so the answer that decides it isn't the first time you've heard yourself give it.",
    body: [
      "The gap between knowing your answer and delivering it is where interviews are won and lost. You can have the perfect story about the project that failed, and still fumble it live because you've only ever run it in your head.",
      "Elovox has you answer real panel questions out loud and scores how it lands: where you hedged, where you rushed, where the confidence dropped out. You do it as many times as it takes, until the answer is steady.",
    ],
    modes: [
      {
        title: "Interview practice",
        body: "Real questions by type, jobs, and the follow-ups that actually decide it. Reroll them, or write the one you're dreading.",
      },
      {
        title: "Camera coaching",
        body: "Turn the camera on and Felix reads what a panel reads: posture, eye contact, and what your hands do when you're thinking.",
      },
      {
        title: "Coaching goals",
        body: "Tell Felix what you want the answer to do, sound trusted, sound in charge, and he judges every take against it.",
      },
    ],
    payoff: "Be steady on the answer that decides it.",
    metaTitle: "Interview practice for job candidates | Elovox",
    metaDescription:
      "Rehearse real interview questions out loud and get scored on your delivery: hedging, pace, confidence, and body language. Practice until the answer is steady.",
  },
  {
    slug: "students",
    who: "Students",
    eyebrow: "For students",
    headline: "The shaky first minute,",
    headlineAccent: "rehearsed away.",
    sub: "Admissions interviews, scholarship panels, class presentations. Practice the opening until your voice stops giving you away.",
    body: [
      "Most of the nerves live in the first sixty seconds, before you've settled, when your voice is thin and you're reading the room reading you. That minute is trainable, and it's most of the impression.",
      "Elovox gives you a fresh speaking challenge every day and scores it, so you build the habit for free, then lets you rehearse the specific rooms you're walking into: the alumni interview, the scholarship panel, the presentation you have to give on Thursday.",
    ],
    modes: [
      {
        title: "The Daily Minute",
        body: "A new topic every morning, one improvised minute, three tries to beat your own best. Free, and it builds the reflex.",
      },
      {
        title: "College & scholarship interviews",
        body: "Admissions and scholarship questions asked the way those panels ask them, the ones about who you are, not your transcript.",
      },
      {
        title: "Your own material",
        body: "Bring the presentation you already wrote and rehearse how you deliver it, pacing, pauses, and where the ending lands.",
      },
    ],
    payoff: "Open like you've done it before.",
    metaTitle: "Speaking & interview practice for students | Elovox",
    metaDescription:
      "Practice admissions interviews, scholarship panels, and class presentations out loud. A free daily challenge builds the habit; targeted modes rehearse the real room.",
  },
  {
    slug: "founders",
    who: "Founders",
    eyebrow: "For founders",
    headline: "Pitch it until the nerves",
    headlineAccent: "are gone.",
    sub: "Rehearse the pitch, the cold open, the objection you keep fumbling, and get scored on whether it actually lands.",
    body: [
      "You will give the pitch more times than you can count, and the delivery moves the money as much as the deck does. A great idea delivered like an apology raises less than an ordinary one delivered with conviction.",
      "Elovox scores what an investor actually reacts to: whether you sound sure, whether the ask is clean, whether you lose energy right before the close. Give it the situation and it will even write you a fresh script to drill against.",
    ],
    modes: [
      {
        title: "Your own material",
        body: "Run your actual pitch and get coached on the delivery: where you rushed the ask, where the conviction dropped, where the close went soft.",
      },
      {
        title: "Custom speeches",
        body: "Give Felix the situation, the room, the objection you keep hitting, and he writes a script to rehearse against.",
      },
      {
        title: "Audience-impact read",
        body: "A prediction of how a listener came away: trusted or doubted, backing you or just nodding along.",
      },
    ],
    payoff: "Deliver it like it's already funded.",
    metaTitle: "Pitch practice for founders | Elovox",
    metaDescription:
      "Rehearse your pitch out loud and get scored on what investors react to: conviction, a clean ask, and energy through the close. Elovox can even write a script to drill against.",
  },
];

export function getAudience(slug: string): Audience | undefined {
  return AUDIENCES.find((a) => a.slug === slug);
}
