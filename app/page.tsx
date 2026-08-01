import Link from "next/link";
import { Felix, type FelixMood } from "@/components/FoxLogo";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { GOALS } from "@/lib/goals";
import { LEVELS } from "@/lib/levels";
import { TESTIMONIALS } from "@/lib/testimonials";
import { RedirectIfAuthed } from "@/components/RedirectIfAuthed";
import { NativeEntry } from "@/components/NativeEntry";
import { EmailCapture } from "@/components/EmailCapture";

// Marketing landing page. The app itself lives behind /dashboard.

// Machine-readable statement of what this is and who runs it. Human readers
// get the name and purpose from the hero copy; automated ones, Google's
// OAuth consent-screen review, search crawlers, link unfurlers, read this.
// The review rejected the consent screen for "the app name does not match
// the app name on your home page", so declaring it explicitly (rather than
// leaving it to be inferred from an animated slogan) closes that gap.
//
// Emitted as a @graph rather than three separate <script> blocks so the nodes
// can reference each other by @id. Without that, a crawler sees an unattached
// Organization and an unattached WebApplication and has to guess they're the
// same outfit; with it, the publisher edge is stated.
//
// The Organization node exists for one specific reason: "Elovox" is a
// contested name, a registered UK company shares it, so a query for the
// brand is a tie Google breaks on entity signals. sameAs is the strongest one
// we can assert from our own page. It is a claim, not proof: it only pays off
// once those profiles link back here, so the accounts' bio links matter as
// much as this block does.
const SITE = "https://elovox.app";

const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "Elovox",
  url: SITE,
  logo: {
    "@type": "ImageObject",
    url: `${SITE}/logo.png`,
    width: 184,
    height: 182,
  },
  description:
    "Elovox makes speaking practice software: record a speech, pitch, or interview answer and get specific coaching on your delivery.",
  sameAs: [
    "https://www.instagram.com/elovox.app/",
    "https://www.tiktok.com/@elovox0",
  ],
};

// Carries the site name for search results. Google reads WebSite.name when
// deciding what to print above the URL, and left to infer it, it tends to
// pick the <title> tail or the domain.
const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  name: "Elovox",
  url: SITE,
  publisher: { "@id": `${SITE}/#organization` },
};

const APP_SCHEMA = {
  "@type": "WebApplication",
  "@id": `${SITE}/#webapp`,
  name: "Elovox",
  url: SITE,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any (web browser)",
  publisher: { "@id": `${SITE}/#organization` },
  description:
    "Elovox is a speaking practice app. You record yourself giving a speech, pitch, or interview answer, and Elovox analyses the recording and returns coaching on your delivery: pace, filler words, pauses, clarity, and how the audience is likely to perceive you.",
  offers: [
    {
      "@type": "Offer",
      name: "Free",
      price: "0",
      priceCurrency: "USD",
      description: "A daily practice topic with three attempts a day.",
    },
    {
      "@type": "Offer",
      name: "Premium",
      price: "11.99",
      priceCurrency: "USD",
      description:
        "Unlimited practice, camera coaching, the full speech library, interview practice, and social skills.",
    },
  ],
};

const SITE_SCHEMA = {
  "@context": "https://schema.org",
  "@graph": [ORGANIZATION, WEBSITE, APP_SCHEMA],
};

// What a report actually contains. Every line here is a real thing the
// pipeline produces — the six dimensions and the pause threshold are lifted
// from app/api/analyze/route.ts. If the analysis changes, this changes.
const REPORT = [
  {
    title: "Six scores, not one",
    body: "Each one out of 100, and the overall is their average, so you can see which one is dragging the rest down.",
  },
  {
    title: "Your own words, marked up",
    body: "Felix marks the words to stress, the places to pause, and where to slow down, and says what each change does to the room.",
  },
  {
    title: "The numbers you can't hear yourself",
    body: "Words per minute, every filler counted, and every pause over 1.2 seconds with the spot it happened.",
  },
  {
    title: "How you came across",
    body: "Whether you sounded trusted or doubted, in charge or just presenting, and whether your ending lost energy.",
  },
];

// The six dimensions Felix scores from the audio, named on the page so the
// scoring isn't a black box before you sign up. Kept in step with
// VOICE_DIMENSIONS in app/api/analyze/route.ts.
const VOICE_DIMENSIONS = [
  "Clarity",
  "Confidence",
  "Pacing",
  "Vocal variety",
  "Organization",
  "Audience engagement",
];

const STEPS = [
  {
    n: "01",
    title: "A new topic every day",
    body: "Felix sets a fresh topic and three points to hit each morning, the same one for everybody. You improvise for a minute, so you train thinking on your feet, not reading a script. Free, forever.",
  },
  {
    n: "02",
    title: "Three tries to beat your own score",
    body: "Record the topic, get Felix's feedback, then run it again with his notes in mind. Three attempts a day, on every plan, each one scored, so you can watch your delivery improve in a single sitting.",
  },
  {
    n: "03",
    title: "Level up as you go",
    body: "Every rep earns XP, beating your own best earns more, and streaks multiply it. Twelve levels from First Words to Voice of the Room.",
  },
];

// Felix's story, told in four beats down the page. The mascot was a static
// drawing on a gradient panel and nothing else; this gives him a past, which
// is the whole argument the page is making — that the calm voice at the end
// is something you build rather than something you're born with.
//
// It is also the one place the fox does the persuading instead of a feature
// list, which is why it sits directly under the hero.
const STORY: { mood: FelixMood; title: string; body: string }[] = [
  {
    mood: "sleepy",
    title: "Felix used to hate this",
    body: "Ears flat, tail down, rehearsing the same first line forty times and still losing it the moment anyone looked at him.",
  },
  {
    mood: "coach",
    title: "So he practiced out loud",
    body: "Every evening, one minute, in the den with the light on. Not reading. Speaking, badly at first, and listening back to it.",
  },
  {
    mood: "listening",
    title: "And he learned to hear it",
    body: "Where he rushed. Where he trailed off. Which pause landed and which one was just fear with a stopwatch on it.",
  },
  {
    mood: "cheer",
    title: "Now he listens for you",
    body: "Same den, same minute, same honest ear. He'll tell you what the room heard, and exactly what to change before tomorrow.",
  },
];

// Who the app is for, directly below the hero. Each card names the modes
// that serve that room, so the claim is checkable further down the page, and
// links through to that audience's own page (/for/<slug>, lib/audiences.ts).
const AUDIENCES: { who: string; body: string; via: string; href: string }[] = [
  {
    who: "Job candidates",
    body: "Walk in having already answered the hard questions out loud, with the hedges cut and the close rehearsed.",
    via: "Interview practice · Camera coaching",
    href: "/for/job-candidates",
  },
  {
    who: "Students",
    body: "Admissions interviews, scholarship panels, class presentations, without the shaky first minute.",
    via: "College & scholarship interviews · The Daily Minute",
    href: "/for/students",
  },
  {
    who: "Founders",
    body: "Pitch it until the nerves are gone and the ask is clean.",
    via: "Your material · Custom speeches",
    href: "/for/founders",
  },
];

// One stroke style for every mode glyph, same vocabulary as the native
// section cards.
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// The six ways to practice, one card each, outcome first. This replaced a
// wall of feature paragraphs: the report section above already says what
// comes back, so each mode only has to say what you'd use it for.
const MODES: {
  title: string;
  body: string;
  tag: "Free" | "Premium";
  glyph: React.ReactNode;
}[] = [
  {
    title: "The Daily Minute",
    body: "A fresh topic every morning, one improvised minute, three tries to beat your own best.",
    tag: "Free",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    ),
  },
  {
    title: "Interview practice",
    body: "Real panel questions: jobs, college admissions, scholarships, grad school, med and law.",
    tag: "Premium",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 5.5h16v10H9l-5 4z" />
        <path d="M9 10h6" />
      </svg>
    ),
  },
  {
    title: "Social skills",
    body: "Small talk, saying no, saying sorry. Practice for the speaking you do every day.",
    tag: "Premium",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M3.5 4.5h11v7.5H8.5l-5 3.5z" />
        <path d="M21 10h-6v6.5h2.5l3.5 3z" />
      </svg>
    ),
  },
  {
    title: "Camera coaching",
    body: "Posture, gestures, eye contact, sway. The half of delivery you can't hear.",
    tag: "Premium",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <rect x="3.5" y="6.5" width="12" height="11" rx="2" />
        <path d="M15.5 10.5 20.5 8v8l-5-2.5" />
      </svg>
    ),
  },
  {
    title: "The speech library",
    body: "Nine short speeches for pace and emphasis, and you can swap any of them for a fresh one.",
    tag: "Premium",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 5.5c2.5-1.2 5-1.2 8 .5 3-1.7 5.5-1.7 8-.5V18c-2.5-1.2-5-1.2-8 .5-3-1.7-5.5-1.7-8-.5z" />
        <path d="M12 6v12.5" />
      </svg>
    ),
  },
  {
    title: "Your material",
    body: "Rehearse the talk you already have, or give Felix the situation and perform the speech he writes.",
    tag: "Premium",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M5 4.5h8l6 6V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z" />
        <path d="M13 4.5v6h6" />
      </svg>
    ),
  },
];

export default function LandingPage() {
  return (
    // native-hide: inside the app this page is a redirect, not a screen.
    // See components/NativeEntry.
    <div className="native-hide pb-20">
      <script
        type="application/ld+json"
        // Not executable script, a data block crawlers and reviewers parse.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_SCHEMA) }}
      />
      <RedirectIfAuthed />
      <NativeEntry />
      {/* Hero */}
      <section className="relative pt-16 md:pt-24 grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
        {/* Brand circles drifting at different depths behind the hero, plus
            a faint dot grid so the white doesn't feel flat.

            There used to be three orbs here, all floating on their own loop
            AND parallaxing at three different speeds, over a dot grid, under
            a per-word headline reveal. Individually each is subtle; together
            they meant nothing on the page was ever still, which is what made
            a first visit feel busy. Two orbs at lower opacity keeps the depth
            and the brand color without the whole background breathing.
            (Anyone with prefers-reduced-motion set already got none of it;
            see the media query in globals.css.) */}
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="dot-grid absolute -inset-x-10 -top-16 bottom-0" />
          {/* One warm orb and one cool one, so the background carries both
              halves of the palette rather than a single wash. */}
          <Parallax speed={0.28} className="absolute -top-8 right-[8%]">
            <div className="orb-float h-40 w-40 rounded-full bg-orange/15 blur-xl" />
          </Parallax>
          <Parallax speed={-0.18} className="absolute top-40 -left-16">
            <div className="orb-float-slow h-56 w-56 rounded-full bg-vista/25 blur-xl" />
          </Parallax>
        </div>

        <div className="md:col-span-7">
          {/* The hero mounts already in view, so it keeps the plain rise —
              swipe direction only means something once the user is scrolling. */}
          <Reveal>
            {/* Names the product in plain text directly above the headline.
                The <h1> is "Speak with impact.", a slogan that never says
                "Elovox", and it's split into per-word spans for the reveal
                animation, so an automated reader (Google's OAuth review, link
                previews, any scraper) finds no brand name at the top of the
                page. That mismatch is what got the consent screen rejected. */}
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] uppercase text-violet">
              Elovox, your speaking practice partner
            </span>
            {/* The slogan, single line: "Speak with" in the geometric sans,
                "impact." in the calligraphic serif. The subline underneath
                carries the concrete what-you-get answer. */}
            <h1 className="hero-slogan mt-4 font-headline font-bold text-primary whitespace-nowrap">
              <WordReveal text="Speak with" delay={100} className="slogan-sans" />
              <WordReveal text="impact." delay={280} className="slogan-serif text-gradient" />
            </h1>
            {/* Says what the product does, in the first sentence, in nouns.
                This used to be "tells you exactly how it landed on the
                audience's ears", which signed-out visitors read as a slogan
                and not as an answer to "what do I actually get?". */}
            <p className="mt-5 text-lg md:text-xl leading-8 text-on-surface-variant max-w-[52ch]">
              Record a speech, a pitch or an interview answer. Elovox scores
              it out of 100, marks the words to stress, and counts every
              filler you didn&apos;t hear yourself say.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/signup"
                className="btn rounded-lg bg-accent text-white font-semibold text-base px-8 py-3.5"
              >
                Start free
              </Link>
              {/* Low-commitment second step: scrolls to the report section
                  rather than asking for an account. Log in lives in the
                  header, it doesn't need a second seat here. */}
              <a
                href="#report"
                className="text-base font-semibold text-primary underline underline-offset-4 decoration-primary/30 transition-colors hover:decoration-primary"
              >
                See a sample report
              </a>
            </div>
          </Reveal>
        </div>
        <div className="md:col-span-5">
          <Reveal delay={150}>
            {/* The signature piece: a report assembling itself over a take,
                on the same dark stage the real recorder uses. Bars listen,
                Felix's marks sweep onto the sentence, the note lands, the
                score pops. It is the product doing its job in five seconds,
                where the FoxDen postcard used to sit (the den still opens
                Felix's story further down). All of it freezes at the final
                frame under prefers-reduced-motion. */}
            <div className="relative">
              <div
                className="demo-card pop-in rounded-card p-5 text-white dusk-gradient md:p-6"
                style={{ animationDelay: "250ms" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-white/80">
                    <span className="rec-dot h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
                    Recording
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="eq" aria-hidden="true">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className="eq-bar"
                          style={{ animationDelay: `${i * 130}ms` }}
                        />
                      ))}
                    </span>
                    <span className="font-data text-sm text-white/80">0:31</span>
                  </span>
                </div>
                <p className="mt-4 text-lg leading-8 text-white/95">
                  We{" "}
                  <span className="sweep sweep-strong sweep-run" style={{ animationDelay: "1100ms" }}>
                    didn&apos;t just meet
                  </span>{" "}
                  the goal, we{" "}
                  <span className="sweep sweep-strong sweep-run" style={{ animationDelay: "1500ms" }}>
                    doubled
                  </span>{" "}
                  it,{" "}
                  <span className="sweep sweep-flag sweep-run" style={{ animationDelay: "1900ms" }}>
                    um, basically
                  </span>{" "}
                  ahead of schedule.
                </p>
                <p
                  className="pop-in mt-3 text-[15px] leading-6 text-white/75"
                  style={{ animationDelay: "2400ms" }}
                >
                  Cut &ldquo;um, basically&rdquo; at 0:27, it undercuts the win
                  right before it.
                </p>
                <div
                  className="pop-in mt-4 flex flex-wrap items-center gap-2.5"
                  style={{ animationDelay: "2900ms" }}
                >
                  <span className="rounded-full bg-white/15 px-3 py-1 text-[13px] font-semibold">
                    <span className="font-data text-accent">86</span> / 100
                  </span>
                  <span className="text-[13px] font-semibold text-white/80">
                    Strong close. Lose the hedge.
                  </span>
                </div>
              </div>
              <Felix
                mood="listening"
                animate
                className="absolute -bottom-6 -right-3 h-24 w-24 drop-shadow-[0_12px_24px_rgba(11,8,41,0.35)] md:h-28 md:w-28"
              />
            </div>
            <p className="mt-9 text-base leading-6 text-on-surface-variant">
              <span className="font-semibold text-primary">Felix</span> hears
              you the way your audience does.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Who it's for. Directly under the hero so a stranger can find
          themself on the page before a single feature is explained. */}
      <section className="mt-20 md:mt-28">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant">
            Who it&apos;s for
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {AUDIENCES.map((a, i) => (
            <Reveal swipe key={a.who} delay={i * 120} className="h-full">
              <GlowCard className="card h-full">
                <Link href={a.href} className="block h-full p-5 md:p-6">
                  <h3 className="font-headline text-xl font-semibold text-primary">
                    {a.who}
                  </h3>
                  <p className="mt-1.5 text-base leading-6 text-on-surface-variant">
                    {a.body}
                  </p>
                  <p className="mt-3 text-[13px] font-semibold tracking-wide text-violet">
                    {a.via} <span aria-hidden="true">→</span>
                  </p>
                </Link>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* What you actually get. Right after who-it's-for, because the one
          complaint from signed-out visitors was that the page was vague about
          what the product does. Also the target of the hero's "See a sample
          report" anchor, hence the id and the scroll margin for the sticky
          header. */}
      <section id="report" className="scroll-mt-24 mt-20 md:mt-28">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant">
            What comes back
            <span className="grow-line" aria-hidden="true" />
          </h2>
          <p className="mt-3 max-w-[56ch] text-lg leading-7 text-on-surface-variant">
            Every recording gets the same report, and it takes about a minute
            to arrive.
          </p>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          {REPORT.map((r, i) => (
            <Reveal swipe key={r.title} delay={i * 110} className="h-full">
              <GlowCard className="card h-full p-5 md:p-6">
                <h3 className="font-headline text-xl font-semibold text-primary">
                  {r.title}
                </h3>
                <p className="mt-1.5 text-base leading-6 text-on-surface-variant">
                  {r.body}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {VOICE_DIMENSIONS.map((d, i) => (
            <Reveal swipe key={d} delay={i * 60}>
              <span className="pill inline-block rounded-full border border-primary/20 px-4 py-2 text-[15px] font-medium text-primary">
                {d}
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mt-20 md:mt-28">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            How it works
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {STEPS.map((s, i) => (
            <Reveal swipe key={s.n} delay={i * 120} className="h-full">
              <GlowCard className="card h-full p-5 md:p-6">
                <span className="font-data text-sm text-violet">{s.n}</span>
                <h3 className="mt-2 font-headline text-xl font-semibold text-primary">
                  {s.title}
                </h3>
                <p className="mt-1.5 text-base leading-6 text-on-surface-variant">
                  {s.body}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Goals */}
      <section className="mt-16 md:mt-20">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Tell Felix what you&apos;re going for
            <span className="grow-line" aria-hidden="true" />
          </h2>
          <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[54ch]">
            The same words can build trust or lose it, depending on the
            delivery. Pick the outcome, and Felix judges every rep against it.
          </p>
        </Reveal>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {GOALS.map((g, i) => (
            <Reveal swipe key={g.id} delay={i * 60}>
              <span className="pill inline-block rounded-full border border-primary/20 text-primary text-[15px] font-medium px-4 py-2 hover:border-accent hover:text-accent">
                {g.label}
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* The modes */}
      <section className="mt-16 md:mt-20">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Six ways to practice
            <span className="grow-line" aria-hidden="true" />
          </h2>
          <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[58ch]">
            Most speaking apps count your filler words and stop. Every mode
            here ends in the same honest report: how you made the room feel,
            and what to change.
          </p>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {MODES.map((m, i) => (
            <Reveal swipe key={m.title} delay={i * 100} className="h-full">
              <GlowCard className="card h-full p-5 md:p-6">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container text-primary">
                    {m.glyph}
                  </span>
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${
                      m.tag === "Free" ? "text-accent" : "text-violet"
                    }`}
                  >
                    {m.tag}
                  </span>
                </div>
                <h3 className="mt-3 font-headline text-xl font-semibold text-primary">
                  {m.title}
                </h3>
                <p className="mt-1.5 text-base leading-6 text-on-surface-variant">
                  {m.body}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Felix's story. Below the product, not above it. */}
      <section className="mt-16 md:mt-20">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant">
            How a nervous fox got his voice
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-4">
          {STORY.map((beat, i) => (
            <Reveal swipe key={beat.title} delay={i * 130} className="h-full">
              <div className="card-warm flex h-full flex-col p-5 md:p-6">
                <Felix mood={beat.mood} className="h-20 w-20" />
                <h3 className="mt-3 font-headline text-lg font-semibold text-primary">
                  {beat.title}
                </h3>
                <p className="mt-1.5 text-[15px] leading-6 text-on-surface-variant">
                  {beat.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Levels */}
      <section className="mt-16 md:mt-20">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Twelve levels, earned out loud
            <span className="grow-line" aria-hidden="true" />
          </h2>
          <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[56ch]">
            XP comes from showing up and from beating your own best, not from
            being naturally good. Streaks multiply it, up to double.
          </p>
        </Reveal>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {LEVELS.map((l, i) => (
            <Reveal swipe key={l.level} delay={i * 40}>
              <span className="pill inline-flex items-center gap-2 rounded-full border border-primary/20 px-4 py-2 text-[15px] hover:border-violet">
                <span className="font-data text-[13px] text-violet">{l.level}</span>
                <span className="font-medium text-primary">{l.title}</span>
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* What people say. Hidden entirely until there is something real to
          put here — an empty "Loved by speakers everywhere" heading over
          nothing is worse than no section at all. Add quotes in
          lib/testimonials.ts and this appears on its own.

          Deliberately NOT emitted as schema.org Review/aggregateRating: that
          markup is for ratings collected on the site, and inventing one to
          win stars in search results is exactly the kind of thing Google
          hands out manual actions for. */}
      {TESTIMONIALS.length > 0 && (
        <section className="mt-16 md:mt-20">
          <Reveal swipe>
            <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
              What people say
              <span className="grow-line" aria-hidden="true" />
            </h2>
          </Reveal>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
            {TESTIMONIALS.map((t, i) => (
              <Reveal swipe key={t.name + i} delay={i * 110} className="h-full">
                <GlowCard className="card flex h-full flex-col p-5 md:p-6">
                  <blockquote className="font-headline text-lg leading-7 text-primary">
                    &ldquo;{t.quote}&rdquo;
                  </blockquote>
                  <p className="mt-3 text-[15px] text-on-surface-variant">
                    <span className="font-semibold text-primary">{t.name}</span>
                    {t.context && <span> · {t.context}</span>}
                  </p>
                </GlowCard>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* Pricing */}
      <section className="mt-16 md:mt-20">
        <Reveal swipe>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Pricing
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <Reveal swipe className="h-full">
            <GlowCard className="card h-full p-6">
              <h3 className="font-headline text-2xl font-semibold text-primary">
                Free
              </h3>
              <p className="mt-1 font-data text-sm text-on-surface-variant">
                $0 / forever
              </p>
              <ul className="mt-4 space-y-2 text-base leading-6 text-on-surface">
                <li>The Daily Minute, a new topic every day, set by Felix</li>
                <li>3 attempts a day to beat your own best score</li>
                <li>Full Felix feedback report on every attempt</li>
                <li>Levels, XP and streaks</li>
                <li>Coaching goals and progress tracking</li>
              </ul>
              <Link
                href="/signup"
                className="btn rounded-lg mt-6 inline-block bg-accent text-white font-semibold px-6 py-3"
              >
                Start free
              </Link>
            </GlowCard>
          </Reveal>
          <Reveal swipe delay={120} className="h-full">
            <GlowCard className="card card-glow-light h-full p-6 navy-gradient border-none! text-white">
              <h3 className="font-headline text-2xl font-semibold">Premium</h3>
              <p className="mt-1 font-data text-sm text-white/70">
                7-day free trial · from $1.54/week
              </p>
              {/* Four lines, not eight. The feature grid further up this page
                  already made the case in detail; restating all of it here
                  turns a price into another pitch. The full list lives on
                  /pricing, which is where someone comparing plans is going
                  next anyway. */}
              <ul className="mt-4 space-y-2 text-base leading-6 text-white/90">
                <li>
                  <span className="font-semibold">Camera coaching</span>: posture,
                  sway, gestures, eye contact, expression
                </li>
                <li>The nine-speech library, plus interview and social skills practice</li>
                <li>
                  Coaching on your own material, and custom speeches Felix
                  writes for your actual situation
                </li>
                <li>Everything in Free, including the Daily Minute</li>
              </ul>
              <Link
                href="/pricing"
                className="btn rounded-lg mt-6 inline-block bg-white/15 text-white font-semibold px-6 py-3 hover:bg-white/25 web-only"
              >
                See plans &amp; pricing
              </Link>
            </GlowCard>
          </Reveal>
        </div>
      </section>

      {/* The soft exit: an email instead of nothing. For the visitor who got
          this far and still isn't ready for an account — the feedback said as
          much, in those words. Sits between pricing and the closing CTA so it
          reads as the alternative to buying, not a competitor to it. */}
      <section className="mt-16 md:mt-20">
        <Reveal swipe>
          <div className="card p-6 md:p-7">
            <h2 className="font-headline text-2xl font-semibold text-primary">
              Not ready yet?
            </h2>
            <p className="mt-2 max-w-[52ch] text-base leading-6 text-on-surface-variant">
              Leave your email and we&apos;ll send the occasional speaking tip
              when we have one worth sending. No spam, and you can drop off
              the list any time.
            </p>
            <div className="mt-4">
              <EmailCapture />
            </div>
          </div>
        </Reveal>
      </section>

      {/* Closing CTA */}
      <section className="relative mt-20 md:mt-28">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <Parallax speed={0.2} className="absolute -top-10 right-0">
            <div className="orb-float h-36 w-36 rounded-full bg-orange/15 blur-xl" />
          </Parallax>
        </div>
        <Reveal swipe>
          <Felix mood="cheer" animate className="mb-4 h-24 w-24" />
          <h2 className="text-display-sm font-headline font-bold text-primary">
            <WordReveal text="The room goes quiet." step={90} />
            <WordReveal
              text="You're ready."
              delay={420}
              step={90}
              className="text-gradient"
            />
          </h2>
          <p className="mt-3 text-lg leading-7 text-on-surface-variant">
            One minute a day, out loud, three times, with honest feedback.
            That&apos;s how delivery gets built.
          </p>
          {/* No /about link alongside this any more: the footer carries one on
              every page at every width (FooterAboutLink), which covers the
              mobile case this used to exist for. */}
          <Link
            href="/signup"
            className="btn rounded-lg mt-8 inline-block bg-accent text-white font-semibold px-8 py-3.5"
          >
            Start your Daily Minute
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
