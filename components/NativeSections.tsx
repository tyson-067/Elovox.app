"use client";

import { useIsNative } from "@/lib/native";
import { usePlan } from "@/lib/plan";
import { NvGroup, NvRow, NvSectionHeader } from "@/components/native/ui";

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

/** The one lock affordance a locked row gets: a small mono glyph, nothing else. */
function LockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} strokeWidth={2} aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function NativeSections() {
  const native = useIsNative();
  const { plan } = usePlan();
  if (!native) return null;

  return (
    <section className="mt-6">
      <NvSectionHeader>More ways to practice</NvSectionHeader>
      <NvGroup>
        {SECTIONS.map((s) => (
          <NvRow
            key={s.href}
            href={s.href}
            icon={s.glyph}
            label={<span className="nv-headline">{s.label}</span>}
            sub={s.blurb}
            value={
              plan === "free" ? (
                <>
                  <LockGlyph />
                  <span className="sr-only">Premium</span>
                </>
              ) : undefined
            }
          />
        ))}
      </NvGroup>
    </section>
  );
}
