"use client";

import { useRef } from "react";

// Card with a cursor-tracking spotlight: a soft radial glow follows the
// pointer across the surface (see .card-glow in globals.css). The glow
// position is driven by CSS vars so the render tree never updates on
// mousemove.

export function GlowCard({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      style={style}
      className={`card-glow ${className}`}
    >
      {children}
    </div>
  );
}
