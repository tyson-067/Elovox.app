"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CountUp } from "@/components/CountUp";
import { useIsNative } from "@/lib/native";
import { Felix } from "@/components/FoxLogo";
import {
  bandForScore,
  FelixBubble,
  NvBadge,
  StreakStat,
} from "@/components/native/felix";
import {
  NvButton,
  NvEmpty,
  NvGroup,
  NvRow,
  NvSectionHeader,
  NvSheet,
  NvStat,
} from "@/components/native/ui";
import Link from "next/link";
import { todayKey, type UserStats } from "@/lib/daily";
import { deleteSession, type DeleteReason } from "@/lib/store";
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
/** Sessions per side of the "where you're moving" comparison. */
const MOVEMENT_WINDOW = 5;
/**
 * Smallest change worth a card. Under two points is noise — three tiles all
 * reading "+1" is a section that has found nothing and said something anyway.
 */
const MOVEMENT_FLOOR = 2;
/** Days in the turn-up grid: ten weeks, laid out fourteen to a row
 *  (the column count lives in .nv-heat, which owns the layout). */
const HEAT_DAYS = 70;

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
function RecentRow({
  session,
  last,
  onDeleteRequest,
}: {
  session: Session;
  last: boolean;
  onDeleteRequest: () => void;
}) {
  const score = session.analysis.overall;
  return (
    // The × is a sibling of the link, not a child of it: a <button> inside an
    // <a> is nested interactive content, which no assistive technology and few
    // browsers agree on. Same shape the web card uses.
    <div
      className="relative"
      style={last ? undefined : { borderBottom: "1px solid var(--nv-hairline)" }}
    >
      <Link
        href={`/report/${session.id}`}
        className="flex items-center gap-3.5 py-3 pl-4 pr-12"
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
            {/* Only once Felix has written a take for it, and only as a way
                in: the report opens with his module and nothing plays until
                it's pressed. Same marker the web history rows carry. */}
            {session.felix && " · Hear Felix again"}
          </span>
        </span>
        {/* No chevron. The × is this row's trailing control, and a chevron
            beside it read as two affordances for one row while costing the
            title twenty pixels it needed more. The row is still the link. */}
      </Link>
      <button
        type="button"
        onClick={onDeleteRequest}
        className="nv-recent-x"
        aria-label={`Delete this session, scored ${score}`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/** The reasons a user can pick when deleting; labels here, codes to the API.
 *  Same closed set /api/session/delete accepts, and the same labels the web
 *  list offers — this is one product's vocabulary, not two. */
const DELETE_REASONS: { code: DeleteReason; label: string }[] = [
  { code: "mic-test", label: "Just testing the mic" },
  { code: "interrupted", label: "I got interrupted" },
  { code: "wrong-scenario", label: "Wrong scenario" },
  { code: "privacy", label: "I'd rather not keep it" },
  { code: "other", label: "Something else" },
];

/**
 * Deleting a take, in a sheet.
 *
 * The app had no way to do this at all: on the web every row in Past sessions
 * carries an ×, and in the app a rep you only made to test the microphone was
 * in your history and your averages forever. It asks why for the same reason
 * the web does — the reason is what the daily cap is counted against, and
 * "I'd rather not keep it" is a privacy answer that deserves to be one tap.
 */
function DeleteSheet({
  session,
  onClose,
  onDeleted,
}: {
  session: Session | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async (reason: DeleteReason) => {
    if (!session) return;
    setBusy(true);
    setError("");
    const result = await deleteSession(session.id, reason);
    setBusy(false);
    if (result.ok) {
      onDeleted(session.id);
      onClose();
      return;
    }
    setError(result.message ?? "Couldn't delete that just now.");
  };

  return (
    <NvSheet
      open={session !== null}
      onClose={() => {
        setError("");
        onClose();
      }}
      title="Delete this attempt?"
    >
      <p className="nv-footnote mb-3 text-center">
        {busy ? "Removing…" : "Tell us why. It helps us know what went wrong."}
      </p>
      <NvGroup>
        {DELETE_REASONS.map((r) => (
          <NvRow
            key={r.code}
            label={r.label}
            destructive
            chevron={false}
            disabled={busy}
            onClick={() => void remove(r.code)}
          />
        ))}
      </NvGroup>
      {error && (
        <p
          role="alert"
          className="nv-footnote mt-2 text-center"
          style={{ color: "var(--nv-destructive)" }}
        >
          {error}
        </p>
      )}
      <NvButton
        variant="plain"
        className="mt-2"
        disabled={busy}
        onClick={() => {
          setError("");
          onClose();
        }}
      >
        Keep it
      </NvButton>
    </NvSheet>
  );
}

/** Average each delivery metric over a slice of the history. */
function averagesOver(sessions: Session[]): Map<string, number> {
  const byName = new Map<string, { total: number; n: number }>();
  for (const s of sessions) {
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
  return new Map(
    [...byName.entries()].map(([skill, agg]) => [
      skill,
      Math.round(agg.total / agg.n),
    ])
  );
}

/** Average each delivery metric over the recent window, latest order first. */
function metricAverages(
  sessions: Session[]
): { skill: string; avg: number }[] {
  return [...averagesOver(sessions.slice(0, METRIC_WINDOW)).entries()]
    .slice(0, METRIC_COUNT)
    .map(([skill, avg]) => ({ skill, avg }));
}

/**
 * WHERE YOU'RE MOVING — the three metrics that changed most, recent window
 * against the window before it.
 *
 * A screen full of averages tells you where you stand and nothing about
 * whether you're getting better, which is the only question anyone opens a
 * progress screen to ask. Needs two full windows of history to say anything,
 * and says nothing rather than guessing when it doesn't have them.
 */
function movements(
  sessions: Session[]
): { skill: string; delta: number }[] {
  if (sessions.length < MOVEMENT_WINDOW * 2) return [];
  const recent = averagesOver(sessions.slice(0, MOVEMENT_WINDOW));
  const older = averagesOver(
    sessions.slice(MOVEMENT_WINDOW, MOVEMENT_WINDOW * 2)
  );
  const out: { skill: string; delta: number }[] = [];
  for (const [skill, now] of recent) {
    const before = older.get(skill);
    if (before === undefined) continue;
    out.push({ skill, delta: now - before });
  }
  return out
    .filter((m) => Math.abs(m.delta) >= MOVEMENT_FLOOR)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
}

/**
 * EVERY DAY YOU TURNED UP — five weeks of days, quiet to strong.
 *
 * Replaces the Tape's bar chart on this screen. Both answer "how often", and
 * the grid answers it in a fifth of the height while covering five times the
 * span: a bar chart of the last fortnight cannot show you the shape of a
 * month, and the shape is the thing.
 *
 * Oldest first, ending on today. Laid out fourteen to a row rather than seven,
 * because at seven columns the cells are 44px squares and the grid reads as a
 * calendar you can tap; it isn't one. Fourteen makes it a texture, which is
 * what a ten-week pattern should look like.
 */
function heatDays(sessions: Session[]): { key: string; best: number | null; isToday: boolean }[] {
  const best = new Map<string, number>();
  for (const s of sessions) {
    const k = todayKey(new Date(s.createdAt));
    best.set(k, Math.max(best.get(k) ?? 0, s.analysis.overall));
  }
  const now = new Date();
  const today = todayKey(now);
  return Array.from({ length: HEAT_DAYS }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (HEAT_DAYS - 1 - i));
    const key = todayKey(d);
    return { key, best: best.get(key) ?? null, isToday: key === today };
  });
}

export function NativeProgress({
  sessions: rawSessions,
  stats,
  onDeleted,
}: {
  /** Newest-first, exactly as the page holds them. */
  sessions: Session[];
  stats: UserStats | null;
  /** Drop a deleted session from the page's list. Same handler the web rows use. */
  onDeleted?: (id: string) => void;
}) {
  const native = useIsNative();
  const router = useRouter();
  // Held here rather than per row, so only one confirm can ever be open —
  // and so the sheet outlives the row it came from while it is deleting it.
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
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
        {/* In a card, not full-bleed. The ghost is a rectangle of flat grey
            with a hard edge, and run to both screen edges under a large title
            it read as a rendering artefact rather than as the chart that
            isn't there yet. Inside a rounded surface it reads as a placeholder
            for the hero the first rep will put there. */}
        <div className="card overflow-hidden p-0">
          <GhostSparkline />
        </div>
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
  const moving = movements(sessions);
  const heat = heatDays(sessions);

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
      {/* THE INK HERO.
          The score used to sit straight on the paper beside the sparkline,
          which put the one number the screen is named after at the same
          elevation as the cards below it. It gets its own block of ink now —
          the same material every other hero in the app stands on. */}
      <section
        className="nv-hero-ink"
        data-band={bandForScore(latest)}
        aria-label={`Overall score ${latest}${
          delta === null
            ? ""
            : delta === 0
              ? ", unchanged since last session"
              : `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} since last session`
        }`}
      >
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="nv-stage-eyebrow">Latest</p>
            <div className="nv-hero-num mt-2.5">
              <CountUp value={latest} duration={900} className="nv-num" />
            </div>
            {delta !== null && (
              <span
                className="nv-badge mt-3"
                aria-hidden="true"
                style={{ background: "rgba(255,255,255,.12)", color: deltaColor }}
              >
                <span>{delta === 0 ? "–" : delta > 0 ? "▲" : "▼"}</span>
                <span className="nv-num">{Math.abs(delta)}</span>
                <span>vs last</span>
              </span>
            )}
            {latest === best && sessions.length > 1 && delta === null && (
              <div className="mt-3">
                <NvBadge pop="sun">Your best yet</NvBadge>
              </div>
            )}
          </div>
          <div className="shrink-0" data-parallax="0.06">
            <Sparkline scores={scores} />
          </div>
        </div>
      </section>

      {/* WHERE YOU'RE MOVING — the deltas, not the levels. */}
      {moving.length > 0 && (
        <section>
          <NvSectionHeader>Where you&apos;re moving</NvSectionHeader>
          <div className="grid grid-cols-3 gap-2.5">
            {moving.map((m) => (
              <div key={m.skill} className="nv-move">
                <span
                  className="nv-move-num"
                  style={{
                    color:
                      m.delta > 0
                        ? "var(--nv-mint)"
                        : m.delta < 0
                          ? "var(--nv-accent-700)"
                          : "var(--nv-ink-3)",
                  }}
                >
                  {m.delta > 0 ? "+" : m.delta < 0 ? "−" : ""}
                  {Math.abs(m.delta)}
                </span>
                <span className="nv-move-label">{m.skill}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* EVERY DAY YOU TURNED UP — five weeks, quiet to strong. */}
      <section>
        <NvSectionHeader>Every day you turned up</NvSectionHeader>
        <div className="card p-4">
          <div
            className="nv-heat"
            role="img"
            aria-label={`Practice over the last ${HEAT_DAYS / 7} weeks`}
          >
            {heat.map((d) => (
              <span
                key={d.key}
                className="nv-heat-cell"
                data-band={d.best !== null ? bandForScore(d.best) : undefined}
                data-on={d.best !== null ? "" : undefined}
                data-today={d.isToday ? "" : undefined}
              />
            ))}
          </div>
          <div className="mt-3.5 flex items-center justify-between">
            <span className="nv-footnote">{HEAT_DAYS / 7} weeks</span>
            <span className="nv-footnote inline-flex items-center gap-1.5">
              quiet
              <span className="nv-heat-key" />
              <span className="nv-heat-key" data-on="" data-band="low" />
              <span className="nv-heat-key" data-on="" data-band="high" />
              strong
            </span>
          </div>
        </div>
      </section>

      {/* The six delivery metrics, averaged over the recent window. */}
      {metrics.length > 0 && (
        <section>
          <NvSectionHeader>Where the work is</NvSectionHeader>
          <NvGroup>
            <div className="py-1.5">
              {/* Colour by BAND, not by a six-hue cycle: what matters about a
                  metric is whether the number is good, not which of six
                  positions it happens to sit in. */}
              {metrics.map((m) => (
                <div
                  key={m.skill}
                  className="nv-metric-row"
                  data-band={bandForScore(m.avg)}
                >
                  <span className="nv-metric-row-label truncate">{m.skill}</span>
                  <span
                    className="nv-meter-track"
                    role="meter"
                    aria-label={`${m.skill} average`}
                    aria-valuenow={m.avg}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span
                      className="nv-meter-fill block"
                      style={{ width: `${m.avg}%` }}
                    />
                  </span>
                  <span className="nv-metric-row-num">{m.avg}</span>
                </div>
              ))}
            </div>
          </NvGroup>
        </section>
      )}

      {/* Streak, week, best — the three numbers that only move by doing. */}
      <section aria-label="Practice stats" className="mt-8">
        <NvGroup>
          <div className="grid grid-cols-3 items-start py-4">
            <StreakStat days={streak} />
            <NvStat value={thisWeek} label="this week" />
            <NvStat value={best} label="best" />
          </div>
        </NvGroup>
      </section>

      {/* Recent sessions; each row opens its report, the × removes it. */}
      <section>
        <NvSectionHeader>Recent sessions</NvSectionHeader>
        <NvGroup>
          {sessions.slice(0, RECENT_ROWS).map((s, i, list) => (
            <RecentRow
              key={s.id}
              session={s}
              last={i === Math.min(RECENT_ROWS, list.length) - 1}
              onDeleteRequest={() => setPendingDelete(s)}
            />
          ))}
        </NvGroup>
      </section>

      <DeleteSheet
        session={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={(id) => onDeleted?.(id)}
      />
    </div>
  );
}
