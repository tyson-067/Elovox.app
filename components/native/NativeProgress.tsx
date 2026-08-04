"use client";

import { useRouter } from "next/navigation";
import { CountUp } from "@/components/CountUp";
import { useIsNative } from "@/lib/native";
import {
  NvButton,
  NvEmpty,
  NvGroup,
  NvRow,
  NvSectionHeader,
  NvStat,
} from "@/components/native/ui";
import type { UserStats } from "@/lib/daily";
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
      <path d={area} style={{ fill: "var(--nv-accent-50)" }} />
      <path
        d={line}
        fill="none"
        style={{ stroke: "var(--nv-accent-500)" }}
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

/** Sessions inside the rolling last seven days (same clock idiom tapeDays
 *  uses in NativeToday — the helper owns the date read). */
function sessionsThisWeek(sessions: Session[]): number {
  const weekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
  return sessions.filter((s) => s.createdAt >= weekAgo).length;
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

  /* --- Empty: the chart's ghost, one line, one action ------------------- */
  if (sessions.length === 0) {
    return (
      <div className="pt-6">
        <GhostSparkline />
        <NvEmpty
          line="Your first rep starts the chart."
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

  return (
    <div className="flex flex-col pt-2">
      {/* The score, huge and tabular, with its move since last session. */}
      <section
        aria-label={`Overall score ${latest}${
          delta === null
            ? ""
            : delta === 0
              ? ", unchanged since last session"
              : `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} since last session`
        }`}
      >
        <p className="nv-caption">Overall</p>
        <div className="mt-1 flex items-baseline gap-2.5">
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
              {metrics.map((m) => (
                <div key={m.skill}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="nv-subhead truncate">{m.skill}</span>
                    <span className="nv-headline nv-num">{m.avg}</span>
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
            <NvStat value={streak} label="day streak" />
            <NvStat value={thisWeek} label="this week" />
            <NvStat value={best} label="best" />
          </div>
        </NvGroup>
      </section>

      {/* Recent sessions; each row opens its report. */}
      <section>
        <NvSectionHeader>Recent sessions</NvSectionHeader>
        <NvGroup>
          {sessions.slice(0, RECENT_ROWS).map((s) => (
            <NvRow
              key={s.id}
              label={s.speechTitle ?? s.prompt}
              sub={new Date(s.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
              value={<span className="nv-num">{s.analysis.overall}</span>}
              href={`/report/${s.id}`}
              ariaLabel={`Open the report for the session scored ${s.analysis.overall}`}
            />
          ))}
        </NvGroup>
      </section>
    </div>
  );
}
