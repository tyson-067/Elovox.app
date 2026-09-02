"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInkTopBar, useIsNative } from "@/lib/native";
import { notifySuccess } from "@/lib/haptics";
import { canShare, shareTake } from "@/lib/share";
import { CountUp } from "@/components/CountUp";
import { FelixCoach } from "@/components/FelixCoach";
import { Reveal } from "@/components/Reveal";
import { bandForScore, NvBadge, NvConfetti } from "@/components/native/felix";
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

/**
 * One metric, compact: label, a hairline, the number. The coaching line is
 * behind a tap.
 *
 * This used to be a full-width bar with its note printed underneath, six of
 * them in a column — which meant the report's own most important sentence sat
 * at the same weight as its least, and the reader had to grade six paragraphs
 * to find it. The three cards above this list do that grading now; a row here
 * only has to be findable. Nothing is lost: every note is one tap away, and
 * the row says so.
 *
 * Colour is by BAND, not by position. Six festival hues cycling down a list
 * said "these six things are different from each other", which is the one
 * thing they are not.
 */
function MeterRow({
  label,
  score,
  note,
}: {
  label: string;
  score: number;
  note: string;
}) {
  const [open, setOpen] = useState(false);
  const band = bandForScore(score);
  return (
    <div data-band={band}>
      <button
        type="button"
        className="nv-metric-row"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={note ? open : undefined}
        disabled={!note}
      >
        <span className="nv-metric-row-label">{label}</span>
        <span className="nv-meter-track">
          <span className="nv-meter-fill block" style={{ width: `${score}%` }} />
        </span>
        <span className="nv-metric-row-num">{score}</span>
        {/* The affordance. Without it the row is a silent disclosure: the
            coaching line is one tap away and nothing on screen says so, which
            is just hiding it. Rotates to point down while open. */}
        {note && (
          <svg
            className="nv-metric-row-caret"
            width="8"
            height="14"
            viewBox="0 0 8 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m1.5 1.5 5 5.5-5 5.5" />
          </svg>
        )}
      </button>
      {note && open && (
        <p className="nv-metric-note">
          <span>{note}</span>
        </p>
      )}
    </div>
  );
}

/**
 * THE THREE THINGS.
 *
 * Everything here is read out of the analysis the pipeline already produced —
 * nothing is invented, and nothing is scored a second time. The strongest
 * moment comes from `strengths` or a transcript segment the coach marked
 * strong; the gap is simply the lowest of the six; the drill is the first
 * drill, or the first tip when the plan has no drills.
 */
function whatMatters(analysis: Session["analysis"]): {
  keep: { title: string; body: string } | null;
  fix: { title: string; body: string; band: string } | null;
  next: { title: string; body: string } | null;
} {
  const strongSeg = analysis.transcript.find((s) => s.mark === "strong" && s.note);
  const best = [...analysis.skills].sort((a, b) => b.score - a.score)[0];
  /**
   * Title and body must never be the same sentence twice, and the body must
   * never be `analysis.summary` — that is already printed in Felix's bubble
   * two hundred pixels above this card. So the title is the OBSERVATION (a
   * named strength, or the moment the coach marked) and the body is the
   * coaching line that explains it.
   */
  const keepTitle =
    analysis.strengths?.[0] ??
    (strongSeg?.time ? `Keep what you did at ${strongSeg.time}` : null) ??
    (best ? `${best.skill} carried this take` : null);
  const keepBody =
    (analysis.strengths?.[0] ? (strongSeg?.note ?? best?.note) : strongSeg?.note) ??
    best?.note ??
    null;
  const keep = keepTitle && keepBody ? { title: keepTitle, body: keepBody } : null;

  const worst = [...analysis.skills].sort((a, b) => a.score - b.score)[0];
  const fix = worst
    ? {
        title: `${worst.skill} is the one to move`,
        body: worst.note,
        band: bandForScore(worst.score),
      }
    : analysis.tips[0]
      ? { title: "The one to move", body: analysis.tips[0], band: "mid" }
      : null;

  const drill = analysis.drills?.[0];
  const next = drill
    ? { title: drill.title, body: drill.how }
    : analysis.tips[0]
      ? { title: "Next time", body: analysis.tips[0] }
      : null;

  return { keep, fix, next };
}

/** The one word the score gets to say for itself. */
function verdictFor(score: number): string {
  if (score >= 85) return "Flying";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Getting there";
  return "Early days";
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
  const router = useRouter();
  // The report opens on an ink stage, so the status bar owes it light glyphs
  // even in the light theme.
  useInkTopBar(native);

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

  /* The score landing is the payoff of the whole app, and until now it
     arrived in silence. iOS has a notification haptic that means exactly
     "that went well" — it has been exported from lib/haptics.ts and never
     called.

     Gated on the same `celebrate` the confetti uses: a take you JUST
     finished, and a good one. Firing it on every report would spend the
     strongest feedback the phone has on re-reading an old page, and firing
     it on a 41 would be the device congratulating you for a take the screen
     is about to give notes on. */
  useEffect(() => {
    if (!native || !celebrate) return;
    notifySuccess();
  }, [native, celebrate]);

  if (!native) return null;

  const { analysis } = session;
  const band = bandForScore(analysis.overall);
  const matters = whatMatters(analysis);
  /**
   * WHAT THE THREE CARDS ALREADY SAID.
   *
   * "What matters" is built out of the same arrays the sections below render
   * in full — the first strength, the first drill, sometimes the first tip —
   * so without this the report printed the same sentence twice on one screen,
   * once as a hero card and once as list item 1. Each list drops only the
   * entry the cards actually took, matched on its text rather than its index,
   * because which array `matters` reached for depends on what the analysis
   * happened to contain.
   */
  const shown = new Set(
    [matters.keep?.title, matters.fix?.title, matters.next?.title].filter(
      Boolean
    ) as string[]
  );
  const restDrills = (analysis.drills ?? []).filter((d) => !shown.has(d.title));
  const restTips = analysis.tips.filter((t) => !shown.has(t));
  const restStrengths = (analysis.strengths ?? []).filter((s) => !shown.has(s));
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
    // nv-staged: tells the screen-level rule in native-theme.css to drop the
    // top padding, so the ink stage below runs to the top of the document.
    <div className="nv-staged">
      {celebrate && (
        <NvConfetti count={analysis.overall >= 85 ? 40 : 26} originY={230} />
      )}

      {/* THE INK STAGE.
          The score used to be a 148px dial on the paper, which put the one
          number the screen exists for at the same elevation as the cards under
          it. It is the whole page, so it gets the whole top of the screen: a
          deep block bloomed in the colour of the band it landed in, the numeral
          at 88px, and Felix delivering the verdict from inside it.

          The stage carries its own back control and its own status-bar inset,
          which is why /report asks NativeShell for no title bar. */}
      <section
        className="nv-stage"
        data-band={band}
        data-bloom={band === "high" ? "mint" : undefined}
      >
        <div className="flex items-center justify-between pt-3.5">
          <button
            type="button"
            onClick={() => router.back()}
            className="nv-stage-btn"
            aria-label="Back"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m14.5 5-7 7 7 7" />
            </svg>
          </button>
          <span
            className="nv-caption min-w-0 truncate px-3"
            style={{ color: "var(--nv-on-stage-3)" }}
          >
            {titleLabel}
            {session.attempt ? ` · attempt ${session.attempt}` : ""}
          </span>
          {canShare() ? (
            <button
              type="button"
              onClick={() =>
                void shareTake({ score: analysis.overall, title: titleLabel })
              }
              className="nv-stage-btn"
              aria-label="Share this take"
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 15V4" />
                <path d="m8 8 4-4 4 4" />
                <path d="M5 14v5h14v-5" />
              </svg>
            </button>
          ) : (
            <span className="w-9" />
          )}
        </div>

        <div className="pt-3.5 text-center">
          <h1>
            <span className="sr-only">
              Report: scored {analysis.overall} out of 100
            </span>
            <span aria-hidden="true" className="nv-stage-num block">
              <CountUp value={analysis.overall} duration={800} />
            </span>
          </h1>
          <span className="nv-verdict mt-2.5" data-band={band}>
            {verdictFor(analysis.overall)}
            {beatSomething ? " · your best yet" : ""}
          </span>
        </div>

        {/* Felix's take, from inside the stage: his thirty seconds on this
            one, in his voice on request, and the way back into the booth.
            The one Felix on the screen. */}
        <FelixCoach
          variant="native"
          className="mt-5 text-left"
          session={session}
          practiceHref={practiceHref}
          practiceLabel={practiceLabel}
          surface={session.mode === "daily" ? "daily" : "report"}
        />
      </section>

      {/* The analysis's own verdict, which used to sit in a bubble beside
          him on the stage. Still here, still first after the stage: the
          take is the coach's opening line, this is the report's. */}
      <p className="nv-subhead mt-5 text-center">{analysis.summary}</p>

      <p className="nv-footnote mt-5 text-center">
        {session.goal && <>{session.goal} · </>}
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
        <p className="nv-footnote mt-2 text-center">
          Sample feedback, Felix&apos;s real voice analysis arrives when the
          backend is connected
        </p>
      )}

      {session.xpEarned || beatSomething ? (
        <div className="nv-hud mt-3 justify-center">
          {beatSomething && <NvBadge pop="mint">Your best yet</NvBadge>}
          {session.xpEarned ? (
            <NvBadge pop="sun">
              <span className="nv-num">+{session.xpEarned}</span>&nbsp;XP
            </NvBadge>
          ) : null}
        </div>
      ) : null}

      {/* --- WHAT MATTERS ----------------------------------------------------
          Three cards, in the order you'd act on them: what to keep, what to
          move, what to do about it tonight. */}
      {(matters.keep || matters.fix || matters.next) && (
        <>
          <NvSectionHeader>What matters from this take</NvSectionHeader>
          <div className="flex flex-col gap-2.5">
            {matters.keep && (
              <div className="nv-insight" data-band="high">
                <span className="nv-insight-mark" aria-hidden="true">
                  1
                </span>
                <span className="min-w-0">
                  <span className="nv-insight-title">{matters.keep.title}</span>
                  <span className="nv-insight-body">{matters.keep.body}</span>
                </span>
              </div>
            )}
            {matters.fix && (
              <div className="nv-insight" data-band={matters.fix.band}>
                <span className="nv-insight-mark" aria-hidden="true">
                  2
                </span>
                <span className="min-w-0">
                  <span className="nv-insight-title">{matters.fix.title}</span>
                  <span className="nv-insight-body">{matters.fix.body}</span>
                </span>
              </div>
            )}
            {matters.next && (
              <Link href={practiceHref} className="nv-insight" data-ink="">
                <span className="nv-insight-mark" aria-hidden="true">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="nv-insight-title">{matters.next.title}</span>
                  <span className="nv-insight-body">{matters.next.body}</span>
                </span>
              </Link>
            )}
          </div>
        </>
      )}

      {/* The receipt sits directly under the verdict: the score is what you
          did, this is what it bought. */}
      <XpReceipt session={session} />

      {/* The six metrics as meters. Sections render only when their data
          exists — a legacy session missing an array gets a shorter report,
          never an empty card. */}
      {analysis.skills.length > 0 && (
        <>
          <NvSectionHeader>
            All {analysis.skills.length === 6 ? "six " : ""}metrics
          </NvSectionHeader>
          <NvGroup>
            <div className="py-1.5">
              {analysis.skills.map((s) => (
                <MeterRow
                  key={s.skill}
                  label={s.skill}
                  score={s.score}
                  note={s.note}
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
            {/* A space BETWEEN segments, not inside them.
                The transcript is a list of sentence-sized segments and the
                spans were rendered flush, so the reading card said
                "work on.We give those four hours back.It runs in the
                background" — three sentences welded together at every
                boundary. The separator belongs between the spans rather than
                appended to each one's text, so a highlighted segment's mark
                never extends past its last word. */}
            {analysis.transcript.map((seg, i) => (
              <Fragment key={i}>
                {i > 0 && " "}
                {seg.mark ? (
                  <span
                    className={`sweep ${seg.mark === "strong" ? "sweep-strong" : "sweep-flag"}`}
                    style={{ transitionDelay: `${400 + i * 180}ms` }}
                  >
                    {seg.text}
                  </span>
                ) : (
                  <span>{seg.text}</span>
                )}
              </Fragment>
            ))}
          </div>
        </Reveal>
        {notes.length > 0 && (
          <div
            className="flex flex-col gap-3 px-4 py-4"
            style={{ borderTop: "1px solid var(--nv-hairline)" }}
          >
            {notes.map((s, i) => (
              <div key={i} className="flex gap-3">
                {/* Mint dot = keep, ember dot = cut — the same two colours the
                    highlights in the card above use, so the note and the mark
                    it refers to are visibly the same claim. (They used to be
                    ember for keep and amber for cut, which agreed with
                    neither.) The sr-only text carries the distinction for
                    everyone the hue misses. */}
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      s.mark === "strong"
                        ? "var(--nv-mint)"
                        : "var(--nv-accent-500)",
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
              <div className="mt-3">
                {analysis.stage.metrics.map((m) => (
                  <MeterRow
                    key={m.metric}
                    label={m.metric}
                    score={m.score}
                    note={m.note}
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

      {restStrengths.length > 0 && (
        <>
          <NvSectionHeader>What else worked</NvSectionHeader>
          <NvGroup>
            <div className="flex flex-col gap-2.5 px-4 py-4">
              {restStrengths.map((s, i) => (
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

      {restTips.length > 0 && (
        <>
          <NvSectionHeader>Try this next time</NvSectionHeader>
          <NvGroup>
            <div className="px-4 py-4">
              <NumberedTips tips={restTips} />
            </div>
          </NvGroup>
        </>
      )}

      {/* The FIRST drill is already the third card at the top of this report —
          it is the "then what do I do about it" of the three things. Listing
          it again down here printed the same title and the same sentence
          twice on one screen. Only the drills the hero card didn't take. */}
      {restDrills.length > 0 && (
        <>
          <NvSectionHeader>More drills</NvSectionHeader>
          <p className="nv-footnote mb-2 px-1">
            Short, targeted exercises for exactly what this take needs.
          </p>
          <NvGroup>
            {restDrills.map((d, i) => (
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
