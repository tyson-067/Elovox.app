import type { Metadata } from "next";
import Link from "next/link";
import { Felix } from "@/components/FoxLogo";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { GlowCard } from "@/components/GlowCard";
import { RedirectIfAuthed } from "@/components/RedirectIfAuthed";

// Marketing "about" page: why Elovox exists, and who builds it. Part of the
// signed-out site only. RedirectIfAuthed sends a logged-in visitor to
// /dashboard the way the landing page does, and the header link (AuthNav) is
// rendered for signed-out visitors alone. Someone who already pays doesn't
// need to be re-sold on the premise; they need the app.
//
// No em dashes in any copy on this page, deliberately.

const SITE = "https://elovox.app";

const TITLE = "About Elovox";
const DESCRIPTION =
  "Why we built Elovox: honest feedback on how you sound is the hardest thing for a speaker to get, and the tools that existed only counted filler words. Meet the team.";

export const metadata: Metadata = {
  title: `${TITLE} | Elovox`,
  description: DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    type: "website",
    siteName: "Elovox",
    url: "/about",
    title: `${TITLE} | Elovox`,
    description: DESCRIPTION,
    images: ["/icon.png"],
  },
  twitter: {
    card: "summary",
    title: `${TITLE} | Elovox`,
    description: DESCRIPTION,
    images: ["/icon.png"],
  },
};

// Points back at the Organization node declared on the landing page rather
// than restating it, so a crawler reads one entity with two pages, not two
// entities that happen to share a name.
const ABOUT_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  url: `${SITE}/about`,
  name: TITLE,
  description: DESCRIPTION,
  mainEntity: { "@id": `${SITE}/#organization` },
};

// The mission, in three beats: the gap, why the existing tools don't close it,
// and what we built instead. Kept as data so the section is one map and the
// paragraphs stay the same length on screen.
const MISSION = [
  "Getting better at speaking takes someone willing to tell you the truth about how you sounded. That is the part almost nobody has. Coaches cost money, teachers are split across thirty students, and friends round everything up to \"that was great.\" So most people practice alone, in front of a mirror or a phone camera, guessing at the one thing they cannot judge from the inside: what it was actually like to sit in the audience.",
  "The tools that existed did not close that gap. They transcribe you, count your filler words, and clock your pace. Those are the easy things to measure, and they are not what decides whether a room believes you. Nothing was reading warmth, confidence, or authority. Nothing was telling you which word to lean on, where to leave a silence, or why your ending lost the audience.",
  "So we built the listener we each wanted. You speak for a minute, and Felix tells you how it landed and what to change on the next take, the way a good coach would. Every day, for anyone, whether or not there is someone in your life whose job it is to listen.",
];

// Names and roles only. The page leads with the mission; a wall of biography
// underneath it would bury the thing a visitor came to read.
//
// No per-person contact details on purpose. These are personal addresses, and
// a public page is where spam crawlers harvest them. The footer's Contact link
// (LEGAL.contactEmail) is the single way in, and it can be redirected or
// retired without touching anyone's inbox.
const TEAM = [
  { name: "Tyson Youm", role: "Head of Product Development" },
  { name: "Aanya Iyer Us", role: "Head of Marketing" },
  { name: "Kelley Guo", role: "Head of Operations" },
  { name: "Arad Mehrabian", role: "Head of Sales" },
];

export default function AboutPage() {
  return (
    <div className="pb-20">
      <script
        type="application/ld+json"
        // Not executable script, a data block crawlers parse.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ABOUT_SCHEMA) }}
      />
      <RedirectIfAuthed />

      {/* Intro */}
      <section className="relative pt-16 md:pt-24 grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="dot-grid absolute -inset-x-10 -top-16 bottom-0" />
          <Parallax speed={0.28} className="absolute -top-8 right-[8%]">
            <div className="orb-float h-40 w-40 rounded-full bg-violet/10 blur-xl" />
          </Parallax>
        </div>

        <div className="md:col-span-7">
          <Reveal>
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] uppercase text-violet">
              About us
            </span>
            <h1 className="mt-4 text-display-sm font-headline font-bold text-primary">
              Everyone should have{" "}
              <span className="text-gradient">someone listening</span>.
            </h1>
            <p className="mt-5 text-lg md:text-xl leading-8 text-on-surface-variant max-w-[54ch]">
              We compete at speaking, in debate rounds, speech and oratory
              tournaments, case and economics competitions, and startup
              pitches. We built Elovox because the feedback that actually makes
              you better is the feedback almost nobody can get.
            </p>
          </Reveal>
        </div>
        <div className="md:col-span-5">
          <Reveal delay={150}>
            <Parallax speed={0.08}>
              <div className="navy-gradient rounded-card p-8 flex flex-col items-center">
                <Felix className="h-40 w-40" />
                <p className="mt-4 text-center text-white/90 text-base leading-6 max-w-[30ch]">
                  Felix does the coaching. We do everything that gets him in
                  front of you.
                </p>
              </div>
            </Parallax>
          </Reveal>
        </div>
      </section>

      {/* Mission statement. Sits above "Why we built it" on purpose: this is
          the short, quotable version of the same story, so a visitor who reads
          only one block reads this one. The three cards underneath then take
          the argument apart at length for anyone still reading. */}
      <section className="mt-16 md:mt-24">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Our mission
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-5 navy-gradient rounded-card p-7 md:p-10">
            <p className="text-lg md:text-xl leading-8 md:leading-9 text-white/90 max-w-[62ch]">
              We met in San Diego, Summer 2026, united by a shared realization:
              brilliant concepts are too often silenced by a fear of public
              speaking. This inspired us to build Elovox: an AI-powered platform
              designed to make speech coaching accessible, effective, and
              judgment-free.
            </p>
            <p className="mt-5 text-lg md:text-xl leading-8 md:leading-9 text-white max-w-[62ch]">
              Our mission is to bridge the gap between having great thoughts and
              articulating them with authority. We empower students, creators,
              and professionals to conquer their nerves, master their delivery,
              and comfortably command any room.
            </p>
          </div>
        </Reveal>
      </section>

      {/* Mission */}
      <section className="mt-16 md:mt-24">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Why we built it
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {MISSION.map((paragraph, i) => (
            <Reveal key={i} delay={i * 120} className="h-full">
              <GlowCard className="card h-full p-5 md:p-6">
                <span className="font-data text-sm text-violet">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="mt-2 text-base leading-7 text-on-surface-variant">
                  {paragraph}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Team */}
      <section className="mt-16 md:mt-24">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            The team
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
          {TEAM.map((member, i) => (
            <Reveal key={member.name} delay={i * 80}>
              <div className="card p-5 md:p-6">
                <p className="font-headline text-xl font-semibold text-primary">
                  {member.name}
                </p>
                <p className="mt-1 text-[13px] font-semibold tracking-[0.06em] uppercase text-violet">
                  {member.role}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mt-16 md:mt-24">
        <Reveal>
          <h2 className="text-display-sm font-headline font-bold text-primary">
            Come practice with us.
          </h2>
          <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[54ch]">
            One minute a day, out loud, with honest feedback. Free to start, and
            free to stay.
          </p>
          <Link
            href="/signup"
            className="btn rounded-lg mt-8 inline-block bg-accent text-white font-semibold px-8 py-3.5"
          >
            Get started free
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
