"use client";

import { useEffect, useState } from "react";
import { isFirebaseConfigured, getUser } from "./firebase";
import { refreshPlan } from "./plan";

// Browser half of the 21-day streak reward. This decides only WHEN to ask;
// whether the streak is real and whether a week is owed is settled entirely
// by /api/streak/reward against server-written data (lib/streakReward.ts).
// Nothing here can grant anything, so the local streak number being editable
// doesn't matter — the worst a tamperer achieves is a wasted request that
// comes back "not-eligible".

export const STREAK_REWARD_DAYS = 21;

export interface StreakRewardResult {
  granted: boolean;
  premiumUntil?: number;
  streakDays?: number;
  reason?: string;
}

/**
 * One claim per day per device. The check is cheap but pointless to repeat on
 * every dashboard mount, and a user idling on the page shouldn't loop it.
 */
const attemptKey = (uid: string) => `elovox.streakClaim.${uid}`;

function alreadyAskedToday(uid: string): boolean {
  try {
    return window.localStorage.getItem(attemptKey(uid)) === new Date().toDateString();
  } catch {
    return false;
  }
}

function markAsked(uid: string): void {
  try {
    window.localStorage.setItem(attemptKey(uid), new Date().toDateString());
  } catch {
    // storage blocked; worst case we ask again next mount
  }
}

async function postClaim(): Promise<StreakRewardResult | null> {
  const user = await getUser();
  if (!user) return null;
  const res = await fetch("/api/streak/reward", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as StreakRewardResult;
}

/**
 * Asks the server whether a comp week is owed, once a day, and only when the
 * local streak has reached the threshold — so ordinary users never make the
 * request at all.
 *
 * Returns the grant once it lands, so the caller can celebrate it. The plan
 * cache is refreshed first, so every gated surface has already unlocked by
 * the time anything renders.
 */
export function useStreakReward(streakDays: number | null): StreakRewardResult | null {
  const [granted, setGranted] = useState<StreakRewardResult | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    if (streakDays === null || streakDays < STREAK_REWARD_DAYS) return;

    let cancelled = false;
    (async () => {
      const user = await getUser();
      if (!user || cancelled || alreadyAskedToday(user.uid)) return;
      markAsked(user.uid);
      try {
        const result = await postClaim();
        if (cancelled || !result?.granted) return;
        // Unlock the gated UI before announcing anything, so the banner and
        // the features it's talking about appear together.
        await refreshPlan();
        if (!cancelled) setGranted(result);
      } catch {
        // Offline or a bad moment. The claim isn't lost: the streak is still
        // on the server and tomorrow's mount asks again.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [streakDays]);

  return granted;
}
