import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { RedirectIfAuthed } from "@/components/RedirectIfAuthed";
import { pageGraph } from "@/lib/schema";

// Marketing "about" page: why Elovox exists, and who builds it. Part of the
// signed-out site only. RedirectIfAuthed sends a logged-in visitor to
// /dashboard the way the landing page does, and the header link (AuthNav) is
// rendered for signed-out visitors alone. Someone who already pays doesn't
// need to be re-sold on the premise; they need the app.
//
// No em dashes in any copy on this page, deliberately.

const SITE = "https://elovox.app";

const TITLE = "About";
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
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | Elovox`,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

// Points back at the Organization node declared on the landing page rather
// than restating it, so a crawler reads one entity with two pages, not two
// entities that happen to share a name.
const ABOUT_SCHEMA = {
  "@type": "AboutPage",
  url: `${SITE}/about`,
  name: TITLE,
  description: DESCRIPTION,
  mainEntity: { "@id": `${SITE}/#organization` },
};

// Names and roles only. The page leads with the mission; a wall of biography
// underneath it would bury the thing a visitor came to read.
//
// No per-person contact details on purpose. These are personal addresses, and
// a public page is where spam crawlers harvest them. The footer's Contact link
// (LEGAL.contactEmail) is the single way in, and it can be redirected or
// retired without touching anyone's inbox.
// Everyone here is a co-founder as well as running their own area, so the card
// carries both: the shared standing as a badge, the individual remit as the
// line under it. Rendering "Co-Founder & Head of Marketing" as one string would
// make the shared half compete with the part that differs, and on a four-card
// grid the eye would read the same three words four times before finding the
// one that matters.
const TEAM = [
  { name: "Tyson Youm", role: "Head of Product Development" },
  { name: "Aanya Iyer", role: "Head of Marketing" },
  { name: "Kelley Gou", role: "Head of Operations" },
  { name: "Arad Mehrabian", role: "Head of Sales" },
];

export default function AboutPage() {
  return (
    <div>
      <script
        type="application/ld+json"
        // Not executable script, a data block crawlers parse.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(ABOUT_SCHEMA)) }}
      />
      <RedirectIfAuthed />

      {/* Intro */}
      {/* No longer a two-column split. The Felix panel that used to sit on the
          right ("Felix does the coaching…") is gone, so the intro is one
          column and the copy keeps its own measure rather than being stretched
          across the full width. */}
      <section className="relative pt-16 md:pt-24">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="dot-grid absolute -inset-x-10 -top-16 bottom-0" />
          <Parallax speed={0.28} className="absolute -top-8 right-[8%]">
            <div className="orb-float h-40 w-40 rounded-full bg-violet/10 blur-xl" />
          </Parallax>
        </div>

        <Reveal>
          <span className="inline-flex items-center gap-2 text-label font-semibold tracking-[0.08em] uppercase text-violet">
            About us
          </span>
          <h1 className="mt-4 text-display-sm font-headline font-bold text-primary">
            Everyone should have{" "}
            <span className="text-gradient">someone listening</span>.
          </h1>
          <p className="mt-5 text-lg md:text-xl leading-8 text-on-surface-variant max-w-[54ch]">
            We compete at speaking, in debate rounds, speech and oratory
            tournaments, case and economics competitions, and startup pitches.
            We built Elovox because the feedback that actually makes you better
            is the feedback almost nobody can get.
          </p>
        </Reveal>
      </section>

      {/* Mission statement. The short, quotable version of the story, and now
          the only version: the three "Why we built it" cards that used to sit
          underneath said the same thing at four times the length.

          The navy box is gone too: the two paragraphs stand as open prose
          instead, and the second is nudged right so the pair doesn't read as
          two identical blocks stacked on top of each other. The payoff
          phrase gets the same drawn underline the landing page uses on its
          key nouns.

          Set in .statement — the upright headline face. This is the company
          speaking in its own name, not a quotation, and the display serif
          that was here first turned forty-odd words a paragraph into
          something the reader had to push through rather than read. */}
      <section className="mt-16 md:mt-24">
        <Reveal>
          <h2 className="text-kicker uppercase text-on-surface-variant">
            Our mission
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <Reveal delay={100} className="mt-5">
          <p className="statement text-primary">
            We met in San Diego, Summer 2026, united by a shared realization:
            brilliant concepts are too often silenced by a fear of public
            speaking. This inspired us to build Elovox: an AI-powered platform
            designed to make speech coaching accessible, effective, and
            judgment-free.
          </p>
          <p className="statement mt-8 text-on-surface-variant md:ml-[18%]">
            Our mission is to bridge the gap between having great thoughts and
            articulating them with authority. We empower students, creators,
            and professionals to conquer their nerves, master their delivery,
            and comfortably{" "}
            <span className="sweep sweep-strong">command any room</span>.
          </p>
        </Reveal>
      </section>

      {/* Team. A typographic roster instead of a card grid: one rule-list,
          each person a ledger row split into name and title the way a
          masthead credits its people. The Co-Founder badge is the one
          thing on the row that keeps its own background. See the note at
          its call site for why that particular pixel of color survives
          everywhere else on this page going open. */}
      <section className="mt-16 md:mt-24">
        <Reveal>
          <h2 className="text-kicker uppercase text-on-surface-variant">
            The team
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="rule-list mt-7">
          {TEAM.map((member, i) => (
            <Reveal key={member.name} delay={i * 80}>
              {/* Fixed right column, not auto. Every row is its own grid, so
                  an auto track sized itself to that row's job title and each
                  credit started at a different x — four ragged left edges
                  down the page. A fixed width gives the roster the single
                  alignment line a masthead is supposed to have. */}
              <div className="md:grid md:grid-cols-[minmax(0,1fr)_15rem] md:items-baseline md:gap-6">
                <p className="font-headline text-h1 font-bold text-primary">
                  {member.name}
                </p>
                <div className="mt-3 md:mt-0">
                  {/* text-violet-strong, not text-violet: on the violet/10 tint
                      the plain violet measures 4.24:1, just under AA. See the
                      token's note in globals.css. */}
                  <span className="inline-block rounded-full bg-violet/10 px-3 py-1 text-micro font-bold uppercase tracking-[0.1em] text-violet-strong">
                    Co-Founder
                  </span>
                  <p className="mt-2 text-body-sm text-on-surface-variant">
                    {member.role}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Closing CTA.
          native-hide: the only way to About inside the app is the Den's About
          row, which means the reader is signed in and practising — and this
          section invited them to "Get started free" on a sign-up page they
          have no business seeing again. The story above is what the row
          promised; the pitch under it is website chrome. */}
      <section className="native-hide mt-16 md:mt-24">
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
            className="btn rounded-lg mt-8 inline-block bg-accent-strong text-white font-semibold px-8 py-3.5"
          >
            Get started free
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
