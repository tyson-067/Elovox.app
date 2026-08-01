"use client";

import Link from "next/link";
import { useIsNative } from "@/lib/native";
import { usePlan } from "@/lib/plan";

/**
 * The rest of the app, on Today.
 *
 * The web puts its sections in a scrolling tab strip. A dock holds four, and
 * most of the rest are Premium — so a free user would have been staring at a
 * dock that was half locked. The Premium modules (Interviews, Social skills,
 * Felix writes it, My material) become cards here instead, which is the
 * better information architecture anyway: they are things you go and do, not
 * places you live.
 *
 * Native only. The web keeps its sub-nav.
 */

interface Section {
  href: string;
  label: string;
  blurb: string;
  glyph: React.ReactElement;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const SECTIONS: Section[] = [
  {
    href: "/interviews",
    label: "Interviews",
    blurb: "Real questions, asked the way panels ask them",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 5.5h16v10H9l-5 4z" />
        <path d="M9 10h6" />
      </svg>
    ),
  },
  {
    href: "/social",
    label: "Social skills",
    blurb: "Small talk, saying no, saying sorry",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M3.5 4.5h11v7.5H8.5l-5 3.5z" />
        <path d="M21 10h-6v6.5h2.5l3.5 3z" />
      </svg>
    ),
  },
  {
    href: "/custom",
    label: "Felix writes it",
    blurb: "Give him the situation, get the script",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" />
        <path d="M13.5 7 17 10.5" />
      </svg>
    ),
  },
  {
    href: "/own",
    label: "My material",
    blurb: "Coaching on the talk you already have",
    glyph: (
      <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M5 4.5h8l6 6V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z" />
        <path d="M13 4.5v6h6" />
      </svg>
    ),
  },
];

export function NativeSections() {
  const native = useIsNative();
  const { plan } = usePlan();
  if (!native) return null;

  return (
    <section className="mt-10">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant">
        More ways to practice
      </h2>
      <div className="mt-3 flex flex-col gap-2.5">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="card flex items-center gap-3.5 p-4 transition-transform active:scale-[0.985]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container text-primary">
              {s.glyph}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="font-headline text-[15px] font-semibold text-primary">
                  {s.label}
                </span>
                {plan === "free" && (
                  <span
                    title="Premium"
                    className="h-1.5 w-1.5 rounded-full bg-violet"
                  >
                    <span className="sr-only">Premium</span>
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-on-surface-variant">
                {s.blurb}
              </span>
            </span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              {...stroke}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0 text-on-surface-variant/50"
            >
              <path d="m9.5 5 7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>
    </section>
  );
}
