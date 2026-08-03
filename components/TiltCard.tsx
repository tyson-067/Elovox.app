"use client";

import { useRef } from "react";

// A card that leans toward the cursor — a few degrees of 3D, spring-back on
// leave. The physical response is what separates "an image of a card" from
// "a thing on the desk in front of you". Web-only by usage; pointer-driven,
// so touch devices (and therefore the app shell) never see it move, and
// reduced-motion turns it off entirely.
//
// Written against rAF rather than state: pointermove can fire hundreds of
// times a second, and a React render per event is how a hero starts
// stuttering on the exact machines this is meant to impress.

const MAX_DEG = 5;

export function TiltCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.transition = "transform 120ms ease-out";
      el.style.transform = `perspective(900px) rotateX(${(-py * MAX_DEG).toFixed(2)}deg) rotateY(${(px * MAX_DEG).toFixed(2)}deg)`;
    });
  };

  const leave = () => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    // The settle is slower than the follow — leaning is live, letting go is
    // physical.
    el.style.transition = "transform 450ms cubic-bezier(0.22, 1, 0.36, 1)";
    el.style.transform = "";
  };

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      className={className}
      style={{ willChange: "transform" }}
    >
      {children}
    </div>
  );
}
