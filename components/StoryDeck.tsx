"use client";

import { useEffect, useRef, useState } from "react";
import { Felix, type FelixMood } from "@/components/FoxLogo";
import { Reveal } from "@/components/Reveal";

// Felix's story as a pinned card deck. The section claims a tall scroll
// runway (one viewport per beat); inside it a sticky, full-height stage
// holds the deck still while the page scrolls. Scroll progress through the
// runway picks the active card: scrolling down swipes the current card away
// to the left and brings up the next, scrolling back up reverses it, and
// the page only un-pins once the last card has been seen — the deck "holds"
// you exactly as long as there are cards left.
//
// Waiting cards sit behind the active one, slightly lower and smaller, so
// the stack reads as a deck rather than a slideshow. All movement is CSS
// transitions on transform/opacity (.deck-card); the scroll handler only
// picks an index, so scrubbing fast is cheap.
//
// prefers-reduced-motion (or no JS): the same four cards render as a plain
// grid with no pinning and no motion. The story is content, not decoration.

export interface StoryBeat {
  mood: FelixMood;
  title: string;
  body: string;
}

/** Below this the pinned stage cannot hold the deck without scrolling inside
 *  itself, so the deck is not the right shape for the screen. The stage
 *  content measures ~443px (heading + the 340px card area + the dots + the
 *  vertical padding); 520 leaves a little air over that. */
const MIN_DECK_VH = 520;

export function StoryDeck({ beats }: { beats: StoryBeat[] }) {
  const runwayRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [flat, setFlat] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Two reasons to fall back to the plain grid, and the second is not a
    // preference — it is a scroll trap.
    //
    // On a landscape phone (844x390) the stage is 390px tall and the deck
    // inside it is 443px, so `overflow-y-auto` was making up the difference:
    // the content stayed REACHABLE, but only by scrolling a container nested
    // inside a pinned section. A swipe up over the deck then scrolls those 53
    // hidden pixels first and the page does not move at all until they run
    // out, which reads as the page having frozen. A grid of four cards has no
    // pin, no nesting and no runway, and it is the same content.
    //
    // Read after mount rather than in a lazy initializer: the two branches
    // render DIFFERENT markup, so deciding during the first render would risk
    // a hydration mismatch. Deck first, grid a beat later, is the SSR-safe
    // order.
    const decide = () =>
      setFlat(mq.matches || window.innerHeight < MIN_DECK_VH);
    decide();
    mq.addEventListener("change", decide);
    // Rotating the phone has to be able to swap the shape back.
    window.addEventListener("resize", decide);
    return () => {
      mq.removeEventListener("change", decide);
      window.removeEventListener("resize", decide);
    };
  }, []);

  useEffect(() => {
    if (flat) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = runwayRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const total = el.offsetHeight - window.innerHeight;
        if (total <= 0) return;
        const scrolled = Math.min(Math.max(0, -rect.top), total);
        setIdx(
          Math.min(beats.length - 1, Math.floor((scrolled / total) * beats.length))
        );
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [flat, beats.length]);

  // Wrapped in a Reveal because `.grow-line` only grows under
  // `.reveal-visible` — rendered bare, the gradient underline sat at
  // scaleX(0) forever, so this was the one section heading on the landing
  // page with no bar under it. (Reduced-motion users saw it, since that
  // media query forces scaleX(1), which made it easy to miss.)
  const heading = (
    <Reveal>
      <h2 className="text-kicker uppercase text-on-surface-variant">
        How a nervous fox got his voice
        <span className="grow-line" aria-hidden="true" />
      </h2>
    </Reveal>
  );

  if (flat) {
    return (
      <section className="mt-16 md:mt-20">
        {heading}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-4">
          {beats.map((beat) => (
            <div key={beat.title} className="card-warm flex h-full flex-col p-5 md:p-6">
              <Felix mood={beat.mood} className="h-20 w-20" />
              <h3 className="mt-3 font-headline text-lg font-semibold text-primary">
                {beat.title}
              </h3>
              <p className="mt-1.5 text-body-sm leading-6 text-on-surface-variant">
                {beat.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={runwayRef}
      className="relative mt-16 md:mt-20"
      style={{ height: `${beats.length * 100}vh` }}
    >
      {/* min-h-0 + overflow-y-auto + py-8: on a short/landscape viewport the
          fixed-height content (~440px) exceeds h-screen, and justify-center
          would push the heading and the progress dots off both edges with no
          way to reach them. Auto-margins center when there's room; the scroll
          fallback keeps everything reachable when there isn't. */}
      {/* h-dvh, not h-screen. `100vh` on a phone is the LARGE viewport — the
          height the page would have if the browser chrome were hidden — so
          with the URL bar showing, this stage was taller than anything the
          user could see and `justify-center` centred the card on a midpoint
          below the fold. The progress dots at its bottom edge sat off-screen
          for the whole pinned section. `100dvh` is the height that is
          actually visible right now, which is the one this is centring in. */}
      <div className="sticky top-0 flex h-dvh min-h-0 flex-col justify-center overflow-y-auto py-8">
        {heading}
        <div className="relative mx-auto mt-6 h-[340px] w-full max-w-lg shrink-0 md:h-[320px]">
          {beats.map((beat, i) => {
            const offset = i - idx;
            // Cards already read: swiped off to the left with a little spin.
            // The card on deck: front and center. Cards still to come: tucked
            // behind, lower and smaller, at most two visible.
            const style =
              offset < 0
                ? {
                    transform: "translateX(-120%) rotate(-8deg)",
                    opacity: 0,
                    zIndex: beats.length + offset,
                  }
                : {
                    transform: `translateY(${Math.min(offset, 2) * 18}px) scale(${
                      1 - Math.min(offset, 2) * 0.05
                    })`,
                    opacity: offset > 2 ? 0 : 1,
                    zIndex: beats.length - offset,
                  };
            return (
              <div
                key={beat.title}
                aria-hidden={offset !== 0}
                style={style}
                className="deck-card card-warm absolute inset-0 flex flex-col p-6 shadow-lift-lg md:p-8"
              >
                {/* Beat number, same index language as the rest of the page.
                    The deck keeps its card shape on purpose — a deck of
                    cards is the one place where the card IS the metaphor. */}
                <span
                  aria-hidden="true"
                  className="ghost-num ghost-num-sm absolute right-5 top-4 text-accent-strong"
                >
                  0{i + 1}
                </span>
                <Felix mood={beat.mood} className="h-20 w-20 md:h-24 md:w-24" />
                <h3 className="mt-4 font-headline text-2xl font-semibold text-primary">
                  {beat.title}
                </h3>
                <p className="mt-2 text-base leading-7 text-on-surface-variant">
                  {beat.body}
                </p>
              </div>
            );
          })}
        </div>
        {/* Where you are in the deck, and the nudge that scrolling drives it. */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {beats.map((b, i) => (
            <span
              key={b.title}
              aria-hidden="true"
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === idx ? "w-6 bg-accent" : "w-1.5 bg-primary/20"
              }`}
            />
          ))}
        </div>
        <p
          aria-hidden="true"
          className={`mt-3 text-center text-caption font-semibold uppercase tracking-[0.08em] text-on-surface-variant/80 transition-opacity duration-300 ${
            idx === beats.length - 1 ? "opacity-0" : "opacity-100"
          }`}
        >
          Keep scrolling
        </p>
      </div>
    </section>
  );
}
