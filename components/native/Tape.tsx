"use client";

import { todayKey } from "@/lib/daily";
import type { Session } from "@/lib/types";

/**
 * THE TAPE — the last fourteen days drawn as sound.
 *
 * The app's signature element, in the exact bar grammar of Felix's chest and
 * the app icon: 6px wide, 3px-radius ends, a shared midline. A settled day
 * stands at its score's amplitude; a missed day is a ghost stub; today, while
 * attempts remain, is orange and breathes.
 *
 * THE BINDING RULE (globals.css, with .voxline): voice bars appear only for
 * quantities the user's VOICE produced — days practiced, and the live waveform
 * on the stage. Never for navigation, buttons, dividers or decoration.
 *
 * It used to open the home screen. The Ladder answers the same question better
 * there — a rung per day, climbing — so the Tape moved to Progress, where it
 * measures the thing the score line can't: not how well, but how often.
 */
const TAPE_DAYS = 14;

interface TapeDay {
  key: string;
  /** Best overall score that day, 0-100, or null if nothing was recorded. */
  best: number | null;
  isToday: boolean;
}

function tapeDays(sessions: Session[]): TapeDay[] {
  // Bucket by LOCAL day key, newest day rightmost — the same day arithmetic
  // the quests use (todayKey on the session's own clock time).
  const best = new Map<string, number>();
  for (const s of sessions) {
    const key = todayKey(new Date(s.createdAt));
    const score = s.analysis?.overall;
    if (typeof score !== "number") continue;
    const prev = best.get(key);
    if (prev === undefined || score > prev) best.set(key, score);
  }

  const days: TapeDay[] = [];
  const now = new Date();
  for (let i = TAPE_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = todayKey(d);
    days.push({ key, best: best.get(key) ?? null, isToday: i === 0 });
  }
  return days;
}

export function Tape({
  sessions,
  streak,
  /** True while today still has attempts left — the live bar only breathes then. */
  liveToday,
}: {
  sessions: Session[];
  streak: number;
  liveToday: boolean;
}) {
  const days = tapeDays(sessions);
  const practiced = days.filter((d) => d.best !== null).length;

  return (
    <div
      aria-label={`Last ${TAPE_DAYS} days: ${practiced} practiced, ${streak}-day streak`}
    >
      {/* No parallax mark. On the home screen the Tape was the loose thing at
          the top of a scroll and a little drift read as depth; inside a
          bordered card any vertical offset at all reads as a bar escaping its
          box. The runtime's cap would keep it legal — this keeps it still. */}
      <div className="voxline" aria-hidden="true">
        {days.map((d, i) => {
          const live = d.isToday && liveToday;
          const amp = d.best !== null ? d.best / 100 : live ? 0.85 : 0;
          return (
            <span
              key={d.key}
              className="voxline-bar"
              data-empty={d.best === null && !live ? "" : undefined}
              data-live={live ? "" : undefined}
              // --i drives the arrival stagger: bars rise left to right like a
              // take scrubbing onto the reel.
              style={{ "--amp": amp, "--i": i } as React.CSSProperties}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="nv-footnote nv-num">{TAPE_DAYS}D</span>
        <span className="nv-footnote font-semibold">
          {streak > 0
            ? `${streak}-day streak`
            : practiced > 0
              ? `${practiced} of ${TAPE_DAYS} days`
              : "your first rep starts the tape"}
        </span>
      </div>
    </div>
  );
}
