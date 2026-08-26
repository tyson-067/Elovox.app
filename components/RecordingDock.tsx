"use client";

import { useEffect, useState, type RefObject } from "react";

// The practice transport, docked to the bottom of the screen whenever the real
// one has scrolled out of reach.
//
// TWO problems, one shape.
//
// The first is the dangerous one. On a phone the practice page is ~2,200px
// tall and the recorder sits in the middle of it. The page tells you to hit
// three points in sixty seconds — so scrolling back up to re-read them
// mid-take is not misuse, it is the instruction. Do it and the Stop button and
// the countdown both leave the screen, and there is no second copy of either:
// measured at iPhone width, scrolled to the top mid-recording, the stop
// control sat at y=1454 with the viewport 844px tall, and at the bottom it sat
// at y=-116. A live microphone the user cannot see the clock for or turn off
// is the worst state on this screen to be unable to reach.
//
// The second is the everyday one. Before a take, that same ~1,450px of brief,
// instructions and Impact Modes sits between the top of the page and the
// record button — so the primary action of the whole product is a long scroll
// down its main flow. That is already solved above `lg`, where the page splits
// into two columns and the stage sticks (see the note at the top of
// app/practice/page.tsx: "the stage sticks so the button stays reachable
// however long the brief runs"). Below `lg` it stacks back and the button goes
// under the fold. This is that same fix on the platform that needs it more.
//
// So the dock carries whichever face the transport is currently showing, and
// the handover rule is the same for both: it appears when the real control is
// not comfortably readable, and gets out of the way when it is.
//
// It is not a second source of truth. It calls the same `onStart`/`onStop` the
// blob calls and renders the clock string the inline timer renders, so there
// is nothing that can drift.
//
// At the very bottom of the page BOTH stop buttons are on screen at once. That
// is deliberate: the alternative is hiding the countdown to avoid a duplicate,
// and a redundant button costs nothing while a missing clock costs the take.
//
// Web only. The native shell runs the booth as a full-screen takeover with its
// own always-visible controls, so there is nothing there to lose sight of;
// practice/page.tsx gates on `native` and `native-hide` covers the stamp
// arriving late.

export function RecordingDock({
  /** The inline transport — clock and control together. */
  anchorRef,
  recording,
  /** Rendered clock, already formatted by the caller so the docked and inline
   *  timers can never disagree about direction or rounding. */
  time,
  /** The line under the label before a take starts. The caller owns this copy
   *  because it owns every other word on this screen. */
  idleDetail,
  /** The last take failed. Changes what the bar says, not what it does. */
  failed = false,
  /** Counting down and nearly out — the clock goes hot. */
  urgent = false,
  onStart,
  onStop,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  recording: boolean;
  time: string;
  idleDetail: string;
  failed?: boolean;
  urgent?: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;

    // The rule: dock unless BOTH the clock and the control are comfortably
    // readable. Deliberately not "unless the anchor intersects the viewport",
    // which is what an IntersectionObserver gives you and what this used to
    // do — at the very bottom of the practice page the record button is still
    // on screen while the clock 50px above it has already slipped under the
    // sticky header, so the observer said "visible" and retracted the dock
    // that was carrying the only remaining copy of the countdown.
    //
    // The readable band, and its two ends are not the same size.
    //
    // TOP is the sticky header: content underneath it is on screen by
    // getBoundingClientRect and unreadable by eye, and this is a control
    // someone uses while speaking to a room.
    //
    // BOTTOM is this bar's own footprint (12px inset + ~64px tall) plus
    // clearance. Measuring to the same 60px as the top handed over while the
    // real button was still under where the dock sits, so for a few pixels of
    // scroll the dock covered the very control it had just decided was
    // visible. Retiring 20px clear of itself means the button is genuinely
    // uncovered at the moment the bar goes.
    const TOP_BAND = 60;
    const BOTTOM_BAND = 96;
    let raf = 0;

    const measure = () => {
      raf = 0;
      const top = TOP_BAND;
      const bottom = window.innerHeight - BOTTOM_BAND;
      const r = el.getBoundingClientRect();
      // The transport's first button is the record/stop control; the clock is
      // the top of the anchor itself. Those two are what has to be readable —
      // not Felix at the bottom of the same column, who can be cropped
      // without costing anyone anything.
      const btn = el.querySelector("button")?.getBoundingClientRect();
      const clockVisible = r.top >= top && r.top <= bottom;
      const controlVisible = btn ? btn.top >= top && btn.bottom <= bottom : r.bottom <= bottom;
      setAway(!(clockVisible && controlVisible));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [anchorRef]);

  const label = recording ? "Recording" : failed ? "Try again" : "Ready";

  return (
    <div
      className={`recording-dock native-hide ${away ? "is-docked" : ""}`}
      // Not aria-hidden, and not unmounted: this is a real, reachable control
      // whenever it is on screen. It is `inert` while hidden so it is never a
      // phantom tab stop over the inline one.
      inert={!away || undefined}
    >
      {recording ? (
        <span className="recording-dock-dot" aria-hidden="true" />
      ) : (
        // The record button's own glyph at bar scale, so the two read as one
        // control in two places rather than as two controls.
        <span className="recording-dock-ring" aria-hidden="true" />
      )}
      <span className="recording-dock-label">
        {/* /85, not /70. tests/unit/contrast.test.ts measures this: 11px
            uppercase white at 70% on the Oxford ground is 3.91:1, under AA. */}
        <span className="block text-micro font-semibold uppercase tracking-[0.08em] text-white/85">
          {label}
        </span>
        {recording ? (
          // aria-hidden for the same reason the inline clock is (see the note
          // in app/practice/page.tsx): this text is rewritten ten times a
          // second, and the spoken countdown is the live region on the page,
          // in words.
          <span
            className={`font-data text-xl tabular-nums ${urgent ? "text-accent" : "text-white"}`}
            aria-hidden="true"
          >
            {time}
          </span>
        ) : (
          <span className="block truncate text-body-sm text-white/85">{idleDetail}</span>
        )}
      </span>
      <button
        type="button"
        onClick={recording ? onStop : onStart}
        className="recording-dock-stop"
      >
        <span
          className={`block h-3.5 w-3.5 ${
            recording ? "rounded-[3px] bg-current" : "rounded-full border-2 border-current"
          }`}
          aria-hidden="true"
        />
        {recording ? "Stop" : "Record"}
      </button>
    </div>
  );
}
