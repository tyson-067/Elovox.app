"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useIsNative } from "@/lib/native";
import { CountUp } from "@/components/CountUp";
import { Felix } from "@/components/FoxLogo";
import { Reveal } from "@/components/Reveal";
import {
  bandForScore,
  FelixBubble,
  moodForScore,
  NvBadge,
  NvConfetti,
  popFor,
} from "@/components/native/felix";
import { NvGroup, NvSectionHeader, NvStat } from "@/components/native/ui";
import { LEVELS } from "@/lib/levels";
import { currentOutfit } from "@/lib/quests";
import type { Plan } from "@/lib/plan";
import type { Session } from "@/lib/types";

/**
 * The report at app scale.
 *
 * The web report is a magazine spread — a 120px score, an asymmetric
 * two-column grid, display headings — and in the shell it reads exactly like
 * a website pasted into a frame. This is the same analysis at iOS density:
 * a score dial you can read from arm's length, the six metrics as meters,
 * the transcript as a reading card, the numbers as a stat strip, and every
 * remaining feedback section as an inset-grouped card.
 *
 * Same data, no second source of truth: the page keeps the fetch and all
 * derived values (date label, practice-again href) and passes them down.
 * Renders nothing in a browser; the web markup it replaces carries
 * native-hide.
 */

const DIAL_R = 62;
const DIAL_C = 2 * Math.PI * DIAL_R;

/** Label + meter + coaching line — the report's metric grammar, and the
 *  stage metrics reuse it so the two lists can never disagree. Each row
 *  takes its color from the festival cycle by position. */
function MeterRow({
  label,
  score,
  note,
  index,
}: {
  label: string;
  score: number;
  note: string;
  index: number;
}) {
  return (
    <div className="nv-metric" data-pop={popFor(index)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[15px] font-semibold">{label}</span>
        <span className="nv-num nv-metric-num text-[15px] font-semibold">
          {score}
        </span>
      </div>
      <div className="nv-meter-track mt-2">
        <div className="nv-meter-fill" style={{ width: `${score}%` }} />
      </div>
      {note && <p className="nv-footnote mt-1.5">{note}</p>}
    </div>
  );
}

function NumberedTips({ tips }: { tips: string[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {tips.map((tip, i) => (
        <li key={i} className="flex gap-3">
          <span className="nv-num nv-footnote mt-1 shrink-0">{i + 1}</span>
          <span className="nv-body">{tip}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One line of the receipt, split into what happened and what it paid.
 *
 * `xpForChallengeAttempt` writes its reasons as sentences with the amount
 * folded in, in three shapes:
 *
 *   "Attempt 2 · 87 score"              the base — no amount of its own
 *   "+42 beat your best by 9"           bonus leading
 *   "×1.3 4-day streak (+22)"           multiplier leading, gain trailing
 *
 * A receipt wants the money in one tabular column, so each shape is peeled
 * apart here rather than reworded at the source: those strings are the audit
 * trail for an award that has already been granted, and a display concern is
 * not a reason to change what was recorded. Anything unrecognised falls
 * through as a plain label — a new reason shape shows up as prose, never as a
 * blank row.
 */
function splitReason(reason: string): { label: string; amount: string } {
  const multiplied = reason.match(/^(×[\d.]+)\s+(.*?)\s*\(\+(\d+)\)$/);
  if (multiplied) {
    return { label: `${multiplied[2]} ${multiplied[1]}`, amount: `+${multiplied[3]}` };
  }
  const bonus = reason.match(/^(\+\d+)\s+(.*)$/);
  if (bonus) return { label: bonus[2], amount: bonus[1] };
  return { label: reason, amount: "" };
}

/**
 * THE XP RECEIPT — what this take actually paid, itemised.
 *
 * Levelling used to be a number that changed somewhere off-screen: you'd get
 * "+96 XP" as a chip and no idea which part of the minute earned it. Every
 * line here is one string `xpForChallengeAttempt` already produced when it did
 * the arithmetic — the report is reading its receipt, not recomputing it, so
 * the two can never disagree.
 *
 * Renders only for daily attempts (nothing else has a breakdown) and only for
 * sessions recorded since the reasons were persisted. Everything else keeps
 * the plain +XP badge above.
 */
function XpReceipt({ session }: { session: Session }) {
  const reasons = session.xpReasons ?? [];
  if (reasons.length === 0) return null;

  // The level this take LANDED on: the one it crossed into if it crossed one,
  // otherwise leave the headline to the XP itself. Deriving a live level here
  // would be wrong — the report is a record of a moment, and the user has
  // almost certainly earned more XP since.
  const reached = session.leveledUpTo;
  const level = reached ? LEVELS[reached - 1] : undefined;
  const outfit = reached ? currentOutfit(reached) : null;
  // The unlock is only news if THIS level is the one that granted it.
  const unlocked = outfit && outfit.level === reached ? outfit : null;

  return (
    <div className="nv-xp-card mt-6">
      <div className="flex items-center gap-3.5">
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontFamily: "var(--nv-font-display)",
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: "-0.04em",
            }}
          >
            {level ? `Level ${level.level} — ${level.title}` : "What this earned"}
          </div>
          <div className="nv-footnote mt-1">
            {unlocked
              ? `The ${unlocked.name} is Felix's now.`
              : reached
                ? "A new level, on the same minute."
                : `+${session.xpEarned ?? 0} XP toward your next level.`}
          </div>
        </div>
        {unlocked && (
          <span className="nv-xp-unlock" aria-hidden="true">
            {unlocked.emoji}
          </span>
        )}
      </div>

      <div className="mt-3.5 flex flex-col gap-1.5">
        {reasons.map((r, i) => {
          const line = splitReason(r);
          return (
            <div key={i} className="nv-xp-line">
              <span>{line.label}</span>
              <span className="nv-num">{line.amount}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mono-stroke padlock for the locked-content row (App Store rule: a lock
 *  and reduced opacity, never an upsell). */
function LockGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function NativeReport({
  session,
  plan,
  titleLabel,
  dateLabel,
  practiceHref,
  practiceLabel,
}: {
  session: Session;
  plan: Plan | null;
  /** speechTitle ?? category name — computed by the page, like everything. */
  titleLabel: string;
  dateLabel: string;
  practiceHref: string;
  practiceLabel: string;
}) {
  const native = useIsNative();
  // The dial draws in via the nv-dial-arc transition: first paint holds the
  // empty arc, then one frame later the real offset lands and the CSS eases
  // it round. Under prefers-reduced-motion it starts at the final frame —
  // the nv- class doesn't cover this transition, so the component does.
  const [drawn, setDrawn] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (drawn) return;
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, [drawn]);

  // A take you JUST finished earns a celebration; rereading an old report
  // doesn't. Confetti only for fresh, good takes — rarity is what keeps it
  // worth something.
  //
  // The clock is read ONCE, in a lazy initialiser. Reading it during render is
  // impure, and it also had a real consequence: a re-render three minutes
  // after mount flipped this to false and would have torn a celebration down
  // mid-flight.
  const [celebrate] = useState(
    () =>
      Date.now() - session.createdAt < 3 * 60 * 1000 &&
      session.analysis.overall >= 75
  );

  if (!native) return null;

  const { analysis } = session;
  const arcOffset = DIAL_C * (1 - analysis.overall / 100);
  /**
   * `isNewBest` is true on the FIRST attempt of every day, whatever the score,
   * because there was no previous best to beat (lib/daily.ts:
   * `prior.bestScore === null || score > prior.bestScore`). That is the right
   * value for the XP formula — the improvement bonus should not fire on a
   * first attempt either — and the wrong thing to put on a badge: a 41 came
   * back reading "Your best yet".
   *
   * A record needs something to have been broken, so the badge waits for an
   * attempt that had one to break.
   */
  const beatSomething = Boolean(session.isNewBest && (session.attempt ?? 1) > 1);
  // Legacy sessions can miss durationSec; "NaN:NaN" in the meta line is
  // worse than no duration at all.
  const durationLabel = Number.isFinite(session.durationSec)
    ? `${Math.floor(session.durationSec / 60)}:${String(
        session.durationSec % 60
      ).padStart(2, "0")}`
    : null;
  const notes = analysis.transcript.filter((s) => s.note);

  return (
    <div>
      {celebrate && (
        <NvConfetti count={analysis.overall >= 85 ? 40 : 26} originY={230} />
      )}
      {/* The dial: the score is the page, so it's the h1 — drawn in the
          color of the band it landed in. */}
      <section
        className="flex flex-col items-center pt-6"
        data-band={bandForScore(analysis.overall)}
      >
        <div className="relative h-[148px] w-[148px]" data-parallax="0.05">
          <svg width="148" height="148" viewBox="0 0 148 148" aria-hidden="true">
            <circle
              className="nv-dial-track"
              cx="74"
              cy="74"
              r={DIAL_R}
              fill="none"
              strokeWidth="10"
            />
            <circle
              className="nv-dial-arc"
              cx="74"
              cy="74"
              r={DIAL_R}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={DIAL_C}
              strokeDashoffset={drawn ? arcOffset : DIAL_C}
              transform="rotate(-90 74 74)"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <h1 className="flex flex-col items-center">
              <span className="sr-only">
                Report: scored {analysis.overall} out of 100
              </span>
              <span aria-hidden="true" className="nv-display nv-num text-[44px]">
                {/* Rolls up in step with the arc draw — the two finish
                    together, which is what makes the dial feel like it is
                    LANDING on the score. */}
                <CountUp value={analysis.overall} duration={800} />
              </span>
              <span aria-hidden="true" className="nv-caption mt-1">
                of 100
              </span>
            </h1>
          </div>
        </div>

        {/* The verdict comes FROM Felix now: him beside his summary, mood
            matched to the band — the cheer for a flying take, the professor's
            glasses when there's work to point at. */}
        <div className="mt-4 flex w-full max-w-[46ch] items-start gap-3 text-left">
          <Felix
            mood={moodForScore(analysis.overall)}
            animate
            className="h-14 w-14 shrink-0"
          />
          <FelixBubble className="min-w-0 flex-1">
            {analysis.summary}
          </FelixBubble>
        </div>

        {(session.xpEarned || beatSomething) && (
          <div className="nv-hud mt-3 justify-center">
            {beatSomething && <NvBadge pop="mint">Your best yet</NvBadge>}
            {session.xpEarned ? (
              <NvBadge pop="sun">
                <span className="nv-num">+{session.xpEarned}</span>&nbsp;XP
              </NvBadge>
            ) : null}
          </div>
        )}

        <p className="nv-footnote mt-2 max-w-[44ch] text-center">
          {titleLabel}
          {session.goal && <> · {session.goal}</>}
          {session.attempt && <> · Attempt {session.attempt} of 3</>}
          {" · "}
          {dateLabel}
          {durationLabel && (
            <>
              {" · "}
              <span className="nv-num">{durationLabel}</span>
            </>
          )}
          {" · "}
          <Link href="/ai" className="underline">
            AI-generated
          </Link>
        </p>

        {analysis.isSample && (
          <p className="nv-footnote mt-3 max-w-[44ch] text-center">
            Sample feedback, Felix&apos;s real voice analysis arrives when the
            backend is connected
          </p>
        )}
      </section>

      {/* The receipt sits directly under the verdict: the score is what you
          did, this is what it bought. */}
      <XpReceipt session={session} />

      {/* The six metrics as meters. Sections render only when their data
          exists — a legacy session missing an array gets a shorter report,
          never an empty card. */}
      {analysis.skills.length > 0 && (
        <>
          <NvSectionHeader>How it broke down</NvSectionHeader>
          <NvGroup>
            <div className="flex flex-col gap-5 px-4 py-4">
              {analysis.skills.map((s, i) => (
                <MeterRow
                  key={s.skill}
                  label={s.skill}
                  score={s.score}
                  note={s.note}
                  index={i}
                />
              ))}
            </div>
          </NvGroup>
        </>
      )}

      {/* The transcript as a reading card. The sweep spans and their delays
          are the web's, verbatim — the marks are the meaning — and the
          Reveal wrapper is what fires them (.reveal-visible .sweep).
          native-selectable: this is the one surface people actually copy. */}
      {analysis.transcript.length > 0 && (
      <>
      <NvSectionHeader>What you said</NvSectionHeader>
      <NvGroup>
        <Reveal className="px-4 py-4">
          <div className="native-selectable nv-body">
            {analysis.transcript.map((seg, i) =>
              seg.mark ? (
                <span
                  key={i}
                  className={`sweep ${seg.mark === "strong" ? "sweep-strong" : "sweep-flag"}`}
                  style={{ transitionDelay: `${400 + i * 180}ms` }}
                >
                  {seg.text}
                </span>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )}
          </div>
        </Reveal>
        {notes.length > 0 && (
          <div
            className="flex flex-col gap-3 px-4 py-4"
            style={{ borderTop: "1px solid var(--nv-hairline)" }}
          >
            {notes.map((s, i) => (
              <div key={i} className="flex gap-3">
                {/* Accent dot = keep, warning dot = cut; the sr-only text
                    carries the distinction for everyone the hue misses. */}
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      s.mark === "strong"
                        ? "var(--nv-accent-500)"
                        : "var(--nv-warning)",
                  }}
                >
                  <span className="sr-only">
                    {s.mark === "strong" ? "Strong moment: " : "Worth cutting: "}
                  </span>
                </span>
                <span className="nv-subhead min-w-0">
                  {s.time && <span className="nv-num mr-2">{s.time}</span>}
                  {s.note}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Why some words are hashed out, and what it cost. Sits inside the
            transcript card because that is where the evidence is — a notice
            somewhere else would read as unrelated. */}
        {analysis.languageNotice && (
          <div
            className="px-4 py-3"
            style={{ borderTop: "1px solid var(--nv-hairline)" }}
          >
            <p className="nv-subhead" style={{ color: "var(--nv-warning)" }}>
              {analysis.languageNotice}
            </p>
          </div>
        )}
      </NvGroup>
      </>
      )}

      {/* The numbers. */}
      {analysis.paceWpm != null && (
        <>
          <NvSectionHeader>The numbers</NvSectionHeader>
          <NvGroup>
            <div className="grid grid-cols-3 gap-2 px-4 py-4">
              <NvStat value={analysis.paceWpm} label="words / min" />
              <NvStat value={analysis.fillerWords} label="filler words" />
              <NvStat value={analysis.pauses} label="long pauses" />
            </div>
          </NvGroup>
        </>
      )}

      {/* The camera pass (only when they recorded with video on). */}
      {analysis.stage && (
        <>
          <NvSectionHeader>How you looked</NvSectionHeader>
          <NvGroup>
            <div className="px-4 py-4">
              <div className="flex items-baseline gap-2">
                <span className="nv-stat-value nv-num">
                  {analysis.stage.overall}
                </span>
                <span className="nv-stat-label">/ 100 presence</span>
              </div>
              <p className="nv-subhead mt-2">{analysis.stage.summary}</p>
              <div className="mt-4 flex flex-col gap-5">
                {analysis.stage.metrics.map((m, i) => (
                  <MeterRow
                    key={m.metric}
                    label={m.metric}
                    score={m.score}
                    note={m.note}
                    index={i}
                  />
                ))}
              </div>
              {analysis.stage.tips.length > 0 && (
                <div className="mt-4">
                  <NumberedTips tips={analysis.stage.tips} />
                </div>
              )}
            </div>
          </NvGroup>
        </>
      )}

      {analysis.strengths && analysis.strengths.length > 0 && (
        <>
          <NvSectionHeader>What worked</NvSectionHeader>
          <NvGroup>
            <div className="flex flex-col gap-2.5 px-4 py-4">
              {analysis.strengths.map((s, i) => (
                <div key={i} className="flex gap-3">
                  <span
                    className="mt-2 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: "var(--nv-accent-500)" }}
                    aria-hidden="true"
                  />
                  <span className="nv-body">{s}</span>
                </div>
              ))}
            </div>
          </NvGroup>
        </>
      )}

      {analysis.audienceImpact && (
        <>
          <NvSectionHeader>How the audience heard it</NvSectionHeader>
          <NvGroup>
            <p className="nv-body px-4 py-4">{analysis.audienceImpact}</p>
          </NvGroup>
        </>
      )}

      {analysis.tips.length > 0 && (
        <>
          <NvSectionHeader>Try this next time</NvSectionHeader>
          <NvGroup>
            <div className="px-4 py-4">
              <NumberedTips tips={analysis.tips} />
            </div>
          </NvGroup>
        </>
      )}

      {analysis.drills && analysis.drills.length > 0 && (
        <>
          <NvSectionHeader>Drills to run</NvSectionHeader>
          <p className="nv-footnote mb-2 px-1">
            Short, targeted exercises for exactly what this take needs.
          </p>
          <NvGroup>
            {analysis.drills.map((d, i) => (
              <div
                key={i}
                className="px-4 py-4"
                style={
                  i > 0
                    ? { borderTop: "1px solid var(--nv-hairline)" }
                    : undefined
                }
              >
                <h3 className="nv-headline">{d.title}</h3>
                <p className="nv-footnote mt-1">{d.how}</p>
              </div>
            ))}
          </NvGroup>
        </>
      )}

      {/* What the free report doesn't include. A lock and lowered opacity,
          nothing else — no prices, no CTA, per App Store rules. */}
      {plan === "free" && !analysis.isSample && (
        <div className="mt-7 opacity-60">
          <NvGroup>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="nv-icon-square" aria-hidden="true">
                <LockGlyph />
              </span>
              <span className="min-w-0 flex-1">
                <span className="nv-body block">
                  <span className="sr-only">Locked: </span>Full breakdown
                </span>
                <span className="nv-footnote block">
                  Strengths, drills, line-by-line notes and camera coaching.
                </span>
              </span>
            </div>
          </NvGroup>
        </div>
      )}

      <div className="mb-4 mt-8 flex flex-col gap-3">
        <Link href={practiceHref} className="nv-btn nv-btn-primary">
          {practiceLabel}
        </Link>
        {/* Back to the climb, not sideways into another screen. The report is
            the end of a rep; the ladder is where the next one starts. */}
        <Link href="/dashboard" className="nv-btn nv-btn-secondary">
          Back to the ladder
        </Link>
      </div>
    </div>
  );
}
