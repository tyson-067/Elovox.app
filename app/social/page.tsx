"use client";

import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { InfoTip } from "@/components/InfoTip";
import { PremiumBadge } from "@/components/PremiumBadge";
import { Felix } from "@/components/FoxLogo";
import { SOCIAL_SKILLS } from "@/lib/social";
import { usePlan } from "@/lib/plan";

// Social skills practice (Premium), split by the moment rather than the
// room. Most speaking isn't a speech: it's small talk, saying no, saying
// sorry. Each skill has its own bank of concrete scenes to answer out loud.

function SocialScreen() {
  const { plan, isPremium } = usePlan();

  return (
    <div className="py-10 md:py-16">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <Felix mood="coach" className="h-14 w-14 shrink-0" />
          <h1 className="native-hide text-title font-headline font-semibold text-primary">
            <WordReveal text="Social skills" delay={80} step={60} />
          </h1>
          {plan === "free" && <PremiumBadge />}
          <InfoTip label="How does social skills practice work?">
            Every skill has its own bank of real moments. Felix sets the
            scene, you say what you&apos;d actually say, and he scores how it
            would land on the other person.
          </InfoTip>
        </div>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[58ch]">
          Pick the moment that trips you up, and answer it out loud, in your
          own words.
        </p>
      </Reveal>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {SOCIAL_SKILLS.map((s, i) => (
          <Reveal key={s.id} delay={i * 70} className="h-full">
            {isPremium ? (
              <GlowCard className="card h-full">
                <Link href={`/practice?social=${s.id}`} className="block h-full p-5">
                  <span className="font-headline text-xl font-medium text-primary block">
                    {s.name}
                  </span>
                  <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
                    {s.description}
                  </span>
                </Link>
              </GlowCard>
            ) : plan === "free" ? (
              <div className="card h-full p-5 opacity-70">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-headline text-xl font-medium text-primary block">
                    {s.name}
                  </span>
                  <PremiumBadge />
                </div>
                <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
                  {s.description}
                </span>
                <span className="mt-3 inline-block text-[13px] font-semibold text-on-surface-variant">
                  Unlocks with Premium
                </span>
              </div>
            ) : (
              // plan === null: still loading, neutral card, no lock/badge flash.
              <div className="card h-full p-5">
                <span className="font-headline text-xl font-medium text-primary block">
                  {s.name}
                </span>
                <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
                  {s.description}
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
              Most speaking isn&apos;t a speech
            </h2>
            <p className="mt-2 text-base leading-6 text-white/85 max-w-[56ch]">
              Premium adds practice for the everyday moments: small talk,
              saying no, apologizing well, and the rest, scored the way the
              other person would hear it.
            </p>
            <Link
              href="/dashboard"
              className="btn rounded-lg mt-5 inline-block bg-accent text-white font-semibold px-7 py-3.5"
            >
              Go to the Daily Minute
            </Link>
          </div>
        </Reveal>
      )}
    </div>
  );
}

export default function SocialPage() {
  return (
    <RequireAuth>
      <SocialScreen />
    </RequireAuth>
  );
}
