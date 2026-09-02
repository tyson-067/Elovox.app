"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Felix } from "@/components/FoxLogo";
import { trackEvent, type EventProps, type FelixEvent } from "@/lib/analytics";
import { goalFocus } from "@/lib/felixTake";
import { loadFelixTake, type FelixTakeResult } from "@/lib/felixTakeClient";
import { useFelixVoice, type FelixVoiceSource } from "@/lib/useFelixVoice";
import type { Session } from "@/lib/types";

/**
 * Felix's take: the module at the top of every report.
 *
 * Head on the left, his thirty seconds on the right, and the two things to
 * do with it: hear him say it, or go again. The written line is always
 * there, so nothing depends on the audio; the audio, when pressed, moves his
 * mouth to the sound (lib/useFelixVoice.ts) and never starts on its own.
 *
 * Two layers, so the landing page can show the same card with a static
 * sample and no session:
 *
 *   <FelixCoach>      the session-aware one: fetches (or reads back) the
 *                     take, wires the analytics, picks the audio source.
 *   <FelixCoachCard>  the card itself, given a line and a source.
 *
 * `variant="native"` swaps the type and button classes for the app shell's
 * (nv-*), inside the report's ink stage. Layout is shared: it's the same
 * card, in the other dress.
 */

export type FelixCoachVariant = "web" | "native";
export type FelixCoachEvent = "shown" | "played" | "replayed" | "completed" | "try_again";

const EVENT: Record<FelixCoachEvent, FelixEvent> = {
  shown: "felix_feedback_shown",
  played: "felix_feedback_played",
  replayed: "felix_feedback_replayed",
  completed: "felix_feedback_completed",
  try_again: "felix_try_again_clicked",
};

const REVIEWING = "Felix is reviewing how you came across…";

const CLASSES: Record<
  FelixCoachVariant,
  { kicker: string; intro: string; text: string; note: string; primary: string; secondary: string; link: string }
> = {
  web: {
    kicker: "text-kicker uppercase text-on-surface-variant",
    intro: "mt-1 font-headline text-h4 font-semibold text-primary",
    // Body size on a phone, where the take runs the card's full width under
    // the head; the report size from md, beside him.
    text: "mt-2 text-base leading-6 text-on-surface md:text-lg md:leading-7",
    note: "mt-2 text-sm leading-5 text-on-surface-variant",
    primary:
      "btn inline-flex items-center gap-2 rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-progress disabled:opacity-70",
    secondary:
      "pill inline-flex items-center gap-2 rounded-[0.375rem] border border-primary/20 px-5 py-2.5 text-sm font-semibold text-primary hover:border-primary/40 disabled:cursor-progress disabled:opacity-70",
    link: "text-sm font-semibold text-on-surface-variant underline underline-offset-2 hover:text-primary",
  },
  native: {
    kicker: "nv-caption",
    intro: "nv-subhead mt-0.5 font-semibold",
    text: "nv-body mt-1.5",
    note: "nv-footnote mt-2",
    primary: "nv-btn nv-btn-primary disabled:opacity-60",
    secondary: "nv-btn nv-btn-secondary disabled:opacity-60",
    link: "nv-footnote underline",
  },
};

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  );
}
function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
      <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
    </svg>
  );
}
function ReplayGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 2.5v3h-3" />
    </svg>
  );
}

export function FelixCoachCard({
  variant = "web",
  kicker = "Felix's take",
  intro,
  text,
  loading = false,
  note,
  onRetryTake,
  source,
  audioLabel = "Hear Felix's feedback",
  action,
  onEvent,
  className = "",
}: {
  variant?: FelixCoachVariant;
  /** The label above the line. */
  kicker?: string;
  /** An optional headline between the kicker and the line ("Here's how you came across."). */
  intro?: string;
  /** What he says. Null while it's being written. */
  text: string | null;
  /** The take is still being written: the line reads as a status. */
  loading?: boolean;
  /** A quiet line under the take, for a fallback ("straight from your report"). */
  note?: string | null;
  /** Offered beside the note: ask the model again. */
  onRetryTake?: () => void;
  /** What the audio button plays. Null hides the button. */
  source: FelixVoiceSource | null;
  /** The audio button's label at rest. */
  audioLabel?: string;
  /** The way on: "Try again" on a report, "Try it free" on the landing page. */
  action?: { href: string; label: string };
  onEvent?: (e: FelixCoachEvent) => void;
  className?: string;
}) {
  const { status, error, speak, pause, resume, bind, bindProgress } = useFelixVoice();

  // played / replayed / completed come from what the engine actually did,
  // not from the tap: a tap that failed to fetch is not a play.
  const plays = useRef(0);
  const prev = useRef(status);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (status === "speaking" && was === "loading") {
      plays.current += 1;
      onEvent?.(plays.current > 1 ? "replayed" : "played");
    } else if (status === "finished" && was === "speaking") {
      onEvent?.("completed");
    }
  }, [status, onEvent]);

  const shown = useRef(false);
  useEffect(() => {
    if (text && !loading && !shown.current) {
      shown.current = true;
      onEvent?.("shown");
    }
  }, [text, loading, onEvent]);

  const onAudio = () => {
    if (!source) return;
    if (status === "speaking") pause();
    else if (status === "paused") resume();
    else void speak(source);
  };

  const c = CLASSES[variant];
  const heard = status === "finished";
  const busy = status === "loading";
  const label =
    status === "loading"
      ? "Loading…"
      : status === "speaking"
        ? "Pause"
        : status === "paused"
          ? "Resume"
          : status === "finished"
            ? "Replay"
            : status === "error"
              ? "Try the voice again"
              : audioLabel;
  const glyph =
    status === "speaking" ? <PauseGlyph /> : status === "finished" ? <ReplayGlyph /> : <PlayGlyph />;

  return (
    <section
      className={`felix-coach ${className}`.trim()}
      data-variant={variant}
      data-audio={status}
      data-heard={heard || undefined}
      aria-label={kicker}
    >
      {/* The face. The frame values land on this span (see useFelixVoice)
          and the fox inside inherits them. At rest it breathes, very
          slightly; while he talks the nod from the audio takes over. */}
      <span
        ref={bind}
        className="felix-coach-portrait"
        data-state={status === "speaking" ? "speaking" : loading ? "thinking" : "idle"}
      >
        <Felix crop="portrait" mood="coach" />
      </span>

      <div className="felix-coach-body min-w-0">
        {/* One grid item on a phone, where the body is display: contents
            (globals.css): the heading sits beside the head and everything
            under it takes the card's full width. */}
        <div className="felix-coach-heading">
          <p className={c.kicker}>{kicker}</p>
          {intro && <p className={c.intro}>{intro}</p>}
        </div>
        {/* Announced when it changes from the status line to the take, so a
            screen reader hears the take arrive without having to look. */}
        <p className={`felix-coach-text ${c.text}`} aria-live="polite" role={loading ? "status" : undefined}>
          {loading || !text ? REVIEWING : text}
        </p>
        {note && (
          <p className={`felix-coach-note ${c.note}`}>
            {note}
            {onRetryTake && (
              <>
                {" "}
                <button type="button" onClick={onRetryTake} className={c.link}>
                  Ask Felix again
                </button>
              </>
            )}
          </p>
        )}

        {/* A hairline that fills as he talks. Driven by --felix-progress on
            this element, written by the engine, never through React. */}
        <span ref={bindProgress} className="felix-coach-progress" aria-hidden="true">
          <span className="felix-coach-progress-fill" />
        </span>

        <div className="felix-coach-actions">
          {source && !loading && (
            <button
              type="button"
              onClick={onAudio}
              disabled={busy}
              aria-busy={busy || undefined}
              className={heard ? c.secondary : c.primary}
            >
              {glyph}
              {label}
            </button>
          )}
          {action && (
            <Link
              href={action.href}
              onClick={() => onEvent?.("try_again")}
              className={heard || !source || loading ? c.primary : c.secondary}
            >
              {action.label}
            </Link>
          )}
        </div>
        {error && (
          <p role="status" className={`felix-coach-note ${c.note}`}>
            {error} His notes are above.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The session-aware module. Reads the take back off the session when it
 * has one, asks /api/felix once when it hasn't, and falls back to a line
 * built from the report when neither is possible, so the card always has
 * something to say.
 */
export function FelixCoach({
  session,
  practiceHref,
  practiceLabel,
  variant = "web",
  surface = "report",
  className = "",
}: {
  session: Session;
  practiceHref: string;
  practiceLabel: string;
  variant?: FelixCoachVariant;
  /** Where the module sits. The Daily Minute gets the intro line. */
  surface?: "report" | "daily";
  className?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  // Keyed by session and attempt rather than reset in the effect, so a
  // switch of report shows the status line again with no setState in the
  // effect body.
  const [state, setState] = useState<{
    id: string;
    attempt: number;
    result: FelixTakeResult;
  } | null>(null);
  const result =
    state && state.id === session.id && state.attempt === attempt ? state.result : null;

  useEffect(() => {
    let cancelled = false;
    void loadFelixTake(session).then((r) => {
      if (!cancelled) setState({ id: session.id, attempt, result: r });
    });
    return () => {
      cancelled = true;
    };
  }, [session, attempt]);

  const props: EventProps = {
    surface,
    variant,
    mode: session.mode ?? "unknown",
    goal: goalFocus(session.goal).id ?? "none",
  };
  const onEvent = useCallback(
    (e: FelixCoachEvent) => {
      trackEvent(EVENT[e], {
        ...props,
        ...(result ? { source: result.take.source, cached: result.cached } : {}),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, variant, session.mode, session.goal, result?.take.source, result?.cached]
  );

  const take = result?.take ?? null;
  const fallback = take?.source === "fallback";
  const reason = result?.reason ?? "";
  const note = !fallback
    ? null
    : reason === "sample"
      ? null
      : reason === "unconfigured"
        ? "Felix's written notes, straight from your report."
        : "Felix couldn't write a fresh take just now, so this one is straight from your report.";
  const canRetry = fallback && reason !== "sample" && reason !== "unconfigured";

  const source: FelixVoiceSource | null = take
    ? result?.persisted
      ? { kind: "session", sessionId: session.id, text: take.text }
      : { kind: "text", text: take.text }
    : null;

  return (
    <FelixCoachCard
      variant={variant}
      intro={surface === "daily" ? "Here's how you came across." : undefined}
      text={take?.text ?? null}
      loading={!result}
      note={note}
      onRetryTake={canRetry ? () => setAttempt((a) => a + 1) : undefined}
      source={source}
      action={{ href: practiceHref, label: practiceLabel }}
      onEvent={onEvent}
      className={className}
    />
  );
}
