"use client";

import { useEffect, useId, useRef, useState } from "react";

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
  const wrapRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Any tap elsewhere dismisses it. Without this, an open tip on touch
    // sticks around until you find the "?" again.
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
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

      {open && (
        <span
          id={id}
          role="tooltip"
          // Anchored to the right edge so a corner tip never runs off screen.
          className="card absolute right-0 top-7 z-30 w-60 p-3 text-left text-[13px] leading-5 font-normal normal-case tracking-normal text-on-surface-variant shadow-[0_10px_28px_rgba(11,8,41,0.18)]"
        >
          {children}
        </span>
      )}
    </span>
  );
}
