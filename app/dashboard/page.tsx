"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { PremiumBadge } from "@/components/PremiumBadge";
import { usePlan } from "@/lib/plan";
import {
  fetchDailyChallenge,
  getChallengeState,
  getStats,
  MAX_DAILY_ATTEMPTS,
  type ChallengeState,
  type DailyChallenge,
  type UserStats,
} from "@/lib/daily";

// "Today" — the home of the app. Deliberately short: the day's challenge,
// where you are in the levels, and a way through to each feature. The
// features themselves live on their own pages, reachable from SubNav, so
// this stopped being one long scrolling wall.

/** Level, XP and streak — the running total across every rep. */
function LevelStrip({ stats }: { stats: UserStats | null }) {
  if (!stats) return null;
  const { level } = stats;
  return (
    <GlowCard className="card p-5 h-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[13px] font-semibold tracking-[0.06em] uppercase text-violet">
            Level {level.level}
          </span>
          <div className="font-headline text-2xl font-medium text-primary">
            {level.title}
          </div>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <div className="font-data text-xl text-primary">{stats.streakDays}</div>
            <div className="text-[12px] text-on-surface-variant">day streak</div>
          </div>
          <div>
            <div className="font-data text-xl text-primary">{level.xp}</div>
            <div className="text-[12px] text-on-surface-variant">total XP</div>
          </div>
        </div>
      </div>
      <div className="mt-4 h-1.5 rounded-full bg-surface-container overflow-hidden">
        <div
          className="bar-grow h-full rounded-full bg-accent"
          style={{ width: `${level.percent}%` }}
        />
      </div>
      <p className="mt-2 text-[13px] text-on-surface-variant">
        {level.isMax
          ? "Top level. Now keep it."
          : `${level.xpForNextLevel} XP to Level ${level.level + 1}`}
      </p>
      <Link
        href="/progress"
        className="mt-3 inline-block text-[13px] font-semibold text-accent"
      >
        See your progress →
      </Link>
    </GlowCard>
  );
}

/** The universal daily challenge — the same topic for everyone, every day. */
function DailyCard({
  challenge,
  state,
}: {
  challenge: DailyChallenge | null;
  state: ChallengeState | null;
}) {
  const used = state?.attempts.length ?? 0;
  const done = state?.complete ?? false;

  return (
    <GlowCard className="card card-glow-light navy-gradient border-none! p-6 md:p-8 text-white h-full">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/15 text-white text-[11px] font-semibold tracking-[0.06em] uppercase px-2.5 py-1">
          Today&apos;s challenge · 1 minute
        </span>
        {challenge?.theme && (
          <span className="text-[13px] font-semibold tracking-wide text-white/70">
            {challenge.theme}
          </span>
        )}
      </div>

      <h2 className="mt-3 font-headline text-3xl md:text-4xl font-semibold">
        {challenge?.title ?? "Felix is picking today's topic…"}
      </h2>
      {challenge?.topic && (
        <p className="mt-2 text-lg leading-7 text-white/85 max-w-[54ch]">
          {challenge.topic}
        </p>
      )}
      {challenge && (
        <p className="mt-1 text-[13px] font-semibold tracking-wide text-white/60">
          Improvise for a minute — three points, your own words.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {Array.from({ length: MAX_DAILY_ATTEMPTS }, (_, i) => {
          const attempt = state?.attempts[i];
          return (
            <span
              key={i}
              className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 font-data text-sm ${
                attempt
                  ? "bg-accent text-white"
                  : i === used
                    ? "border border-white/50 text-white"
                    : "border border-white/20 text-white/40"
              }`}
            >
              {attempt ? attempt.score : i + 1}
            </span>
          );
        })}
        <span className="text-[13px] font-semibold tracking-wide text-white/70">
          {done
            ? `Best today: ${state?.bestScore} — new topic tomorrow`
            : `${MAX_DAILY_ATTEMPTS - used} of ${MAX_DAILY_ATTEMPTS} attempts left`}
        </span>
      </div>

      {!done && (
        <Link
          href="/practice?daily=1"
          className="btn rounded-lg mt-6 inline-block bg-accent text-white font-semibold px-7 py-3.5"
        >
          {used === 0 ? "Start today's challenge" : `Attempt ${used + 1} — beat ${state?.bestScore}`}
        </Link>
      )}
    </GlowCard>
  );
}

const SHORTCUTS = [
  {
    href: "/library",
    title: "Speech library",
    body: "Eight ~30-second speeches, unlimited reps, replaceable when you outgrow one.",
    premium: true,
  },
  {
    href: "/interviews",
    title: "Interviews",
    body: "Jobs, college admissions, scholarships, grad school, and more.",
    premium: true,
  },
  {
    href: "/custom",
    title: "Felix writes it",
    body: "A toast, a pitch, a hard conversation — written for your actual situation.",
    premium: true,
  },
  {
    href: "/own",
    title: "My own material",
    body: "Bring what you've already written and get coached on the delivery.",
    premium: true,
  },
];

function TodayScreen() {
  const { plan, isPremium } = usePlan();
  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDailyChallenge()
      .then((c) => !cancelled && setDaily(c))
      .catch(() => {});
    getChallengeState()
      .then((s) => !cancelled && setChallenge(s))
      .catch(() => {});
    getStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="py-10 md:py-14">
      <Reveal>
        <h1 className="text-title font-headline font-semibold text-primary">
          <WordReveal text="What are you practicing today?" delay={80} step={60} />
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[54ch]">
          A new topic every day, three attempts to beat your own best.
          Improvise for a minute and Felix will tell you how it landed.
        </p>
      </Reveal>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Reveal className="md:col-span-2">
          <DailyCard challenge={daily} state={challenge} />
        </Reveal>
        <Reveal delay={120}>
          <LevelStrip stats={stats} />
        </Reveal>
      </div>

      <section className="mt-12">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            More ways to practice
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {SHORTCUTS.map((s, i) => (
            <Reveal key={s.href} delay={i * 70} className="h-full">
              <GlowCard className="card h-full">
                <Link href={s.href} className="block h-full p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-headline text-xl font-medium text-primary block">
                      {s.title}
                    </span>
                    {s.premium && !isPremium && <PremiumBadge />}
                  </div>
                  <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
                    {s.body}
                  </span>
                </Link>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {plan === "free" && (
        <Reveal>
          <div className="card mt-12 mb-6 p-6 navy-gradient border-none! text-white">
            <h3 className="font-headline text-2xl font-semibold">
              Practice as much as you want
            </h3>
            <p className="mt-2 text-base leading-6 text-white/85 max-w-[56ch]">
              Premium adds the speech library with unlimited reps, interview
              practice by type, coaching on your own material, custom speeches
              written by Felix, camera feedback on posture, gestures, eye
              contact and sway — plus Felix&apos;s deepest, most thorough
              breakdown of every recording.
            </p>
            <Link
              href="/pricing"
              className="btn mt-4 inline-block rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white"
            >
              See Premium
            </Link>
          </div>
        </Reveal>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <TodayScreen />
    </RequireAuth>
  );
}
