"use client";

import { useRouter } from "next/navigation";
import { CountUp } from "@/components/CountUp";
import { useIsNative } from "@/lib/native";
import { Felix } from "@/components/FoxLogo";
import {
  bandForScore,
  FelixBubble,
  moodForScore,
  NvBadge,
  popFor,
  StreakStat,
} from "@/components/native/felix";
import { NvButton, NvEmpty, NvGroup, NvSectionHeader, NvStat } from "@/components/native/ui";
import { NvChevron } from "@/components/native/ui";
import { Tape } from "@/components/native/Tape";
import Link from "next/link";
import { MAX_DAILY_ATTEMPTS, todayKey, type UserStats } from "@/lib/daily";
import type { Session } from "@/lib/types";

/**
 * Progress at app scale: data is the hero. The current score as a huge
 * tabular numeral with its delta, the run of sessions as an axis-free
 * sparkline, the six delivery metrics as meters, three stats, and the
 * recent sessions as a grouped list.
 *
 * Same data the web page reads — sessions (newest-first) and stats — no
 * second source of truth. Renders nothing in a browser; the web sections
 * it replaces carry native-hide.
 */

/** How many recent sessions feed the six metric bars. */
const METRIC_WINDOW = 10;
/** How many of the six-ish delivery metrics we show (the analysis has six). */
const METRIC_COUNT = 6;
/** Rows in the Recent sessions group. */
const RECENT_ROWS = 8;

/* --- Sparkline geometry ------------------------------------------------- */
const SPARK_W = 300;
const SPARK_H = 96;
const SPARK_PAD = 10; // vertical breathing room inside the viewBox

function sparkPaths(scores: number[]): { line: string; area: string } {
  const pts = scores.length === 1 ? [scores[0], scores[0]] : scores;
  const min = Math.max(0, Math.min(...pts) - 10);
  const max = Math.min(100, Math.max(...pts) + 10);
  const x = (i: number) => (i / (pts.length - 1)) * SPARK_W;
  const y = (v: number) =>
    SPARK_H - SPARK_PAD - ((v - min) / (max - min || 1)) * (SPARK_H - SPARK_PAD * 2);
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`;
  return { line, area };
}

/**
 * The score line, axis-free and full-bleed. preserveAspectRatio="none"
 * stretches the geometry to fill; non-scaling-stroke keeps the line weight
 * honest while it does. Colors via style, not attributes — same var()
 * reasoning as the web chart's dots.
 */
function Sparkline({ scores }: { scores: number[] }) {
  const { line, area } = sparkPaths(scores);
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="block h-[120px] w-full"
      aria-hidden="true"
    >
      {/* Fixed gradient id, shared-defs rule as ever: the journey line runs
          ember into violet, left to right — time itself gets a color.

          gradientUnits="userSpaceOnUse" is load-bearing, not tidiness. The
          default (objectBoundingBox) resolves against the PATH's bounding
          box, and a flat line has zero height — which is exactly what one
          session produces (sparkPaths duplicates the point), and what any
          run of identical scores produces. A degenerate box makes the
          gradient unresolvable and WebKit drops the stroke entirely: the
          chart painted its fill and no line at all. Verified in Mobile
          Safari on the simulator, i.e. the WKWebView this actually ships to.
          Anchoring to the viewBox instead means the ramp is the same every
          time and never depends on how the data happens to sit. */}
      <defs>
        <linearGradient
          id="nv-spark-grad"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={SPARK_W}
          y2="0"
        >
          <stop offset="0%" stopColor="var(--nv-accent-500)" />
          <stop offset="55%" stopColor="var(--nv-pop-rose)" />
          <stop offset="100%" stopColor="var(--nv-pop-lilac)" />
        </linearGradient>
      </defs>
      <path d={area} style={{ fill: "var(--nv-accent-50)" }} />
      <path
        d={line}
        fill="none"
        stroke="url(#nv-spark-grad)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The chart that isn't there yet: a ghost wave in ink-3 over tint. */
function GhostSparkline() {
  const line =
    "M0,78 C30,74 45,58 75,60 C105,62 120,46 150,48 C180,50 195,34 225,32 C255,30 272,24 300,18";
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="block h-[120px] w-full"
      aria-hidden="true"
    >
      <path d={`${line} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`} style={{ fill: "var(--nv-tint-soft)" }} />
      <path
        d={line}
        fill="none"
        style={{ stroke: "var(--nv-ink-3)" }}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Sessions inside the rolling last seven days (same clock idiom the Tape
 *  uses — the helper owns the date read). */
function sessionsThisWeek(sessions: Session[]): number {
  const weekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
  return sessions.filter((s) => s.createdAt >= weekAgo).length;
}

/**
 * One recent session, as a row you can open.
 *
 * The score wears its band as a colour-tinted square rather than sitting in
 * the row's grey value slot: eight sessions in a list is the one place you
 * scan for "which of these went well", and a column of identical grey numerals
 * makes that a reading exercise. The numeral is still the numeral — the tint
 * is redundant encoding, never the only signal.
 */
function RecentRow({ session, last }: { session: Session; last: boolean }) {
  const score = session.analysis.overall;
  return (
    <Link
      href={`/report/${session.id}`}
      className="flex items-center gap-3.5 px-4 py-3"
      style={last ? undefined : { borderBottom: "1px solid var(--nv-hairline)" }}
      data-band={bandForScore(score)}
      aria-label={`Open the report for ${session.speechTitle ?? session.prompt}, scored ${score}`}
    >
      <span className="nv-score-sq" aria-hidden="true">
        {score}
      </span>
      <span className="min-w-0 flex-1">
        <span className="nv-body block truncate">
          {session.speechTitle ?? session.prompt}
        </span>
        <span className="nv-footnote block">
          {new Date(session.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </span>
      <NvChevron />
    </Link>
  );
}

/** Average each delivery metric over the recent window, latest order first. */
function metricAverages(
  sessions: Session[]
): { skill: string; avg: number }[] {
  const byName = new Map<string, { total: number; n: number }>();
  for (const s of sessions.slice(0, METRIC_WINDOW)) {
    // Sessions saved before per-skill scoring existed (old localStorage,
    // early accounts) carry an overall but no skills array — iterating
    // undefined here was a whole-screen crash into Next's error page.
    for (const sk of s.analysis.skills ?? []) {
      const agg = byName.get(sk.skill) ?? { total: 0, n: 0 };
      agg.total += sk.score;
      agg.n += 1;
      byName.set(sk.skill, agg);
    }
  }
  return [...byName.entries()]
    .slice(0, METRIC_COUNT)
    .map(([skill, agg]) => ({ skill, avg: Math.round(agg.total / agg.n) }));
}

export function NativeProgress({
  sessions: rawSessions,
  stats,
}: {
  /** Newest-first, exactly as the page holds them. */
  sessions: Session[];
  stats: UserStats | null;
}) {
  const native = useIsNative();
  const router = useRouter();
  if (!native) return null;

  // The type promises analysis on every session; storage predating the type
  // does not. One filter here and every read below is safe against whatever
  // an old localStorage or an early account actually holds.
  const sessions = rawSessions.filter(
    (s) => typeof s.analysis?.overall === "number"
  );

  /* --- Empty: the chart's ghost, and the coach himself ------------------- */
  if (sessions.length === 0) {
    return (
      <div className="pt-6">
        <GhostSparkline />
        {/* NvEmpty, not a hand-rolled .nv-empty. The kit primitive existed and
            this screen re-implemented it, which is how two versions of one
            empty state start to drift. */}
        <NvEmpty
          icon={<Felix mood="coach" animate className="h-24 w-24" />}
          line={<FelixBubble side="top">Your first rep starts the chart.</FelixBubble>}
          action={
            <NvButton onClick={() => router.push("/practice?daily=1")}>
              Start your Daily Minute
            </NvButton>
          }
        />
      </div>
    );
  }

  const latest = sessions[0].analysis.overall;
  const previous = sessions[1]?.analysis.overall;
  const delta = previous === undefined ? null : latest - previous;
  const deltaColor =
    delta === null || delta === 0
      ? "var(--nv-ink-3)"
      : delta > 0
        ? "var(--nv-success)"
        : "var(--nv-destructive)";

  const metrics = metricAverages(sessions);

  const streak = stats?.streakDays ?? 0;
  const thisWeek = sessionsThisWeek(sessions);
  const best = sessions.reduce(
    (top, s) => Math.max(top, s.analysis.overall),
    0
  );

  // Oldest → newest, left to right — same data the web TrendChart plots.
  const scores = [...sessions].reverse().map((s) => s.analysis.overall);

  // Today's bar only breathes while the day is still open. Counted from the
  // sessions this screen already holds rather than fetching the challenge
  // state again — a daily rep is exactly a session stamped with today's key.
  const today = todayKey();
  const liveToday =
    sessions.filter((s) => s.challengeDate === today).length < MAX_DAILY_ATTEMPTS;

  return (
    <div className="flex flex-col pt-2">
      {/* The score, huge and tabular, in its band's color — and Felix beside
          it, reacting to the move: up or flying gets the cheer, a dip gets
          the coach. He is the delta, readable from across the room. */}
      <section
        data-band={bandForScore(latest)}
        aria-label={`Overall score ${latest}${
          delta === null
            ? ""
            : delta === 0
              ? ", unchanged since last session"
              : `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} since last session`
        }`}
      >
        <p className="nv-caption">Overall</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <CountUp value={latest} duration={900} className="nv-display nv-num" />
              {delta !== null && (
                <span
                  className="nv-headline nv-num flex items-baseline gap-1"
                  style={{ color: deltaColor }}
                  aria-hidden="true"
                >
                  <span>{delta === 0 ? "–" : delta > 0 ? "▲" : "▼"}</span>
                  {Math.abs(delta)}
                </span>
              )}
              {delta !== null && (
                <span className="nv-footnote" aria-hidden="true">
                  vs last
                </span>
              )}
            </div>
            {latest === best && sessions.length > 1 && (
              <div className="mt-2.5">
                <NvBadge pop="sun">Your best yet</NvBadge>
              </div>
            )}
          </div>
          <Felix
            mood={delta !== null && delta < 0 ? "coach" : moodForScore(latest)}
            animate
            className="h-16 w-16 shrink-0"
          />
        </div>
        <div className="mt-5" data-parallax="0.06">
          <Sparkline scores={scores} />
        </div>
      </section>

      {/* The six delivery metrics, averaged over the recent window. */}
      {metrics.length > 0 && (
        <section>
          <NvSectionHeader>Where the work is</NvSectionHeader>
          <NvGroup>
            <div className="flex flex-col gap-4 p-4">
              {/* Each skill owns a color from the festival cycle — six bars
                  you can tell apart at a glance instead of six orange ones. */}
              {metrics.map((m, i) => (
                <div key={m.skill} className="nv-metric" data-pop={popFor(i)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="nv-subhead truncate">{m.skill}</span>
                    <span className="nv-headline nv-num nv-metric-num">
                      {m.avg}
                    </span>
                  </div>
                  <div
                    className="nv-meter-track mt-1.5"
                    role="meter"
                    aria-label={`${m.skill} average`}
                    aria-valuenow={m.avg}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="nv-meter-fill"
                      style={{ width: `${m.avg}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </NvGroup>
        </section>
      )}

      {/* Streak, week, best — the three numbers that only move by doing. */}
      <section aria-label="Practice stats" className="mt-8">
        <NvGroup>
          <div className="grid grid-cols-3 items-start px-2 py-4">
            <StreakStat days={streak} />
            <NvStat value={thisWeek} label="this week" />
            <NvStat value={best} label="best" />
          </div>
        </NvGroup>
      </section>

      {/* THE TAPE. It opened the home screen until the Ladder answered the
          same question better there — a rung per day, climbing. It belongs
          here now, beside the score line, because the two measure different
          things: the line is how WELL, the tape is how OFTEN. */}
      <section>
        <NvSectionHeader>Showing up</NvSectionHeader>
        <NvGroup>
          <div className="px-4 py-4">
            <Tape sessions={sessions} streak={streak} liveToday={liveToday} />
          </div>
        </NvGroup>
      </section>

      {/* Recent sessions; each row opens its report. */}
      <section>
        <NvSectionHeader>Recent sessions</NvSectionHeader>
        <NvGroup>
          {sessions.slice(0, RECENT_ROWS).map((s, i, list) => (
            <RecentRow
              key={s.id}
              session={s}
              last={i === Math.min(RECENT_ROWS, list.length) - 1}
            />
          ))}
        </NvGroup>
      </section>
    </div>
  );
}
