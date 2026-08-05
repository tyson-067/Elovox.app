"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { NativeProgress } from "@/components/native/NativeProgress";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { InfoTip } from "@/components/InfoTip";
import { Felix } from "@/components/FoxLogo";
import { Biome } from "@/components/Biome";
import { BIOMES } from "@/lib/coins";
import { fetchShopState, type ShopState } from "@/lib/shop";
import { listSessions, deleteSession, type DeleteReason } from "@/lib/store";
import { getCategory } from "@/lib/categories";
import { getStats, type UserStats } from "@/lib/daily";
import { LEVELS } from "@/lib/levels";
import { barClass } from "@/lib/scoring";
import type { Session } from "@/lib/types";

function TrendChart({ sessions }: { sessions: Session[] }) {
  const router = useRouter();
  // Oldest → newest, left to right. Kept as sessions (not bare scores) so
  // every dot knows which report it belongs to — clicking a point opens that
  // session's detail.
  const ordered = [...sessions].reverse();
  if (ordered.length === 1) ordered.push(ordered[0]);
  const points = ordered.map((s) => s.analysis.overall);
  const w = 720;
  const h = 200;
  const pad = 24;

  const min = Math.max(0, Math.min(...points) - 10);
  const max = Math.min(100, Math.max(...points) + 10);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p)}`).join(" ");

  return (
    // Deliberately NOT role="img": that makes the whole subtree
    // presentational, so the N focusable point-links nested inside became
    // unnamed tab stops that a screen reader could land on but never
    // describe. A <title> gives the graphic its description without hiding
    // its contents.
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-auto"
      aria-labelledby="trend-chart-title"
    >
      <title id="trend-chart-title">
        Overall score across sessions. Each point opens that session&apos;s report.
      </title>
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#c6c6ce" strokeWidth="1" />
      {/* pathLength=1 normalizes the dash animation (.chart-draw) so the
          line draws itself in regardless of its real length */}
      <path
        d={path}
        pathLength={1}
        className="chart-draw"
        fill="none"
        stroke="#ff6b35"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {ordered.map((s, i) => (
        // A group per point: the visible dot plus a larger invisible halo so
        // the click target isn't a 4px circle. Keyboard reachable (Enter/Space)
        // since SVG circles aren't naturally focusable.
        <g
          key={`${s.id}-${i}`}
          role="link"
          tabIndex={0}
          aria-label={`Open the report for the session scored ${s.analysis.overall}`}
          // No focus:outline-none here. These are the only way to reach a
          // session's report from the chart, and removing the ring made them
          // invisible tab stops.
          className="cursor-pointer"
          onClick={() => router.push(`/report/${s.id}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              router.push(`/report/${s.id}`);
            }
          }}
        >
          <circle cx={x(i)} cy={y(s.analysis.overall)} r="12" fill="transparent" />
          {/* Theme tokens via style (var() doesn't resolve in SVG fill=""
              attributes), so the dots and labels stay readable in dark mode
              instead of dark-navy-on-near-black. */}
          <circle
            cx={x(i)}
            cy={y(s.analysis.overall)}
            r="4"
            className="chart-dot"
            style={{
              fill: "var(--color-primary)",
              animationDelay: `${150 + (i / (points.length - 1)) * 1300}ms`,
            }}
          />
        </g>
      ))}
      <text
        x={pad}
        y={y(points[0]) - 10}
        fontSize="12"
        style={{ fill: "var(--color-on-surface-variant)" }}
        fontFamily="var(--font-geist-mono)"
      >
        {points[0]}
      </text>
      <text
        x={x(points.length - 1)}
        y={y(points[points.length - 1]) - 10}
        fontSize="12"
        style={{ fill: "var(--color-primary)" }}
        fontFamily="var(--font-geist-mono)"
        textAnchor="end"
      >
        {points[points.length - 1]}
      </text>
    </svg>
  );
}

/** Level, XP, streak, the headline of the whole tab now. */
function LevelPanel({
  stats,
  minutesPracticed,
}: {
  stats: UserStats;
  /** Total minutes across EVERY practice mode, from the session log — not
   *  just the Daily Minute. "Daily minutes" used to show the count of daily
   *  challenges done under a label that read like practice time. */
  minutesPracticed: number;
}) {
  const { level } = stats;
  const nextTitle = LEVELS[level.level]?.title;

  return (
    <GlowCard className="card navy-gradient border-none! p-6 md:p-8 text-white">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          {/* Sits with the eyebrow rather than in the card corner: the stat
              row on the right is bottom-aligned, so a corner tip lands on
              top of the numbers on narrow screens. */}
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-semibold tracking-[0.06em] uppercase text-white/70">
              Level {level.level}
            </span>
            <InfoTip label="Where do levels and XP come from?" tone="dark">
              XP comes from finishing practice, and enough XP moves you up a
              level. The streak counts days in a row where you practiced at
              least once.
            </InfoTip>
          </span>
          <div className="font-headline text-4xl font-semibold">{level.title}</div>
        </div>
        <div className="flex items-center gap-8">
          <div>
            <div className="font-data text-2xl">{stats.streakDays}</div>
            <div className="text-[12px] text-white/70">day streak</div>
          </div>
          <div>
            <div className="font-data text-2xl">{minutesPracticed}</div>
            <div className="text-[12px] text-white/70">minutes practiced</div>
          </div>
          <div>
            <div className="font-data text-2xl">{level.xp}</div>
            <div className="text-[12px] text-white/70">total XP</div>
          </div>
        </div>
      </div>

      <div className="mt-6 h-2 rounded-full bg-white/20 overflow-hidden">
        <div
          className="bar-grow h-full rounded-full bg-accent"
          style={{ width: `${level.percent}%` }}
        />
      </div>
      <p className="mt-2 text-[13px] text-white/75">
        {level.isMax
          ? "Top level. The work now is keeping it."
          : `${level.xpForNextLevel} XP to Level ${level.level + 1}, ${nextTitle}`}
      </p>
    </GlowCard>
  );
}

/**
 * How much of Felix's world is theirs: which biomes are unlocked, which one
 * he's in, and what the next one costs.
 *
 * On the progress page rather than only in the shop because this is the part
 * of the collection that reads as a run rather than as a purchase — "three of
 * five" belongs next to the streak and the level, which are the other two
 * numbers that only move by practicing.
 */
function BiomeProgress({ shop }: { shop: ShopState | null }) {
  if (!shop) return null;

  const owned = BIOMES.filter((b) => shop.owned.includes(b.id));
  // Cheapest first, so "next" is the one they can actually reach.
  const next = BIOMES.filter((b) => !shop.owned.includes(b.id)).sort(
    (a, b) => a.price - b.price
  )[0];

  return (
    <div className="card p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] text-on-surface">
          <span className="font-semibold text-primary">
            {owned.length} of {BIOMES.length}
          </span>{" "}
          places unlocked
        </p>
        <span className="font-data text-[13px] text-on-surface-variant">
          🪙 {shop.coins.toLocaleString()}
        </span>
      </div>

      <ul className="mt-4 grid grid-cols-5 gap-2">
        {BIOMES.map((b) => {
          const has = shop.owned.includes(b.id);
          const here = shop.equippedBiome === b.id;
          return (
            <li key={b.id} className="text-center">
              <Biome
                id={b.id}
                className={`aspect-square w-full rounded-lg ${
                  has ? "" : "opacity-30 grayscale"
                } ${here ? "ring-2 ring-accent ring-offset-2" : ""}`}
              />
              <span className="mt-1.5 block truncate text-[11px] font-semibold text-primary">
                {has ? b.name : `🪙 ${b.price}`}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-[13px] leading-5 text-on-surface-variant">
        {next ? (
          <>
            Next up is{" "}
            <span className="font-semibold text-primary">{next.name}</span>, at{" "}
            {next.price} coins.{" "}
          </>
        ) : (
          <>Felix has been everywhere. </>
        )}
        <Link href="/shop" className="font-semibold text-accent-strong">
          Open the shop →
        </Link>
      </p>
    </div>
  );
}


/** The reasons a user can pick when deleting; labels here, codes to the API. */
const DELETE_REASONS: { code: DeleteReason; label: string }[] = [
  { code: "mic-test", label: "Just testing the mic" },
  { code: "interrupted", label: "I got interrupted" },
  { code: "wrong-scenario", label: "Wrong scenario" },
  { code: "privacy", label: "I'd rather not keep it" },
  { code: "other", label: "Something else" },
];

/**
 * One row of the Past sessions list. The whole row opens the report; the X
 * opens a confirm that asks why (same pattern as the library card's swap).
 * Daily reps carry a small sun icon by the score — the separate Daily
 * Minutes section this replaces used to explain itself with a heading, so
 * the icon's tooltip carries that job now.
 */
function SessionRow({
  session: s,
  onDeleted,
}: {
  session: Session;
  onDeleted: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async (reason: DeleteReason) => {
    setBusy(true);
    setError("");
    const result = await deleteSession(s.id, reason);
    setBusy(false);
    if (result.ok) {
      onDeleted(s.id);
      return;
    }
    setError(result.message ?? "Couldn't delete that just now.");
  };

  // When confirming, render the picker IN FLOW as the card body (not an
  // absolute overlay), so the card grows to fit the wrapped reason pills
  // instead of the ~180px overlay spilling over a ~76px card onto its
  // neighbours on a phone.
  if (confirming) {
    return (
      <GlowCard className="card">
        <div className="p-4 text-center">
          <p className="text-base font-medium text-primary">
            {busy ? "Removing…" : "Delete this attempt? Tell us why:"}
          </p>
          {!busy && (
            <>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {DELETE_REASONS.map((r) => (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => void remove(r.code)}
                    className="pill rounded-full border border-primary/20 px-3.5 py-1.5 text-[13px] font-semibold text-primary hover:border-error hover:text-error"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="mt-3 text-[13px] font-semibold text-on-surface-variant underline underline-offset-2 hover:text-primary"
              >
                Keep it
              </button>
              {error && (
                <p role="alert" className="mt-2 text-[13px] font-medium text-error">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </GlowCard>
    );
  }

  return (
    <GlowCard className="card relative">
      <Link href={`/report/${s.id}`} className="flex items-center gap-4 p-4 pr-12">
        <span className="flex w-14 shrink-0 items-center justify-end gap-1.5">
          {s.mode === "daily" && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="shrink-0 text-accent-strong"
              aria-label="Daily Minute: the shared one-minute challenge, three attempts a day"
              role="img"
            >
              <title>
                Daily Minute: the shared one-minute challenge, three attempts a day
              </title>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
            </svg>
          )}
          <span className="font-data text-xl text-primary">{s.analysis.overall}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-on-surface">{s.prompt}</span>
          <span className="mt-0.5 block text-[13px] font-semibold tracking-wide text-on-surface-variant">
            <span className="text-violet">
              {s.speechTitle ?? getCategory(s.category).name}
            </span>
            {s.mode === "daily" && s.attempt && (
              <>
                <span className="mx-1.5">·</span>
                attempt {s.attempt}
              </>
            )}
            {s.withVideo && (
              <>
                <span className="mx-1.5">·</span>
                <span className="text-accent-strong">camera</span>
              </>
            )}
            <span className="mx-1.5">·</span>
            {new Date(s.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </span>
        <span aria-hidden="true" className="text-on-surface-variant">→</span>
      </Link>

      <button
        type="button"
        onClick={() => {
          setError("");
          setConfirming(true);
        }}
        aria-label={`Delete this session, scored ${s.analysis.overall}`}
        title="Delete this attempt"
        className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </GlowCard>
  );
}

export default function ProgressPage() {
  return (
    <RequireAuth>
      <ProgressScreen />
    </RequireAuth>
  );
}

function ProgressScreen() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [shop, setShop] = useState<ShopState | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((s) => !cancelled && setSessions(s))
      // Leave sessions null and flag the error, so a returning user whose
      // history failed to load doesn't see the first-time "Nothing here yet"
      // onboarding as if their account were empty.
      .catch(() => !cancelled && setLoadError(true));
    getStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => {});
    // Failure leaves the biome panel unrendered rather than showing a wrong
    // collection — nothing else on this page depends on it.
    fetchShopState()
      .then((s) => !cancelled && setShop(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const skillAverages = useMemo(() => {
    if (!sessions?.length) return [];
    const byName = new Map<string, number[]>();
    for (const s of sessions) {
      // Sessions saved before per-skill scoring carry an overall but no
      // skills array; iterating undefined crashed the whole screen into
      // Next's error page for any account (or localStorage) that old.
      for (const sk of s.analysis.skills ?? []) {
        byName.set(sk.skill, [...(byName.get(sk.skill) ?? []), sk.score]);
      }
    }
    return [...byName.entries()].map(([skill, scores]) => ({
      skill,
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      latest: scores[0], // sessions are newest-first
    }));
  }, [sessions]);

  // Body-language averages, from the Premium camera pass only.
  const stageAverages = useMemo(() => {
    if (!sessions?.length) return [];
    const byName = new Map<string, number[]>();
    for (const s of sessions) {
      for (const m of s.analysis.stage?.metrics ?? []) {
        byName.set(m.metric, [...(byName.get(m.metric) ?? []), m.score]);
      }
    }
    return [...byName.entries()].map(([metric, scores]) => ({
      metric,
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      latest: scores[0],
    }));
  }, [sessions]);

  // Same reasoning as the report screen: a tab you clicked has to show you
  // something. Rendering `null` here meant Progress opened as an empty page
  // and stayed that way for as long as the history took to come back, which
  // reads as "it didn't load" and sends people clicking around to make it
  // appear.
  if (loadError) {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-center">
        <Felix mood="coach" className="h-16 w-16" />
        <p className="text-lg text-on-surface-variant" role="alert">
          Couldn&apos;t load your history just now.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  if (sessions === null) {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-center">
        <Felix mood="coach" className="felix-idle h-16 w-16" />
        <p className="text-lg text-on-surface-variant" role="status">
          Pulling up your practice history…
        </p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <>
        {/* The app's empty state: a ghosted chart with one line and one
            action. The web copy below carries native-hide — the h1 was
            double-titling under the nav bar, and NvEmpty already holds the
            line and the button. */}
        <NativeProgress sessions={sessions} stats={stats} />
        <div className="stagger-in py-16 max-w-[640px] mx-auto">
          <h1 className="native-hide text-title font-headline font-semibold text-primary">
            Nothing here yet
          </h1>
          <p className="native-hide mt-3 text-lg leading-7 text-on-surface-variant">
            Your first recording becomes your baseline. Everything after that is
            progress you can see, and your Daily Minute is waiting.
          </p>
          <Link
            href="/practice?daily=1"
            className="native-hide btn rounded-lg mt-8 inline-block bg-accent-strong text-white font-semibold px-8 py-3.5"
          >
            Start your Daily Minute
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className="py-8 md:py-12">
      <h1 className="native-hide text-title font-headline font-semibold text-primary">
        <WordReveal text="Your progress" delay={80} />
      </h1>

      {/* The app-scale Progress. Same sessions/stats the web sections below
          read; those sections carry native-hide. Renders nothing in a
          browser. Deletion goes through the same handler as the web rows, so
          both lists drop the session from the same state. */}
      <NativeProgress
        sessions={sessions}
        stats={stats}
        onDeleted={(id) =>
          setSessions((prev) => prev?.filter((x) => x.id !== id) ?? prev)
        }
      />

      {/* 1. Level and streak, the running story */}
      {stats && (
        <section className="native-hide mt-8">
          <Reveal>
            <LevelPanel
              stats={stats}
              minutesPracticed={Math.round(
                sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0) / 60
              )}
            />
          </Reveal>
        </section>
      )}

      {/* 2. Trend line */}
      <section className="native-hide mt-10">
        <Reveal>
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
              Overall score, session by session
              <span className="grow-line" aria-hidden="true" />
            </h2>
            <InfoTip label="What does this chart show?" className="align-middle">
              One dot per recording, oldest on the left. The line is your
              overall score out of 100. Tap any point to open that session.
            </InfoTip>
          </div>
          <div className="mt-3">
            <TrendChart sessions={sessions} />
          </div>
        </Reveal>
      </section>

      {/* The separate Daily Minutes section used to sit here. Gone on
          purpose: it repeated sessions the Past sessions list already shows,
          six hundred pixels apart. Daily reps now carry a small icon in that
          list instead. */}

      {/* 4. Voice skill breakdown */}
      <section className="native-hide mt-12">
        <Reveal>
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
              Where the work is
              <span className="grow-line" aria-hidden="true" />
            </h2>
            <InfoTip label="What are these scores?" className="align-middle">
              Each part of your delivery, scored every session. &ldquo;Latest&rdquo;
              is your most recent take, &ldquo;avg&rdquo; is everything so far.
            </InfoTip>
          </div>
        </Reveal>
        <ul className="mt-4 space-y-4">
          {skillAverages.map((s, i) => (
            <li
              key={s.skill}
              className="stagger-in"
              style={{ animationDelay: `${200 + i * 100}ms` }}
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-base font-medium text-primary">{s.skill}</span>
                <span className="font-data text-sm text-on-surface-variant">
                  latest <span className="text-primary">{s.latest}</span> · avg {s.avg}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-surface-container overflow-hidden">
                <div
                  className={`bar-grow h-full rounded-full ${barClass(s.latest, "bg-accent")}`}
                  style={{
                    width: `${s.latest}%`,
                    animationDelay: `${300 + i * 100}ms`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 5. Body language, when they've used the camera */}
      {stageAverages.length > 0 && (
        <section className="native-hide mt-12">
          <Reveal>
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
                On camera
                <span className="grow-line" aria-hidden="true" />
              </h2>
              <InfoTip label="Where does this come from?" className="align-middle">
                Only from sessions you recorded with the camera on: posture,
                gestures, eye contact and sway.
              </InfoTip>
            </div>
          </Reveal>
          <ul className="mt-4 space-y-4">
            {stageAverages.map((m, i) => (
              <li
                key={m.metric}
                className="stagger-in"
                style={{ animationDelay: `${200 + i * 100}ms` }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-base font-medium text-primary">{m.metric}</span>
                  <span className="font-data text-sm text-on-surface-variant">
                    latest <span className="text-primary">{m.latest}</span> · avg {m.avg}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className={`bar-grow h-full rounded-full ${barClass(m.latest, "bg-violet")}`}
                    style={{
                      width: `${m.latest}%`,
                      animationDelay: `${300 + i * 100}ms`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. Felix's world: how much of the shop is actually theirs. The whole
          section is gated on `shop`, not just its body — BiomeProgress
          returns null without it, which left a heading standing over nothing
          whenever the shop read failed. */}
      {shop && (
        <section className="native-hide mt-12">
          <Reveal>
            <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
              Felix&apos;s world
              <span className="grow-line" aria-hidden="true" />
            </h2>
          </Reveal>
          <Reveal className="mt-4">
            <BiomeProgress shop={shop} />
          </Reveal>
        </section>
      )}

      {/* 7. Session list last */}
      <section className="native-hide mt-12 mb-10">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Past sessions
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <ul className="mt-4 space-y-3">
          {sessions.map((s, i) => (
            <li
              key={s.id}
              className="stagger-in"
              style={{ animationDelay: `${250 + Math.min(i, 8) * 80}ms` }}
            >
              <SessionRow
                session={s}
                onDeleted={(id) =>
                  setSessions((prev) => prev?.filter((x) => x.id !== id) ?? prev)
                }
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
