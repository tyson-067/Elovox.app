"use client";

import { type ReactNode } from "react";
import { useIsNative } from "@/lib/native";
import { NvGroup, NvRow, NvSectionHeader } from "@/components/native/ui";

/**
 * The library screens (/library, /interviews, /social, /own) share one calm
 * shape in the app: inset grouped lists of title + one-line blurb + chevron,
 * the browsing register instead of the web's three-column card grid.
 *
 * Each page keeps all of its own data, plan and lock logic and hands this
 * renderer plain rows. In a browser it renders nothing; the page's own
 * markup (marked native-hide) keeps carrying the website unchanged.
 *
 * Locked rows — a free plan looking at Premium content — dim and carry one
 * small lock in the trailing slot. No PREMIUM chip, no "Unlocks with
 * Premium" line, no prices: App Store rules, and calmer besides.
 */

export interface NativeLibraryItem {
  /** Destination the row pushes. Omit (with no onClick) for a plain display
   *  row — how the plan-still-loading state renders, so a subscriber never
   *  sees a paywall flash. */
  href?: string;
  /** For destinations that must be computed at tap time (e.g. stashing a
   *  generated speech before routing to it). Ignored when `href` is set. */
  onClick?: () => void;
  title: string;
  blurb: string;
  /** Free plan, Premium content: dim the row, show the lock, drop the link. */
  locked?: boolean;
  /** Optional mono-stroke glyph for the leading icon square. */
  glyph?: ReactNode;
}

export interface NativeLibrarySection {
  header?: string;
  items: NativeLibraryItem[];
}

function LockGlyph() {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 14 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Locked"
    >
      <rect x="1.5" y="7" width="11" height="7.5" rx="2.5" />
      <path d="M4 7V4.75a3 3 0 0 1 6 0V7" />
    </svg>
  );
}

export function NativeLibraryList({
  sections,
}: {
  sections: NativeLibrarySection[];
}) {
  const native = useIsNative();
  if (!native) return null;

  return (
    <div>
      {sections.map((section, i) => (
        <section
          key={section.header ?? i}
          className={i > 0 && !section.header ? "mt-5" : undefined}
        >
          {section.header && (
            <NvSectionHeader>{section.header}</NvSectionHeader>
          )}
          <NvGroup>
            {section.items.map((item) =>
              item.locked ? (
                // NvRow has no dimmed state, so the locked row is assembled
                // from the same .nv-* classes it renders: reduced opacity,
                // one lock, nothing to tap.
                <div key={item.title} className="nv-row opacity-60">
                  {item.glyph && (
                    <span className="nv-icon-square" aria-hidden="true">
                      {item.glyph}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="nv-headline block truncate">
                      {item.title}
                    </span>
                    <span className="nv-footnote block truncate">
                      {item.blurb}
                    </span>
                  </span>
                  <span className="nv-row-value">
                    <LockGlyph />
                  </span>
                </div>
              ) : (
                <NvRow
                  key={item.title}
                  icon={item.glyph}
                  label={<span className="nv-headline">{item.title}</span>}
                  sub={item.blurb}
                  href={item.href}
                  onClick={item.onClick}
                  chevron={Boolean(item.href || item.onClick)}
                />
              )
            )}
          </NvGroup>
        </section>
      ))}
    </div>
  );
}
