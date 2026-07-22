"use client";

import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { PremiumBadge } from "@/components/PremiumBadge";
import { CATEGORIES } from "@/lib/categories";
import { usePlan } from "@/lib/plan";

// Coaching on the user's own material (Premium). Nothing is written for
// them here — they bring the pitch or the talk they already have, and
// Felix coaches the delivery rather than the draft.

function OwnScreen() {
  const { plan, isPremium } = usePlan();

  return (
    <div className="py-10 md:py-16">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title font-headline font-semibold text-primary">
            <WordReveal text="My own material" delay={80} step={60} />
          </h1>
          {!isPremium && <PremiumBadge />}
        </div>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[58ch]">
          Bring the pitch, the presentation, or the talk you&apos;ve already
          written. Pick the kind of thing it is, and Felix coaches how you
          deliver it — not how you wrote it.
        </p>
      </Reveal>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {CATEGORIES.map((cat, i) => (
          <Reveal key={cat.id} delay={i * 70} className="h-full">
            {isPremium ? (
              <GlowCard className="card h-full">
                <Link href={`/practice?category=${cat.id}`} className="block h-full p-5">
                  <span className="font-headline text-xl font-medium text-primary block">
                    {cat.name}
                  </span>
                  <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
                    {cat.description}
                  </span>
                  <span className="mt-3 inline-block text-[13px] font-semibold text-accent">
                    Start a session →
                  </span>
                </Link>
              </GlowCard>
            ) : (
              <div className="card h-full p-5 opacity-70">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-headline text-xl font-medium text-primary block">
                    {cat.name}
                  </span>
                  <PremiumBadge />
                </div>
                <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
                  {cat.description}
                </span>
              </div>
            )}
          </Reveal>
        ))}
      </div>

      {plan === "free" && (
        <Reveal>
          <div className="card mt-10 p-6 navy-gradient border-none! text-white">
            <h2 className="font-headline text-2xl font-semibold">
              Got something real coming up?
            </h2>
            <p className="mt-2 text-base leading-6 text-white/85 max-w-[56ch]">
              Premium coaches you on your own words, and Felix will write you
              a speech from scratch if you&apos;d rather start there.
            </p>
            <Link
              href="/dashboard"
              className="btn rounded-lg mt-5 inline-block bg-accent text-white font-semibold px-7 py-3.5"
            >
              Go to today&apos;s challenge
            </Link>
          </div>
        </Reveal>
      )}
    </div>
  );
}

export default function OwnPage() {
  return (
    <RequireAuth>
      <OwnScreen />
    </RequireAuth>
  );
}
