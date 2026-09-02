import type { Metadata } from "next";
import Link from "next/link";
import { Felix, type FelixMood } from "@/components/FoxLogo";
import { FelixSpeaks } from "@/components/FelixSpeaks";
import { FelixCoachCard } from "@/components/FelixCoach";
import { FELIX_SAMPLE_TAKE } from "@/lib/felixSample";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { CountUp } from "@/components/CountUp";
import { TiltCard } from "@/components/TiltCard";
import { GOALS } from "@/lib/goals";
import { TRIAL_DAYS, formatUSD, planFor } from "@/lib/pricing";
import { TESTIMONIALS } from "@/lib/testimonials";
import { RedirectIfAuthed } from "@/components/RedirectIfAuthed";
import { NativeEntry } from "@/components/NativeEntry";
import { EmailCapture } from "@/components/EmailCapture";
import { StoryDeck } from "@/components/StoryDeck";
import { LevelLadder } from "@/components/LevelLadder";
import { pageGraph, WEBAPP } from "@/lib/schema";

// Marketing landing page. The app itself lives behind /dashboard.

// The homepage owns its own canonical now that the root layout no longer sets
// one for the whole tree (Next INHERITS `alternates` rather than merging them,
// so a canonical up there made every route claim to be this page).
// `openGraph` is spelled out in full, not just `{ url: "/" }`. Next does NOT
// deep-merge it: declaring the key here dropped the inherited `type`,
// `siteName` and `images`, which silently cost the homepage its og:image.
// (Verified against the rendered HTML — that is how it was caught.)
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Elovox",
    url: "/",
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: "Elovox — speak with impact" },
    ],
  },
};

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

// Organization, WebSite and WebApplication live in lib/schema.ts so every
// other page can emit the same nodes and its @id references actually resolve.
const SITE_SCHEMA = pageGraph(WEBAPP);

// What a report actually contains. Every line here is a real thing the
// pipeline produces — the six dimensions and the pause threshold are lifted
// from app/api/analyze/route.ts. If the analysis changes, this changes.
// `mark` is the phrase that gets the drawn underline when the row reveals —
// the same sweep the report itself uses on your words, which is the point:
// the section about markup is itself marked up.
const REPORT = [
  {
    title: "Six scores, not one",
    mark: "not one",
    body: "Each one out of 100, and the overall is their average, so you can see which one is dragging the rest down.",
  },
  {
    title: "Your own words, marked up",
    mark: "marked up",
    // Two mark types exist, not four: the annotation schema's enum is
    // ["strong", "flag"] (app/api/analyze/route.ts) and the report labels
    // them "Strong moment" and "Worth cutting". Nothing is marked for pace,
    // so "the places to pause, and where to slow down" described a pair of
    // marks the pipeline has never emitted. Felix can say slow down inside a
    // note; he does not mark it.
    body: "Felix marks the lines that landed and the ones worth cutting, and says what each one does to the room.",
  },
  {
    title: "The numbers you can't hear yourself",
    mark: "can't hear",
    // Three numbers, and only three. This used to end "with the spot it
    // happened", which promised a per-pause location the pipeline has never
    // produced: Analysis.pauses is a single integer (lib/types.ts) and the
    // report prints it as one figure. Timestamps exist only on transcript
    // segments Felix annotated, which is the bullet above this one.
    body: "Words per minute, your filler words counted, and every pause over 1.2 seconds.",
  },
  {
    title: "How you came across",
    mark: "came across",
    body: "Whether you sounded trusted or doubted, in charge or just presenting, and whether your ending lost energy.",
  },
  {
    title: "Felix's take, out loud",
    mark: "out loud",
    // The take is written from the finished analysis (lib/felixTake.ts),
    // capped at about sixty words, and always shown as text: the audio is a
    // press away, never the only copy.
    body: "Thirty seconds of spoken coaching, written from your report: the one thing that worked, the one thing to fix, and what to do on the next take. Always there as text too.",
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

// The loop, in the order it happens: speak, see, hear, go again. Every
// claim here is a thing the code does: the Daily Minute and its three
// attempts (lib/daily.ts), the report (app/api/analyze/route.ts), Felix's
// take (lib/felixTake.ts), XP and the twelve levels (lib/levels.ts).
const STEPS = [
  {
    n: "01",
    title: "Record yourself",
    body: "Felix sets a fresh topic and three points to hit each morning, the same one for everybody, and you improvise for a minute with no script. Free, forever. Or bring a speech, an interview answer, a pitch: every mode ends the same way.",
  },
  {
    n: "02",
    title: "See how you came across",
    body: "Six scores out of 100, your own words marked up, the numbers you can't hear yourself, and a read on whether the room trusted you, doubted you, or drifted.",
  },
  {
    n: "03",
    title: "Hear Felix's coaching",
    body: "Thirty seconds, in his voice: the one thing that worked, the one thing to fix, and what to do on the next take. Written from your report, and always there as text.",
  },
  {
    n: "04",
    title: "Practice again",
    body: "Three attempts a day on the Daily Minute, on every plan, each one scored, so you can watch your delivery improve in a single sitting. Every rep earns XP, beating your own best earns more, and streaks multiply it. Twelve levels from First Words to Voice of the Room.",
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
    <div className="native-hide">
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
            <span className="inline-flex items-center gap-2 text-label font-semibold tracking-[0.08em] uppercase text-violet">
              Elovox, your speaking practice partner
            </span>
            {/* The slogan, single line: "Speak with" in the geometric sans,
                "impact." in the calligraphic serif. The subline underneath
                carries the concrete what-you-get answer. */}
            {/* nowrap keeps it one line where it fits; below 360px the clamp
                floors out and one line would overflow into the page's
                overflow-x:clip (lost, not scrollable), so let it wrap there. */}
            <h1 className="hero-slogan mt-4 font-headline font-bold text-primary whitespace-nowrap max-[360px]:whitespace-normal">
              <WordReveal text="Speak with" delay={100} className="slogan-sans" />
              <WordReveal text="impact." delay={280} className="slogan-serif text-gradient" />
            </h1>
            {/* Says what the product does, in the first sentence, in nouns.
                This used to be "tells you exactly how it landed on the
                audience's ears", which signed-out visitors read as a slogan
                and not as an answer to "what do I actually get?". */}
            <p className="mt-5 text-lg md:text-xl leading-8 text-on-surface-variant max-w-[52ch]">
              Record a speech, a pitch or an interview answer. Elovox scores
              it out of 100, marks the lines that landed, and counts the
              fillers you didn&apos;t hear yourself say.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/signup"
                className="btn rounded-lg bg-accent-strong text-white font-semibold text-base px-8 py-3.5"
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
                See what comes back
              </a>
            </div>
            {/* The objection the button raises, answered under the button
                rather than crammed into its label. /pricing already tells
                people the free plan takes no card; the page where they
                actually decide never did. Every clause here is checkable
                against lib/pricing.ts and the free plan's own limits. */}
            <p className="mt-3 text-caption text-on-surface-variant">
              No card required. One minute a day, free for good.
            </p>
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
            <TiltCard className="relative">
              <div
                className="demo-card pop-in rounded-card p-5 text-white dusk-gradient md:p-6"
                style={{ animationDelay: "250ms" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-label font-semibold tracking-wide text-white/80">
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
                  className="pop-in mt-3 text-body-sm leading-6 text-white/85"
                  style={{ animationDelay: "2400ms" }}
                >
                  Cut &ldquo;um, basically&rdquo; at 0:27, it undercuts the win
                  right before it.
                </p>
                <div
                  className="pop-in mt-4 flex flex-wrap items-center gap-2.5"
                  style={{ animationDelay: "2900ms" }}
                >
                  <span className="rounded-full bg-white/15 px-3 py-1 text-label font-semibold">
                    {/* Rolls 0→86 as its chip pops in (the 2900ms cue above),
                        landing the score rather than stating it. */}
                    <CountUp
                      value={86}
                      startDelay={2950}
                      className="font-data text-accent"
                    />{" "}
                    / 100
                  </span>
                  <span className="text-label font-semibold text-white/80">
                    Strong close. Lose the hedge.
                  </span>
                </div>
              </div>
              {/* Tap him and he introduces himself: the page's one chance to
                  let a stranger hear the coach before signing up. Plays a
                  static file written once by scripts/felix-voice-sample.mjs,
                  never the live route, so the front door costs nothing and
                  can't be scripted against. Listening at rest, since the take
                  is playing; the glasses go on when he talks. */}
              <FelixSpeaks
                src="/felix-hello.mp3"
                mood="listening"
                speakingMood="coach"
                animate
                label="Hear Felix's voice"
                showNote={false}
                className="absolute -bottom-6 -right-3"
                foxClassName="h-24 w-24 drop-shadow-[0_12px_24px_rgba(11,8,41,0.35)] md:h-28 md:w-28"
              />
            </TiltCard>
            <p className="mt-9 text-base leading-6 text-on-surface-variant">
              <span className="font-semibold text-primary">Felix</span> hears
              you the way your audience does. Tap him to hear how he sounds.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Who it's for. Directly under the hero so a stranger can find
          themself on the page before a single feature is explained.

          No cards: three audiences set as open type on a broken grid, the
          middle one deliberately low. The kicker lives in a sticky left
          rail (the page's one rail — repeated on every section it would
          become a template). The sticky element is the rail cell itself,
          never a Reveal: a hidden Reveal is transformed, and transform
          kills position: sticky for everything inside it. */}
      <section
        id="who"
        className="section-rail scroll-mt-24 mt-[var(--space-section-lg)]"
      >
        <div className="marginalia">
          <Reveal>
            <h2 className="text-kicker uppercase text-on-surface-variant">
              Who it&apos;s for
              <span className="grow-line" aria-hidden="true" />
            </h2>
          </Reveal>
        </div>
        <div className="grid-broken mt-5 max-md:gap-y-0 max-md:divide-y max-md:divide-(--hairline-ink) md:mt-0">
          {AUDIENCES.map((a, i) => (
            // The stagger transform lives on this wrapper; the Reveal is
            // inside it. On the Reveal itself, .reveal-visible resolves
            // transform to none and would erase the offset.
            <div
              key={a.who}
              className="col-span-12 max-md:py-5 md:col-span-4"
            >
              <Reveal variant="swipe" delay={i * 120} className="h-full">
                <Link href={a.href} className="block h-full">
                  <h3 className="font-headline text-h2 font-bold text-primary">
                    {a.who}
                  </h3>
                  <p className="mt-2 text-base leading-6 text-on-surface-variant">
                    {a.body}
                  </p>
                  <p className="mt-4 text-label font-semibold tracking-wide text-violet">
                    <span className="sweep-hover sweep-violet">{a.via}</span>{" "}
                    <span aria-hidden="true">→</span>
                  </p>
                </Link>
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* What you actually get. Right after who-it's-for, because the one
          complaint from signed-out visitors was that the page was vague about
          what the product does. Also the target of the hero's "See a sample
          report" anchor, hence the id and the scroll margin for the sticky
          header. */}
      <section id="report" className="scroll-mt-24 mt-[var(--space-section)]">
        <Reveal>
          <h2 className="text-kicker uppercase text-on-surface-variant">
            What comes back
            <span className="grow-line" aria-hidden="true" />
          </h2>
          {/* "Every recording gets the same report" was not true across
              plans: a Premium report adds strengths and drills and runs
              longer everywhere. It IS true across modes, which is the claim
              worth making. "About a minute" was also roughly 3x the real
              number, and the app's own loader says "a few seconds". */}
          <p className="mt-3 max-w-[56ch] text-lg leading-7 text-on-surface-variant">
            Every mode ends in the same report, and it usually arrives in
            under half a minute.
          </p>
        </Reveal>
        {/* Four ledger rows, not a 2x2 of cards: each row is title left,
            body right, with an oversized index numeral layered faintly
            behind the title. The numeral is decoration (the sweep and the
            ledger carry the reading order), so it is aria-hidden. */}
        <div className="rule-list rule-list-cols mt-7">
          {REPORT.map((r, i) => (
            <Reveal key={r.title} variant="zoom" delay={i * 110}>
              <span
                aria-hidden="true"
                className="ghost-num absolute -left-2 top-2 text-primary"
              >
                0{i + 1}
              </span>
              <h3 className="relative font-headline text-h2 font-bold text-primary">
                {r.title.slice(0, r.title.indexOf(r.mark))}
                <span
                  className="sweep sweep-strong"
                  style={{ transitionDelay: `${i * 110 + 250}ms` }}
                >
                  {r.mark}
                </span>
                {r.title.slice(r.title.indexOf(r.mark) + r.mark.length)}
              </h3>
              <p className="relative mt-2 text-base leading-7 text-on-surface-variant md:mt-1">
                {r.body}
              </p>
            </Reveal>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          {VOICE_DIMENSIONS.map((d, i) => (
            <Reveal key={d} delay={i * 60}>
              {/* Hairline drawn from the local ink, not a fixed navy: over a
                  purchased night backdrop the ground rules turn the text
                  light and the border follows it. */}
              <span className="pill inline-block rounded-full border border-(--hairline-ink) px-4 py-2 text-body-sm font-medium text-primary">
                {d}
              </span>
            </Reveal>
          ))}
        </div>

        {/* Meet Felix: the same card that tops every report, with the one
            sample a stranger gets to hear. A static file, never the live
            route (scripts/felix-voice-sample.mjs), so the front door costs
            nothing and can't be scripted against. Under the ledger and not
            above it: the report is the product, the take is how it opens. */}
        <Reveal delay={160} className="mt-12">
          <h3 className="font-headline text-h3 font-semibold text-primary">
            Meet Felix, your communication coach.
          </h3>
          <p className="mt-2 max-w-[60ch] text-base leading-7 text-on-surface-variant">
            Felix turns your Elovox analysis into a short, actionable coaching
            response, so you know what to improve before you practice again.
          </p>
          <FelixCoachCard
            className="mt-5 max-w-[640px]"
            text={FELIX_SAMPLE_TAKE}
            source={{ kind: "url", url: "/felix-hello.mp3" }}
            audioLabel="Hear Felix"
            action={{ href: "/signup", label: "Try it free" }}
          />
        </Reveal>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-24 mt-[var(--space-section)]">
        <Reveal>
          <h2 className="text-kicker uppercase text-on-surface-variant">
            How it works
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        {/* A numbered SEQUENCE, not three cards in a row.
            Three equal cards is the shape every SaaS page uses for "how it
            works", and it says these are three features rather than three
            steps that happen in order. Dropping the card chrome and letting a
            large tabular numeral carry each step turns it back into a process:
            the eye reads 01 -> 02 -> 03 down a rule instead of scanning three
            boxes and choosing one.

            The numeral is font-data and tabular so the three digits sit on the
            same optical left edge; a proportional face would stagger them and
            the rule would look bent. */}
        <ol className="mt-7 border-l border-primary/15 pl-6 md:pl-8">
          {STEPS.map((s, i) => (
            <li key={s.n} className={i > 0 ? "mt-9 md:mt-11" : ""}>
              <Reveal delay={i * 120}>
                <div className="relative md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,9fr)] md:gap-x-10">
                  {/* Pulled into the rule so the marker straddles it. */}
                  <span
                    aria-hidden="true"
                    className="absolute -left-[calc(1.5rem+1px)] top-1 h-2 w-2 -translate-x-1/2 rounded-full bg-accent-strong md:-left-[calc(2rem+1px)]"
                  />
                  {/* Two columns from md up. Single-column with a 62ch measure
                      left the right half of a 1280px row empty, which reads as
                      an unfinished section rather than a controlled one — the
                      measure was right and the layout was not using the space
                      it had. Title and body side by side fills the row, keeps
                      the reading measure honest, and gives the sequence the
                      spec-sheet register that suits a numbered process. */}
                  <div>
                    {/* Same numbering language as the report ledger above:
                        an oversized numeral layered behind the title. Violet
                        ink at 14% rather than the old small label — the ol
                        still carries the order for AT, so this is
                        decoration. */}
                    <span
                      aria-hidden="true"
                      className="ghost-num ghost-num-sm absolute -left-1 -top-5 text-violet"
                    >
                      {s.n}
                    </span>
                    <h3 className="relative pt-3 font-headline text-h3 font-semibold text-primary">
                      {s.title}
                    </h3>
                  </div>
                  <p className="relative mt-2 max-w-[62ch] text-base leading-7 text-on-surface-variant md:mt-0 md:pt-3">
                    {s.body}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* Goals */}
      <section className="mt-[var(--space-section)]">
        <Reveal>
          <h2 className="text-kicker uppercase text-on-surface-variant">
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
            <Reveal key={g.id} delay={i * 60}>
              <span className="pill inline-block rounded-full border border-(--hairline-ink) text-primary text-body-sm font-medium px-4 py-2 hover:border-accent-strong hover:text-accent-strong">
                {g.label}
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* The modes */}
      <section id="modes" className="scroll-mt-24 mt-[var(--space-section)]">
        <Reveal>
          <h2 className="text-kicker uppercase text-on-surface-variant">
            Six ways to practice
            <span className="grow-line" aria-hidden="true" />
          </h2>
          <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[58ch]">
            Most speaking apps count your filler words and stop. Every mode
            here ends in the same honest report: how you made the room feel,
            and what to change.
          </p>
        </Reveal>
        {/* Six numbered entries on a broken grid instead of six white boxes.
            The middle column of each row sits low (see .grid-broken), the
            index numeral is layered behind the title, and the glyph loses
            its tile — a stroke icon can stand on its own. On phones the
            grid collapses to a single hairline ledger. */}
        <div className="grid-broken mt-7 max-md:gap-y-0 max-md:divide-y max-md:divide-(--hairline-ink)">
          {MODES.map((m, i) => (
            <div
              key={m.title}
              className="col-span-12 max-md:py-5 md:col-span-4"
            >
              <Reveal
                variant="swipe"
                delay={(i % 3) * 100 + Math.floor(i / 3) * 60}
                className="relative h-full"
              >
                <span
                  aria-hidden="true"
                  className="ghost-num absolute -left-2 -top-3 text-primary"
                >
                  0{i + 1}
                </span>
                <div className="relative flex items-center justify-end gap-2.5">
                  <span className="text-accent-strong">{m.glyph}</span>
                  <span
                    className={`text-micro font-semibold uppercase tracking-[0.08em] ${
                      m.tag === "Free" ? "text-accent-strong" : "text-violet"
                    }`}
                  >
                    {m.tag}
                  </span>
                </div>
                <h3 className="relative mt-9 font-headline text-h3 font-semibold text-primary">
                  {m.title}
                </h3>
                <p className="relative mt-1.5 text-base leading-6 text-on-surface-variant">
                  {m.body}
                </p>
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* Felix's story. Below the product, not above it. The one animated
          set piece on the page: a pinned card deck that swipes beat to beat
          as you scroll, holding you until the story is told. */}
      <StoryDeck beats={STORY} />

      {/* Levels. A scroll-driven climb, not a wrap of pills: see the long
          note at the top of components/LevelLadder.tsx for why the previous
          Reveal-per-rung version left eight of the twelve invisible on a
          phone. */}
      <LevelLadder />

      {/* What people say. Hidden entirely until there is something real to
          put here — an empty "Loved by speakers everywhere" heading over
          nothing is worse than no section at all. Add quotes in
          lib/testimonials.ts and this appears on its own.

          Deliberately NOT emitted as schema.org Review/aggregateRating: that
          markup is for ratings collected on the site, and inventing one to
          win stars in search results is exactly the kind of thing Google
          hands out manual actions for. */}
      {TESTIMONIALS.length > 0 && (
        <section className="mt-[var(--space-section)]">
          <Reveal>
            <h2 className="text-kicker uppercase text-on-surface-variant">
              What people say
              <span className="grow-line" aria-hidden="true" />
            </h2>
          </Reveal>
          {/* A wall of voices, not a grid of boxes: quotes set large and
              open, alternating left and right down the page. Same upright
              headline face as the rest of the site — the quotation marks and
              the credit line under each one are what say "someone said
              this", so the type doesn't have to perform it. */}
          <div className="mt-7 space-y-10 md:space-y-12">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name + i} delay={i * 110}>
                <figure className={i % 2 === 1 ? "max-w-[56ch] md:ml-auto" : "max-w-[56ch]"}>
                  <blockquote className="statement text-primary">
                    &ldquo;{t.quote}&rdquo;
                  </blockquote>
                  <figcaption className="mt-3 font-data text-label uppercase tracking-[0.08em] text-on-surface-variant">
                    <span className="font-semibold text-primary">{t.name}</span>
                    {t.context && <span> · {t.context}</span>}
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* Pricing */}
      <section className="mt-[var(--space-section-lg)]">
        <Reveal>
          <h2 className="text-kicker uppercase text-on-surface-variant">
            Pricing
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <Reveal className="h-full">
            <GlowCard className="card h-full p-6">
              <h3 className="font-headline text-2xl font-semibold text-primary">
                Free
              </h3>
              <p className="num-display mt-2 text-primary">
                $0
                <span className="ml-2 align-baseline font-data text-sm font-medium text-on-surface-variant">
                  / forever
                </span>
              </p>
              <ul className="mt-4 space-y-2 text-base leading-6 text-on-surface">
                <li>The Daily Minute, a new topic every day, set by Felix</li>
                <li>3 attempts a day to beat your own best score</li>
                <li>A Felix feedback report on every attempt</li>
                <li>Levels, XP and streaks</li>
                <li>Coaching goals and progress tracking</li>
              </ul>
              <Link
                href="/signup"
                className="btn rounded-lg mt-6 inline-block bg-accent-strong text-white font-semibold px-6 py-3"
              >
                Start free
              </Link>
            </GlowCard>
          </Reveal>
          <Reveal delay={120} className="h-full">
            <GlowCard className="card card-glow-light h-full p-6 navy-gradient border-none! text-white">
              <h3 className="font-headline text-2xl font-semibold">Premium</h3>
              {/* Qualified, and priced by what is actually charged.
                  This read "7-day free trial · from $1.54/week", which was
                  wrong twice: the trial is on monthly and annual only (weekly
                  bills from day one), and $1.54/week is the annual plan's
                  DERIVED rate — the charge is $79.99 once. /pricing went to
                  visible trouble to qualify both; the homepage inverted the
                  emphasis on the page more people see. Figures come from
                  lib/pricing.ts so they can never drift from checkout. */}
              <p className="num-display mt-2">
                {formatUSD(planFor("annual").price)}
                <span className="ml-2 align-baseline font-data text-sm font-medium text-white/85">
                  / year
                </span>
              </p>
              <p className="mt-1 font-data text-sm text-white/85">
                ({formatUSD(planFor("annual").perWeek)}/week) · {TRIAL_DAYS}-day
                free trial on monthly and annual · plus sales tax
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
      <section className="mt-[var(--space-section)]">
        <Reveal>
          {/* No card: open type on the plain page. .ground-panel is inert
              here and only materializes (white wash, padding) when a
              purchased backdrop is active, because a form must not gamble
              its legibility on a photograph. */}
          <div className="ground-panel md:grid md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:items-center md:gap-10">
            <div>
              <h2 className="font-headline text-h2 font-bold text-primary">
                Not ready yet?
              </h2>
              <p className="mt-2 max-w-[52ch] text-base leading-6 text-on-surface-variant">
                Leave your email and we&apos;ll send the occasional speaking
                tip when we have one worth sending. No spam, and you can drop
                off the list any time.
              </p>
            </div>
            <div className="mt-4 md:mt-0">
              <EmailCapture />
            </div>
          </div>
        </Reveal>
      </section>

      {/* Closing CTA */}
      <section className="relative mt-[var(--space-section-lg)]">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <Parallax speed={0.2} className="absolute -top-10 right-0">
            <div className="orb-float h-36 w-36 rounded-full bg-orange/15 blur-xl" />
          </Parallax>
        </div>
        <Reveal>
          <Felix mood="cheer" animate className="mb-4 h-24 w-24" />
          {/* Full display size for the exit line — the biggest type on the
              page belongs to the last thing it says. */}
          <h2 className="text-display font-headline font-bold text-primary">
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
            className="btn rounded-lg mt-8 inline-block bg-accent-strong text-white font-semibold px-8 py-3.5"
          >
            Start your Daily Minute
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
