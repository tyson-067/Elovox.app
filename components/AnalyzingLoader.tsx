"use client";

import { useEffect, useState } from "react";
import { Felix } from "@/components/FoxLogo";

// What the user sees while a finished take is being analysed.
//
// This replaced a single pulsing line of text. Analysis genuinely takes a
// while (the upload, then transcription, then the model), and one unchanging
// sentence on an otherwise empty screen reads as a hang, not as progress:
// people were reloading mid-analysis and losing the recording. So the loader
// names what is happening and keeps changing, which is the honest version of
// a progress bar for work whose duration we cannot predict.
//
// The stages are time-driven rather than event-driven on purpose. The API is
// one request with no intermediate reporting, so a "real" bar would be a lie
// with extra steps; these are the phases the request actually goes through,
// paced to how long each one usually takes. The last stage has no successor,
// so a slow analysis settles on "putting your notes together" and stays
// there rather than completing to 100% and sitting at a finished bar.

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

export function AnalyzingLoader({ withVideo = false }: { withVideo?: boolean }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    // One timer per upcoming stage, all set at mount: simpler than a ticking
    // interval, and it can't drift.
    const timers = STAGES.slice(1).map((s, i) =>
      setTimeout(() => setStage(i + 1), s.at)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const current = STAGES[stage];
  const label = (withVideo && current.videoLabel) || current.label;

  return (
    // Sits on the dark stage panel (bg-oxford), so every colour here is a
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
        {/* `key` restarts the fade whenever the stage changes. */}
        <p
          key={stage}
          className="loader-caption font-headline text-lg font-semibold text-white"
        >
          {label}
        </p>

        <div className="flex items-center gap-1.5" aria-hidden="true">
          {STAGES.map((s, i) => (
            <span
              key={s.at}
              className={`loader-step ${i <= stage ? "loader-step-on" : ""}`}
              style={{ width: i === stage ? 22 : 10 }}
            />
          ))}
        </div>

        <p className="text-[13px] leading-5 text-white/55 max-w-[34ch]">
          This takes a few seconds. Stay on this page, your report opens by
          itself.
        </p>
      </div>
    </div>
  );
}
