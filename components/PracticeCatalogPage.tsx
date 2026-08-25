"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { InfoTip } from "@/components/InfoTip";
import { PremiumBadge } from "@/components/PremiumBadge";
import { Felix } from "@/components/FoxLogo";
import { NativeLibraryList } from "@/components/native/NativeLibraryList";
import { usePlan } from "@/lib/plan";

/**
 * The shell behind /library, /interviews, /social and /own.
 *
 * Those four were four copies of the same page. Not "similar" — a diff
 * between /interviews and /social came back as the data source, seven strings
 * and the component name. Every one of them carried its own copy of the
 * three-state card (premium / locked / still-loading), which is the part that
 * is easy to get subtly wrong and expensive to notice: see `plan === null`
 * below.
 *
 * What actually varies between the four is now the props list, and nothing
 * else. /library keeps its own richer card through `renderCard` rather than
 * bending this one into a shape that serves two masters.
 *
 * PRESERVED FROM THE ORIGINALS, deliberately:
 *
 *  - `native-hide` on every web-only element. The iOS app loads this same
 *    deployment, and NativeLibraryList is what it renders instead. Dropping a
 *    marker here would put a web page inside the app.
 *  - The `plan === null` third state. A subscriber whose plan has not resolved
 *    yet must NOT see the locked card for a frame — that flash reads as
 *    "my subscription is gone" on every cold load.
 *  - No prices anywhere. The upsell names Premium and links to the Daily
 *    Minute; it never says what anything costs. That is what keeps this screen
 *    legal inside the app under App Store guideline 3.1.1, and it is why the
 *    upsell is inside a `native-hide` wrapper as well.
 */

export type CatalogItem = {
  id: string;
  name: string;
  description: string;
};

export function PracticeCatalogPage<T extends CatalogItem>({
  title,
  felixMood = "coach",
  tipLabel,
  tip,
  lead,
  items,
  hrefFor,
  columns = 3,
  upsellHeading,
  upsellBody,
  renderCard,
}: {
  title: string;
  felixMood?: "idle" | "coach";
  tipLabel: string;
  tip: ReactNode;
  /** A function when the copy depends on plan, a string when it doesn't. */
  lead: ReactNode | ((isPremium: boolean) => ReactNode);
  items: readonly T[];
  hrefFor: (item: T) => string;
  columns?: 2 | 3;
  upsellHeading: string;
  upsellBody: ReactNode;
  /** /library's richer card. Omit for the standard title + blurb card. */
  renderCard?: (item: T, locked: boolean | null) => ReactNode;
}) {
  const { plan, isPremium } = usePlan();
  const locked = plan === null ? null : plan === "free";

  return (
    <div className="py-[var(--space-page-y)]">
      {/* App shape: one calm grouped list, same items, same lock rule as the
          cards below. Renders nothing in a browser. */}
      <NativeLibraryList
        sections={[
          {
            items: items.map((item) => ({
              title: item.name,
              blurb: item.description,
              locked: plan === "free",
              href: isPremium ? hrefFor(item) : undefined,
            })),
          },
        ]}
      />

      <Reveal className="native-hide">
        <div className="flex flex-wrap items-center gap-3">
          <Felix mood={felixMood} className="h-14 w-14 shrink-0" />
          <h1 className="native-hide text-title font-headline font-semibold text-primary">
            <WordReveal text={title} delay={80} step={60} />
          </h1>
          {plan === "free" && <PremiumBadge />}
          <InfoTip label={tipLabel}>{tip}</InfoTip>
        </div>
        <p className="mt-3 text-body-lg text-on-surface-variant max-w-[58ch]">
          {typeof lead === "function" ? lead(isPremium) : lead}
        </p>
      </Reveal>

      <div
        className={`native-hide mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 ${
          columns === 3 ? "lg:grid-cols-3" : ""
        }`}
      >
        {items.map((item, i) => (
          <Reveal key={item.id} delay={i * 70} className="h-full">
            {renderCard ? (
              renderCard(item, locked)
            ) : (
              <CatalogCard item={item} locked={locked} href={hrefFor(item)} />
            )}
          </Reveal>
        ))}
      </div>

      {plan === "free" && (
        <Reveal className="native-hide">
          {/* No `.card` + `border-none!` here. The original fought its own
              base class with an important modifier to remove a border the
              gradient never wanted; the surface simply doesn't need .card. */}
          <div className="navy-gradient mt-10 rounded-card p-6 text-white md:p-7">
            <h2 className="font-headline text-h3 font-semibold">{upsellHeading}</h2>
            <p className="mt-2 max-w-[56ch] text-base leading-6 text-white/85">
              {upsellBody}
            </p>
            <Link
              href="/dashboard"
              className="btn mt-5 inline-block rounded-lg bg-accent-strong px-7 py-3.5 font-semibold text-white"
            >
              Go to the Daily Minute
            </Link>
          </div>
        </Reveal>
      )}
    </div>
  );
}

/**
 * The three states one card can be in. `locked === null` is the one that
 * matters: the plan has not resolved, so we show a neutral card with no lock
 * and no badge. Rendering the locked state during that window means every
 * paying subscriber sees a paywall flash on every cold load.
 */
function CatalogCard({
  item,
  locked,
  href,
}: {
  item: CatalogItem;
  locked: boolean | null;
  href: string;
}) {
  const Title = (
    <span className="block font-headline text-h4 font-medium text-primary">
      {item.name}
    </span>
  );
  const Blurb = (
    <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
      {item.description}
    </span>
  );

  if (locked === false) {
    return (
      <GlowCard className="card h-full">
        <Link href={href} className="block h-full p-5">
          {Title}
          {Blurb}
        </Link>
      </GlowCard>
    );
  }

  if (locked === true) {
    // flex-col + mt-auto, not mt-3. The cards stretch to a common height
    // because the grid makes them, but the blurbs are one to three lines, so
    // "Unlocks with Premium" landed at a different height in every card and
    // the row read as ragged. Pinning it to the bottom is what makes a row of
    // cards look like a row.
    return (
      <div className="card flex h-full flex-col p-5 opacity-70">
        <div className="flex items-start justify-between gap-2">
          {Title}
          <PremiumBadge />
        </div>
        {Blurb}
        <span className="mt-auto pt-3 inline-block text-label font-semibold text-on-surface-variant">
          Unlocks with Premium
        </span>
      </div>
    );
  }

  // Still loading. Neutral: no lock, no badge, no flash.
  return (
    <div className="card h-full p-5">
      {Title}
      {Blurb}
    </div>
  );
}
