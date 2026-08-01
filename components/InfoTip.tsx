"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A small "?" in the corner of a card that explains what the card is for.
//
// This exists so pages can stay short. The alternative was another line of
// body copy under every heading, which is what made these screens feel
// wordy in the first place.
//
// Hover alone is not enough: on a phone there is no hover, and the native
// shell is a phone. So it opens on hover for a mouse and on tap/click for
// everything, which means the mouse path has to ignore the synthetic
// mouseenter that fires on tap or the tap would open and immediately close it.
//
// The bubble is position:FIXED and placed from the trigger's screen rect,
// not absolutely inside the card. Absolute positioning was clipped or buried
// by whatever the card happened to be: an overflow-hidden ancestor cut it
// off (the Daily Minute card on smaller laptops), and a later sibling card
// with its own stacking context could paint over it. Fixed coordinates,
// clamped to the viewport and flipped above the trigger when there's no room
// below, escape every ancestor context at once.

const BUBBLE_W = 240; // matches w-60
const MARGIN = 8;

export function InfoTip({
  label,
  children,
  tone = "light",
  className = "",
}: {
  /** Screen-reader name, e.g. "What is the Daily Minute?". */
  label: string;
  children: React.ReactNode;
  /** "light" = dark text on a pale card. "dark" = on a navy/dusk card. */
  tone?: "light" | "dark";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(
    null
  );
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  // createPortal needs document.body, which only exists on the client. This
  // one-shot flip after mount is the standard SSR portal guard, not a render
  // loop (the rule over-flags it).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      // Right-align to the trigger, then clamp inside the viewport.
      const left = Math.min(
        Math.max(MARGIN, r.right - BUBBLE_W),
        window.innerWidth - BUBBLE_W - MARGIN
      );
      // ~180px is a tall bubble; if that doesn't fit below, open upward.
      const above = r.bottom + 188 > window.innerHeight;
      setPos({ top: above ? r.top - MARGIN : r.bottom + MARGIN, left, above });
    };
    place();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Any tap outside BOTH the trigger and the bubble dismisses it. The bubble
    // is portaled to <body>, so it is no longer a DOM descendant of the
    // wrapper — it has to be checked separately or tapping the bubble itself
    // (e.g. to select its text) would close it.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !tipRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    // Fixed coordinates go stale the moment the page moves under them.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const dark = tone === "dark";

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold leading-none transition-colors ${
          dark
            ? "border-white/40 text-white/70 hover:border-white hover:text-white"
            : "border-outline-variant text-on-surface-variant hover:border-accent hover:text-accent"
        }`}
      >
        ?
      </button>

      {/* Portaled to <body> so it escapes BOTH overflow-clipping ancestors
          AND transformed ancestors. A `position: fixed` element is positioned
          relative to the nearest ancestor with a transform/filter/perspective,
          not the viewport — and this page is full of them (reveal animations,
          GlowCard hover, Tilt, Parallax), which is why a fixed bubble left in
          place landed off-screen. At <body> there is no such ancestor, so the
          viewport coordinates computed above are correct. */}
      {mounted && open && pos &&
        createPortal(
          <span
            ref={tipRef}
            id={id}
            role="tooltip"
            style={{
              top: pos.top,
              left: pos.left,
              transform: pos.above ? "translateY(-100%)" : undefined,
            }}
            className="card fixed z-[60] w-60 p-3 text-left text-[13px] leading-5 font-normal normal-case tracking-normal text-on-surface-variant shadow-[0_10px_28px_rgba(11,8,41,0.18)]"
          >
            {children}
          </span>,
          document.body
        )}
    </span>
  );
}
