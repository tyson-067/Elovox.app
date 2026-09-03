import type { Metadata } from "next";
import Link from "next/link";
import { Felix, type FelixMood } from "@/components/FoxLogo";
import { FelixSpeaks } from "@/components/FelixSpeaks";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { WordReveal } from "@/components/WordReveal";
import { LandingMotion } from "@/components/LandingMotion";
import { GOALS } from "@/lib/goals";
import { TRIAL_DAYS, formatUSD, planFor } from "@/lib/pricing";
import { RedirectIfAuthed } from "@/components/RedirectIfAuthed";
import { NativeEntry } from "@/components/NativeEntry";
import { LevelLadder } from "@/components/LevelLadder";
import { pageGraph, WEBAPP } from "@/lib/schema";

// Marketing landing page. The app itself lives behind /dashboard.
//
// The layout and copy here are the Claude Design project "Elovox.app UI
// overhaul" (Elovox Website.dc.html), rebuilt on this codebase's own
// primitives: the palette the design was drawn in is already the @theme
// block in globals.css, so almost nothing here is a literal colour. The
// cinematic layer — the pinned report, the drawn rail, the sideways card
// rail, the story cross-fade — lives in components/LandingMotion.tsx and is
// strictly additive; every word on this page is readable without it.
//
// The design's floating nav pill is site-wide chrome and lives in
// components/SiteNav.tsx; its footer is the existing shared <Footer />, which
// already carries the same links and owns the gap above itself.

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
// The Organization node exists for one specific reason: "Elovox" is a
// contested name, a registered UK company shares it, so a query for the
// brand is a tie Google breaks on entity signals. sameAs is the strongest one
// we can assert from our own page.
const SITE_SCHEMA = pageGraph(WEBAPP);

// The six dimensions Felix scores from the audio, with the sample report's
// figures. Kept in step with VOICE_DIMENSIONS in app/api/analyze/route.ts —
// if the analysis changes, this changes.
const SCORES: Array<[string, number]> = [
  ["Clarity", 88],
  ["Confidence", 84],
  ["Pacing", 79],
  ["Vocal variety", 91],
  ["Organization", 86],
  ["Audience engagement", 88],
];

// One line per marked phrase in the quote, in the order the words are spoken.
// Every underline on the card is now accounted for — a mark with no note is a
// claim the report draws and never explains, and the card used to draw three
// and explain one. `soft` tracks .lp-mark-soft on the phrase it refers to, so
// a note's rule is the same colour as the underline it belongs to.
const REPORT_NOTES: Array<{ time: string; note: string; soft?: boolean }> = [
  {
    time: "0:23",
    note: "“Didn’t just meet” sets the bar before you clear it. That’s the setup working — keep the shape.",
  },
  {
    time: "0:25",
    note: "“Doubled” is the whole story, and you said it once and moved on. Exactly right.",
  },
  {
    time: "0:27",
    note: "“Um, basically” hands the win straight back. Cut it and the sentence closes hard.",
    soft: true,
  },
];

// The waveform in the hero card. Twenty-seven bars, each on its own phase of
// the CSS equalizer so the row never pulses in unison; anime.js re-randomises
// the heights once it loads (components/LandingMotion.tsx). The delays are
// written out rather than computed so server and client emit the same markup.
const WAVE_DELAYS = [
  0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 900,
  960, 20, 340, 520, 700, 880, 140, 460, 620, 800, 260,
];

// The loop, in the order it happens: speak, see, hear, go again. Every claim
// is a thing the code does — the Daily Minute and its three attempts
// (lib/daily.ts), the report (app/api/analyze/route.ts), Felix's take
// (lib/felixTake.ts), XP and the twelve levels (lib/levels.ts).
const STEPS = [
  {
    title: "Record yourself",
    body: "Felix sets a fresh topic and three points to hit each morning — the same one for everybody — and you improvise for a minute with no script. Free, forever. Or bring a speech, an interview answer, a pitch.",
  },
  {
    title: "See how you came across",
    body: "Six scores out of 100, your own words marked up, the numbers you can't hear yourself, and a read on whether the room trusted you, doubted you, or drifted.",
  },
  {
    title: "Hear Felix's coaching",
    body: "Thirty seconds, in his voice: the one thing that worked, the one thing to fix, and what to do on the next take. Written from your report, and always there as text.",
  },
  {
    title: "Practice again",
    body: "Three attempts a day on the Daily Minute, on every plan, each one scored — so you can watch your delivery improve in a single sitting. Every rep earns XP; streaks multiply it.",
  },
];

// Felix's story, four beats. Cross-faded under a pin on a desktop-sized
// window, stacked in flow everywhere else — see .lp-beats in globals.css.
const STORY: Array<{ mood: FelixMood; title: string; body: string }> = [
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

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// The six ways to practice, in the order the product opens them up. Only the
// first is free, and the card says so rather than making you find out.
const MODES = [
  {
    tag: "Free",
    title: "The Daily Minute",
    body: "A fresh topic every morning, one improvised minute, three tries to beat your own best.",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    ),
  },
  {
    tag: "Premium",
    title: "Interview practice",
    body: "Real panel questions: jobs, college admissions, scholarships, grad school, med and law.",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 5.5h16v10H9l-5 4z" />
        <path d="M9 10h6" />
      </svg>
    ),
  },
  {
    tag: "Premium",
    title: "Social skills",
    body: "Small talk, saying no, saying sorry. Practice for the speaking you do every day.",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M3.5 4.5h11v7.5H8.5l-5 3.5z" />
        <path d="M21 10h-6v6.5h2.5l3.5 3z" />
      </svg>
    ),
  },
  {
    tag: "Premium",
    title: "Camera coaching",
    body: "Posture, gestures, eye contact, sway. The half of delivery you can't hear.",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <rect x="3.5" y="6.5" width="12" height="11" rx="2" />
        <path d="M15.5 10.5 20.5 8v8l-5-2.5" />
      </svg>
    ),
  },
  {
    tag: "Premium",
    title: "The speech library",
    body: "Nine short speeches for pace and emphasis — and you can swap any of them for a fresh one.",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 5.5c2.5-1.2 5-1.2 8 .5 3-1.7 5.5-1.7 8-.5V18c-2.5-1.2-5-1.2-8 .5-3-1.7-5.5-1.7-8-.5z" />
        <path d="M12 6v12.5" />
      </svg>
    ),
  },
  {
    tag: "Premium",
    title: "Your material",
    body: "Rehearse the talk you already have — or give Felix the situation and perform the speech he writes.",
    dark: true,
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M5 4.5h8l6 6V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z" />
        <path d="M13 4.5v6h6" />
      </svg>
    ),
  },
];

/** The arrow that leans out of every primary button when the cursor nears it.
 *  `data-lp-arrow` is what LandingMotion reaches for. */
function Arrow({ size = 14 }: { size?: number }) {
  return (
    <svg
      data-lp-arrow
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

// The uppercase mono eyebrow that opens most sections, with the rule that
// grows under it once the section arrives.
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <Reveal>
      <h2 className="font-data text-[11.5px] font-medium uppercase tracking-[0.16em] text-on-surface-variant">
        {children}
        <span className="grow-line" aria-hidden="true" />
      </h2>
    </Reveal>
  );
}

const TICKER = [
  "Clarity",
  "Confidence",
  "Pacing",
  "Vocal variety",
  "Organization",
  "Audience engagement",
  "Six scores out of 100",
  "Back in under 30 seconds",
];

function TickerRun({ hidden = false }: { hidden?: boolean }) {
  return (
    <span className="flex gap-[34px] pr-[34px]" aria-hidden={hidden || undefined}>
      {TICKER.map((word) => (
        <span key={word} className="flex gap-[34px]">
          <span>{word}</span>
          <span className="text-accent">✳</span>
        </span>
      ))}
    </span>
  );
}

export default function LandingPage() {
  const annual = planFor("annual");

  return (
    // native-hide: inside the app this page is a redirect, not a screen.
    // See components/NativeEntry.
    // lp: the warm-paper ground and its grain, painted from a fixed layer
    // because #main is capped and centred (see .lp in globals.css).
    <div className="lp native-hide">
      <script
        type="application/ld+json"
        // Not executable script, a data block crawlers and reviewers parse.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_SCHEMA) }}
      />
      <RedirectIfAuthed />
      <NativeEntry />
      <LandingMotion />

      {/* ================= HERO ================= */}
      <section id="top" className="relative scroll-mt-24 pt-10 md:pt-16">
        {/* Brand circles drifting at different depths, over a faint dot grid
            so the warm paper doesn't read as flat. Both orbs are decoration
            and carry aria-hidden on the wrapper. */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="dot-grid absolute -inset-x-10 -top-16 h-[760px]" />
          <Parallax speed={0.22} className="absolute top-10 right-[6%]">
            <div className="orb-float h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,rgba(255,132,0,0.28),rgba(255,132,0,0)_70%)] blur-[14px]" />
          </Parallax>
          <Parallax speed={-0.1} className="absolute top-64 -left-24">
            <div className="orb-float-slow h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(143,160,216,0.34),rgba(143,160,216,0)_70%)] blur-[16px]" />
          </Parallax>
        </div>

        {/* The brand name in plain text above the slogan. The headline is a
            four-word claim, not a name, and an OAuth consent-screen review
            rejected this page for exactly that — so the product says what it
            is called and what it does before it says anything clever. */}
        <span
          data-lp-eyebrow
          className="inline-flex items-center gap-[9px] rounded-full border border-primary/15 bg-white/60 py-[7px] pl-[11px] pr-[15px] font-data text-[10.5px] font-medium uppercase tracking-[0.16em] text-violet-strong"
        >
          <span className="rec-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          Elovox — your speaking practice partner
        </span>

        <h1 className="mt-5 font-bold tracking-[-0.045em] text-balance">
          {/* Line height must clear Montserrat 800's ink at display size or
              the descender on "Speak" is sliced flat by the word masks. */}
          <WordReveal
            text="Speak with"
            className="block font-headline text-[clamp(3.1rem,11.6vw,12.2rem)] font-extrabold leading-[1.26] text-oxford"
          />
          {/* font-size lives on the WRAPPER so the em-based padding and the
              negative overlap resolve against the display size rather than
              the h1's inherited one — at 32px the intended .09em landed at
              2.88px and cut the descender off "impact." */}
          <span className="-mt-[0.02em] block overflow-hidden pb-[0.09em] text-[clamp(3.4rem,12.6vw,13.2rem)] leading-[1.2]">
            <span data-lp-serif className="lp-serif-grad">
              impact.
            </span>
          </span>
        </h1>

        <div className="mt-11 grid grid-cols-1 items-start gap-[clamp(24px,4vw,56px)] md:grid-cols-12">
          <div className="md:col-span-5">
            <p
              data-lp-sub
              className="max-w-[34ch] text-[clamp(17px,1.35vw,21px)] leading-[1.55] text-on-surface-variant"
            >
              Record a speech, a pitch or an interview answer. Elovox scores it
              out of 100, marks the lines that landed, and counts the fillers
              you didn&apos;t hear yourself say.
            </p>
            <div data-lp-cta className="mt-[34px] flex flex-wrap items-center gap-[22px]">
              <Link
                href="/signup"
                data-lp-magnet
                className="flex items-center gap-3 rounded-full bg-accent-strong py-[11px] pl-7 pr-3 text-base font-semibold text-on-primary shadow-[0_14px_30px_-14px_rgba(194,65,12,0.7)]"
              >
                Start free
                <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white/20">
                  <Arrow />
                </span>
              </Link>
              <Link
                href="#report"
                className="border-b-2 border-primary/30 pb-0.5 text-base font-semibold text-primary"
              >
                See what comes back
              </Link>
            </div>
            <p className="mt-4 font-data text-[11.5px] tracking-[0.04em] text-on-surface-variant">
              No card required · One minute a day, free for good
            </p>
          </div>

          <div className="relative md:col-span-7">
            {/* The product, in one card: a minute of audio going in. The
                waveform is CSS by default and anime.js once it loads. */}
            <div
              data-lp-card
              className="relative rounded-[22px] bg-[linear-gradient(150deg,#0b0829_0%,#004e89_55%,#1a659e_100%)] p-[26px] text-white shadow-[0_30px_60px_-22px_rgba(11,8,41,0.55),0_0_0_1px_rgba(255,255,255,0.07)_inset]"
            >
              <div className="flex items-center justify-between gap-3.5">
                <span className="flex items-center gap-[9px] text-[12.5px] font-semibold uppercase tracking-[0.06em] text-white/80">
                  <span className="rec-dot h-[9px] w-[9px] rounded-full bg-accent" aria-hidden="true" />
                  Recording
                </span>
                <span className="font-data text-[13px] text-white/80">0:31</span>
              </div>

              <div data-lp-wave className="my-[22px] mb-1.5 flex h-[74px] items-center gap-[3px]">
                {WAVE_DELAYS.map((delay, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="lp-eq-bar"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>

              <p className="mt-4 text-[clamp(16px,1.25vw,19px)] leading-[1.7] text-white/95">
                We didn&apos;t just meet the goal, we doubled it,{" "}
                <span className="text-white/80">um, basically</span> ahead of
                schedule.
              </p>
              <p className="mt-3.5 flex items-center gap-2.5 font-data text-[11.5px] uppercase tracking-[0.05em] text-white/80">
                <span className="h-px w-[22px] bg-white/35" aria-hidden="true" />
                Listening
              </p>
            </div>

            {/* Felix, sitting on the corner of the card. He is also the play
                control for a real thirty-second take — the design's fox is
                decoration, but there is no reason for it to be. */}
            <div
              data-lp-herofox
              className="absolute -bottom-7 right-0 drop-shadow-[0_16px_28px_rgba(11,8,41,0.35)] sm:-bottom-11 sm:-right-4"
            >
              <FelixSpeaks
                src="/felix-hello.mp3"
                mood="coach"
                speakingMood="coach"
                animate
                label="Hear Felix's voice"
                showNote={false}
                foxClassName="h-[104px] w-[104px] sm:h-[150px] sm:w-[150px]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ================= TICKER ================= */}
      {/* Full-bleed out of #main's cap. The six dimensions, said plainly,
          moving at whatever speed the page is being read. */}
      <section
        className="lp-bleed mt-[clamp(56px,9vw,120px)] overflow-hidden border-y border-primary/15 bg-amande/35"
        aria-label="What Elovox scores"
      >
        <div
          data-lp-ticker
          className="lp-ticker py-[22px] font-data text-[13px] uppercase tracking-[0.14em] whitespace-nowrap text-primary"
        >
          <TickerRun />
          <TickerRun hidden />
        </div>
      </section>

      {/* ================= THE REPORT ================= */}
      {/* The centrepiece. A full-bleed dark stage that pins itself and builds
          the report line by line as the page is scrolled through it. */}
      <section
        id="report"
        data-lp-report
        className="lp-bleed mt-[var(--space-section-lg)] scroll-mt-24"
      >
        <div
          data-lp-report-stage
          className="lp-stage flex min-h-[100svh] items-center overflow-hidden bg-[linear-gradient(165deg,#0b0829_0%,#0e1136_46%,#004e89_100%)] text-white"
        >
          <div className="lp-stage-pad mx-auto grid w-full max-w-[var(--container-page)] grid-cols-1 items-center gap-[clamp(28px,4vw,64px)] px-4 py-[clamp(56px,7vw,96px)] md:grid-cols-12 md:px-10 xl:px-16 2xl:px-24">
            <div className="md:col-span-4">
              <p className="font-data text-[11.5px] font-medium uppercase tracking-[0.16em] text-shrimp/80">
                What comes back
              </p>
              <h2 className="mt-[18px] font-headline text-[clamp(2rem,3.4vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.035em]">
                One minute.
                <br />
                Then{" "}
                <span className="font-slogan italic font-semibold text-orange">
                  this.
                </span>
              </h2>
              <p className="mt-5 max-w-[32ch] text-[16.5px] leading-[1.65] text-white/80">
                Every mode ends in the same report. Six scores, your own words
                marked up, and the numbers you can&apos;t hear yourself.
              </p>
              <div data-lp-report-fox className="mt-[34px] w-[130px]">
                <Felix mood="listening" className="h-[130px] w-[130px]" />
              </div>
            </div>

            <div className="md:col-span-8">
              <div
                data-lp-report-card
                className="lp-report-card rounded-[22px] border border-white/15 bg-white/[0.055] p-[clamp(22px,2.4vw,34px)] shadow-[0_40px_80px_-40px_rgba(0,0,0,0.7)] backdrop-blur-[6px]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-white/12 pb-[18px]">
                  <span className="font-data text-[11.5px] uppercase tracking-[0.14em] text-white/80">
                    Report · 0:31
                  </span>
                  <span className="rounded-full bg-violet/30 px-3 py-[5px] text-[11.5px] font-semibold tracking-[0.04em] text-white">
                    Goal: sound like a leader
                  </span>
                </div>

                {/* Your own words, with the marks the report actually draws:
                    the enum is ["strong", "flag"] and nothing else. */}
                <p
                  data-lp-report-quote
                  className="lp-report-quote mt-6 text-[clamp(17px,1.5vw,24px)] leading-[1.75] text-white"
                >
                  We <span className="lp-mark">didn&apos;t just meet</span> the
                  goal, we <span className="lp-mark">doubled</span> it,{" "}
                  <span className="lp-mark lp-mark-soft text-white/80">
                    um, basically
                  </span>{" "}
                  ahead of schedule.
                </p>

                {/* The timestamp leads rather than sitting mid-sentence, so
                    three notes read as a scannable column against the quote
                    above rather than three paragraphs that each have to be
                    read to find their moment. */}
                <div className="mt-5 flex flex-col gap-2.5">
                  {REPORT_NOTES.map(({ time, note, soft }) => (
                    <p
                      key={time}
                      data-lp-note
                      className="flex gap-3 text-[15px] leading-[1.6] text-white/85"
                    >
                      <span
                        className={`w-[3px] flex-none rounded-full ${soft ? "bg-orange" : "bg-accent"}`}
                        aria-hidden="true"
                      />
                      <span>
                        <span className="mr-2 font-data text-white/80">{time}</span>
                        {note}
                      </span>
                    </p>
                  ))}
                </div>

                <div className="mt-[30px] grid grid-cols-1 gap-x-[34px] gap-y-3.5 sm:grid-cols-2">
                  {SCORES.map(([name, value]) => (
                    <div
                      key={name}
                      data-lp-scorerow
                      className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5"
                    >
                      <span className="text-[13px] tracking-[0.02em] text-white/80">
                        {name}
                      </span>
                      <span className="font-data text-[13px] text-orange">{value}</span>
                      <span className="col-span-full h-1 overflow-hidden rounded-full bg-white/15">
                        <span
                          data-lp-bar
                          className="block h-full origin-left rounded-full bg-[linear-gradient(90deg,#ff8400,#ff6b35)]"
                          style={{ width: `${value}%` }}
                        />
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-[34px] flex flex-wrap items-end justify-between gap-5 border-t border-white/12 pt-[26px]">
                  <p className="flex items-baseline gap-2 font-data font-medium leading-none tracking-[-0.03em]">
                    {/* Scrubbed 0 → 86 by the pin. Rendered at its finished
                        value so it is right with no JS at all. */}
                    <span
                      data-lp-score
                      className="lp-score text-[clamp(3rem,5.6vw,5.4rem)] text-orange"
                    >
                      86
                    </span>
                    <span className="text-[clamp(1rem,1.4vw,1.4rem)] text-white/80">
                      / 100
                    </span>
                  </p>
                  <p data-lp-verdict className="max-w-[34ch] text-[15px] leading-[1.55] text-white/85">
                    {/* Both halves name a mark that is actually drawn above:
                        the two accent underlines are the CLAIM ("didn't just
                        meet" / "doubled"), and the hedge is the soft one. This
                        used to read "Strong close", which named the one part
                        of the sentence carrying no mark at all — "ahead of
                        schedule" is unmarked, and the strong phrases are the
                        opening. Harmless while every underline looked alike;
                        wrong the moment each one got a note pointing at it. */}
                    <span className="font-semibold text-white">
                      Strong claim. Lose the hedge.
                    </span>
                    <br />
                    142 words per minute · 3 fillers · 2 pauses over 1.2s
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section id="how" className="mt-[var(--space-section-lg)] scroll-mt-24">
        <Kicker>How it works</Kicker>

        <div className="relative mt-13 pl-[clamp(28px,4vw,60px)]">
          {/* The rail is drawn by DrawSVGPlugin as the section passes. The
              grey line under it is always there, so the four steps read as a
              sequence whether or not the draw ever runs. */}
          <svg
            aria-hidden="true"
            preserveAspectRatio="none"
            viewBox="0 0 2 1000"
            className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-0.5 overflow-visible"
          >
            <defs>
              <linearGradient id="lp-railgrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" />
                <stop offset="100%" stopColor="var(--color-violet)" />
              </linearGradient>
            </defs>
            <line x1="1" y1="0" x2="1" y2="1000" stroke="rgba(0,78,137,.16)" strokeWidth="2" />
            <line
              data-lp-rail
              x1="1"
              y1="0"
              x2="1"
              y2="1000"
              stroke="url(#lp-railgrad)"
              strokeWidth="2"
            />
          </svg>

          {STEPS.map((step, i) => (
            <Reveal key={step.title}>
              <div
                className={`relative grid grid-cols-1 gap-[clamp(20px,3vw,48px)] md:grid-cols-[minmax(0,7fr)_minmax(0,9fr)] ${
                  i === STEPS.length - 1 ? "" : "pb-[clamp(40px,5vw,72px)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="absolute top-3.5 -left-[calc(clamp(28px,4vw,60px)+5px)] h-2.5 w-2.5 rounded-full bg-accent-strong shadow-[0_0_0_5px_rgba(194,65,12,0.16)]"
                />
                <div>
                  <span
                    aria-hidden="true"
                    className="ghost-num ghost-num-sm text-violet"
                  >
                    0{i + 1}
                  </span>
                  <h3 className="mt-1.5 font-headline text-[clamp(21px,1.8vw,27px)] font-bold tracking-[-0.02em] text-primary">
                    {step.title}
                  </h3>
                </div>
                <p className="max-w-[58ch] self-center text-base leading-[1.7] text-on-surface-variant">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= WAYS TO PRACTICE ================= */}
      {/* Six cards on a rail. Pinned and scrubbed sideways on a desktop-sized
          window; a swipeable row on everything else, which is also the state
          the page ships in before any JavaScript runs. */}
      <section
        id="modes"
        data-lp-modes
        className="lp-bleed mt-[var(--space-section-lg)] scroll-mt-24 overflow-hidden"
      >
        <div className="lp-stage flex min-h-[100svh] flex-col justify-center gap-[clamp(32px,4vw,56px)] py-[clamp(48px,6vw,80px)]">
          <div className="mx-auto w-full max-w-[var(--container-page)] px-4 md:px-10 xl:px-16 2xl:px-24">
            <h2 className="font-data text-[11.5px] font-medium uppercase tracking-[0.16em] text-on-surface-variant">
              Six ways to practice
            </h2>
            <p className="mt-[18px] max-w-[24ch] font-headline text-[clamp(1.8rem,3vw,3.1rem)] font-extrabold leading-[1.05] tracking-[-0.035em] text-oxford">
              Most apps count your filler words and stop.
            </p>
          </div>
          <div data-lp-modes-scroller className="lp-modes-scroller">
            <div
              data-lp-modes-track
              className="lp-modes-track gap-[clamp(18px,2vw,30px)] px-4 md:px-10 xl:px-16 2xl:px-24"
            >
              {MODES.map((mode, i) => (
                <article
                  key={mode.title}
                  className={`lp-mode-card w-[min(78vw,420px)] flex-none rounded-[20px] p-[clamp(24px,2.6vw,36px)] ${
                    mode.dark
                      ? "border border-white/15 bg-[linear-gradient(155deg,#0b0829_0%,#004e89_40%,#1a659e_66%,#8fa0d8_92%)] text-white shadow-[0_26px_50px_-30px_rgba(11,8,41,0.7)]"
                      : "border border-primary/15 bg-white shadow-[0_20px_44px_-30px_rgba(11,8,41,0.4)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      aria-hidden="true"
                      className={`ghost-num ghost-num-sm ${mode.dark ? "lp-ghost-bright text-white" : "text-primary"}`}
                    >
                      0{i + 1}
                    </span>
                    <span
                      className={`flex items-center gap-[9px] ${
                        mode.dark
                          ? "text-shrimp"
                          : mode.tag === "Free"
                            ? "text-accent-strong"
                            : "text-violet-strong"
                      }`}
                    >
                      {mode.glyph}
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.1em]">
                        {mode.tag}
                      </span>
                    </span>
                  </div>
                  <h3
                    className={`mt-11 font-headline text-[clamp(20px,1.7vw,26px)] font-bold tracking-[-0.02em] ${
                      mode.dark ? "" : "text-primary"
                    }`}
                  >
                    {mode.title}
                  </h3>
                  <p
                    className={`mt-2.5 text-[15.5px] leading-[1.6] ${
                      mode.dark ? "text-white/85" : "text-on-surface-variant"
                    }`}
                  >
                    {mode.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= FELIX'S STORY ================= */}
      <section
        id="story"
        data-lp-story
        className="lp-bleed mt-[clamp(48px,7vw,90px)] scroll-mt-24"
      >
        <div className="lp-stage flex min-h-[100svh] items-center bg-[linear-gradient(150deg,#f9dfc6_0%,#fdf6ee_48%,#f7e1c6_100%)]">
          <div className="lp-stage-pad mx-auto grid w-full max-w-[var(--container-page)] grid-cols-1 items-center gap-[clamp(28px,4vw,64px)] px-4 py-[clamp(48px,6vw,90px)] md:grid-cols-12 md:px-10 xl:px-16 2xl:px-24">
            <div
              data-lp-foxes
              className="lp-foxes relative mx-auto aspect-square w-full max-w-[400px] md:col-span-5"
            >
              {STORY.map((beat) => (
                <div key={beat.mood} data-lp-fox className="lp-fox">
                  <Felix mood={beat.mood} className="h-full w-full" />
                </div>
              ))}
            </div>
            <div className="md:col-span-7">
              <p className="mb-[26px] font-data text-[11.5px] font-medium uppercase tracking-[0.16em] text-on-surface-variant">
                Felix&apos;s story
              </p>
              {/* Rendered in flow and fully opaque. LandingMotion stacks and
                  cross-fades them only once it holds a live ScrollTrigger —
                  a story that needs JavaScript to be readable is a story
                  that goes missing. */}
              <div data-lp-beats className="lp-beats">
                {STORY.map((beat, i) => (
                  <div key={beat.title} data-lp-beat className="lp-beat">
                    <p className="font-data text-xs tracking-[0.14em] text-accent-strong">
                      0{i + 1} / 0{STORY.length}
                    </p>
                    <h3 className="mt-3.5 font-headline text-[clamp(1.9rem,3.4vw,3.5rem)] font-extrabold leading-[1.03] tracking-[-0.035em] text-oxford">
                      {beat.title}
                    </h3>
                    <p className="mt-[18px] max-w-[40ch] text-[clamp(16px,1.4vw,20px)] leading-[1.65] text-on-surface-variant">
                      {beat.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= TWELVE LEVELS ================= */}
      {/* The ladder is its own component: it climbs with the scroll, pins
          only when the rail overflows, and renders every rung lit with no
          JS at all. */}
      <LevelLadder />

      {/* ================= GOALS ================= */}
      <section className="mt-[var(--space-section)]">
        <div className="grid grid-cols-1 items-center gap-[clamp(28px,4vw,64px)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <Reveal>
              <h2 className="font-headline text-[clamp(1.7rem,2.6vw,2.7rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-primary">
                Tell Felix what you&apos;re going for.
              </h2>
            </Reveal>
            <Reveal delay={80}>
              <p className="mt-4 max-w-[40ch] text-[16.5px] leading-[1.65] text-on-surface-variant">
                The same words can build trust or lose it, depending on the
                delivery. Pick the outcome, and Felix judges every rep against
                it.
              </p>
            </Reveal>
          </div>
          <div data-lp-goals className="flex flex-wrap gap-2.5">
            {GOALS.map((goal) => (
              <span
                key={goal.id}
                data-lp-goal
                className="rounded-full border border-primary/20 bg-white/55 px-[18px] py-2.5 text-[15px] text-primary"
              >
                {goal.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ================= PRICING ================= */}
      <section id="pricing" className="mt-[var(--space-section-lg)] scroll-mt-24">
        <Kicker>Pricing</Kicker>
        <div className="mt-[clamp(32px,4vw,52px)] grid grid-cols-1 gap-[clamp(16px,2vw,28px)] md:grid-cols-2">
          <Reveal>
            <div
              data-lp-tilt
              className="relative h-full rounded-3xl border border-primary/15 bg-white p-[clamp(26px,3vw,40px)] shadow-[0_24px_50px_-34px_rgba(11,8,41,0.38)] will-change-transform"
            >
              <div className="lp-spot" aria-hidden="true" />
              <h3 className="font-headline text-[22px] font-bold tracking-[-0.02em] text-primary">
                Free
              </h3>
              <p className="mt-3.5 flex items-baseline gap-[9px] font-data font-medium leading-none tracking-[-0.03em] text-primary">
                <span className="text-[clamp(2.6rem,4vw,3.9rem)]">$0</span>
                <span className="text-sm text-on-surface-variant">/ forever</span>
              </p>
              <ul className="mt-[26px] flex list-none flex-col gap-[11px] text-[15.5px] leading-[1.5] text-oxford">
                {[
                  "The Daily Minute — a new topic every day, set by Felix",
                  "3 attempts a day to beat your own best score",
                  "A Felix feedback report on every attempt",
                  "Levels, XP and streaks",
                  "Coaching goals and progress tracking",
                ].map((line) => (
                  <li key={line} className="flex gap-[11px]">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-[5px] w-[5px] flex-none rounded-full bg-accent"
                    />
                    {line}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                data-lp-magnet
                className="mt-[30px] inline-flex items-center gap-[11px] rounded-full bg-accent-strong py-2.5 pl-6 pr-2.5 text-[15px] font-semibold text-on-primary"
              >
                Start free
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white/20">
                  <Arrow size={13} />
                </span>
              </Link>
            </div>
          </Reveal>

          {/* web-only, and the whole page is native-hide besides: the iOS
              shell must never show a price or a route to buying (App Store
              guideline 3.1.1). tests/e2e/app-store-gate.spec.ts enforces it. */}
          <Reveal delay={90}>
            <div
              data-lp-tilt
              className="web-only relative h-full overflow-hidden rounded-3xl bg-[linear-gradient(155deg,#0b0829_0%,#004e89_38%,#1a659e_62%,#8fa0d8_86%,#f9dfc6_100%)] bg-[length:160%_160%] p-[clamp(26px,3vw,40px)] text-white shadow-[0_30px_60px_-30px_rgba(11,8,41,0.6)] will-change-transform"
            >
              <div className="lp-spot lp-spot-light" aria-hidden="true" />
              <div className="flex items-center justify-between gap-3.5">
                <h3 className="font-headline text-[22px] font-bold tracking-[-0.02em]">
                  Premium
                </h3>
                <span className="rounded-full bg-white/20 px-3 py-[5px] text-[11px] font-bold uppercase tracking-[0.1em]">
                  {annual.badge}
                </span>
              </div>
              <p className="mt-3.5 flex items-baseline gap-[9px] font-data font-medium leading-none tracking-[-0.03em]">
                <span className="text-[clamp(2.6rem,4vw,3.9rem)]">
                  {formatUSD(annual.price)}
                </span>
                <span className="text-sm text-white/85">/ year</span>
              </p>
              <p className="mt-2.5 font-data text-[12.5px] leading-[1.5] text-white/85">
                ({formatUSD(annual.perWeek)}/week) · {TRIAL_DAYS}-day free trial
                on monthly and annual · plus sales tax
              </p>
              <ul className="mt-[26px] flex list-none flex-col gap-[11px] text-[15.5px] leading-[1.5] text-white/95">
                {[
                  <>
                    <span className="font-semibold text-white">Camera coaching</span>{" "}
                    — posture, sway, gestures, eye contact, expression
                  </>,
                  <>The nine-speech library, plus interview and social skills practice</>,
                  <>Coaching on your own material, and custom speeches Felix writes</>,
                  <>Everything in Free, including the Daily Minute</>,
                ].map((line, i) => (
                  <li key={i} className="flex gap-[11px]">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-[5px] w-[5px] flex-none rounded-full bg-orange"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/pricing"
                data-lp-magnet
                className="relative mt-[30px] inline-flex items-center gap-[11px] overflow-hidden rounded-full border border-white/30 bg-white/20 py-2.5 pl-6 pr-2.5 text-[15px] font-semibold text-white"
              >
                See plans &amp; pricing
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white/25">
                  <Arrow size={13} />
                </span>
              </Link>
            </div>
          </Reveal>
        </div>
      </section>


      {/* ================= CLOSING ================= */}
      {/* No bottom margin: Footer owns the gap above itself
          (mt-[var(--space-section)]), and a page that adds its own leaves a
          hole that tests/e2e/responsive.spec.ts measures. */}
      <section className="relative mt-[var(--space-section-lg)] text-center">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <Parallax speed={0.18} className="absolute -top-5 left-1/2 -translate-x-1/2">
            <div className="h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(255,132,0,0.2),rgba(255,132,0,0)_68%)] blur-xl" />
          </Parallax>
        </div>
        <Reveal variant="zoom">
          <Felix mood="cheer" animate className="mx-auto mb-5 h-[132px] w-[132px]" />
        </Reveal>
        <h2 className="relative font-headline text-[clamp(2.2rem,6.4vw,5.4rem)] font-extrabold leading-[1.24] tracking-[-0.04em] text-oxford">
          <WordReveal text="The room goes quiet." className="block" />
          <WordReveal
            text="You're ready."
            delay={220}
            className="block font-slogan italic font-semibold text-accent-strong"
          />
        </h2>
        <p className="relative mx-auto mt-[22px] max-w-[52ch] text-[clamp(16px,1.35vw,19px)] leading-[1.6] text-on-surface-variant">
          One minute a day, out loud, three times, with honest feedback.
          That&apos;s how delivery gets built.
        </p>
        <Link
          href="/signup"
          data-lp-magnet
          className="relative mt-[34px] inline-flex items-center gap-3 rounded-full bg-accent-strong py-[13px] pl-[30px] pr-[13px] text-[17px] font-semibold text-on-primary shadow-[0_18px_36px_-16px_rgba(194,65,12,0.7)]"
        >
          Start your Daily Minute
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/20">
            <Arrow size={15} />
          </span>
        </Link>
      </section>
    </div>
  );
}
