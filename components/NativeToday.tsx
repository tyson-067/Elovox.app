"use client";

import Link from "next/link";
import { useIsNative } from "@/lib/native";
import { FelixScene } from "@/components/Biome";
import { type FelixAccessory } from "@/components/FoxLogo";
import { currentOutfit, felixLine, moodFor } from "@/lib/quests";
import {
  MAX_DAILY_ATTEMPTS,
  todayKey,
  type ChallengeState,
  type DailyChallenge,
  type UserStats,
} from "@/lib/daily";
import type { ShopState } from "@/lib/shop";
import type { Session } from "@/lib/types";

/**
 * Today, on the native design system (app/native-theme.css).
 *
 * Order is the argument: the Daily Minute is the one thing this screen wants
 * from you, so it opens the screen as the hero card — topic, one line, three
 * attempt dots, one accent button. Under it the day's numbers as a quiet
 * Whoop-style strip (Felix keeps his corner of it), then the Tape — the last
 * fourteen days as sound, the app's signature — then "More ways to practice"
 * as an inset grouped list (NativeSections).
 *
 * Same data, same helpers, no second source of truth: everything here is
 * derived from the exact props the web hero reads. Renders nothing in a
 * browser; the web keeps its hero, and the dashboard marks it native-hide.
 */
const TAPE_DAYS = 14;

/** One bar of the Tape: the day's best score as amplitude. */
interface TapeDay {
  key: string;
  /** Best overall score that day, 0-100, or null if nothing was recorded. */
  best: number | null;
  isToday: boolean;
}

function tapeDays(sessions: Session[]): TapeDay[] {
  // Bucket by LOCAL day key, newest day rightmost — the same day arithmetic
  // the quests use (todayKey on the session's own clock time).
  const best = new Map<string, number>();
  for (const s of sessions) {
    const key = todayKey(new Date(s.createdAt));
    const score = s.analysis?.overall;
    if (typeof score !== "number") continue;
    const prev = best.get(key);
    if (prev === undefined || score > prev) best.set(key, score);
  }

  const days: TapeDay[] = [];
  const now = new Date();
  for (let i = TAPE_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = todayKey(d);
    days.push({ key, best: best.get(key) ?? null, isToday: i === 0 });
  }
  return days;
}

export function NativeToday({
  stats,
  daily,
  challenge,
  shop,
  sessions,
  sessionsFailed,
}: {
  stats: UserStats | null;
  daily: DailyChallenge | null;
  challenge: ChallengeState | null;
  shop: ShopState | null;
  sessions: Session[];
  /** History could not be read — show no Tape rather than a fake flatline. */
  sessionsFailed: boolean;
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
    <div className="flex flex-col gap-4">
      {/* THE HERO: the Daily Minute. The screen's one saturated element is
          this card's button — everything else on Today is ink and hairlines. */}
      <section className="card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="nv-caption">The Daily Minute</span>
          {daily?.theme && (
            <span className="nv-footnote truncate">{daily.theme}</span>
          )}
        </div>

        <h2 className="nv-title mt-3">
          {daily?.title ?? "Felix is picking today's topic…"}
        </h2>
        {daily?.topic && <p className="nv-subhead mt-2">{daily.topic}</p>}

        {challenge === null ? (
          <p className="nv-footnote mt-3" role="status">
            Checking today&apos;s attempts…
          </p>
        ) : (
          <div
            className="mt-5 flex items-center gap-2"
            aria-label={
              done
                ? "All attempts used"
                : `${MAX_DAILY_ATTEMPTS - used} of ${MAX_DAILY_ATTEMPTS} attempts left`
            }
          >
            {Array.from({ length: MAX_DAILY_ATTEMPTS }, (_, i) => (
              <span
                key={i}
                className="nv-dot"
                data-filled={i < used ? "" : undefined}
                aria-hidden="true"
              />
            ))}
            <span className="nv-footnote font-semibold">
              {done
                ? "done for today"
                : used === 0
                  ? `${MAX_DAILY_ATTEMPTS} attempts`
                  : `best ${challenge.bestScore} · ${MAX_DAILY_ATTEMPTS - used} left`}
            </span>
          </div>
        )}

        {challenge !== null && !done && (
          <Link
            href="/practice?daily=1"
            className="nv-btn nv-btn-primary mt-5"
          >
            {used === 0
              ? "Start your Daily Minute"
              : `Attempt ${used + 1} — beat ${challenge.bestScore}`}
          </Link>
        )}
        {challenge !== null && done && (
          <p className="nv-footnote mt-3">
            New topic at midnight. The rest is rest.
          </p>
        )}
      </section>

      {/* The day's numbers, Whoop-quiet: Felix holds the left edge (he is
          the brand's whole illustration budget on this screen), the level
          bar runs under his line, streak and level sit as tabular stats. */}
      <section className="card p-4" aria-label="Level and streak">
        <div className="flex items-center gap-3.5">
          <Link href="/shop" aria-label="Felix's shop" className="nv-press shrink-0 rounded-2xl">
            <span data-parallax="0.04" className="block">
              <FelixScene
                biome={shop?.equippedBiome}
                mood={mood}
                animate
                accessory={wearing}
                className="h-[56px] w-[56px] rounded-2xl"
              />
            </span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="nv-subhead leading-snug">{line}</p>
            {level && (
              <div className="mt-2">
                <div className="flex items-baseline justify-between">
                  <span className="nv-footnote font-semibold">
                    Level {level.level} · {level.title}
                  </span>
                  <span className="nv-footnote nv-num">
                    {level.isMax
                      ? `${level.xp} XP`
                      : `${level.xpForNextLevel} XP to L${level.level + 1}`}
                  </span>
                </div>
                <div className="nv-meter-track mt-1.5">
                  <div
                    className="nv-meter-fill"
                    style={{ width: `${level.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          {streak > 0 && (
            <div className="shrink-0 pl-1 text-center">
              <div className="nv-stat-value nv-num">{streak}</div>
              <div className="nv-stat-label">day streak</div>
            </div>
          )}
        </div>
      </section>

      {/* THE TAPE: the last fourteen days as a waveform strip — the app's
          signature element, in the exact bar grammar of Felix's chest and
          the app icon. Settled days at their score's amplitude, ghost stubs
          for missed days, today breathing orange while attempts remain.
          Nothing renders when history couldn't be read: a fake flatline
          would say "you did nothing", which is worse than saying nothing. */}
      {!sessionsFailed &&
        (() => {
          const days = tapeDays(sessions);
          const practiced = days.filter((d) => d.best !== null).length;
          return (
            <section
              className="card p-4"
              aria-label={`Last ${TAPE_DAYS} days: ${practiced} practiced, ${streak}-day streak`}
            >
              <div className="voxline" aria-hidden="true" data-parallax="0.05">
                {days.map((d, i) => {
                  const live = d.isToday && !done;
                  const amp = d.best !== null ? d.best / 100 : live ? 0.85 : 0;
                  return (
                    <span
                      key={d.key}
                      className="voxline-bar"
                      data-empty={d.best === null && !live ? "" : undefined}
                      data-live={live ? "" : undefined}
                      // --i drives the arrival stagger: bars rise left to
                      // right like a take scrubbing onto the reel.
                      style={{ "--amp": amp, "--i": i } as React.CSSProperties}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="nv-footnote nv-num">{TAPE_DAYS}D</span>
                <span className="nv-footnote font-semibold">
                  {streak > 0
                    ? `${streak}-day streak`
                    : practiced > 0
                      ? `${practiced} of ${TAPE_DAYS} days`
                      : "your first rep starts the tape"}
                </span>
              </div>
            </section>
          );
        })()}
    </div>
  );
}
