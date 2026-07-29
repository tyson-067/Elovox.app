"use client";

import { useEffect, useRef } from "react";

/**
 * Un-sticks a "busy" button when the user comes back from somewhere we sent
 * them, without having finished what they left to do.
 *
 * Two things used to strand a disabled button forever:
 *
 *   1. Stripe. `startCheckout` / `openBillingPortal` do a full-page redirect,
 *      so the component is still mounted with `busy === true` when it goes.
 *      Press Back and Safari/Chrome restore that exact page from bfcache,
 *      state included: the CTA comes back greyed out with no way to retry
 *      short of a manual reload.
 *
 *   2. The Google sign-in popup. Under COOP the opener can't observe the
 *      popup closing, so when someone dismisses it `signInWithPopup` never
 *      settles. There is no rejection to catch, so the `catch` that resets
 *      `busy` never runs.
 *
 * So we watch for the two signals that mean "they're back": a bfcache restore
 * (`pageshow` with `persisted`), and the window regaining focus. The focus
 * path waits `delayMs` first, because a *successful* popup also hands focus
 * back, a beat before the sign-in resolves; that grace period lets the happy
 * path settle and unmount rather than flashing the button back on.
 *
 * `reset` is called only while `busy` is true, and callers pass their own
 * guard (see AuthForm's `settled` ref) when "back" is ambiguous.
 */
export function useReturnReset(
  busy: boolean,
  reset: () => void,
  delayMs = 1500
) {
  // Kept in a ref so a caller can pass an inline arrow without re-arming the
  // listeners (and restarting the timer) on every render.
  const resetRef = useRef(reset);
  useEffect(() => {
    resetRef.current = reset;
  });

  useEffect(() => {
    if (!busy) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resetRef.current();
    };
    const onFocus = () => {
      clearTimeout(timer);
      timer = setTimeout(() => resetRef.current(), delayMs);
    };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
    };
  }, [busy, delayMs]);
}
