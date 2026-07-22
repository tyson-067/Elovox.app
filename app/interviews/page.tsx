"use client";

import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { PremiumBadge } from "@/components/PremiumBadge";
import { INTERVIEW_TYPES } from "@/lib/interviews";
import { usePlan } from "@/lib/plan";

// Interview practice (Premium), split by the kind of room you're walking
// into. A hiring panel and an admissions officer are listening for
// completely different things, so each type has its own question bank.

function InterviewsScreen() {
  const { plan, isPremium } = usePlan();

  return (
    <div className="py-10 md:py-16">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title font-headline font-semibold text-primary">
            <WordReveal text="Interview practice" delay={80} step={60} />
          </h1>
          {!isPremium && <PremiumBadge />}
        </div>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[58ch]">
          Real questions, asked the way real panels ask them — including the
          follow-ups people fumble. Pick the room you&apos;re walking into and
          Felix will judge the answer the way that panel would.
        </p>
      </Reveal>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {INTERVIEW_TYPES.map((t, i) => (
          <Reveal key={t.id} delay={i * 70} className="h-full">
            {isPremium ? (
              <GlowCard className="card h-full">
                <Link href={`/practice?interview=${t.id}`} className="block h-full p-5">
                  <span className="font-headline text-xl font-medium text-primary block">
                    {t.name}
                  </span>
                  <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
                    {t.description}
                  </span>
                  <span className="mt-3 inline-block text-[13px] font-semibold text-accent">
                    {t.questions.length} questions →
                  </span>
                </Link>
              </GlowCard>
            ) : (
              <div className="card h-full p-5 opacity-70">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-headline text-xl font-medium text-primary block">
                    {t.name}
                  </span>
                  <PremiumBadge />
                </div>
                <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
                  {t.description}
                </span>
                <span className="mt-3 inline-block text-[13px] font-semibold text-on-surface-variant">
                  {t.questions.length} questions · unlocks with Premium
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
              Practising for something specific?
            </h2>
            <p className="mt-2 text-base leading-6 text-white/85 max-w-[56ch]">
              Premium adds interview practice by type, plus camera coaching —
              posture, eye contact and what your hands do when you&apos;re
              thinking, which is most of what a panel actually reads.
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

export default function InterviewsPage() {
  return (
    <RequireAuth>
      <InterviewsScreen />
    </RequireAuth>
  );
}
