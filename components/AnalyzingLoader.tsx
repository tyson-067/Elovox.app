"use client";

import { useEffect, useState } from "react";
import { Felix } from "@/components/FoxLogo";
import type { LiveMetrics } from "@/lib/analyze";

// What the user sees while a finished take is being analyzed.
//
// This replaced a single pulsing line of text. Analysis genuinely takes a
// while (the upload, then transcription, then the model), and one unchanging
// sentence on an otherwise empty screen reads as a hang, not as progress:
// people were reloading mid-analysis and losing the recording. So the loader
// names what is happening and keeps changing, which is the honest version of
// a progress bar for work whose duration we cannot predict.
//
// The stages are time-driven rather than event-driven — with ONE real event
// now wired in: the moment transcription lands, the analyze stream sends the
// measured metrics, and the parent passes them in as `metrics`. That flips the
// caption to the model stage and shows the actual pace/filler/pause numbers, so
// the back half of the wait is spent looking at real results instead of a
// spinner. Everything before that first event is still paced to how long each
// phase usually takes, because the request reports nothing until then.

interface Stage {
  /** Milliseconds from the start of analysis when this stage takes over. */
  at: number;
  label: string;
  /** Shown instead of `label` when the take had video. */
  videoLabel?: string;
}

const STAGES: Stage[] = [
  { at: 0, label: "Saving your take" },
  {
    at: 2500,
    label: "Listening back, word by word",
    videoLabel: "Watching that back, voice and body",
  },
  { at: 11000, label: "Reading your delivery" },
  { at: 22000, label: "Putting your notes together" },
];

export function AnalyzingLoader({
  withVideo = false,
  metrics = null,
}: {
  withVideo?: boolean;
  /** Delivery numbers streamed the instant transcription finishes. Null until
   *  then; once set, the loader shows them and jumps to the model stage. */
  metrics?: LiveMetrics | null;
}) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    // One timer per upcoming stage, all set at mount: simpler than a ticking
    // interval, and it can't drift.
    const timers = STAGES.slice(1).map((s, i) =>
      setTimeout(() => setStage(i + 1), s.at)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Metrics arriving IS transcription finishing, so don't let a slow timer hold
  // the caption on "Listening back" while the real numbers are already on
  // screen — jump to at least the model stage (index 2, "Reading your
  // delivery"). Never move backwards if the timers are already further along.
  const effectiveStage = metrics ? Math.max(stage, 2) : stage;
  const current = STAGES[effectiveStage];
  const label = (withVideo && current.videoLabel) || current.label;

  return (
    // Sits on the dark stage panel (bg-oxford), so every color here is a
    // light-on-dark one, and it covers the frozen waveform (or the last
    // camera frame) still sitting underneath rather than competing with it.
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-oxford/90 px-6 text-center backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="loader-ring relative h-[88px] w-[88px]">
        <span className="loader-halo" aria-hidden="true" />
        <span className="loader-track" aria-hidden="true" />
        <span className="loader-sweep" aria-hidden="true" />
        <span className="loader-orbit" aria-hidden="true" />
        {/* Felix sits inside the ring with his eyes shut, which is the same
            "he's listening" pose the rest of the screen uses. */}
        <Felix mood="listening" className="absolute inset-0 m-auto h-12 w-12" />
      </div>

      <div className="flex flex-col items-center gap-2.5">
        {/* `key` restarts the fade whenever the caption changes. */}
        <p
          key={effectiveStage}
          className="loader-caption font-headline text-lg font-semibold text-white"
        >
          {label}
        </p>

        <div className="flex items-center gap-1.5" aria-hidden="true">
          {STAGES.map((s, i) => (
            <span
              key={s.at}
              className={`loader-step ${i <= effectiveStage ? "loader-step-on" : ""}`}
              style={{ width: i === effectiveStage ? 22 : 10 }}
            />
          ))}
        </div>

        {metrics ? (
          // Real numbers, the moment they exist — the honest "we've heard you"
          // signal that the coaching is now being written on top of these.
          <div className="mt-1 flex items-stretch gap-2.5">
            <Stat value={metrics.paceWpm} unit="wpm" label="pace" />
            <Stat value={metrics.fillerWords} label="fillers" />
            <Stat value={metrics.pauses} label="pauses" />
          </div>
        ) : (
          <p className="text-label leading-5 text-white/80 max-w-[34ch]">
            This takes a few seconds. Stay on this page, your report opens by
            itself.
          </p>
        )}
      </div>
    </div>
  );
}

// One metric tile in the loader's early-results row. Light-on-dark to match the
// stage panel it sits on.
function Stat({
  value,
  unit,
  label,
}: {
  value: number;
  unit?: string;
  label: string;
}) {
  return (
    <div className="flex min-w-[64px] flex-col items-center rounded-lg bg-white/10 px-3 py-2">
      <span className="font-data text-lg font-bold leading-none text-white">
        {value}
        {unit ? <span className="ml-0.5 text-xs font-medium text-white/85">{unit}</span> : null}
      </span>
      <span className="mt-1 text-micro uppercase tracking-wide text-white/80">
        {label}
      </span>
    </div>
  );
}
