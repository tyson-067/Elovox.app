"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { NativeSections } from "@/components/NativeSections";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { InfoTip } from "@/components/InfoTip";
import { type FelixAccessory } from "@/components/FoxLogo";
import { FelixScene } from "@/components/Biome";
import { fetchShopState, type ShopState } from "@/lib/shop";
import { usePlan } from "@/lib/plan";
import { useStreakReward } from "@/lib/streakClaim";
import { useRedeemReferral } from "@/lib/invite";
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
  shop,
}: {
  stats: UserStats | null;
  challenge: ChallengeState | null;
  shop: ShopState | null;
}) {
  const mood = moodFor({ stats, challenge });
  const line = felixLine({ stats, challenge });
  const level = stats?.level;
  // Whatever the Den says he's unlocked, he is actually wearing.
  const outfit = currentOutfit(level?.level ?? 1);
  // A bought accessory beats the level outfit, and taking it off in the shop
  // (equippedAccessory → null) drops back to the level one rather than to a
  // bare fox — those outfits were earned and are never taken away.
  const wearing = (shop?.equippedAccessory as FelixAccessory | null) ?? outfit?.id;

  return (
    <div className="card den-gradient border-none! overflow-hidden p-6 md:p-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-end">
        <Link
          href="/shop"
          aria-label="Felix's shop"
          className="shrink-0 rounded-2xl transition-transform hover:scale-[1.03]"
        >
          <FelixScene
            biome={shop?.equippedBiome}
            mood={mood}
            animate
            accessory={wearing}
            className="h-32 w-32 rounded-2xl shadow-[0_10px_20px_rgba(11,8,41,0.22)] md:h-40 md:w-40"
          />
        </Link>

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
      <InfoTip
        label="What is the Daily Minute?"
        tone="dark"
        className="absolute right-4 top-4"
      >
        One topic a day, the same one for everybody. Speak for a minute with no
        script. You get three tries, and it&apos;s free on every plan.
      </InfoTip>

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

      {/* Attempt pips, counter and CTA all render only once `state` has
          arrived. While it was in flight they asserted a specific, usually
          WRONG answer — three empty pips, "3 of 3 attempts left" and "Start
          your Daily Minute" — to someone who had already used all three
          today, who then tapped through to /practice only to be turned away.
          The title above already had a loading state; these didn't. */}
      {state === null ? (
        <p className="mt-5 text-[13px] font-semibold tracking-wide text-white/60" role="status">
          Checking today&apos;s attempts…
        </p>
      ) : (
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {Array.from({ length: MAX_DAILY_ATTEMPTS }, (_, i) => {
          const attempt = state?.attempts[i];
          return (
            <span
              key={i}
              className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 font-data text-sm ${
                attempt
                  ? "bg-accent-strong text-white"
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
      )}

      {state !== null && !done && (
        <Link
          href="/practice?daily=1"
          className="btn mt-6 inline-block rounded-lg bg-accent-strong px-7 py-3.5 font-semibold text-white"
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
              ? "bg-accent-strong text-white"
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

      <p className="mt-2 text-[13px] font-semibold text-accent-strong">
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
  shop,
  sessionsFailed,
}: {
  stats: UserStats | null;
  sessions: Session[];
  shop: ShopState | null;
  /** History couldn't be read — badges are unknown, not un-earned. */
  sessionsFailed: boolean;
}) {
  const badges = badgesFor({ stats, sessions });
  const earned = badges.filter((b) => b.earned).length;
  const level = stats?.level.level ?? 1;
  const worn = currentOutfit(level);
  const next = nextOutfit(level);
  const bought = shop?.equippedAccessory as FelixAccessory | null;

  return (
    <div className="card-warm h-full p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-headline text-xl font-semibold text-primary">
          The Fox Den
        </h2>
        <span className="flex items-center gap-2">
          <span className="font-data text-[13px] text-on-surface-variant">
            {sessionsFailed ? "badges unavailable" : `${earned} / ${badges.length} badges`}
          </span>
          <InfoTip label="What is the Fox Den?">
            Everything you&apos;ve earned. Badges unlock as you practice.
            Felix&apos;s outfits come with levels, and he wears whatever you
            unlock last.
          </InfoTip>
        </span>
      </div>

      {/* Each badge says how it's earned on hover and on keyboard focus. It's
          a plain CSS tooltip rather than an <InfoTip>: there are six of these
          in a tight grid, and six "?" buttons next to six emoji is more
          chrome than content. `tabIndex` and `focus-within` are what keep it
          reachable without a mouse — a hover-only hint is invisible on a
          phone and to anyone tabbing. */}
      {sessionsFailed && (
        <p className="mt-4 text-[13px] text-on-surface-variant" role="status">
          Couldn&apos;t check your badges just now. Nothing has been lost —
          reload to try again.
        </p>
      )}
      <ul className="mt-4 grid grid-cols-3 gap-2.5" aria-hidden={sessionsFailed}>
        {badges.map((b) => (
          <li key={b.id} className="group relative">
            {/* aria-describedby ties the tooltip to its badge: these are six
                focus stops per dashboard, and without the association the
                text that explains each one was never announced. The earned
                state is spelled out too, since "earned" was otherwise carried
                only by the dimming — colour as the sole signal. */}
            <div
              tabIndex={0}
              aria-describedby={`badge-tip-${b.id}`}
              className={`rounded-lg bg-white/70 px-2 py-3 text-center outline-offset-2 ${
                b.earned || sessionsFailed ? "" : "locked-reward"
              }`}
            >
              <span className="block text-xl leading-none" aria-hidden="true">
                {b.emoji}
              </span>
              <span className="mt-1.5 block text-[11px] font-semibold leading-tight text-primary">
                {b.name}
              </span>
              <span className="sr-only">{b.earned ? " — earned" : " — not earned yet"}</span>
            </div>
            <span
              id={`badge-tip-${b.id}`}
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-[min(11rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg bg-oxford px-2.5 py-1.5 text-[11px] leading-4 text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {b.earned ? `Earned: ${b.hint.toLowerCase()}` : b.hint}
            </span>
          </li>
        ))}
      </ul>

      {/* Felix in whatever biome he's standing in, straight through to the
          shop. The Den used to talk about his outfits without ever showing
          him, so the one place that listed what he owned was the one place
          you couldn't see it. */}
      <Link
        href="/shop"
        className="mt-4 flex items-center gap-3 rounded-xl border border-shrimp/70 p-2 transition-colors hover:border-accent/50"
      >
        <FelixScene
          biome={shop?.equippedBiome}
          accessory={bought ?? worn?.id}
          className="h-16 w-16 shrink-0 rounded-lg"
        />
        <span className="min-w-0 text-[13px] leading-5 text-on-surface-variant">
          {bought ? (
            <>Felix is out in his new gear.</>
          ) : worn ? (
            <>
              Felix is wearing <span aria-hidden="true">{worn.emoji}</span>{" "}
              <span className="font-semibold text-primary">{worn.name}</span>.
            </>
          ) : (
            <>Felix has nothing to wear yet.</>
          )}{" "}
          <span className="font-semibold text-accent-strong">Visit the shop →</span>
        </span>
      </Link>

      {next && (
        <p className="mt-3 text-[13px] leading-5 text-on-surface-variant">
          <span aria-hidden="true">{next.emoji}</span>{" "}
          <span className="font-semibold text-primary">{next.name}</span> at{" "}
          {/* The level is the link: it's a number about your progress, and
              /progress is where that number is explained. */}
          <Link href="/progress" className="font-semibold text-accent-strong underline">
            Level {next.level}
          </Link>
          .
        </p>
      )}

      <Link
        href="/progress"
        className="mt-3 inline-block text-[13px] font-semibold text-accent-strong"
      >
        See the whole run →
      </Link>
    </div>
  );
}

function TodayScreen() {
  const { plan } = usePlan();
  // Where an invite link is cashed in: signup lands here, so this runs before
  // the new account has recorded anything, which is what the server requires.
  useRedeemReferral();
  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  // True when the history read failed, so the Fox Den can say so instead of
  // rendering an empty history as "you've earned nothing".
  const [sessionsFailed, setSessionsFailed] = useState(false);
  // What Felix is wearing and where he's standing. Read-only here; the shop
  // is the only screen that changes it.
  const [shop, setShop] = useState<ShopState | null>(null);
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
        .catch(() => {
          // The stamp above was set synchronously to dedupe the focus +
          // visibilitychange pair that fires on wake. If the rollover fetch
          // then fails (e.g. waking offline across midnight), clear it so the
          // next focus/visibility event retries instead of pinning yesterday's
          // topic under today's fresh (empty) attempt counters until remount.
          if (!cancelled && loadedDayRef.current === key) loadedDayRef.current = "";
        });
      getChallengeState()
        .then((s) => !cancelled && setChallenge(s))
        .catch(() => {});
      getStats()
        .then((s) => !cancelled && setStats(s))
        .catch(() => {});
      // Feeds the quests and the badges. A failure is tracked rather than
      // swallowed: leaving `sessions` at [] made badgesFor report "0 / 6
      // badges" with First Words, No-Um Ninja and the rest greyed out for
      // someone who had already earned them, which reads as having them taken
      // away. Everything else on this page still works, so the Den just says
      // it couldn't check.
      listSessions()
        .then((s) => {
          if (cancelled) return;
          setSessions(s);
          setSessionsFailed(false);
        })
        .catch(() => !cancelled && setSessionsFailed(true));
      // Same treatment: if this fails Felix just appears in the den with his
      // level outfit, which is what every account looked like before the shop.
      fetchShopState()
        .then((s) => !cancelled && setShop(s))
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

  // Only fires once the streak is long enough to be worth asking about; the
  // server decides whether the week is actually owed.
  const reward = useStreakReward(stats?.streakDays ?? null);

  return (
    <div className="py-10 md:py-14">
      <Reveal>
        <h1 className="text-title font-headline font-semibold text-primary">
          <WordReveal text="What are you practicing today?" delay={80} step={60} />
        </h1>
      </Reveal>

      {reward?.granted && (
        <Reveal className="mt-8">
          <div className="card navy-gradient border-none! p-6 text-white">
            <h2 className="font-headline text-2xl font-semibold">
              Three weeks straight. Have a week on us.
            </h2>
            <p className="mt-2 max-w-[56ch] text-base leading-6 text-white/85">
              You&apos;ve practiced {reward.streakDays} days in a row, so
              Premium is open until{" "}
              {reward.premiumUntil
                ? new Date(reward.premiumUntil).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                  })
                : "next week"}
              . The speech library, your own material, interview practice,
              social skills and camera coaching are all unlocked — nothing to
              cancel when it ends.
            </p>
            <Link
              href="/library"
              className="btn mt-5 inline-block rounded-lg bg-accent-strong px-7 py-3.5 font-semibold text-white"
            >
              Open the speech library
            </Link>
          </div>
        </Reveal>
      )}

      <Reveal className="mt-8">
        <FelixHero stats={stats} challenge={challenge} shop={shop} />
      </Reveal>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Reveal delay={80} className="lg:col-span-2">
          <DailyCard challenge={daily} state={challenge} />
        </Reveal>
        <Reveal delay={160}>
          <DenWidget
            stats={stats}
            sessions={sessions}
            shop={shop}
            sessionsFailed={sessionsFailed}
          />
        </Reveal>
      </div>

      <section className="mt-12">
        <Reveal>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-on-surface-variant">
              Today&apos;s fox quests
              <span className="grow-line" aria-hidden="true" />
            </h2>
            <span className="flex items-center gap-2">
              <span className="font-data text-[13px] text-on-surface-variant">
                {questsDone} of {quests.length} cleared
              </span>
              <InfoTip label="What are fox quests?">
                Three small jobs, picked fresh each day. Clear one and the XP
                goes straight to your level. They reset at midnight.
              </InfoTip>
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

      {/* The sections that lost their tab when the sub-nav became a dock.
          Native only. */}
      <NativeSections />

      {plan === "free" && (
        <Reveal>
          <div className="card navy-gradient border-none! mt-12 mb-6 p-6 text-white">
            <h3 className="font-headline text-2xl font-semibold">
              Practice as much as you want
            </h3>
            <p className="mt-2 max-w-[56ch] text-base leading-6 text-white/85">
              Premium adds the speech library with no three-a-day limit,
              interview practice by type, everyday social skills, coaching on
              your own material, custom speeches written by Felix, camera
              feedback on posture, gestures, eye contact and sway, plus Felix&apos;s
              deepest, most thorough breakdown of every recording.
            </p>
            <Link
              href="/pricing"
              className="btn mt-4 inline-block rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-semibold text-white web-only"
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
