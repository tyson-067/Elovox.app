"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { listSessions } from "@/lib/store";
import { getCategory } from "@/lib/categories";
import { getStats, MAX_DAILY_ATTEMPTS, type UserStats } from "@/lib/daily";
import { LEVELS } from "@/lib/levels";
import type { Session } from "@/lib/types";

function TrendChart({ sessions }: { sessions: Session[] }) {
  // Oldest → newest, left to right
  const points = [...sessions].reverse().map((s) => s.analysis.overall);
  const w = 720;
  const h = 200;
  const pad = 24;

  if (points.length === 1) points.push(points[0]);

  const min = Math.max(0, Math.min(...points) - 10);
  const max = Math.min(100, Math.max(...points) + 10);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Overall score across sessions">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#c6c6ce" strokeWidth="1" />
      {/* pathLength=1 normalizes the dash animation (.chart-draw) so the
          line draws itself in regardless of its real length */}
      <path
        d={path}
        pathLength={1}
        className="chart-draw"
        fill="none"
        stroke="#e8792f"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(p)}
          r="4"
          fill="#2e3a66"
          className="chart-dot"
          style={{
            animationDelay: `${150 + (i / (points.length - 1)) * 1300}ms`,
          }}
        />
      ))}
      <text x={pad} y={y(points[0]) - 10} fontSize="12" fill="#45464d" fontFamily="var(--font-geist-mono)">
        {points[0]}
      </text>
      <text
        x={x(points.length - 1)}
        y={y(points[points.length - 1]) - 10}
        fontSize="12"
        fill="#2e3a66"
        fontFamily="var(--font-geist-mono)"
        textAnchor="end"
      >
        {points[points.length - 1]}
      </text>
    </svg>
  );
}

/** Level, XP, streak — the headline of the whole tab now. */
function LevelPanel({ stats }: { stats: UserStats }) {
  const { level } = stats;
  const nextTitle = LEVELS[level.level]?.title;

  return (
    <GlowCard className="card navy-gradient border-none! p-6 md:p-8 text-white">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <span className="text-[13px] font-semibold tracking-[0.06em] uppercase text-white/70">
            Level {level.level}
          </span>
          <div className="font-headline text-4xl font-semibold">{level.title}</div>
        </div>
        <div className="flex items-center gap-8">
          <div>
            <div className="font-data text-2xl">{stats.streakDays}</div>
            <div className="text-[12px] text-white/70">day streak</div>
          </div>
          <div>
            <div className="font-data text-2xl">{stats.challengesCompleted}</div>
            <div className="text-[12px] text-white/70">challenges</div>
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
          : `${level.xpForNextLevel} XP to Level ${level.level + 1} — ${nextTitle}`}
      </p>
    </GlowCard>
  );
}

/**
 * Daily challenges, grouped by day, showing all three attempts. This is
 * where improvement actually shows: same topic, three goes, did the
 * number move?
 */
function ChallengeHistory({ sessions }: { sessions: Session[] }) {
  const days = useMemo(() => {
    const byDate = new Map<string, Session[]>();
    for (const s of sessions) {
      if (s.mode !== "daily" || !s.challengeDate) continue;
      byDate.set(s.challengeDate, [...(byDate.get(s.challengeDate) ?? []), s]);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, reps]) => {
        const ordered = [...reps].sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0));
        const scores = ordered.map((r) => r.analysis.overall);
        return {
          date,
          title: ordered[0]?.speechTitle ?? "Daily challenge",
          reps: ordered,
          best: Math.max(...scores),
          gain: scores.length > 1 ? scores[scores.length - 1] - scores[0] : null,
        };
      });
  }, [sessions]);

  if (days.length === 0) return null;

  return (
    <section className="mt-12">
      <Reveal>
        <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
          Daily challenges
          <span className="grow-line" aria-hidden="true" />
        </h2>
      </Reveal>
      <ul className="mt-4 space-y-3">
        {days.map((day, i) => (
          <li
            key={day.date}
            className="stagger-in"
            style={{ animationDelay: `${200 + Math.min(i, 8) * 80}ms` }}
          >
            <GlowCard className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate text-base font-medium text-primary">
                    {day.title}
                  </span>
                  <span className="mt-0.5 block text-[13px] font-semibold tracking-wide text-on-surface-variant">
                    {new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    <span className="mx-1.5">·</span>
                    best <span className="font-data text-primary">{day.best}</span>
                    {day.gain !== null && day.gain !== 0 && (
                      <>
                        <span className="mx-1.5">·</span>
                        <span className={day.gain > 0 ? "text-accent" : "text-amber"}>
                          {day.gain > 0 ? "+" : ""}
                          {day.gain} across attempts
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {Array.from({ length: MAX_DAILY_ATTEMPTS }, (_, slot) => {
                    const rep = day.reps[slot];
                    return rep ? (
                      <Link
                        key={slot}
                        href={`/report/${rep.id}`}
                        className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-primary px-3 font-data text-sm text-white transition-opacity hover:opacity-80"
                        aria-label={`Attempt ${slot + 1}, score ${rep.analysis.overall}`}
                      >
                        {rep.analysis.overall}
                      </Link>
                    ) : (
                      <span
                        key={slot}
                        className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-primary/20 px-3 font-data text-sm text-on-surface-variant"
                      >
                        –
                      </span>
                    );
                  })}
                </div>
              </div>
            </GlowCard>
          </li>
        ))}
      </ul>
    </section>
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
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((s) => !cancelled && setSessions(s))
      .catch(() => !cancelled && setSessions([]));
    getStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const skillAverages = useMemo(() => {
    if (!sessions?.length) return [];
    const byName = new Map<string, number[]>();
    for (const s of sessions) {
      for (const sk of s.analysis.skills) {
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

  if (sessions === null) return null;

  if (sessions.length === 0) {
    return (
      <div className="stagger-in py-16 max-w-[640px] mx-auto">
        <h1 className="text-title font-headline font-semibold text-primary">
          Nothing here yet
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          Your first recording becomes your baseline. Everything after that is
          progress you can see — and today&apos;s challenge is waiting.
        </p>
        <Link
          href="/practice?daily=1"
          className="btn rounded-lg mt-8 inline-block bg-accent text-white font-semibold px-8 py-3.5"
        >
          Start today&apos;s challenge
        </Link>
      </div>
    );
  }

  return (
    <div className="py-8 md:py-12">
      <h1 className="text-title font-headline font-semibold text-primary">
        <WordReveal text="Your progress" delay={80} />
      </h1>

      {/* 1. Level and streak — the running story */}
      {stats && (
        <section className="mt-8">
          <Reveal>
            <LevelPanel stats={stats} />
          </Reveal>
        </section>
      )}

      {/* 2. Trend line */}
      <section className="mt-10">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Overall score, session by session
            <span className="grow-line" aria-hidden="true" />
          </h2>
          <div className="mt-3">
            <TrendChart sessions={sessions} />
          </div>
        </Reveal>
      </section>

      {/* 3. Daily challenge attempts, day by day */}
      <ChallengeHistory sessions={sessions} />

      {/* 4. Voice skill breakdown */}
      <section className="mt-12">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Where the work is
            <span className="grow-line" aria-hidden="true" />
          </h2>
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
                  className={`bar-grow h-full rounded-full ${s.latest >= 75 ? "bg-accent" : "bg-amber"}`}
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
        <section className="mt-12">
          <Reveal>
            <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
              On camera
              <span className="grow-line" aria-hidden="true" />
            </h2>
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
                    className={`bar-grow h-full rounded-full ${m.latest >= 75 ? "bg-violet" : "bg-amber"}`}
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

      {/* 6. Session list last */}
      <section className="mt-12 mb-10">
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
              <GlowCard className="card">
                <Link
                  href={`/report/${s.id}`}
                  className="flex items-center gap-4 p-4"
                >
                <span className="font-data text-xl text-primary w-12 shrink-0 text-right">
                  {s.analysis.overall}
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
                        <span className="text-accent">camera</span>
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
              </GlowCard>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
