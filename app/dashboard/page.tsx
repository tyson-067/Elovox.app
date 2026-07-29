"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { Felix } from "@/components/FoxLogo";
import { usePlan } from "@/lib/plan";
import { listSessions } from "@/lib/store";
import type { Session } from "@/lib/types";
import {
  badgesFor,
  currentOutfit,
  dailyQuests,
  felixLine,
  moodFor,
  nextOutfit,
  questsComplete,
  sessionsFromDay,
  type Quest,
} from "@/lib/quests";
import {
  fetchDailyChallenge,
  getChallengeState,
  getStats,
  todayKey,
  MAX_DAILY_ATTEMPTS,
  type ChallengeState,
  type DailyChallenge,
  type UserStats,
} from "@/lib/daily";

// "Today", the home of the app.
//
// Two things this screen is NOT allowed to become:
//
//   1. A second copy of the sub-nav. It used to end in a "More ways to
//      practice" grid listing the speech library, interviews, Felix writes
//      it and my material, which are the exact four tabs sitting in the
//      header two centimetres above it. The same four names twice on one
//      screen is what made this page feel loud, and it taught people the
//      header wasn't worth reading.
//   2. A wall. Everything below is on the day: what Felix makes of where
//      you are, the Daily Minute itself, three quests, and the Den. The
//      features live on their own pages and are reached from the tabs.
//
// Everything gamified here is derived, never stored. See lib/quests.ts.

/** A flame that burns harder the longer the streak. */
function StreakFlame({ days }: { days: number }) {
  // Faster breath as the streak grows, floored so it never becomes a
  // strobe: 2.6s at one day down to 1.1s from a fortnight on.
  const speed = Math.max(1.1, 2.6 - days * 0.1);
  const cold = days === 0;
  return (
    <span
      className={cold ? "opacity-35" : "flame inline-block"}
      style={cold ? undefined : ({ "--flame-speed": `${speed}s` } as React.CSSProperties)}
      aria-hidden="true"
    >
      🔥
    </span>
  );
}

/**
 * The mascot hero: Felix, a line from him about where you actually are, and
 * the level bar and streak he's reacting to. One card rather than three, so
 * the numbers read as his commentary rather than as a separate dashboard.
 */
function FelixHero({
  stats,
  challenge,
}: {
  stats: UserStats | null;
  challenge: ChallengeState | null;
}) {
  const mood = moodFor({ stats, challenge });
  const line = felixLine({ stats, challenge });
  const level = stats?.level;
  // Whatever the Den says he's unlocked, he is actually wearing.
  const outfit = currentOutfit(level?.level ?? 1);

  return (
    <div className="card den-gradient border-none! overflow-hidden p-6 md:p-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-end">
        <Felix
          mood={mood}
          animate
          accessory={outfit?.id}
          className="h-32 w-32 shrink-0 drop-shadow-[0_10px_20px_rgba(11,8,41,0.22)] md:h-40 md:w-40"
        />

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-oxford/60">
            Felix says
          </span>
          <p className="mt-1 font-headline text-xl leading-7 text-oxford md:text-2xl md:leading-8">
            {line}
          </p>

          {level && (
            <div className="mt-5">
              <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 sm:justify-start">
                <span className="font-headline text-lg font-semibold text-oxford">
                  Level {level.level}
                </span>
                <span className="text-lg text-oxford/75">{level.title}</span>
                <span className="font-data text-[13px] text-oxford/60">
                  {level.xp} XP
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-oxford/15">
                <div
                  className="xp-bar-fill bar-grow h-full rounded-full bg-oxford"
                  style={{ width: `${level.percent}%` }}
                />
              </div>
              <p className="mt-1.5 text-[13px] text-oxford/70">
                {level.isMax
                  ? "Top of the ladder. Now hold it."
                  : `${level.xpForNextLevel} XP to Level ${level.level + 1}`}
              </p>
            </div>
          )}
        </div>

        {/* The streak, given its own column so it reads as a standing total
            rather than another stat in the level row. */}
        <div className="shrink-0 rounded-xl bg-oxford/10 px-5 py-4 text-center">
          <div className="text-3xl leading-none">
            <StreakFlame days={stats?.streakDays ?? 0} />
          </div>
          <div className="mt-1 font-data text-2xl text-oxford">
            {stats?.streakDays ?? 0}
          </div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-oxford/60">
            day streak
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Daily Minute, the same topic for everyone, every day. */
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
    <GlowCard className="card card-glow-light dusk-gradient border-none! h-full p-6 text-white md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-white">
          The Daily Minute · 60 seconds
        </span>
        {challenge?.theme && (
          <span className="text-[13px] font-semibold tracking-wide text-white/70">
            {challenge.theme}
          </span>
        )}
      </div>

      <h2 className="mt-3 font-headline text-3xl font-semibold md:text-4xl">
        {challenge?.title ?? "Felix is picking today's topic…"}
      </h2>
      {challenge?.topic && (
        <p className="mt-2 max-w-[54ch] text-lg leading-7 text-white/85">
          {challenge.topic}
        </p>
      )}
      {challenge && (
        <p className="mt-1 text-[13px] font-semibold tracking-wide text-white/60">
          Improvise for a minute, three points, your own words.
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
            ? `Best today: ${state?.bestScore}, new topic tomorrow`
            : `${MAX_DAILY_ATTEMPTS - used} of ${MAX_DAILY_ATTEMPTS} attempts left`}
        </span>
      </div>

      {!done && (
        <Link
          href="/practice?daily=1"
          className="btn mt-6 inline-block rounded-lg bg-accent px-7 py-3.5 font-semibold text-white"
        >
          {used === 0
            ? "Start your Daily Minute"
            : `Attempt ${used + 1}, beat ${state?.bestScore}`}
        </Link>
      )}
    </GlowCard>
  );
}

function QuestCard({ quest, index }: { quest: Quest; index: number }) {
  const percent = Math.round((quest.progress / quest.target) * 100);
  return (
    <GlowCard
      className={`card h-full p-5 ${quest.done ? "quest-done border-accent/40!" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-headline text-lg font-semibold text-primary">
          {quest.title}
        </span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 font-data text-[11px] font-semibold ${
            quest.done
              ? "bg-accent text-white"
              : "bg-surface-container text-on-surface-variant"
          }`}
        >
          +{quest.xp} XP
        </span>
      </div>

      <p className="mt-1.5 text-[15px] leading-6 text-on-surface-variant">
        {quest.detail}
      </p>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-container">
        <div
          className="bar-grow h-full rounded-full bg-gradient-to-r from-orange to-accent"
          style={{ width: `${percent}%`, animationDelay: `${index * 120}ms` }}
        />
      </div>

      <p className="mt-2 text-[13px] font-semibold text-accent">
        {quest.done ? (
          <span className="text-primary/70">✓ {quest.doneLabel}</span>
        ) : (
          <Link href={quest.href}>Take it on →</Link>
        )}
      </p>
    </GlowCard>
  );
}

/**
 * The Fox Den: what you've earned and what Felix is still saving up for.
 * Badges are real and unlock the moment the underlying rep happens; the
 * wardrobe is level-gated, which is the app's only currency.
 */
function DenWidget({
  stats,
  sessions,
}: {
  stats: UserStats | null;
  sessions: Session[];
}) {
  const badges = badgesFor({ stats, sessions });
  const earned = badges.filter((b) => b.earned).length;
  const level = stats?.level.level ?? 1;
  const worn = currentOutfit(level);
  const next = nextOutfit(level);

  return (
    <div className="card-warm h-full p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-headline text-xl font-semibold text-primary">
          The Fox Den
        </h2>
        <span className="font-data text-[13px] text-on-surface-variant">
          {earned} / {badges.length} badges
        </span>
      </div>

      <ul className="mt-4 grid grid-cols-3 gap-2.5">
        {badges.map((b) => (
          <li
            key={b.id}
            title={b.earned ? b.name : `${b.name}: ${b.hint}`}
            className={`rounded-lg bg-white/70 px-2 py-3 text-center ${
              b.earned ? "" : "locked-reward"
            }`}
          >
            <span className="block text-xl leading-none" aria-hidden="true">
              {b.emoji}
            </span>
            <span className="mt-1.5 block text-[11px] font-semibold leading-tight text-primary">
              {b.name}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-shrimp/70 pt-3 text-[13px] leading-5 text-on-surface-variant">
        <p>
          {worn ? (
            <>
              Felix is wearing{" "}
              <span aria-hidden="true">{worn.emoji}</span>{" "}
              <span className="font-semibold text-primary">{worn.name}</span>.
            </>
          ) : (
            <>Felix has nothing to wear yet. Level 2 gets him a bow tie.</>
          )}
        </p>
        {next && (
          <p className="mt-1">
            <span aria-hidden="true">{next.emoji}</span>{" "}
            <span className="font-semibold text-primary">{next.name}</span> at
            Level {next.level}.
          </p>
        )}
      </div>

      <Link
        href="/progress"
        className="mt-3 inline-block text-[13px] font-semibold text-accent"
      >
        See the whole run →
      </Link>
    </div>
  );
}

function TodayScreen() {
  const { plan } = usePlan();
  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  // The local day everything on screen belongs to. Held as state as well as a
  // ref: the ref is what the midnight/focus checks compare against without
  // re-running their effect, and the state is what makes the quests recompute
  // when the day turns. Filtering on the clock instead meant that if the
  // session refetch failed at midnight, yesterday's reps stayed inside
  // "today" and a cleared quest carried over into the new day.
  const [day, setDay] = useState<string>(() => todayKey());
  const loadedDayRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    let midnightTimer: ReturnType<typeof setTimeout>;

    const load = () => {
      const key = todayKey();
      loadedDayRef.current = key;
      setDay(key);
      fetchDailyChallenge()
        .then((c) => !cancelled && setDaily(c))
        .catch(() => {});
      getChallengeState()
        .then((s) => !cancelled && setChallenge(s))
        .catch(() => {});
      getStats()
        .then((s) => !cancelled && setStats(s))
        .catch(() => {});
      // Feeds the quests and the badges. A failure just means an empty
      // history, which reads as "nothing earned yet" rather than an error:
      // none of this is worth interrupting someone's practice over.
      listSessions()
        .then((s) => !cancelled && setSessions(s))
        .catch(() => {});
    };

    // Roll over exactly at the user's local midnight. Everything keys off
    // todayKey() (a local-timezone date), so a fresh load past midnight pulls
    // the next day's Daily Minute and a clean attempt count.
    const scheduleMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        5 // a few seconds past midnight, to be safely on the new day
      );
      midnightTimer = setTimeout(() => {
        if (cancelled) return;
        load();
        scheduleMidnight();
      }, nextMidnight.getTime() - now.getTime());
    };

    // Also catch the case where the tab was asleep across midnight: when it
    // comes back and the local day has changed, refresh immediately.
    const refreshIfNewDay = () => {
      if (todayKey() !== loadedDayRef.current) load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshIfNewDay();
    };

    load();
    scheduleMidnight();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshIfNewDay);
    return () => {
      cancelled = true;
      clearTimeout(midnightTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refreshIfNewDay);
    };
  }, []);

  const today = useMemo(() => sessionsFromDay(sessions, day), [sessions, day]);
  const quests = useMemo(
    () => dailyQuests({ challenge, today }),
    [challenge, today]
  );
  const questsDone = questsComplete(quests);

  return (
    <div className="py-10 md:py-14">
      <Reveal>
        <h1 className="text-title font-headline font-semibold text-primary">
          <WordReveal text="What are you practicing today?" delay={80} step={60} />
        </h1>
      </Reveal>

      <Reveal className="mt-8">
        <FelixHero stats={stats} challenge={challenge} />
      </Reveal>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Reveal delay={80} className="lg:col-span-2">
          <DailyCard challenge={daily} state={challenge} />
        </Reveal>
        <Reveal delay={160}>
          <DenWidget stats={stats} sessions={sessions} />
        </Reveal>
      </div>

      <section className="mt-12">
        <Reveal>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant">
              Today&apos;s fox quests
              <span className="grow-line" aria-hidden="true" />
            </h2>
            <span className="font-data text-[13px] text-on-surface-variant">
              {questsDone} of {quests.length} cleared
            </span>
          </div>
        </Reveal>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
          {quests.map((q, i) => (
            <Reveal key={q.id} delay={i * 70} className="h-full">
              <QuestCard quest={q} index={i} />
            </Reveal>
          ))}
        </div>
      </section>

      {plan === "free" && (
        <Reveal>
          <div className="card navy-gradient border-none! mt-12 mb-6 p-6 text-white">
            <h3 className="font-headline text-2xl font-semibold">
              Practice as much as you want
            </h3>
            <p className="mt-2 max-w-[56ch] text-base leading-6 text-white/85">
              Premium adds the speech library with unlimited reps, interview
              practice by type, coaching on your own material, custom speeches
              written by Felix, camera feedback on posture, gestures, eye
              contact and sway, plus Felix&apos;s deepest, most thorough
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
