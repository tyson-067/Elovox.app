import type { Metadata } from "next";
import Link from "next/link";
import { Felix } from "@/components/FoxLogo";
import { FelixSpeaks } from "@/components/FelixSpeaks";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { WordReveal } from "@/components/WordReveal";
import { LandingMotion } from "@/components/LandingMotion";
import { ImpactModes, ImpactCta } from "@/components/ImpactModes";
import { TRIAL_DAYS, formatUSD, planFor } from "@/lib/pricing";
import { RedirectIfAuthed } from "@/components/RedirectIfAuthed";
import { NativeEntry } from "@/components/NativeEntry";
import { pageGraph, WEBAPP } from "@/lib/schema";

// Marketing landing page. The app itself lives behind /dashboard.
//
// The layout and copy here are the Claude Design project "Elovox.app UI
// overhaul" (Elovox Website.dc.html), rebuilt on this codebase's own
// primitives: the palette the design was drawn in is already the @theme
// block in globals.css, so almost nothing here is a literal colour. The
// cinematic layer — the pinned report, the drawn rail, the sideways card
// rail — lives in components/LandingMotion.tsx and is strictly additive;
// every word on this page is readable without it.
//
// The order is the argument: hero, the report, the impact modes, how it
// works, the ways to practice, the ladder, the price. The modes used to sit
// second from last; they are the differentiator, so they now follow the
// report directly. Felix's backstory used to be a pinned section between the
// practice cards and the ladder — it is gone from here, and its copy is
// parked in lib/felixStory.ts.
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
      { url: "/og.png", width: 1200, height: 630, alt: "Elovox: speak with impact" },
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

// Delivery coaching against the impact mode named on the card, "sound like a
// leader". Each line says what the LISTENER is taking from a moment and what
// to change, because a note that only identifies a mechanic ("you said the
// number once") is a scorekeeper's observation, not coaching — it never tells
// the reader why the moment mattered or what it cost them.
//
// One note per mark, and now two of each: the result, and the hedge in front
// of it. `soft` tracks .lp-mark-soft on the phrase the note refers to, so a
// note's rule is the same colour as the underline it belongs to.
const REPORT_NOTES: Array<{ time: string; note: string; soft?: boolean }> = [
  {
    time: "0:23",
    note: "Stress “doubled it.” This is your strongest point.",
  },
  {
    time: "0:27",
    note: "Cut “um” and “basically.” The filler and qualifier make you sound less certain. Start clean: “We’re well ahead of schedule.”",
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
    body: "Earn trust in the room. Real panel questions: jobs, college admissions, scholarships, grad school, med and law.",
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
    body: "Hold small talk, say no, make an apology land. Practice for the speaking you do every day.",
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
    body: "Nine short speeches for pace and emphasis, and you can swap any of them for a fresh one.",
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
    body: "Rehearse the talk you already have, or give Felix the situation and perform the speech he writes.",
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
      <section id="top" className="relative scroll-mt-24 pt-8 md:pt-11">
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
          Elovox: your speaking practice partner
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

        {/* The brand line, directly under the headline and across the full
            measure — in the left-hand column it wrapped to two lines and read
            as a caption. Out here it is one line, and it is the deck: the
            headline is the claim, this is what the product asks of you.
            The sentence below it says what "impact" means here, a listener's
            response, and then stops. There is no second paragraph on purpose;
            the report a screen down explains better than more copy would. */}
        <p
          data-lp-line
          className="mt-5 font-headline text-[clamp(20px,2vw,30px)] font-semibold leading-[1.3] tracking-[-0.02em] text-primary"
        >
          Choose your impact. Practice until it lands.
        </p>

        <div className="mt-6 grid grid-cols-1 items-start gap-[clamp(24px,4vw,56px)] md:grid-cols-12">
          <div className="md:col-span-5">
            <p
              data-lp-sub
              className="max-w-[34ch] text-[clamp(19px,1.5vw,23px)] leading-[1.55] text-on-surface-variant"
            >
              Decide what you want your listener to feel, think, or do. Elovox
              helps you practice for the response you want.
            </p>
            <div data-lp-cta className="mt-[30px] flex flex-wrap items-center gap-[22px]">
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
              <ImpactCta className="border-b-2 border-primary/30 pb-0.5 text-base font-semibold text-primary">
                Choose your impact
              </ImpactCta>
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

              {/* The card is a take IN PROGRESS, and it now says only that:
                  a running clock, a live waveform, and the word Listening.
                  It used to print the transcript mid-recording, which is not
                  a thing a recorder does — the words belong to the report
                  further down, which is where they are read back and marked
                  up. Felix sat on the corner of it as the play control for
                  the finished sample; he goes with the same reasoning, since
                  what this card shows is the take being captured rather than
                  anything there is yet to hear.

                  The waveform keeps its own bottom margin, so Listening sits
                  the same distance under it as it always did. */}
              <p className="mt-4 flex items-center gap-2.5 font-data text-[11.5px] uppercase tracking-[0.05em] text-white/80">
                <span className="h-px w-[22px] bg-white/35" aria-hidden="true" />
                Listening
              </p>
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
              {/* The section now answers the question the impact modes ask.
                  "land?" keeps the Playfair-italic orange that "this." had —
                  same lockup, same three-or-four-word rule the serif is held
                  to everywhere on this site.

                  The break is hard rather than left to the box: "How did you"
                  is 11 characters and clears one line at the clamp's 32px
                  floor with room to spare on a 320px screen, so this is always
                  two lines and never a ragged three. */}
              <h2 className="mt-[18px] font-headline text-[clamp(2rem,3.4vw,3.6rem)] font-extrabold leading-[1.02] tracking-[-0.035em]">
                How did you
                <br />
                <span className="font-slogan italic font-semibold text-orange">
                  land?
                </span>
              </h2>
              <p className="mt-5 max-w-[34ch] text-[16.5px] leading-[1.65] text-white/80">
                Felix shows you how you came across, what shaped that
                impression, and what to try next.
              </p>
              <p className="mt-3.5 max-w-[34ch] text-[16.5px] leading-[1.65] text-white/80">
                The report: your scores, your words, your pace, pauses,
                fillers, and delivery.
              </p>
              {/* The same playable Felix as the hero, not a still. This is
                  the section that names him as the coach reading your take, so
                  hearing him here is the shortest possible proof of it. Wrapper
                  and data attribute unchanged — LandingMotion slides this in on
                  the report's own trigger. */}
              <div data-lp-report-fox className="mt-[34px]">
                <FelixSpeaks
                  src="/felix-note.mp3"
                  mood="listening"
                  speakingMood="coach"
                  animate
                  label="Hear Felix's voice"
                  showNote={false}
                  foxClassName="h-[130px] w-[130px]"
                />
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
                    Impact: sound like a leader
                  </span>
                </div>

                {/* The card leads with the ANSWER — how you came across —
                    because that is the question the impact mode above asked.
                    Everything below it is the working: your words, then the
                    scores, then the numbers.

                    Read against the impact mode named in the pill, not in the
                    abstract. "Sound like a leader" is won and lost on whether
                    the strongest claim gets emphasis and room, so the read
                    names the moment that decides it — and the line under it
                    says what the listener needed from that moment. The old
                    copy ("confident and a little rushed") described the
                    speaker's mechanics and left the reader to work out what
                    they cost him.

                    Still derived from the figures on this very card, not
                    invented for the mock: Confidence 84 is the second-highest
                    score, which is why the read grants confidence and spends
                    its argument on emphasis instead. */}
                <div className="mt-6">
                  <p className="font-data text-[11px] font-medium uppercase tracking-[0.14em] text-shrimp/80">
                    Felix&apos;s read
                  </p>
                  <p className="lp-report-read mt-2.5 text-[clamp(18px,1.6vw,26px)] leading-[1.35] font-semibold tracking-[-0.02em] text-white">
                    You sounded confident, but your strongest result didn&apos;t
                    get the emphasis it deserved.
                  </p>
                  {/* The interpretation, one step down in the hierarchy: the
                      read is the verdict, this is the coaching that follows
                      from it. Body scale, not a second headline. */}
                  <p className="lp-report-readsub mt-2.5 text-[15px] leading-[1.55] text-white/85">
                    &ldquo;Doubled it&rdquo; is the moment that proves your
                    result. Emphasize those words, then pause. Give the listener
                    a second to take it in.
                  </p>
                </div>

                {/* Your own words, with the marks the report actually draws:
                    the enum is ["strong", "flag"] and nothing else.

                    Two marks, not three. "didn't just meet" was underlined and
                    then never spoken about, and a mark the report draws and
                    never explains is a claim it cannot back. What is left is
                    the pair the coaching is actually about: the result, and
                    the hedge in front of it. */}
                <p
                  data-lp-report-quote
                  className="lp-report-quote mt-5 text-[clamp(17px,1.5vw,24px)] leading-[1.75] text-white"
                >
                  We didn&apos;t just meet the goal, we{" "}
                  <span className="lp-mark">doubled</span> it,{" "}
                  <span className="lp-mark lp-mark-soft text-white/80">
                    um, basically
                  </span>{" "}
                  ahead of schedule.
                </p>

                {/* The timestamp leads rather than sitting mid-sentence, so
                    three notes read as a scannable column against the quote
                    above rather than three paragraphs that each have to be
                    read to find their moment. */}
                <div className="mt-4 flex flex-col gap-2">
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

                <div className="mt-6 grid grid-cols-1 gap-x-[34px] gap-y-3.5 sm:grid-cols-2">
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

                {/* The measurements that explain the read, sitting with the
                    scores rather than inside the verdict where they used to
                    live. Same three numbers, moved up one step: they are
                    EVIDENCE for the impression, not the closing word on it. */}
                <p className="mt-4 font-data text-[12.5px] leading-[1.5] text-white/80">
                  142 words per minute · 3 fillers · 2 pauses over 1.2s
                </p>

                <div className="mt-6 flex flex-wrap items-end justify-between gap-5 border-t border-white/12 pt-[22px]">
                  <div>
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
                    {/* The loop closing, and a real one: the control the app
                        puts here starts another take, and so does this. */}
                    <Link
                      href="/signup"
                      className="mt-3.5 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 py-2 pl-3.5 pr-4 text-[13.5px] font-semibold text-white"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        {...stroke}
                        aria-hidden="true"
                      >
                        <path d="M20 12a8 8 0 1 1-2.6-5.9" />
                        <path d="M20 4v4h-4" />
                      </svg>
                      Try again
                    </Link>
                  </div>
                  <p data-lp-verdict className="max-w-[32ch] text-[15px] leading-[1.55] text-white/85">
                    {/* An INSTRUCTION for the next take, which is what the
                        label promises. It used to read "Strong claim. Lose the
                        hedge. Say 'doubled' and stop." — a compliment the
                        Felix's read at the top of the card already pays, a
                        metaphor, and a fix the 0:27 note already gives. What
                        was left for this line to do was tell the reader what
                        to actually do next, so that is all it says now.

                        It still names only marks that are drawn above: the
                        filler is the soft underline. */}
                    <span className="font-data text-[11px] font-medium uppercase tracking-[0.14em] text-shrimp/80">
                      What to try next
                    </span>
                    <br />
                    <span className="font-semibold text-white">
                      Run it again. Same sentence, no filler.
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= IMPACT MODES ================= */}
      {/* Moved up out of the bottom third of the page, where it sat between
          the levels ladder and the price cards. It is the single thing on
          this site that no filler-word counter has, so it belongs directly
          under the report the reader has just watched assemble — the report
          answers "how did I come across", this answers "against what". The
          pills are interactive now (components/ImpactModes.tsx); the eight
          modes themselves are untouched, and are still lib/goals.ts. */}
      <section
        id="impact"
        className="mt-[var(--space-section-lg)] scroll-mt-24"
      >
        <ImpactModes />
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
                  "The Daily Minute: a new topic every day, set by Felix",
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
                    <span className="font-semibold text-white">Camera coaching:</span>{" "}
                    posture, sway, gestures, eye contact, expression
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
