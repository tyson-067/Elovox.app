"use client";

import { useEffect, useRef, useState } from "react";

// Word-by-word text entrance: each word rises out of a blur with a
// small stagger the first time the element scrolls into view. Pure CSS
// animation (see .wr in globals.css); this splits the text and assigns
// per-word delays. `delay` offsets the whole phrase (ms), `step` is the
// gap between words.

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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span
      ref={ref}
      className={`wr ${visible ? "wr-visible" : ""} ${className}`}
      aria-label={text}
    >
      {text.split(" ").map((word, i) => (
        <span key={i} aria-hidden="true" className="wr-word">
          <span style={{ animationDelay: `${delay + i * step}ms` }}>
            {word}
          </span>{" "}
        </span>
      ))}
    </span>
  );
}
