"use client";

import { useEffect, useRef } from "react";
import { useRevealOnView } from "@/lib/useReveal";

// Fades + raises its children into view the first time they enter the
// viewport. Pure CSS transition (see .reveal in globals.css); this just
// flips the class. `delay` staggers siblings.
//
// `swipe` swaps the vertical rise for a horizontal slide whose direction
// follows the scroll: scrolling down, content sweeps in from the right;
// scrolling up, from the left. The direction is stamped on the element as a
// data attribute WHILE IT IS STILL HIDDEN (a transition animates from the
// current computed style, so the hidden transform must already point the
// right way before the reveal class lands). Marketing pages opt in; app
// screens keep the plain rise.
//
// Anything already on screen at mount reveals synchronously — see the note
// in lib/useReveal.ts for why that matters a great deal more than the
// animation does.

// One shared scroll-direction tracker for every swipe Reveal on the page.
// The 2px dead zone ignores rubber-band jitter at the top of the page.
let scrollDir: "down" | "up" = "down";
let lastY = 0;
let listening = false;
function ensureDirListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  lastY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) < 2) return;
      scrollDir = y > lastY ? "down" : "up";
      lastY = y;
    },
    { passive: true }
  );
}

export function Reveal({
  children,
  delay = 0,
  className = "",
  swipe = false,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  swipe?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useRevealOnView(ref, { threshold: 0.15 });

  // Keep the hidden element's slide direction in step with the scroll, and
  // stop caring the moment it has revealed (the stamped direction is then
  // frozen, which is exactly right: it entered the way the user was moving).
  useEffect(() => {
    if (!swipe || visible) return;
    const el = ref.current;
    if (!el) return;
    ensureDirListener();
    el.dataset.dir = scrollDir;
    const sync = () => {
      el.dataset.dir = scrollDir;
    };
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, [swipe, visible]);

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`reveal ${swipe ? "reveal-swipe" : ""} ${visible ? "reveal-visible" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
