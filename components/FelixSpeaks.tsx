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
 * exactly as it would on a bare <Felix>. The pressable badge scales with him.
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
  /** Print the failure under him. Off where there is no room (the hero). */
  showNote?: boolean;
}) {
  const { status, error, toggle, bind } = useFelixVoice();
  const source: FelixVoiceSource = src
    ? { kind: "url", url: src }
    : { kind: "text", text: text ?? "" };
  const speaking = status === "speaking";
  const loading = status === "loading";
  const shown = speaking && speakingMood ? speakingMood : mood;

  return (
    <span className={`felix-speaks ${className}`.trim()} data-status={status}>
      <button
        type="button"
        className="felix-speaks-btn"
        onClick={() => toggle(source)}
        aria-pressed={speaking}
        aria-label={speaking ? "Stop Felix" : loading ? "Felix is clearing his throat" : label}
        title={error ?? (speaking ? "Stop" : label)}
        disabled={!src && !text}
      >
        <span ref={bind} className="block">
          <Felix mood={shown} accessory={accessory} animate={animate} className={foxClassName} />
        </span>
        <span className="felix-speaks-badge" aria-hidden="true">
          {status === "error" ? (
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M7 3h2v6H7zM7 11h2v2H7z" />
            </svg>
          ) : speaking ? (
            <svg viewBox="0 0 16 16" fill="currentColor">
              <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 6h2.6L8 3.2v9.6L4.6 10H2z" />
              <path
                d="M10.2 5.4a3.2 3.2 0 0 1 0 5.2M12 3.4a6 6 0 0 1 0 9.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
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
