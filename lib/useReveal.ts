"use client";

import { useEffect, useState, type RefObject } from "react";

// Shared "has this scrolled into view yet" flag behind Reveal and WordReveal.
//
// Both of those start their content at opacity 0 and only paint it once the
// flag flips, which means the flag is not decoration: if it never flips, that
// part of the screen is *gone*. That is the bug this hook exists to close.
// The old code hung the flag on a single IntersectionObserver callback and
// nothing else, and an observer only delivers while the document is being
// rendered. Click a header link and switch tabs (or let the phone lock, or
// let the page come back from bfcache) and the callback for the page you
// just navigated to is never delivered — every Reveal on it stays at opacity
// 0 forever, and the only way out is a reload. Which is exactly what people
// were doing.
//
// So the observer is now one of three ways to become visible, not the only
// one:
//
//   1. A synchronous rect check on mount. Anything already on screen when the
//      component mounts — i.e. the whole first viewport of every page you
//      navigate to — reveals immediately, without waiting for a callback that
//      may never come. This alone fixes the reported blank screen.
//   2. The observer, for content genuinely below the fold. Unchanged, and
//      still what drives the animation during normal scrolling.
//   3. A late re-check, on tab focus and on a one-shot timer. If the observer
//      hasn't reported by then we stop trusting it and fall back to plain
//      scroll/resize listeners for the rest of the page's life.
//
// Path 3 is the rare one and costs nothing when the observer is healthy.

/**
 * Is any part of `el` inside the viewport?
 *
 * The 40px bottom inset mirrors the observer's rootMargin, so the two agree
 * about the edge case and content doesn't reveal a hair early. Unlike the
 * observer's 0.15 threshold this is a simple overlap test, which also covers
 * zero-height wrappers: a 0px-tall element has an intersection ratio of 0 and
 * can never satisfy a non-zero threshold, so under the old code it stayed
 * invisible permanently no matter where it sat on the page.
 */
function inViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  // No measurable viewport (headless/embedded contexts, a tab the engine has
  // never laid out). Every comparison below would be against nonsense, and
  // the honest answer to "is this on screen?" is "we can't tell" — so say
  // yes. A missed animation costs nothing; a wrongly hidden page is the bug.
  if (!vh || !vw) return true;
  return r.bottom >= 0 && r.top <= vh - 40 && r.right >= 0 && r.left <= vw;
}

/** How long to wait for the observer before assuming it isn't coming. */
const OBSERVER_GRACE_MS = 1200;

export function useRevealOnView(
  ref: RefObject<Element | null>,
  { threshold = 0.15 }: { threshold?: number } = {}
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let done = false;
    let io: IntersectionObserver | undefined;
    // Explicitly initialised because `cleanup` can run before the timer is
    // ever scheduled (the synchronous check below may reveal immediately).
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    let listening = false;

    const stopListening = () => {
      if (!listening) return;
      listening = false;
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };

    const cleanup = () => {
      io?.disconnect();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      stopListening();
    };

    function show() {
      if (done) return;
      done = true;
      cleanup();
      setVisible(true);
    }

    function check() {
      if (!done && el && inViewport(el)) show();
    }

    // 1. Already on screen? Don't wait for anything.
    check();
    if (done) return;

    // Nothing to fall back on: show it rather than risk hiding it forever.
    if (typeof IntersectionObserver === "undefined") {
      show();
      return;
    }

    // 2. The normal path for below-the-fold content.
    io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) show();
      },
      { threshold, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);

    // 3. Safety nets. A tab that was hidden through the navigation gets its
    //    first real look here; the timer covers everything else by giving up
    //    on the observer and watching scroll directly.
    document.addEventListener("visibilitychange", check);

    const giveUpOnObserver = () => {
      check();
      if (done) return;
      // A hidden document isn't rendering, so the observer has had no chance
      // to say anything and silence proves nothing. Wait for the tab to come
      // back rather than burning the healthy path on a false negative.
      if (document.hidden) {
        timer = setTimeout(giveUpOnObserver, OBSERVER_GRACE_MS);
        return;
      }
      io?.disconnect();
      io = undefined;
      listening = true;
      window.addEventListener("scroll", check, { passive: true });
      window.addEventListener("resize", check, { passive: true });
    };
    timer = setTimeout(giveUpOnObserver, OBSERVER_GRACE_MS);

    return cleanup;
  }, [ref, threshold]);

  return visible;
}
