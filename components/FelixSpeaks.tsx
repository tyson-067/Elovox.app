"use client";

import { Felix, type FelixAccessory, type FelixMood } from "@/components/FoxLogo";
import { useFelixVoice, type FelixVoiceSource } from "@/lib/useFelixVoice";

/**
 * A Felix you can press to hear.
 *
 * Give him `text` and he reads it through /api/voice (signed-in surfaces:
 * the report). Give him `src` and he plays a file (the landing page, whose
 * sample is static so a stranger can hear him for free). Either way the
 * mouth and head move with the sound: lib/useFelixVoice.ts writes the frame
 * onto the wrapper span here, and the fox inside inherits it.
 *
 * `mood` is how he sits at rest; `speakingMood` is how he looks while
 * talking, since a fox with his eyes shut (listening, cheer) reading a
 * report aloud looks asleep at the wheel. Coach, with the glasses, is the
 * natural one.
 *
 * `className` positions the whole control; `foxClassName` sizes the fox,
 * exactly as it would on a bare <Felix>. The cue pill sits at his feet.
 *
 * That pill used to be a speaker icon in a circle, and it did not work: a
 * speaker glyph names an OUTPUT DEVICE, so it reads as "this card has
 * sound" — the same mark a volume slider and a mute toggle wear — and not
 * as "press me". A play triangle and a verb say the one thing it has to.
 */
export function FelixSpeaks({
  text,
  src,
  mood = "coach",
  speakingMood,
  accessory,
  animate = false,
  className = "",
  foxClassName = "",
  label = "Hear Felix",
  cue = "Hear Felix",
  showNote = true,
}: {
  text?: string;
  src?: string;
  mood?: FelixMood;
  speakingMood?: FelixMood;
  accessory?: FelixAccessory | null;
  animate?: boolean;
  className?: string;
  foxClassName?: string;
  /** The accessible name at rest. While speaking it becomes "Stop Felix". */
  label?: string;
  /**
   * What the pill SAYS at rest. Two or three words: it sits at the fox's
   * feet and has to stay legible beside a 104px fox on a phone. Keep it a
   * substring of `label` — WCAG 2.5.3 asks that the accessible name contain
   * the visible one, so "click Hear Felix" works in voice control.
   */
  cue?: string;
  /** Print the failure under him. Off where there is no room (the hero). */
  showNote?: boolean;
}) {
  const { status, error, toggle, bind } = useFelixVoice();
  const source: FelixVoiceSource = src
    ? { kind: "url", url: src }
    : { kind: "text", text: text ?? "" };
  const speaking = status === "speaking";
  const loading = status === "loading";
  const failed = status === "error";
  const shown = speaking && speakingMood ? speakingMood : mood;

  // Visible words and accessible name, decided together so they cannot
  // drift apart: every branch below keeps `cueText` inside `ariaLabel`.
  // "finished" deliberately falls through to the resting pair — a played
  // sample invites the same second press, and the name it answers to must
  // not change under a reader who has already learned it.
  const cueText = speaking ? "Stop" : loading ? "One moment" : failed ? "Try again" : cue;
  const ariaLabel = speaking
    ? "Stop Felix"
    : loading
      ? "One moment, Felix is clearing his throat"
      : failed
        ? `Try again. ${label}`
        : label;

  return (
    <span className={`felix-speaks ${className}`.trim()} data-status={status}>
      <button
        type="button"
        className="felix-speaks-btn"
        onClick={() => toggle(source)}
        aria-pressed={speaking}
        aria-label={ariaLabel}
        title={error ?? (speaking ? "Stop" : label)}
        disabled={!src && !text}
      >
        <span ref={bind} className="block">
          <Felix mood={shown} accessory={accessory} animate={animate} className={foxClassName} />
        </span>
        {/* The invitation. aria-hidden because the button already carries
            all of this in its accessible name — announcing it twice makes a
            screen reader say "Hear Felix, Hear Felix". */}
        <span className="felix-speaks-cue" aria-hidden="true">
          <span className="felix-speaks-cue-icon">
            {failed ? (
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M7 3h2v6H7zM7 11h2v2H7z" />
              </svg>
            ) : speaking ? (
              <svg viewBox="0 0 16 16" fill="currentColor">
                <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
              </svg>
            ) : loading ? (
              <svg viewBox="0 0 16 16" fill="currentColor">
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="13" cy="8" r="1.5" />
              </svg>
            ) : (
              // A play triangle, not a speaker: the speaker is what a volume
              // control wears, and it reads as status rather than as an
              // invitation to press.
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 3.4 12.6 8 5 12.6z" />
              </svg>
            )}
          </span>
          <span className="felix-speaks-cue-text">{cueText}</span>
        </span>
      </button>
      {/* Announced either way; printed only where it fits. */}
      {error && (
        <span role="status" className={showNote ? "felix-speaks-note" : "sr-only"}>
          {error}
        </span>
      )}
    </span>
  );
}
