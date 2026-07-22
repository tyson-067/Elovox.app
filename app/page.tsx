import Link from "next/link";
import { Felix } from "@/components/FoxLogo";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { WordReveal } from "@/components/WordReveal";
import { Tilt } from "@/components/Tilt";
import { GlowCard } from "@/components/GlowCard";
import { GOALS } from "@/lib/goals";
import { LEVELS } from "@/lib/levels";

// Marketing landing page. The app itself lives behind /dashboard.

const STEPS = [
  {
    n: "01",
    title: "A new topic every day",
    body: "Felix sets a fresh topic and three points to hit each morning — the same one for everybody. You improvise for a minute, so you train thinking on your feet, not reading a script. Free, forever.",
  },
  {
    n: "02",
    title: "Three attempts to beat yourself",
    body: "Say it, hear how it landed, say it again. Three goes at the same topic is where delivery actually changes — and where the XP is.",
  },
  {
    n: "03",
    title: "Level up as you go",
    body: "Every rep earns XP, beating your own best earns more, and streaks multiply it. Twelve levels from First Words to Voice of the Room.",
  },
];

const FEATURES: {
  title: string;
  body: string;
  demo?: React.ReactNode;
}[] = [
  {
    title: "Voice feedback, not grammar feedback",
    body: "Warmth, confidence, authority, enthusiasm, authenticity — plus pace, pitch variation, monotone stretches, fillers, and awkward pauses.",
  },
  {
    title: "Delivery coaching on the words",
    body: "Which words to emphasize, where to pause, where to slow down, where to change inflection — and why each change moves the audience.",
    // Live sample of Felix's line-by-line marks: the underlines sweep
    // across the words as the card scrolls into view.
    demo: (
      <p className="mt-3 text-base leading-7 text-on-surface rounded-lg bg-surface-container/60 px-4 py-3">
        We{" "}
        <span className="sweep sweep-strong" style={{ transitionDelay: "400ms" }}>
          didn&apos;t just meet
        </span>{" "}
        the goal — we{" "}
        <span className="sweep sweep-strong" style={{ transitionDelay: "700ms" }}>
          doubled
        </span>{" "}
        it,{" "}
        <span className="sweep sweep-flag" style={{ transitionDelay: "1000ms" }}>
          um, basically
        </span>{" "}
        ahead of schedule.
      </p>
    ),
  },
  {
    title: "Audience impact prediction",
    body: "Felix predicts how listeners will perceive you — trusted or doubted, leader or presenter, and whether your ending loses energy.",
  },
  {
    title: "Camera coaching, not just audio",
    body: "Turn the camera on and Felix reads the other half of delivery: posture, sway, hand gestures, facial expression, eye contact, and what your body does during the pauses. Premium.",
  },
  {
    title: "One speech a day, three attempts",
    body: "A new AI-written minute every morning, the same for everyone. Beat your own score twice and watch the number move — that's the whole habit.",
  },
  {
    title: "Interviews that ask like the real thing",
    body: "Jobs, college admissions, scholarships, grad school, med and law. Real questions, and the follow-ups that actually decide it. Premium.",
  },
];

export default function LandingPage() {
  return (
    <div className="pb-20">
      {/* Hero */}
      <section className="relative pt-16 md:pt-24 grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
        {/* Brand circles drifting at different depths behind the hero,
            each also floating on its own so the page moves at rest.
            A faint dot grid keeps the white from feeling flat. */}
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="dot-grid absolute -inset-x-10 -top-16 bottom-0" />
          <Parallax speed={0.28} className="absolute -top-8 right-[8%]">
            <div className="orb-float h-40 w-40 rounded-full bg-violet/15 blur-xl" />
          </Parallax>
          <Parallax speed={-0.18} className="absolute top-40 -left-16">
            <div className="orb-float-slow h-56 w-56 rounded-full bg-slate/15 blur-xl" />
          </Parallax>
          <Parallax speed={0.12} className="absolute bottom-0 right-[30%]">
            <div className="orb-float h-28 w-28 rounded-full bg-accent/15 blur-lg" />
          </Parallax>
        </div>

        <div className="md:col-span-7">
          <Reveal>
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] uppercase text-violet">
              Your speaking practice partner
            </span>
            <h1 className="hero-slogan mt-4 font-headline font-bold text-primary whitespace-nowrap">
              <WordReveal text="Speak with" delay={100} className="slogan-sans" />
              <WordReveal text="impact." delay={280} className="slogan-serif text-gradient" />
            </h1>
            <p className="mt-5 text-lg md:text-xl leading-8 text-on-surface-variant max-w-[52ch]">
              Elovox listens while you practice out loud — a speech, a pitch,
              an interview answer — and Felix, your fox of a coach, tells you
              exactly how it landed on the audience&apos;s ears.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/signup"
                className="btn rounded-lg bg-accent text-white font-semibold text-base px-8 py-3.5"
              >
                Get started free
              </Link>
              <Link
                href="/login"
                className="text-base font-semibold text-primary underline underline-offset-4 decoration-primary/30 transition-colors hover:decoration-primary"
              >
                Log in
              </Link>
            </div>
          </Reveal>
        </div>
        <div className="md:col-span-5">
          <Reveal delay={150}>
            <Parallax speed={0.08}>
              <Tilt>
              <div className="navy-gradient rounded-card p-8 flex flex-col items-center">
                <Felix className="h-44 w-44" />
                <p className="mt-4 text-center text-white/90 text-base leading-6 max-w-[30ch]">
                  Meet <span className="font-semibold">Felix</span> — the coach
                  who hears you the way your audience does.
                </p>
              </div>
              </Tilt>
            </Parallax>
          </Reveal>
        </div>
      </section>

      {/* How it works */}
      <section className="mt-20 md:mt-28">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            How it works
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 120} className="h-full">
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
        <Reveal>
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
            <Reveal key={g.id} delay={i * 60}>
              <span className="pill inline-block rounded-full border border-primary/20 text-primary text-[15px] font-medium px-4 py-2 hover:border-accent hover:text-accent">
                {g.label}
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mt-16 md:mt-20">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Why it stands out
            <span className="grow-line" aria-hidden="true" />
          </h2>
          <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[58ch]">
            Most speaking apps count your filler words and stop. Elovox coaches
            emotional perception and audience response — how you make people
            feel, and what they&apos;ll do about it.
          </p>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 120} className="h-full">
              <GlowCard className="card h-full p-5 md:p-6">
                <h3 className="font-headline text-xl font-semibold text-primary">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-base leading-6 text-on-surface-variant">
                  {f.body}
                </p>
                {f.demo}
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Levels */}
      <section className="mt-16 md:mt-20">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Twelve levels, earned out loud
            <span className="grow-line" aria-hidden="true" />
          </h2>
          <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[56ch]">
            XP comes from showing up and from beating your own best — not from
            being naturally good. Streaks multiply it, up to double.
          </p>
        </Reveal>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {LEVELS.map((l, i) => (
            <Reveal key={l.level} delay={i * 40}>
              <span className="pill inline-flex items-center gap-2 rounded-full border border-primary/20 px-4 py-2 text-[15px] hover:border-violet">
                <span className="font-data text-[13px] text-violet">{l.level}</span>
                <span className="font-medium text-primary">{l.title}</span>
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="mt-16 md:mt-20">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
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
              <p className="mt-1 font-data text-sm text-on-surface-variant">
                $0 / forever
              </p>
              <ul className="mt-4 space-y-2 text-base leading-6 text-on-surface">
                <li>The daily 1-minute speech — new every day, written by Felix</li>
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
          <Reveal delay={120} className="h-full">
            <GlowCard className="card card-glow-light h-full p-6 navy-gradient border-none! text-white">
              <h3 className="font-headline text-2xl font-semibold">Premium</h3>
              <p className="mt-1 font-data text-sm text-white/70">
                7-day free trial · from $1.54/week
              </p>
              <ul className="mt-4 space-y-2 text-base leading-6 text-white/90">
                <li>
                  <span className="font-semibold">Camera coaching</span> — posture,
                  sway, gestures, eye contact, expression
                </li>
                <li>The ~30-second speech library, unlimited reps</li>
                <li>
                  Outgrown a speech? Felix rewrites it — similar topic or a
                  different one
                </li>
                <li>
                  Interview practice by type: jobs, college admissions,
                  scholarships, grad school
                </li>
                <li>Coaching on your own material — pitches, talks, presentations</li>
                <li>Custom speeches written by Felix for your actual situation</li>
                <li>Everything in Free, including the daily challenge</li>
              </ul>
              <Link
                href="/pricing"
                className="btn rounded-lg mt-6 inline-block bg-white/15 text-white font-semibold px-6 py-3 hover:bg-white/25"
              >
                See plans &amp; pricing
              </Link>
            </GlowCard>
          </Reveal>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative mt-20 md:mt-28">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <Parallax speed={0.2} className="absolute -top-10 right-0">
            <div className="orb-float h-36 w-36 rounded-full bg-violet/12 blur-xl" />
          </Parallax>
        </div>
        <Reveal>
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
          <Link
            href="/signup"
            className="btn rounded-lg mt-8 inline-block bg-accent text-white font-semibold px-8 py-3.5"
          >
            Take today&apos;s challenge
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
