"use client";

import { useEffect, useRef } from "react";
import { reducedMotion } from "@/lib/motion";

// Parallax wrapper: the inner element drifts against scroll at `speed`
// (positive = slower than the page, negative = faster). The outer div is
// the measuring element (untransformed, so getBoundingClientRect stays
// honest); the inner div receives the transform. Disabled for users who
// prefer reduced motion.
//
// THE TRAVEL IS CLAMPED, and that is not a refinement — it is the whole
// reason this file has a comment. The offset is proportional to the
// element's distance from the centre of the viewport, and on a 12,000px
// marketing page an orb sitting near the bottom is ~9,800px from centre:
// at speed 0.2 that is a translateY of +1,959px on an element that is only
// ever 144px tall. Vertical overflow from an absolutely positioned
// descendant propagates to the document, so the page measured 12,067px tall
// at the top and 10,912px once the scroll handler caught up — flick a phone
// to the bottom and you landed in 1,154px of blank white under the footer,
// which then silently corrected itself. (`overflow-x: clip` on html in
// globals.css handles the sideways case; there is no vertical equivalent
// that doesn't also kill page scrolling.)
//
// Clamping to the on-screen range costs nothing visually: while the element
// is anywhere near the viewport, |offCenter| is already inside the range, so
// the movement you can actually SEE is identical. Past that the drift simply
// parks instead of running away.

export function Parallax({
  children,
  speed = 0.15,
  className = "",
}: {
  children: React.ReactNode;
  speed?: number;
  className?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    if (reducedMotion()) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = outer.getBoundingClientRect();
      const offCenter = rect.top + rect.height / 2 - window.innerHeight / 2;
      // The distance at which the element has just left the viewport. Beyond
      // it nothing about this element is visible, so there is nothing to
      // animate and every further pixel of travel is pure page overflow.
      const range = window.innerHeight / 2 + rect.height / 2;
      const bounded = Math.max(-range, Math.min(range, offCenter));
      inner.style.transform = `translate3d(0, ${(bounded * speed).toFixed(1)}px, 0)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);

  return (
    <div ref={outerRef} className={className}>
      <div ref={innerRef} className="will-change-transform">
        {children}
      </div>
    </div>
  );
}
