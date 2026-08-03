"use client";

import { useRef } from "react";
import { useRevealOnView } from "@/lib/useReveal";

// Word-by-word text entrance: the words of a headline SCATTER-ASSEMBLE —
// each one arrives from its own direction, with its own slight rotation, on
// its own moment, settling out of a blur into the line. Chaos into order,
// which is the feeling of a sentence coming together — the product's whole
// promise.
//
// "Unpredictable" here is strictly deterministic: every offset, tilt and
// delay is a pure hash of the word's index, so the server and the client
// render identical markup and nothing hydration-mismatches. It reads as
// random; it never actually is.
//
// Pure CSS animation (see .wr in globals.css); this component only splits
// the text and stamps per-word custom properties. `delay` offsets the whole
// phrase (ms); `step` scales the spread of the arrival window.

/** Deterministic pseudo-random in [0, 1) from an integer. The classic
 *  fract(sin) hash — stable across server and client, no Math.random. */
function hash(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function WordReveal({
  text,
  delay = 0,
  step = 70,
  className = "",
}: {
  text: string;
  delay?: number;
  step?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // Headlines are the worst thing to lose to a stuck observer — a page whose
  // heading never appears reads as "didn't load". See lib/useReveal.ts.
  const visible = useRevealOnView(ref, { threshold: 0.3 });

  const words = text.split(" ");
  const n = words.length;

  return (
    <span ref={ref} className={`wr ${visible ? "wr-visible" : ""} ${className}`}>
      {/* A real, readable copy of the text rather than an aria-label on the
          wrapper. This component renders the <h1> on nearly every screen in
          the app, and the wrapper is a role-less <span> (role=generic), where
          ARIA 1.2 PROHIBITS aria-label — browsers mostly honour it today, but
          the product's headings shouldn't depend on unspecified behaviour.
          Every animated word stays aria-hidden, so nothing is announced
          twice. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, i) => {
          // Each word's own arrival: a direction (anywhere in the lower
          // half-plane, so nothing drops from above the line and collides
          // with ascenders), a distance, a tilt, and a shuffled slot in the
          // arrival window. The last word is nudged to land LAST about a
          // third of the time words allow — a sentence that finishes on its
          // final word lands better than one that trails off mid-line.
          const angle = (hash(i * 3 + 1) - 0.5) * Math.PI; // -90°..+90°
          const dist = 0.6 + hash(i * 3 + 2) * 0.9; // 0.6em..1.5em
          const wx = Math.sin(angle) * dist;
          const wy = Math.cos(angle) * dist * 0.7 + 0.35;
          const rot = (hash(i * 3 + 3) - 0.5) * 14; // -7°..7°
          const slot = i === n - 1 ? Math.max(hash(i) * n, n * 0.66) : hash(i * 7 + 5) * n;
          return (
            <span key={i} className="wr-word">
              <span
                style={
                  {
                    animationDelay: `${Math.round(delay + slot * step)}ms`,
                    "--wx": `${wx.toFixed(3)}em`,
                    "--wy": `${wy.toFixed(3)}em`,
                    "--wr": `${rot.toFixed(2)}deg`,
                  } as React.CSSProperties
                }
              >
                {word}
              </span>{" "}
            </span>
          );
        })}
      </span>
    </span>
  );
}
