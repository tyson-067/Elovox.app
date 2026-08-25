"use client";

import { useEffect, useRef, useState } from "react";
import { spring, rubberband } from "@/lib/spring";
import { tapMedium, notifySuccess } from "@/lib/haptics";

/**
 * Pull to refresh, on the window scroll.
 *
 * The app had no instance of it. On the Ladder that meant the streak, the
 * topic and today's attempt count only ever updated on remount — so the
 * obvious thing to do when you suspect a screen is stale (drag it down) did
 * nothing, and the actual remedy was to kill the app.
 *
 * Built on lib/spring.ts rather than a CSS transition for the same reason the
 * sheet is: the release has to continue from wherever the finger left it, at
 * whatever speed it was going, and a fixed-duration curve cannot do that.
 *
 * Deliberately NOT a scroll-container implementation. These screens scroll the
 * DOCUMENT — `#main` has no overflow of its own — so the gesture reads
 * window.scrollY and translates `#main`. Attaching to a child that never
 * scrolls is why a first attempt at this appeared to do nothing.
 *
 * Everything mutable lives in a ref. The effect subscribes once per onRefresh
 * identity; putting `refreshing` in the deps tore the listeners down and reset
 * the transform in the middle of the gesture that had just set it.
 */

const THRESHOLD = 72; // px of pull that commits
const MAX = 120; // hard stop, past which the band is basically flat
const MIN_VISIBLE_MS = 450; // a refresh that resolves instantly reads as a glitch

export function usePullToRefresh(onRefresh?: () => void | Promise<void>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const armedRef = useRef(false);
  const committedRef = useRef(false);
  const startYRef = useRef(0);
  const springRef = useRef<{ stop: () => { value: number; velocity: number } } | null>(null);

  useEffect(() => {
    if (!onRefresh) return;
    const surface = document.getElementById("main");
    if (!surface) return;

    const paint = (v: number) => {
      pullRef.current = v;
      setPull(v);
      surface.style.transform = v === 0 ? "" : `translate3d(0,${v}px,0)`;
    };

    const settle = (to: number, velocity = 0, then?: () => void) => {
      springRef.current?.stop();
      springRef.current = spring({
        from: pullRef.current,
        to,
        velocity,
        // No overshoot: coming back to rest is a correction, not a flourish.
        damping: 1,
        response: 0.32,
        onFrame: paint,
        onRest: then,
      });
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || refreshingRef.current) return;
      // Only from a genuine top-of-page. Arming mid-scroll is how a
      // pull-to-refresh ends up fighting the scroller on every screen.
      if (window.scrollY > 0) return;
      springRef.current?.stop();
      armedRef.current = true;
      committedRef.current = false;
      startYRef.current = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (!armedRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;

      // Went back up, or the page started scrolling for real: hand the gesture
      // back to the scroller cleanly rather than half-owning it.
      if (dy <= 0 || window.scrollY > 0) {
        armedRef.current = false;
        if (pullRef.current !== 0) paint(0);
        return;
      }

      const eased = Math.min(MAX, rubberband(dy, window.innerHeight));
      paint(eased);

      if (!committedRef.current && eased >= THRESHOLD) {
        committedRef.current = true;
        // One tick at the moment it BECOMES a refresh, so the commit is felt
        // rather than guessed at — the job the iOS detent click does.
        tapMedium();
      }
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      if (!armedRef.current) return;
      armedRef.current = false;

      if (!committedRef.current) {
        settle(0);
        return;
      }

      refreshingRef.current = true;
      setRefreshing(true);
      // Hold at the threshold while the work happens. Snapping shut the
      // instant the finger lifts makes a fast refresh look like nothing
      // happened at all.
      settle(THRESHOLD);

      const started = Date.now();
      const finish = () => {
        refreshingRef.current = false;
        setRefreshing(false);
        notifySuccess();
        settle(0);
      };

      void Promise.resolve()
        .then(() => onRefresh())
        .catch(() => {
          /* The screen owns its own error state; this only owns the gesture. */
        })
        .finally(() => {
          window.setTimeout(finish, Math.max(0, MIN_VISIBLE_MS - (Date.now() - started)));
        });
    };

    surface.addEventListener("touchstart", onStart, { passive: true });
    surface.addEventListener("touchmove", onMove, { passive: false });
    surface.addEventListener("touchend", onEnd, { passive: true });
    surface.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      surface.removeEventListener("touchstart", onStart);
      surface.removeEventListener("touchmove", onMove);
      surface.removeEventListener("touchend", onEnd);
      surface.removeEventListener("touchcancel", onEnd);
      springRef.current?.stop();
      surface.style.transform = "";
    };
  }, [onRefresh]);

  return {
    pull,
    refreshing,
    /** 0..1 toward the commit point, for the indicator. */
    progress: Math.min(1, pull / THRESHOLD),
  };
}
