"use client";

import { Fragment, useEffect, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useIsNative } from "@/lib/native";
import { Felix, type FelixAccessory } from "@/components/FoxLogo";
import { FelixScene } from "@/components/Biome";
import {
  bandForScore,
  CoinBadge,
  FlameGlyph,
  flameTier,
} from "@/components/native/felix";
import { currentOutfit, moodFor, nextOutfit } from "@/lib/quests";
import { LEVELS } from "@/lib/levels";
import {
  MAX_DAILY_ATTEMPTS,
  todayKey,
  type ChallengeState,
  type DailyChallenge,
  type UserStats,
} from "@/lib/daily";
import { usePlan } from "@/lib/plan";
import { publishWidgetState } from "@/lib/nativeExtras";
import type { ShopState } from "@/lib/shop";
import type { Session } from "@/lib/types";

/**
 * THE LADDER — home, rebuilt around a spine.
 *
 * The old Today was four cards competing for the same attention: a hero, a
 * game card, the Tape, a section list. Every one of them was doing its job and
 * the screen still read as a dashboard, because a dashboard is what four
 * equal cards ARE.
 *
 * A ladder has an argument instead. A day is a rung. A rung is lit or it
 * isn't. Yesterday sits behind you at half contrast, today is enormous and
 * orange in the middle of the screen, and the next thing you unlock waits
 * further up. Felix stands on the rung you're meant to climb. There is only
 * ever ONE thing at full contrast, which is what the four cards could never
 * agree on.
 *
 * Data-wise nothing new is invented: every rung is a real session, the topic
 * is the real Daily Minute, the reward node is `nextOutfit()` and the XP bar
 * is `stats.level`. Same props the old Today took, so the page didn't move.
 * Renders nothing in a browser.
 */

/** How many settled days sit under today before the climb runs off screen. */
const PAST_RUNGS = 2;

/**
 * Where a score sits: mint is good, ember is working, rough is quiet ink.
 *
 * `bandForScore` and nothing else. This screen briefly had its own 80/60
 * thresholds, which meant an 82 was mint on the climb and ember on its own
 * report — the exact disagreement the shared mapping exists to prevent.
 */
const bandOf = bandForScore;

interface PastRung {
  key: string;
  score: number;
  title: string;
  weekday: string;
  sessionId: string;
}

/**
 * The last seven days, Sunday first, each holding the best score recorded on
 * it. The climb shows you the last two days in detail; this shows the shape
 * of the week, which is the thing a streak is actually made of.
 */
function weekStrip(
  sessions: Session[],
  todayBest: number | null
): { letter: string; key: string; score: number | null; isToday: boolean }[] {
  const best = new Map<string, number>();
  for (const s of sessions) {
    const score = s.analysis?.overall;
    if (typeof score !== "number") continue;
    const k = todayKey(new Date(s.createdAt));
    best.set(k, Math.max(best.get(k) ?? 0, score));
  }
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay()); // back to Sunday
  const today = todayKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = todayKey(d);
    const isToday = key === today;
    return {
      key,
      letter: ["S", "M", "T", "W", "T", "F", "S"][i],
      score: isToday ? todayBest : (best.get(key) ?? null),
      isToday,
    };
  });
}

/**
 * The last few days that actually have a score, newest first, today excluded.
 * Best score wins the day, the same rule the Tape used — a day is as good as
 * your best take on it.
 */
function pastRungs(sessions: Session[], today: string): PastRung[] {
  const byDay = new Map<string, PastRung>();
  for (const s of sessions) {
    const score = s.analysis?.overall;
    if (typeof score !== "number") continue;
    const when = new Date(s.createdAt);
    const key = todayKey(when);
    if (key === today) continue;
    const prev = byDay.get(key);
    if (prev && prev.score >= score) continue;
    byDay.set(key, {
      key,
      score,
      title: s.speechTitle ?? s.prompt,
      weekday: when.toLocaleDateString(undefined, { weekday: "short" }),
      sessionId: s.id,
    });
  }
  return [...byDay.values()]
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .slice(0, PAST_RUNGS)
    .reverse(); // oldest first: the climb reads bottom-up on screen order
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function MicGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={2} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

/** The score ring Felix stands inside. r=92 in a 196 box, so C = 578. */
const RING_C = 2 * Math.PI * 92;

function ScoreRing({
  percent,
  band,
  children,
}: {
  /** 0-100, or null for "nothing to draw yet". */
  percent: number | null;
  band: ReturnType<typeof bandForScore>;
  children: ReactNode;
}) {
  return (
    <div className="nv-ring" data-band={band}>
      {percent === null && <span className="nv-ring-halo" aria-hidden="true" />}
      <svg viewBox="0 0 196 196" fill="none" aria-hidden="true">
        <circle className="nv-dial-track" cx="98" cy="98" r="92" strokeWidth="5" />
        {percent !== null && (
          <circle
            className="nv-ring-arc"
            cx="98"
            cy="98"
            r="92"
            stroke="var(--band, var(--nv-accent-500))"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - Math.max(0, Math.min(100, percent)) / 100)}
            transform="rotate(-90 98 98)"
          />
        )}
      </svg>
      <span className="nv-ring-spot" aria-hidden="true" />
      {children}
    </div>
  );
}

/** Three plinths, tallest in the middle — the board's own mark, echoing the
 *  podium the screen it opens is built around. */
function PodiumGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="13" width="5.6" height="8" rx="1.2" />
      <rect x="9.2" y="7.5" width="5.6" height="13.5" rx="1.2" />
      <rect x="15.9" y="15.5" width="5.6" height="5.5" rx="1.2" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/* --- Go deeper -------------------------------------------------------------
   The Premium modules used to be a grouped list under Today, which put four
   more rows of navigation on the one screen that is supposed to say a single
   thing. They live at the FOOT of the climb now: a rail you reach after the
   day is dealt with, not a menu you scroll past on the way to it.

   Four hues went in here once; three go out. `sky` and `lilac` both resolve
   to violet in this pass, so Interviews and My material read as one family —
   which is right, because they are the two "your own material" doors. */
const RAIL = [
  {
    href: "/interviews",
    label: "Interviews",
    sub: "Jobs, college, grad school",
    pop: "sky",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 5.5h16v10H9l-5 4z" />
        <path d="M9 10h6" />
      </svg>
    ),
  },
  {
    href: "/social",
    label: "Social skills",
    sub: "Small talk, tough rooms",
    pop: "rose",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M3.5 4.5h11v7.5H8.5l-5 3.5z" />
        <path d="M21 10h-6v6.5h2.5l3.5 3z" />
      </svg>
    ),
  },
  {
    href: "/custom",
    label: "Felix writes it",
    sub: "A speech for your situation",
    pop: "mint",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" />
        <path d="M13.5 7 17 10.5" />
      </svg>
    ),
  },
  {
    href: "/own",
    label: "My material",
    sub: "Your own pitches and talks",
    pop: "lilac",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
        <path d="M5 4.5h8l6 6V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z" />
        <path d="M13 4.5v6h6" />
      </svg>
    ),
  },
] as const;

export function NativeLadder({
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
  /** History could not be read — show no past rungs rather than a fake blank climb. */
  sessionsFailed: boolean;
}) {
  const native = useIsNative();
  const { plan } = usePlan();

  /* --- The Home Screen widget ------------------------------------------
     Pushed from here because the Ladder is the one screen that already holds
     every number the widget draws — the streak, the day's topic, the attempts
     left, today's best. Publishing from the screen that displays them means
     the widget can never disagree with what the user just looked at, and it
     never runs on a timer.

     Above the `!native` return, because hooks are not conditional. The helper
     itself no-ops off-device. */
  const widgetStreak = stats?.streakDays ?? 0;
  const widgetTopic = daily?.title ?? "";
  const widgetUsed = challenge?.attempts.length ?? 0;
  const widgetBest = challenge?.bestScore ?? null;
  useEffect(() => {
    // `challenge === null` is "still loading", and it collapses to the same
    // values as "nothing done yet" — publishing then would tell the widget
    // three takes are left on a day that is already finished.
    if (!widgetTopic || challenge === null) return;
    void publishWidgetState({
      streak: widgetStreak,
      topic: widgetTopic,
      attemptsLeft: Math.max(0, MAX_DAILY_ATTEMPTS - widgetUsed),
      bestToday: widgetBest,
    });
  }, [challenge, widgetStreak, widgetTopic, widgetUsed, widgetBest]);

  if (!native) return null;

  const level = stats?.level;
  const outfit = currentOutfit(level?.level ?? 1);
  const wearing = (shop?.equippedAccessory as FelixAccessory | null) ?? outfit?.id;
  const mood = moodFor({ stats, challenge });
  const streak = stats?.streakDays ?? 0;

  const used = challenge?.attempts.length ?? 0;
  const complete = challenge?.complete ?? false;
  const best = challenge?.bestScore ?? null;
  /** Lit means "you have spoken today". Not "you have used all three" — the
   *  ladder rewards showing up, and the second take is a bonus, not a debt. */
  const lit = used > 0 && best !== null;

  const day = todayKey();
  const past = sessionsFailed ? [] : pastRungs(sessions, day);
  /**
   * The best score on record, or null when we cannot know.
   *
   * `reduce(..., 0)` over an empty list answers 0, and "today's best beats 0"
   * is true of every score there has ever been — so a history that merely
   * failed to load (or a brand-new account) had the rung shouting NEW BEST at
   * a 38. A claim about a record needs the record; absent it, say the smaller
   * true thing instead.
   */
  const allTimeBest =
    sessionsFailed || sessions.length === 0
      ? null
      : sessions.reduce((top, s) => Math.max(top, s.analysis?.overall ?? 0), 0);

  // The best attempt's report, so a finished day still has somewhere to go.
  const bestAttempt = challenge?.attempts.reduce<
    { score: number; sessionId: string } | null
  >((top, a) => (top === null || a.score > top.score ? a : top), null);

  const week = sessionsFailed ? [] : weekStrip(sessions, best);
  const todayIndex = new Date().getDay();
  const scored = week.filter((d) => d.score !== null);
  const weekAvg = scored.length
    ? Math.round(scored.reduce((t, d) => t + (d.score ?? 0), 0) / scored.length)
    : null;

  const reward = nextOutfit(level?.level ?? 1);
  const rewardGate = reward ? LEVELS[reward.level - 1] : undefined;
  const xpToReward =
    rewardGate && stats ? Math.max(0, rewardGate.minXp - stats.xp) : null;

  const rungHref = complete
    ? bestAttempt
      ? `/report/${bestAttempt.sessionId}`
      : "/progress"
    : "/practice?daily=1";
  const rungLabel =
    challenge === null
      ? "Checking today's attempts"
      : complete
        ? `All three attempts used, best ${best}. Open the report`
        : lit
          ? `Attempt ${used + 1} of ${MAX_DAILY_ATTEMPTS}, beat ${best}`
          : "Start today's Daily Minute, sixty seconds";

  return (
    <div className="-mt-3.5">
      {/* --- The HUD ---------------------------------------------------------
          Felix is the door to the Den, the bar is the climb, the flame is the
          run. Sticky, because these three are the only things on this screen
          that are true no matter how far down you scroll. */}
      <div className="nv-ladder-bar">
        <div className="flex items-center gap-3">
          <Link
            href="/account"
            aria-label="Your den"
            className="nv-ladder-avatar nv-press nv-tap44"
          >
            <FelixScene
              biome={shop?.equippedBiome}
              mood={mood}
              accessory={wearing}
              className="h-10 w-10"
            />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="nv-footnote truncate font-semibold" style={{ color: "var(--nv-ink)" }}>
                {level ? `Level ${level.level} · ${level.title}` : " "}
              </span>
              {/* Progress THROUGH this level, because that is what the bar
                  underneath draws. It read `716 / 875` — total XP against the
                  next threshold — beside a bar sitting at 21%, so the two
                  halves of one control disagreed by sixty points from level 2
                  onward. Same numerator and denominator as the fill now. */}
              <span className="nv-footnote nv-num shrink-0">
                {level
                  ? level.isMax
                    ? `${level.xp} XP`
                    : `${level.xpIntoLevel} / ${level.xpIntoLevel + level.xpForNextLevel} XP`
                  : ""}
              </span>
            </div>
            <div className="nv-xp-track">
              <div className="nv-xp-fill" style={{ width: `${level?.percent ?? 0}%` }} />
            </div>
          </div>
          {streak > 0 && (
            <div className="flex shrink-0 items-center gap-1" data-tier={flameTier(streak)}>
              {/* Real hidden text, not aria-label. A bare <div> is
                  role=generic, and ARIA 1.2 prohibits a label there — AT drops
                  it, leaving the numeral "4" with no unit and no meaning. */}
              <span className="sr-only">{streak} day streak</span>
              {/* Sized here, not in the glyph: FlameGlyph carries only the
                  .nv-flame class (colour + the lick), so an unsized instance
                  falls back to the SVG default box. */}
              <FlameGlyph className="h-[22px] w-[17px]" />
              <span
                aria-hidden="true"
                className="nv-num"
                style={{
                  fontFamily: "var(--nv-font-display)",
                  fontWeight: 800,
                  fontSize: 17,
                  letterSpacing: "-0.03em",
                }}
              >
                {streak}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* --- The climb ------------------------------------------------------- */}
      <div className="nv-ladder">
        {past.map((r, i) => (
          <Fragment key={r.key}>
            {i > 0 && <span className="nv-spine-seg" aria-hidden="true" />}
            <Link
              href={`/report/${r.sessionId}`}
              className="nv-rung nv-press"
              data-side={i % 2 === 0 ? "left" : "right"}
              style={
                i % 2 === 0
                  ? { alignSelf: "flex-start", marginLeft: 22 }
                  : { alignSelf: "flex-end", marginRight: 18 }
              }
            >
              <span className="nv-rung-disc" data-band={bandOf(r.score)}>
                {r.score}
              </span>
              <span className="nv-rung-caption truncate">
                {r.weekday} · {r.title}
              </span>
            </Link>
          </Fragment>
        ))}
        {past.length > 0 && (
          <span className="nv-spine-seg" style={{ "--seg": "40px" } as CSSProperties} aria-hidden="true" />
        )}

        {/* TODAY.
            The no-past-rungs case needs MORE headroom, not less: with nothing
            above it the ring sits straight under the sticky HUD.

            The 136px orange planet this used to be is now a RING that Felix
            stands inside, and the action has moved down into a pill — the same
            shape every other action in the app is. The circle was the loudest
            object in the app while carrying the least information on screen;
            the arc it became is today's actual score. */}
        <div className={`nv-today ${past.length ? "mt-8" : "mt-12"}`}>
          <ScoreRing
            percent={lit && best !== null ? best : null}
            band={lit && best !== null ? bandOf(best) : "mid"}
          >
            <span className="nv-ring-felix" aria-hidden="true">
              <Felix
                mood={lit ? "cheer" : mood}
                accessory={wearing}
                animate
                className="block h-[136px] w-[136px]"
              />
            </span>
          </ScoreRing>

          {lit && best !== null && (
            <span
              className="nv-badge mt-3.5"
              data-band={bandOf(best)}
              style={{
                background: "var(--band-soft)",
                color: "var(--band-ink)",
              }}
            >
              <span className="nv-num" style={{ fontSize: 15 }}>
                {best}
              </span>
              <span>
                {complete
                  ? "· done today"
                  : allTimeBest !== null && best >= allTimeBest
                    ? "· your best yet"
                    : "· best today"}
              </span>
            </span>
          )}

          {/* --band-ink flips with the theme (the score-band block defines the
              dark cut); a raw --nv-accent-700 measured 3.4:1 in the Booth. */}
          <span
            className={`nv-caption ${lit ? "mt-3.5" : "mt-4"}`}
            data-band="mid"
            style={{ color: "var(--band-ink)" }}
          >
            Today{daily?.theme ? ` · ${daily.theme}` : ""}
          </span>
          <h2
            className="mt-2 px-4 text-center"
            style={{
              fontFamily: "var(--nv-font-display)",
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: "-0.05em",
              lineHeight: 1.02,
            }}
          >
            {daily?.title ?? "Felix is picking today's topic…"}
          </h2>
          {daily?.topic && (
            <p className="nv-subhead mt-2 px-2 text-center">{daily.topic}</p>
          )}

          {/* NOT tappable until the attempts are known.
              `challenge === null` is "still loading", and it collapses to the
              same values as "nothing done yet" — so the control showed the mic
              and a live link to /practice for someone who had already used all
              three attempts today, who tapped through and got turned away at
              the other end. */}
          <Link
            href={rungHref}
            className="nv-btn nv-btn-ink mt-5"
            aria-label={rungLabel}
            aria-disabled={challenge === null || undefined}
            onClick={(e) => {
              if (challenge === null) e.preventDefault();
            }}
            style={
              challenge === null
                ? { pointerEvents: "none", opacity: 0.5 }
                : undefined
            }
          >
            {!complete && (
              <span style={{ color: "var(--nv-accent-500)" }} aria-hidden="true">
                <MicGlyph size={21} />
              </span>
            )}
            <span>
              {challenge === null
                ? "Checking today…"
                : complete
                  ? "See your report"
                  : lit
                    ? `Go again · beat ${best}`
                    : "Start · 60 seconds"}
            </span>
          </Link>

          {challenge === null ? (
            <p className="nv-footnote mt-3" role="status">
              Checking today&apos;s attempts…
            </p>
          ) : (
            <div
              className="mt-3 flex items-center gap-1.5"
              aria-label={
                complete
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
              <span className="nv-footnote ml-1">
                {complete
                  ? "done for today"
                  : used === 0
                    ? `${MAX_DAILY_ATTEMPTS} attempts today · best one counts`
                    : `${MAX_DAILY_ATTEMPTS - used} left`}
              </span>
            </div>
          )}
        </div>

        <span className="nv-spine-seg mt-7" style={{ "--seg": "30px" } as CSSProperties} aria-hidden="true" />

        {/* Tomorrow, which nobody can reach early. */}
        <div
          className="nv-rung mt-4"
          data-side="left"
          style={{ alignSelf: "flex-start", marginLeft: 16 }}
        >
          <span className="nv-rung-locked" aria-hidden="true">
            <LockGlyph />
          </span>
          <span className="nv-rung-caption">New topic at midnight</span>
        </div>

        {reward && <span className="nv-spine-seg mt-4" aria-hidden="true" />}

        {/* The reward node: levelling finally has somewhere to land. */}
        {reward && (
          <Link
            href="/shop"
            className="nv-rung nv-press mt-4"
            data-side="right"
            style={{ alignSelf: "flex-end", marginRight: 12 }}
            aria-label={`${reward.name}, unlocks at level ${reward.level}`}
          >
            {/* Felix WEARING the reward, not an emoji standing in for it.
                Every accessory in lib/quests.ts is a real FoxLogo part, so
                the app was rendering 🎓 next to a fox who could simply have
                the cap on. */}
            <span className="nv-reward-tile" aria-hidden="true">
              <Felix mood="idle" accessory={reward.id as FelixAccessory} />
            </span>
            <span className="nv-rung-caption" style={{ color: "var(--nv-ink-2)" }}>
              <span className="block font-semibold" style={{ color: "var(--nv-ink)" }}>
                {reward.name}
              </span>
              <span className="block">
                Level {reward.level}
                {xpToReward !== null && xpToReward > 0 ? ` · ${xpToReward} XP away` : ""}
              </span>
            </span>
          </Link>
        )}

      </div>

      {/* --- The week --------------------------------------------------------
          The climb shows the last two days in detail; this shows the shape of
          the week, which is what a streak is actually made of. Deliberately
          OUTSIDE .nv-ladder — the spine is measured against its container. */}
      {/* No history read, no week: an empty seven-cell grid is a claim that
          you did nothing, and we don't know that. */}
      <div className="mt-11" hidden={week.length === 0}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="nv-caption">This week</h2>
          {weekAvg !== null && (
            <span className="nv-footnote nv-num">avg {weekAvg}</span>
          )}
        </div>
        <div className="card nv-week" style={{ padding: "16px 12px" }}>
          {week.map((d, i) => (
            <div
              key={d.key}
              className="nv-week-cell"
              data-today={d.isToday ? "" : undefined}
            >
              <span className="nv-week-day">{d.letter}</span>
              <span
                className="nv-week-score"
                data-band={d.score !== null ? bandOf(d.score) : undefined}
                data-empty={d.score === null && !d.isToday ? "" : undefined}
                data-now={d.isToday && d.score === null ? "" : undefined}
              >
                {d.score ?? (d.isToday ? "·" : i < todayIndex ? "—" : "")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* --- Go deeper -------------------------------------------------------
          The four Premium modules. Two up, on a gradient wash rather than a
          white tile, so they read as a different KIND of thing from the
          climb — places to go, not days to do. */}
      <div className="mt-9">
        <h2 className="nv-caption mb-3">Go deeper</h2>
        <div className="grid grid-cols-2 gap-3">
          {RAIL.map((r) => (
            <Link key={r.href} href={r.href} className="nv-deep" data-pop={r.pop}>
              <span className="nv-deep-glyph" aria-hidden="true">
                {r.glyph}
              </span>
              <span className="nv-deep-title">{r.label}</span>
              <span className="nv-deep-sub">{r.sub}</span>
              {plan === "free" && (
                // A lock and nothing else — no price, no CTA (App Store rule).
                <span className="nv-deep-lock">
                  <svg width="13" height="13" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} aria-hidden="true">
                    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
                    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                  </svg>
                  <span className="sr-only">Premium</span>
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* The two doors off the foot of the climb.

          The coin balance keeps its door to the shop — the reward node up the
          climb is the thing it buys toward. Beside it, the board: this app had
          a full leaderboard that NOTHING in the native shell linked to. The
          dock carries four tabs, the rail carries the four Premium modules,
          and the coin badge and the reward node both go to /shop, so a
          signed-in user simply could not reach it. It belongs here rather than
          in the rail because it is the other face of the same XP the HUD bar
          at the top of this screen is drawing. */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        {/* No nv-tap44 wrapper — CoinBadge carries it on its own link now. The
            wrapper's pseudo-element was sitting on top of that link and eating
            every tap, so this badge navigated nowhere at all. */}
        {shop && <CoinBadge coins={shop.coins} />}
        <Link
          href="/leaderboard"
          className="nv-badge nv-press nv-tap44"
          data-pop="lilac"
        >
          <PodiumGlyph />
          <span>Leaderboard</span>
        </Link>
      </div>
    </div>
  );
}
