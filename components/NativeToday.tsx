"use client";

import Link from "next/link";
import { useIsNative } from "@/lib/native";
import { FelixScene } from "@/components/Biome";
import { type FelixAccessory } from "@/components/FoxLogo";
import { currentOutfit, felixLine, moodFor } from "@/lib/quests";
import {
  MAX_DAILY_ATTEMPTS,
  type ChallengeState,
  type DailyChallenge,
  type UserStats,
} from "@/lib/daily";
import type { ShopState } from "@/lib/shop";

/**
 * Today's above-the-fold, rebuilt at app scale.
 *
 * The web dashboard opens with a display-size headline, a hero card the
 * height of the viewport and a three-column grid — a landing page's rhythm,
 * and the single loudest "this is a website" signal in the shell. This is
 * the same information at iOS density: one compact identity row (Felix, his
 * line, the level bar), a streak/attempts strip, and the Daily Minute as a
 * proper full-width card whose button sits in the thumb zone of the scroll.
 *
 * Same data, same helpers, no second source of truth: everything here is
 * derived from the exact props the web hero reads. Renders nothing in a
 * browser; the web keeps its hero, and the dashboard marks it native-hide.
 */
export function NativeToday({
  stats,
  daily,
  challenge,
  shop,
}: {
  stats: UserStats | null;
  daily: DailyChallenge | null;
  challenge: ChallengeState | null;
  shop: ShopState | null;
}) {
  const native = useIsNative();
  if (!native) return null;

  const mood = moodFor({ stats, challenge });
  const line = felixLine({ stats, challenge });
  const level = stats?.level;
  const outfit = currentOutfit(level?.level ?? 1);
  const wearing =
    (shop?.equippedAccessory as FelixAccessory | null) ?? outfit?.id;

  const used = challenge?.attempts.length ?? 0;
  const done = challenge?.complete ?? false;
  const streak = stats?.streakDays ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Felix, in one row: the mascot at avatar size, his line as the
          greeting, the level bar as a single quiet strip underneath. */}
      <section className="card den-gradient border-none! overflow-hidden p-4">
        <div className="flex items-center gap-3.5">
          <Link
            href="/shop"
            aria-label="Felix's shop"
            className="native-press shrink-0 rounded-2xl"
          >
            <FelixScene
              biome={shop?.equippedBiome}
              mood={mood}
              animate
              accessory={wearing}
              className="h-[76px] w-[76px] rounded-2xl"
            />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-oxford/55">
              Felix says
            </p>
            <p className="mt-0.5 font-headline text-[17px] font-semibold leading-[1.32] text-oxford">
              {line}
            </p>
          </div>
        </div>

        {level && (
          <div className="mt-3.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-oxford">
                Level {level.level} · {level.title}
              </span>
              <span className="font-data text-[11px] text-oxford/60">
                {level.isMax
                  ? `${level.xp} XP`
                  : `${level.xpForNextLevel} XP to L${level.level + 1}`}
              </span>
            </div>
            <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-oxford/15">
              <div
                className="h-full rounded-full bg-oxford"
                style={{ width: `${level.percent}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* The day, in numbers: streak and today's attempts as stat tiles, the
          register Fitness uses. Two, not a dashboard. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
            Streak
          </p>
          <p className="mt-1 font-data text-[28px] leading-none text-on-surface">
            {streak}
            <span className="ml-1.5 text-[15px]" aria-hidden="true">
              {streak > 0 ? "🔥" : "·"}
            </span>
          </p>
          <p className="mt-1 text-[12px] text-on-surface-variant">
            {streak === 1 ? "day" : "days"} in a row
          </p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
            Today
          </p>
          <p className="mt-1 font-data text-[28px] leading-none text-on-surface">
            {done && challenge?.bestScore != null ? challenge.bestScore : used}
            <span className="ml-1 text-[15px] text-on-surface-variant">
              {done && challenge?.bestScore != null ? "/100" : `/${MAX_DAILY_ATTEMPTS}`}
            </span>
          </p>
          <p className="mt-1 text-[12px] text-on-surface-variant">
            {done ? "best score today" : "attempts used"}
          </p>
        </div>
      </div>

      {/* The Daily Minute. The one thing to do today, so it gets the dark
          brand surface and the screen's only full-width call to action. */}
      <section className="card dusk-gradient border-none! overflow-hidden p-5 text-white">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]">
            The Daily Minute
          </span>
          {daily?.theme && (
            <span className="truncate text-[13px] font-semibold text-white/65">
              {daily.theme}
            </span>
          )}
        </div>

        <h2 className="mt-3 font-headline text-[22px] font-semibold leading-[1.25]">
          {daily?.title ?? "Felix is picking today's topic…"}
        </h2>
        {daily?.topic && (
          <p className="mt-1.5 text-[15px] leading-[1.45] text-white/80">
            {daily.topic}
          </p>
        )}

        {challenge === null ? (
          <p className="mt-4 text-[13px] font-semibold text-white/60" role="status">
            Checking today&apos;s attempts…
          </p>
        ) : (
          <div className="mt-4 flex items-center gap-2.5">
            {Array.from({ length: MAX_DAILY_ATTEMPTS }, (_, i) => {
              const attempt = challenge.attempts[i];
              return (
                <span
                  key={i}
                  className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2.5 font-data text-[13px] ${
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
            <span className="text-[13px] font-semibold text-white/65">
              {done
                ? "done for today"
                : `${MAX_DAILY_ATTEMPTS - used} left`}
            </span>
          </div>
        )}

        {challenge !== null && !done && (
          <Link
            href="/practice?daily=1"
            className="btn mt-4 bg-accent-strong text-white"
          >
            {used === 0
              ? "Start your Daily Minute"
              : `Attempt ${used + 1} — beat ${challenge.bestScore}`}
          </Link>
        )}
        {challenge !== null && done && (
          <p className="mt-3 text-[13px] text-white/65">
            New topic at midnight. The rest is rest.
          </p>
        )}
      </section>
    </div>
  );
}
