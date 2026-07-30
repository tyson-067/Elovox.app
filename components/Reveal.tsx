"use client";

import { useRef } from "react";
import { useRevealOnView } from "@/lib/useReveal";

// Fades + raises its children into view the first time they enter the
// viewport. Pure CSS transition (see .reveal in globals.css); this just
// flips the class. `delay` staggers siblings.
//
// Anything already on screen at mount reveals synchronously — see the note
// in lib/useReveal.ts for why that matters a great deal more than the
// animation does.

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useRevealOnView(ref, { threshold: 0.15 });

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`reveal ${visible ? "reveal-visible" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
