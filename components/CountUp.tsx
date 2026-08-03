"use client";

import { useEffect, useState } from "react";

// A numeral that rolls up to its value — the odometer moment for the one
// number the page is about. Web-only by usage (the landing hero's score);
// nothing native imports it.
//
// The roll starts on `start` (so a choreographed sequence can hand it its
// cue) or on mount, runs ~1.1s on an ease-out — fast early, tightening at
// the end, which is what makes a counter feel like it is LANDING on the
// number rather than counting to it — and renders the final value
// immediately under prefers-reduced-motion.

export function CountUp({
  value,
  startDelay = 0,
  duration = 1100,
  className = "",
}: {
  value: number;
  /** ms before the roll begins — for syncing with a CSS animation's cue. */
  startDelay?: number;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let raf = 0;
    // Reduced motion lands on the value in one asynchronous hop — same
    // "no synchronous setState in the effect body" rule as the roll itself.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      raf = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(raf);
    }

    const timer = setTimeout(() => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        // easeOutQuart: the last third of the roll covers the last few
        // digits slowly enough to read.
        const eased = 1 - Math.pow(1 - p, 4);
        setShown(Math.round(eased * value));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, startDelay);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [value, startDelay, duration]);

  return (
    <span className={`tabular-nums ${className}`} aria-label={String(value)}>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
