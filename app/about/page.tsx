import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { RedirectIfAuthed } from "@/components/RedirectIfAuthed";
import { pageGraph, PERSON } from "@/lib/schema";

// Marketing "about" page: the human idea behind Elovox, and who builds it.
// Part of the signed-out site only. RedirectIfAuthed sends a logged-in visitor
// to /dashboard the way the landing page does. Someone who already pays
// doesn't need to be re-sold on the premise; they need the app.
//
// This is chapter two of the homepage, and it is built from the homepage's own
// parts on purpose: the same mono eyebrow, the same Montserrat headline with a
// Playfair-italic tail, the same cream ground, the same accent rule on a
// pulled-out line, the same pill CTA. The homepage says "Choose your impact.
// Practice until it lands." This page says why anyone would want to.
//
// It is deliberately SHORTER than what it replaced. The old page argued its
// case in full paragraphs — a mission statement of forty-odd words, a second
// of thirty — which on a phone became a narrow column of eight-word lines that
// nobody scrolls to the end of. The claims are the same; they are now made in
// lines a reader can take in at a glance.
//
// No em dashes in any copy on this page, deliberately.

const SITE = "https://elovox.app";

// The Bridge Up Project's own site. Already asserted in lib/schema.ts as an
// NGO Tyson founded, which is the only reason it is linkable from here.
const BRIDGE_UP = "https://bridgeupproject.org/";

const TITLE = "About";
// Rewritten with the page. The old description sold "honest feedback on how
// you sound" against "tools that only counted filler words", which is the
// competitor framing the homepage moved off. This one describes what Elovox
// is for: choosing the effect you want to have on a listener and practising
// toward it. No keyword list, one sentence a human would say out loud.
const DESCRIPTION =
  "Why we built Elovox: communication isn't only about the words you choose, it's about how they land. A speaking practice app built around the impact you want to have on the person listening.";

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

// Four co-founders, and the page is built so that no reader can rank them.
// This used to be a hierarchy: Tyson at display size under the title
// "President & Co-founder", the other three as a quiet comma-ish row a third
// of that size. That layout made a claim about standing, and the claim is no
// longer the one the company wants to make, so BOTH halves of it are gone —
// the president title and the type-size gap that was doing the same work
// without saying so.
//
// Equal emphasis here is structural, not a promise in a comment: one array,
// one card component, one type scale, one colour. There is no per-person
// prop that could grow a badge later without someone noticing. Tyson is
// first because he is listed first; that is the only ordering signal on the
// page, and a four-up grid at one size reads as a set rather than a ranking.
//
// No per-person contact details on purpose. These are personal addresses, and
// a public page is where spam crawlers harvest them. The footer's Contact link
// is the single way in, and it can be redirected or retired without touching
// anyone's inbox.
//
// lib/legal.ts carries all four as the entity behind Elovox regardless — that
// is what /terms and /privacy print, and it is the one place the list has to
// be exhaustive whatever this page shows.
const CO_FOUNDERS = ["Tyson Youm", "Aanya Iyer", "Kelley Gou", "Arad Mehrabian"];

// Said once, above the grid, rather than stamped under each of four names.
// Four identical strings in four identical cells is noise the eye has to
// read past; one label that governs the whole set says the same thing and
// keeps the names the only varying content in the block.
const TEAM_ROLE = "Co-founders";

/** The homepage's section eyebrow, to the pixel. Kept as a <p>: every section
 *  below owns a real <h2>, and a second one here would only blur the outline. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-data text-[11.5px] font-medium uppercase tracking-[0.16em] text-on-surface-variant">
      {children}
    </p>
  );
}

/** The arrow chip from the landing page's primary button. */
function Arrow() {
  return (
    <svg
      width="14"
      height="14"
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

export default function AboutPage() {
  return (
    <div>
      <script
        type="application/ld+json"
        // Not executable script, a data block crawlers parse.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageGraph(ABOUT_SCHEMA, PERSON)) }}
      />
      <RedirectIfAuthed />

      {/* ================= WHY WE BUILT IT ================= */}
      {/* The page's opening section now, and it wears the hero's clothes: the
          Montserrat-then-Playfair two-line lockup that "Everyone should / feel
          heard." had, at the same sizes, so the About page still opens on a
          display line rather than a section heading. Only the words changed.
          The 5fr/7fr split went with the old h2 — a display lockup wants the
          full measure, and the paragraphs sit under it the way the hero's did.

          The ambient layer — dot grid and two drifting orbs — used to belong
          to the hero above and was clipped to that section's box. With the
          hero cut, `inset-0` would have cropped a 560px grid down to a few
          dozen pixels of stray banding under the nav, so the layer is given
          its own fixed canvas at the top of the page instead of inheriting
          whatever height this section happens to have. */}
      <section className="relative pt-10 md:pt-14">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] overflow-hidden" aria-hidden="true">
          <div className="dot-grid absolute -inset-x-10 -top-16 h-[560px]" />
          <Parallax speed={0.24} className="absolute top-6 right-[6%]">
            <div className="orb-float h-[240px] w-[240px] rounded-full bg-[radial-gradient(circle,rgba(255,132,0,0.2),rgba(255,132,0,0)_70%)] blur-[14px]" />
          </Parallax>
          <Parallax speed={-0.1} className="absolute top-56 -left-24">
            <div className="orb-float-slow h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(143,160,216,0.26),rgba(143,160,216,0)_70%)] blur-[16px]" />
          </Parallax>
        </div>

        {/* The old eyebrow said "Why we built Elovox" and the old h2 said
            "It started with a pattern we kept noticing." Those were two ways
            of announcing the same paragraph, so the label became the heading
            and the heading was cut. The brand name takes the serif line the
            way "feel heard." did — one or two words, which is the only length
            Playfair is allowed on this site. */}
        <Reveal>
          <h1 className="mt-5 font-bold tracking-[-0.04em]">
            <span className="block font-headline text-[clamp(2.35rem,8.2vw,6.4rem)] font-extrabold leading-[1.08] text-oxford">
              Why we built
            </span>
            {/* font-size on the WRAPPER, as in the landing hero: .lp-serif-grad
                is 1em, so the em-based padding that keeps Playfair's descender
                off the baseline has to resolve against the display size. */}
            <span className="mt-[0.04em] block overflow-hidden pb-[0.09em] text-[clamp(2.55rem,8.9vw,6.9rem)] leading-[1.14]">
              <span className="lp-serif-grad">Elovox</span>
            </span>
          </h1>
        </Reveal>

        <div className="mt-[clamp(34px,5vw,60px)] max-w-[54ch] text-[clamp(17px,1.1vw,19px)] leading-[1.68] text-on-surface-variant">
          <Reveal delay={110}>
            <p>
              We met in San Diego in the summer of 2026, coming from debate,
              speech, competitions, and startup pitches.
            </p>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-5">
              Across all of them, we kept seeing the same thing: having
              something worth saying isn&apos;t enough. How people experience
              you can change whether they trust you, understand you, or want
              to keep listening.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ================= TEAM ================= */}
      {/* A four-up masthead, and every cell is the same cell. Same type size,
          same weight, same colour, same accent rule, same amount of page. The
          previous version carried the hierarchy "by type size and by how much
          of the page each gets" — that was an accurate description of what it
          did, and it is exactly what had to go.

          One heading governs all four rather than a role line repeated under
          each name, so the only thing that differs between cells is the name.

          The grid is 1 / 2 / 4: a phone gets a stacked list, a tablet a 2x2
          (which still reads as equal — no cell is bigger), a desktop the full
          row. It never goes to 3 + 1, which would orphan the fourth name and
          quietly re-introduce a ranking. */}
      <section className="mt-[var(--space-section-lg)]">
        <Reveal>
          <Eyebrow>The team</Eyebrow>
        </Reveal>

        <Reveal delay={70}>
          <h2 className="mt-8 border-t-2 border-primary/30 pt-6 font-headline text-[clamp(1.8rem,3.4vw,2.6rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-primary">
            {TEAM_ROLE}
          </h2>
        </Reveal>

        {/* The stagger is presentation only, and it is the one place order is
            visible at all. 60ms apart is below the threshold where a reader
            would read it as a countdown. */}
        <ul className="mt-9 grid list-none grid-cols-1 gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
          {CO_FOUNDERS.map((name, i) => (
            <Reveal key={name} delay={130 + i * 60} className="h-full">
              <li className="border-t border-[var(--hairline-ink)] pt-5">
                {/* The accent rule the page uses on a line a section exists
                    to deliver — on all four, because all four are that line. */}
                <span className="block h-[2px] w-9 bg-accent" aria-hidden="true" />
                <p className="mt-4 font-headline text-[clamp(1.3rem,2vw,1.6rem)] font-bold leading-[1.15] tracking-[-0.025em] text-primary">
                  {name}
                </p>
              </li>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* ================= IN THE REAL WORLD ================= */}
      {/* Under the team, above the CTA: the leadership row answers who
          builds Elovox, this answers where the belief behind it is already
          being used, and then the page asks for something. */}
      {/* One restrained panel, not a partnership announcement. The wording is
          load-bearing and was written to be accurate rather than flattering:
          The Bridge Up Project runs the workshops, and Elovox is used inside
          them. No claim that JCCA endorses, sponsors, licenses or partners
          with Elovox; no outcome claims, because there is no data behind any;
          no logos. The link goes to Bridge Up's own site, which lib/schema.ts
          already asserts as an NGO founded by one of the team. */}
      <section className="mt-[var(--space-section-lg)]">
        <Reveal>
          <div className="rounded-3xl border border-primary/15 bg-white/55 p-[clamp(24px,3.4vw,44px)]">
            <Eyebrow>Communication in the real world</Eyebrow>
            <p className="mt-[18px] max-w-[46ch] font-headline text-[clamp(1.35rem,2vw,1.85rem)] font-semibold leading-[1.25] tracking-[-0.02em] text-primary">
              Being heard matters everywhere.
            </p>
            <p className="mt-5 max-w-[60ch] text-[clamp(16.5px,1.05vw,18px)] leading-[1.65] text-on-surface-variant">
              Elovox co-founder Tyson Youm is also the founder of The Bridge Up
              Project. Through Bridge Up, Elovox is used in communication
              workshops with foster youth to help them practice expressing
              themselves and connecting with others.
            </p>
            <Link
              href={BRIDGE_UP}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 border-b-2 border-accent-strong/30 pb-0.5 text-[15px] font-semibold text-accent-strong"
            >
              Learn about The Bridge Up Project
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ================= CLOSING ================= */}
      {/* native-hide: the only way to About inside the app is the Den's About
          row, which means the reader is signed in and practising, and this
          section invited them to sign up on a page they have no business
          seeing again. The story above is what that row promised; the pitch
          under it is website chrome.

          No bottom margin: Footer owns the gap above itself, and a page that
          adds its own leaves a hole tests/e2e/responsive.spec.ts measures. */}
      <section className="native-hide mt-[var(--space-section-lg)]">
        <Reveal>
          <Eyebrow>Choose your impact</Eyebrow>
        </Reveal>
        <Reveal delay={70}>
          <h2 className="mt-5 font-headline text-[clamp(2.1rem,5vw,3.6rem)] font-extrabold leading-[1.06] tracking-[-0.035em] text-oxford">
            Practice until it lands.
          </h2>
        </Reveal>
        <Reveal delay={130}>
          <p className="mt-5 max-w-[46ch] text-[clamp(17px,1.2vw,20px)] leading-[1.6] text-on-surface-variant">
            One minute a day, out loud, with feedback built around the impact
            you&apos;re trying to make.
          </p>
        </Reveal>
        <Reveal delay={190}>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center gap-3 rounded-full bg-accent-strong py-[11px] pl-7 pr-3 text-base font-semibold text-on-primary shadow-[0_14px_30px_-14px_rgba(194,65,12,0.7)]"
          >
            Start free
            <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white/20">
              <Arrow />
            </span>
          </Link>
        </Reveal>
      </section>

    </div>
  );
}
