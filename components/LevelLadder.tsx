"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LEVELS } from "@/lib/levels";

// The twelve levels as a ladder you CLIMB by scrolling, not a strip you have
// to discover you can swipe.
//
// What was here before had two faults, and they compounded:
//
//   1. Each rung was wrapped in <Reveal>, which flips on an
//      IntersectionObserver. An observer measures against the VIEWPORT, and
//      rungs 5-12 sit off the right edge of a 375px phone inside a
//      horizontal scroller — so they never intersected, never flipped, and
//      sat at opacity 0 permanently. Eight of the twelve levels were simply
//      not on the page. (Measured, not guessed: a scripted full-page scroll
//      at iPhone width left exactly 8 `.reveal` nodes without
//      `.reveal-visible` — "Room Reader" through "Commanding".)
//   2. The four that DID reveal each rose 18px on a 40ms stagger, so the one
//      part of the ladder you could see bounced vertically while the rest of
//      it was invisible.
//
// So the entrance is driven by scroll POSITION rather than by a one-shot
// observer, and the horizontal travel is driven by it too. A climb line
// grows along the rail; each rung lights as the line reaches it; and on a
// screen too narrow to hold twelve rungs the rail is pulled sideways by the
// same progress value, so scrolling down walks you along the ladder.
// Nothing can be left invisible, because nothing waits on a callback.
//
// The geometry is one formula in both layouts. With progress p, rail width
// W and window width V:
//
//     climb head, absolute  = p·W
//     rail translate        = −p·(W − V)
//     climb head, on screen = p·W − p·(W − V) = p·V
//
// The head sweeps left to right across the window exactly once, whether the
// rail overflows (phone: W ≈ 1136, V = 375) or fits (desktop: W = V, so the
// translate term is zero and only the fill moves). One code path.
//
// Per frame this writes two custom properties and a transform to ONE element
// and lets CSS light the twelve rungs from `--climb` (see .ladder-* in
// globals.css). Deliberately not React state: a scroll-linked animation that
// re-renders a 12-item list on every rAF is how a phone drops frames.
//
// It degrades in the right direction. The server renders — and a browser
// with no JS, or with prefers-reduced-motion, keeps — every rung fully lit
// in a plain, natively scrollable rail. The pinned climb is an upgrade
// applied after mount, never a prerequisite for seeing the content.

/** Gap between the sticky stage and the site header while pinned. */
const STAGE_TOP = 72;

/** Cap on the extra scroll the pinned climb may claim, as a share of the
 *  viewport. Long enough to walk twelve rungs past you and no longer — much
 *  more than this and a section that holds you reads as a section that
 *  traps you. */
const MAX_RUNWAY_VH = 0.9;

export function LevelLadder() {
  const sectionRef = useRef<HTMLElement>(null);
  const underlineRef = useRef<HTMLSpanElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLOListElement>(null);

  // How far the rail must travel sideways, and how much extra page scroll
  // the section claims to drive it. Both 0 is the static layout: the rail
  // fits, or motion is off, or nothing has been measured yet.
  const travelRef = useRef(0);
  const runwayRef = useRef(0);
  // Only the layout MODE lives in state — it changes on resize, not on
  // scroll. Progress never does; see the note above.
  const [runway, setRunway] = useState(0);
  const pinned = runway > 0;

  /** Paint one frame. `p` is 0 (untouched) to 1 (fully climbed). */
  const paint = useCallback((p: number) => {
    const rail = railRef.current;
    if (rail) {
      rail.style.transform = `translate3d(${(-p * travelRef.current).toFixed(1)}px, 0, 0)`;
      // Unitless, so the rung CSS can do arithmetic with it.
      rail.style.setProperty("--climb", p.toFixed(4));
    }
    // A hair of underline is always showing, so the heading never looks like
    // it lost its rule.
    if (underlineRef.current) {
      underlineRef.current.style.transform = `scaleX(${Math.max(0.08, p).toFixed(3)})`;
    }
  }, []);

  const measure = useCallback(() => {
    const win = windowRef.current;
    const rail = railRef.current;
    if (!win || !rail) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      travelRef.current = 0;
      runwayRef.current = 0;
      setRunway(0);
      paint(1);
      return;
    }

    // Measure the rail untransformed, or the overflow shrinks by whatever
    // the last frame happened to translate it by.
    const previous = rail.style.transform;
    rail.style.transform = "none";
    const overflow = Math.max(0, rail.scrollWidth - win.clientWidth);
    rail.style.transform = previous;

    travelRef.current = overflow;
    // A rail that fits needs no runway: the fill still animates, but as the
    // section passes through the viewport, with no pinning.
    const next =
      overflow > 8
        ? Math.min(overflow, Math.round(window.innerHeight * MAX_RUNWAY_VH))
        : 0;
    runwayRef.current = next;
    setRunway(next);
  }, [paint]);

  useEffect(() => {
    // No explicit first measure(): a ResizeObserver delivers an initial
    // notification for every element the moment it starts observing, so
    // subscribing IS the first measurement. Calling it here as well would be
    // setState in an effect body (react-hooks/set-state-in-effect) for a
    // result the observer is about to deliver anyway — and the pre-measure
    // markup is the finished, fully-lit ladder, so there is nothing ugly to
    // race.
    const ro = new ResizeObserver(measure);
    if (railRef.current) ro.observe(railRef.current);
    if (windowRef.current) ro.observe(windowRef.current);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", measure);
    };
  }, [measure]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paint(1);
      return;
    }

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const run = runwayRef.current;
      let p: number;
      if (run > 0) {
        // Pinned: progress is how far into the runway the stage has stuck.
        p = (STAGE_TOP - rect.top) / run;
      } else {
        // Static: progress is how far the section has crossed the viewport,
        // over a band that finishes the climb well before the section
        // leaves rather than completing it off-screen.
        const span = window.innerHeight * 0.75 + rect.height;
        p = (window.innerHeight * 0.85 - rect.top) / span;
      }
      paint(Math.max(0, Math.min(1, p)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [runway, paint]);

  return (
    <section ref={sectionRef} className="mt-[var(--space-section)]">
      <div
        className={pinned ? "sticky" : undefined}
        style={pinned ? { top: `${STAGE_TOP}px` } : undefined}
      >
        <h2 className="text-kicker uppercase text-on-surface-variant">
          Twelve levels, earned out loud
          {/* Not `.grow-line`: that grows only under `.reveal-visible`, and
              this section deliberately owns no Reveal any more. The rule
              follows the climb instead — the same idea said once. */}
          <span ref={underlineRef} className="ladder-underline" aria-hidden="true" />
        </h2>
        <p className="mt-3 max-w-[56ch] text-lg leading-7 text-on-surface-variant">
          XP comes from showing up and from beating your own best, not from
          being naturally good. Streaks multiply it, up to double.
        </p>

        {/* The negative margin lets the rail bleed to the screen edge on a
            phone, so it is obvious the ladder continues past the fold. */}
        <div
          ref={windowRef}
          className={`-mx-4 mt-7 md:mx-0 ${
            pinned ? "overflow-hidden" : "no-scrollbar overflow-x-auto"
          }`}
        >
          <ol ref={railRef} className="ladder-rail">
            {/* The rail the rungs sit on: one continuous line, drawn once, so
                it never shows the seams twelve abutting segments would at
                fractional widths. The climbed part is a second line over it. */}
            <span aria-hidden="true" className="ladder-line" />
            <span aria-hidden="true" className="ladder-line-lit" />
            {LEVELS.map((l, i) => (
              <li
                key={l.level}
                className="ladder-rung"
                // Rung centres are evenly spaced, so rung i sits at
                // (i + 0.5)/n along the rail. CSS lights it once --climb
                // passes this; no per-rung JS, no per-frame re-render.
                style={{ ["--at" as string]: ((i + 0.5) / LEVELS.length).toFixed(4) }}
              >
                <span className="ladder-pip font-data text-caption font-medium">
                  {l.level}
                </span>
                <span className="ladder-name text-caption font-medium">
                  {l.title}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {/* The runway, as a SIBLING rather than as padding on the section.
          A sticky box is constrained to its containing block, and a block
          container's containing block is its CONTENT box — padding is
          outside it. So `padding-bottom: 730px` here gave the stage a
          730px-tall section it was still not allowed to move inside, and it
          scrolled away untouched with `position: sticky` computed and doing
          nothing. An empty sibling grows the content box, which is the thing
          sticky actually measures. */}
      {pinned && <div aria-hidden="true" style={{ height: `${runway}px` }} />}
    </section>
  );
}
