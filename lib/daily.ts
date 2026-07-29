"use client";

import { isFirebaseConfigured, getDb, getUser } from "./firebase";
import { levelFromXp, xpForChallengeAttempt, type LevelProgress } from "./levels";

// The daily challenge: one AI-written ~1 minute speech, the same one for
// everybody, rotating at local midnight with nobody having to press a
// button. Free and premium both get it.
//
// Where it lives:
//   dailyChallenges/{YYYY-MM-DD}          shared, world-readable, written once
//   users/{uid}/challenges/{YYYY-MM-DD}   this user's three attempts
//   users/{uid}/profile/stats             xp, streak, totals
//
// The first user to open the app on a given day finds no shared doc, asks
// /api/daily to write one, and publishes it for everyone after. If two
// users race, the loser's write is harmless, both wrote the same day key,
// and whichever lands second just overwrites identical-shaped content.
// Without Firebase the whole thing degrades to localStorage, so the app
// still works signed-out and offline.

/**
 * Three attempts at the daily challenge, for EVERYONE, free and Premium
 * alike. This is deliberate and is not a paywall: the daily challenge is one
 * shared topic that the whole userbase is scored on, so an uncapped run at it
 * would make the scores incomparable and turn a habit into a grind. Premium's
 * "unlimited" is about the other surfaces (the speech library, your own
 * material, interview practice, custom speeches), which have no cap at all.
 *
 * Keep this in step with the /pricing copy: Premium must never be sold as
 * removing THIS cap, because it does not.
 */
export const MAX_DAILY_ATTEMPTS = 3;

export interface DailyChallenge {
  date: string; // YYYY-MM-DD
  title: string;
  topic: string; // the subject to speak about, in one phrase
  bullets: string[]; // three angles to hit while improvising (no script)
  scenario: string; // the setup: who you're talking to and why
  theme: string; // short tag, e.g. "Persuasion"
  focus: string; // what Felix is watching for today
  generated?: boolean; // false when the API served the canned bank
}

export interface ChallengeAttempt {
  attempt: number; // 1-based
  score: number;
  sessionId: string;
  at: number;
  xp: number;
}

export interface ChallengeState {
  date: string;
  attempts: ChallengeAttempt[];
  bestScore: number | null;
  attemptsLeft: number;
  complete: boolean;
}

export interface UserStats {
  xp: number;
  streakDays: number;
  /**
   * The best streak this user has ever held, as a high-water mark that only
   * ever goes up. `streakDays` is the run in progress and drops back to 1 on
   * a missed day; this is the one the Fox Den's streak badges are allowed to
   * read, because an achievement that can be taken away is a status light.
   *
   * Deliberately NOT backfilled. Existing users start from whatever streak
   * they are on right now, and `longestStreak()` in lib/quests.ts still walks
   * the session history for anything earlier, so nobody loses a badge they
   * already have. It exists so that bounding the dashboard's session query to
   * a recent window later on cannot silently un-earn those badges: the floor
   * survives in the stats doc even when the history behind it is out of view.
   */
  longestStreak: number;
  lastChallengeDate: string | null;
  challengesCompleted: number;
  level: LevelProgress;
}

// --- date helpers --------------------------------------------------------

/** Local-midnight day key, so "today" means the user's today. */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whole days from day key `a` to day key `b`. Negative if `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

async function currentUid(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null;
  const user = await getUser();
  return user?.uid ?? null;
}

// --- the challenge itself ------------------------------------------------

const challengeCacheKey = (date: string) => `elovox.daily.${date}`;

function cachedChallenge(date: string): DailyChallenge | null {
  try {
    const raw = window.localStorage.getItem(challengeCacheKey(date));
    return raw ? (JSON.parse(raw) as DailyChallenge) : null;
  } catch {
    return null;
  }
}

function cacheChallenge(c: DailyChallenge): void {
  // Never cache a fallback: one request during a Gemini outage would
  // otherwise pin canned content on this device for the rest of the day,
  // long after generation recovered.
  if (c.generated === false) return;
  try {
    window.localStorage.setItem(challengeCacheKey(c.date), JSON.stringify(c));
  } catch {
    // storage full, the network path still works
  }
}

async function generateChallenge(date: string): Promise<DailyChallenge> {
  const res = await fetch(`/api/daily?date=${encodeURIComponent(date)}`);
  if (!res.ok) throw new Error(`daily challenge: ${res.status}`);
  return (await res.json()) as DailyChallenge;
}

/**
 * True only for the current improv format (topic + three bullets). Challenges
 * cached or published under the old "full speech" schema lack `bullets`, so we
 * treat them as absent and regenerate, otherwise the practice screen would
 * try to map over an undefined bullet list. The shared doc for such a day
 * can't be rewritten (rules forbid it), so each client just regenerates
 * locally until midnight rolls the day over.
 */
function isCurrentFormat(c: DailyChallenge | null | undefined): c is DailyChallenge {
  return (
    !!c &&
    typeof c.topic === "string" &&
    Array.isArray(c.bullets) &&
    c.bullets.length > 0
  );
}

/** Today's challenge, shared doc, generating and publishing it if needed. */
export async function fetchDailyChallenge(
  date: string = todayKey()
): Promise<DailyChallenge> {
  const local = cachedChallenge(date);
  if (isCurrentFormat(local)) return local;

  const uid = await currentUid();
  if (!uid) {
    const generated = await generateChallenge(date);
    cacheChallenge(generated);
    return generated;
  }

  const { doc, getDoc, setDoc } = await import("firebase/firestore");
  const ref = doc(getDb(), "dailyChallenges", date);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const shared = snap.data() as DailyChallenge;
      if (isCurrentFormat(shared)) {
        cacheChallenge(shared);
        return shared;
      }
      // Old-format shared doc: fall through and regenerate locally.
    }
  } catch {
    // unreadable, fall through and generate a local-only one
  }

  const fresh = await generateChallenge(date);
  cacheChallenge(fresh);
  // Publish for everyone else today. Failure is fine: the next user tries.
  // A fallback is never published, it would hand the whole user base
  // canned content for the day, and the doc can't be rewritten afterwards.
  // (If an old-format doc already exists, this write is denied by rules and
  // harmlessly caught; we still use our freshly generated one.)
  if (fresh.generated !== false) setDoc(ref, fresh).catch(() => {});
  return fresh;
}

// --- this user's attempts ------------------------------------------------

const attemptsCacheKey = (date: string) => `elovox.daily.attempts.${date}`;

function localAttempts(date: string): ChallengeAttempt[] {
  try {
    const raw = window.localStorage.getItem(attemptsCacheKey(date));
    return raw ? (JSON.parse(raw) as ChallengeAttempt[]) : [];
  } catch {
    return [];
  }
}

function saveLocalAttempts(date: string, attempts: ChallengeAttempt[]): void {
  try {
    window.localStorage.setItem(attemptsCacheKey(date), JSON.stringify(attempts));
  } catch {
    // non-fatal
  }
}

function toState(date: string, attempts: ChallengeAttempt[]): ChallengeState {
  const sorted = [...attempts].sort((a, b) => a.attempt - b.attempt);
  return {
    date,
    attempts: sorted,
    bestScore: sorted.length ? Math.max(...sorted.map((a) => a.score)) : null,
    attemptsLeft: Math.max(0, MAX_DAILY_ATTEMPTS - sorted.length),
    complete: sorted.length >= MAX_DAILY_ATTEMPTS,
  };
}

export async function getChallengeState(
  date: string = todayKey()
): Promise<ChallengeState> {
  const uid = await currentUid();
  if (!uid) return toState(date, localAttempts(date));

  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(getDb(), "users", uid, "challenges", date));
    const attempts = snap.exists()
      ? ((snap.data().attempts ?? []) as ChallengeAttempt[])
      : [];
    saveLocalAttempts(date, attempts);
    return toState(date, attempts);
  } catch {
    return toState(date, localAttempts(date));
  }
}

// --- stats / levelling ---------------------------------------------------

const STATS_KEY = "elovox.stats.v1";

const EMPTY_STATS = {
  xp: 0,
  streakDays: 0,
  longestStreak: 0,
  lastChallengeDate: null as string | null,
  challengesCompleted: 0,
};

type RawStats = typeof EMPTY_STATS;

function localStats(): RawStats {
  try {
    const raw = window.localStorage.getItem(STATS_KEY);
    return raw ? { ...EMPTY_STATS, ...JSON.parse(raw) } : { ...EMPTY_STATS };
  } catch {
    return { ...EMPTY_STATS };
  }
}

function saveLocalStats(stats: RawStats): void {
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // non-fatal
  }
}

async function readRawStats(): Promise<RawStats> {
  const uid = await currentUid();
  if (!uid) return localStats();
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(getDb(), "users", uid, "profile", "stats"));
    const stats = snap.exists()
      ? ({ ...EMPTY_STATS, ...snap.data() } as RawStats)
      : { ...EMPTY_STATS };
    saveLocalStats(stats);
    return stats;
  } catch {
    return localStats();
  }
}

async function writeRawStats(stats: RawStats): Promise<void> {
  saveLocalStats(stats);
  const uid = await currentUid();
  if (!uid) return;
  try {
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(getDb(), "users", uid, "profile", "stats"), stats, {
      merge: true,
    });
  } catch {
    // localStorage already has it; Firestore catches up on the next write
  }
}

export async function getStats(): Promise<UserStats> {
  const raw = await readRawStats();
  return { ...raw, level: levelFromXp(raw.xp) };
}

/** XP for a rep that isn't the daily challenge (library, own material, interview). */
export async function awardPracticeXp(amount: number): Promise<UserStats> {
  const raw = await readRawStats();
  const next = { ...raw, xp: raw.xp + amount };
  await writeRawStats(next);
  return { ...next, level: levelFromXp(next.xp) };
}

export interface AttemptResult {
  attempt: ChallengeAttempt;
  state: ChallengeState;
  stats: UserStats;
  xpReasons: string[];
  leveledUpTo: number | null;
  isNewBest: boolean;
}

/**
 * Records one daily-challenge attempt: appends it, updates the streak (a
 * challenge counts as "done" on the first attempt), and awards XP weighted
 * toward improving on your own previous best.
 */
export async function recordChallengeAttempt(opts: {
  date?: string;
  score: number;
  sessionId: string;
}): Promise<AttemptResult> {
  const date = opts.date ?? todayKey();
  const prior = await getChallengeState(date);

  if (prior.complete) {
    const stats = await getStats();
    return {
      attempt: prior.attempts[prior.attempts.length - 1],
      state: prior,
      stats,
      xpReasons: [],
      leveledUpTo: null,
      isNewBest: false,
    };
  }

  const raw = await readRawStats();
  const attemptNumber = prior.attempts.length + 1;

  // Streak advances once per day, on the first attempt only.
  //
  // The gap used to be tested as `=== 1 ? +1 : 1`, which quietly wiped the
  // streak in two cases that are not a missed day:
  //
  //   gap === 0   we already recorded a challenge today, yet this is
  //               attempt 1. That happens when the attempts document didn't
  //               make it to Firestore but the stats write did, so the next
  //               read comes back empty and the attempt numbering restarts.
  //               Counting it as a fresh day also double-counted
  //               challengesCompleted.
  //   gap < 0     the local day moved backwards: a flight west, or a clock
  //               correction. todayKey() is a local-timezone date by design,
  //               so this is reachable without anything being wrong.
  //
  // Only a genuine gap of two days or more breaks a streak.
  let streakDays = raw.streakDays;
  let challengesCompleted = raw.challengesCompleted;
  if (attemptNumber === 1) {
    const gap = raw.lastChallengeDate ? daysBetween(raw.lastChallengeDate, date) : null;
    if (gap === null) {
      streakDays = 1;
      challengesCompleted += 1;
    } else if (gap === 1) {
      streakDays = raw.streakDays + 1;
      challengesCompleted += 1;
    } else if (gap <= 0) {
      // Same day, or time went backwards. Hold everything where it is.
      streakDays = Math.max(1, raw.streakDays);
    } else {
      streakDays = 1;
      challengesCompleted += 1;
    }
  }

  const { xp, reasons } = xpForChallengeAttempt({
    score: opts.score,
    previousBest: prior.bestScore,
    attemptNumber,
    streakDays,
  });

  const attempt: ChallengeAttempt = {
    attempt: attemptNumber,
    score: opts.score,
    sessionId: opts.sessionId,
    at: Date.now(),
    xp,
  };

  const attempts = [...prior.attempts, attempt];
  saveLocalAttempts(date, attempts);

  const uid = await currentUid();
  if (uid) {
    try {
      const { doc, setDoc } = await import("firebase/firestore");
      await setDoc(
        doc(getDb(), "users", uid, "challenges", date),
        { date, attempts },
        { merge: true }
      );
    } catch {
      // localStorage holds the attempt; the count stays correct on this device
    }
  }

  const beforeLevel = levelFromXp(raw.xp).level;
  const nextStats: RawStats = {
    xp: raw.xp + xp,
    streakDays,
    // A high-water mark, so it can only ever go up. Written on every attempt
    // rather than only on the first of the day, because it costs nothing and
    // the streak it tracks is already settled by this point.
    longestStreak: Math.max(raw.longestStreak ?? 0, streakDays),
    lastChallengeDate: date,
    challengesCompleted,
  };
  await writeRawStats(nextStats);
  const level = levelFromXp(nextStats.xp);

  return {
    attempt,
    state: toState(date, attempts),
    stats: { ...nextStats, level },
    xpReasons: reasons,
    leveledUpTo: level.level > beforeLevel ? level.level : null,
    isNewBest: prior.bestScore === null || opts.score > prior.bestScore,
  };
}
