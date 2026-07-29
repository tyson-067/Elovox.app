import type { FelixAccessory } from "@/components/FoxLogo";
import type { Session } from "./types";
import type { ChallengeState, UserStats } from "./daily";
import { daysBetween, MAX_DAILY_ATTEMPTS, todayKey } from "./daily";
import { LEVELS } from "./levels";
import { GOOD_MIN } from "./scoring";

// The dashboard's reward layer: today's quests, and the Fox Den's badges
// and outfits.
//
// Everything here is DERIVED. There is no quest state in Firestore, no
// token balance, no separate progress document to keep in step with the
// sessions that actually happened. A quest is a question asked of data the
// app already stores (today's challenge attempts, today's sessions, the
// running stats), and the answer is recomputed on every load.
//
// That constraint is deliberate. A parallel progress store is the thing
// that eventually disagrees with the reports, and a streak that says 4 next
// to a history showing 2 is worse than no streak at all. It also means
// quests can be added, reworded or dropped here without a migration.
//
// The XP numbers quoted on each quest are not a second economy either: they
// are the payouts lib/levels.ts already awards for the underlying rep, spelled
// out so the reward is visible before the work rather than after it. If you
// change a quest's `xp`, change it in lib/levels.ts, not here.

export interface Quest {
  id: string;
  title: string;
  /** One line, present tense, telling them exactly what to do. */
  detail: string;
  progress: number;
  target: number;
  /** What the underlying rep pays, for display only. */
  xp: number;
  done: boolean;
  href: string;
  /** Shown once done, instead of the call to action. */
  doneLabel: string;
}

/**
 * Reps recorded on the given local day, defaulting to today.
 *
 * Takes the day key explicitly rather than reading the clock, so a caller
 * that re-renders across midnight recomputes instead of holding a boundary
 * captured hours ago. The dashboard passes the same key it loaded the
 * challenge under, which keeps the quests and the attempt counter agreeing
 * even if one of the two fetches fails.
 */
export function sessionsFromDay(
  sessions: Session[],
  dayKey: string = todayKey()
): Session[] {
  return sessions.filter((s) => todayKey(new Date(s.createdAt)) === dayKey);
}

/** The lowest filler count across today's reps, or null if there are none. */
function bestFillerCount(today: Session[]): number | null {
  if (today.length === 0) return null;
  return Math.min(...today.map((s) => s.analysis?.fillerWords ?? 99));
}

/** Filler words at or below this counts as a clean run. Not zero: a real
 *  minute of speech with two "so"s in it is a good minute, and a target
 *  nobody hits is a target nobody plays for. */
export const CLEAN_RUN_FILLERS = 2;

export function dailyQuests(opts: {
  challenge: ChallengeState | null;
  today: Session[];
}): Quest[] {
  const attempts = opts.challenge?.attempts ?? [];
  const used = attempts.length;

  // "Beat your best" only makes sense against a score you've already set,
  // so before the first attempt it's shown as a target rather than a miss.
  const first = attempts[0]?.score ?? null;
  const beaten =
    first !== null && attempts.slice(1).some((a) => a.score > first);

  const fillers = bestFillerCount(opts.today);
  const cleanRun = fillers !== null && fillers <= CLEAN_RUN_FILLERS;

  return [
    {
      id: "daily-minute",
      title: "The Daily Minute",
      detail: "Improvise for sixty seconds on today's topic.",
      progress: Math.min(1, used),
      target: 1,
      xp: 10,
      done: used >= 1,
      href: "/practice?daily=1",
      doneLabel: "Done today",
    },
    {
      id: "beat-your-best",
      title: "Beat your best",
      detail:
        first === null
          ? "Run it twice and score higher the second time."
          : `Score above ${first} on a later attempt.`,
      progress: beaten ? 1 : 0,
      target: 1,
      xp: 15,
      done: beaten,
      href: "/practice?daily=1",
      doneLabel: "Beaten",
    },
    {
      id: "zero-filler",
      title: "Zero-filler sprint",
      detail: `Finish any rep today with ${CLEAN_RUN_FILLERS} filler words or fewer.`,
      // Progress here is binary rather than a filler countdown: showing
      // "7 of 2" on a rambling take is a scoreboard for failure.
      progress: cleanRun ? 1 : 0,
      target: 1,
      xp: 10,
      done: cleanRun,
      href: "/practice?daily=1",
      doneLabel:
        fillers === 0 ? "Not one filler" : `Cleanest run: ${fillers} fillers`,
    },
  ];
}

/** How far through today's quests, for the header summary. */
export function questsComplete(quests: Quest[]): number {
  return quests.filter((q) => q.done).length;
}

// --- The Fox Den ---------------------------------------------------------

export interface Badge {
  id: string;
  name: string;
  /** How it's earned. Shown whether or not they have it. */
  hint: string;
  emoji: string;
  earned: boolean;
}

/**
 * The longest run of consecutive days this user has ever practised,
 * reconstructed from the daily-challenge reps in their history.
 *
 * The badges below need this rather than `stats.streakDays`, which is the
 * run currently in progress and resets to 1 the moment someone misses a day.
 * Reading the live counter meant Three-Day Fox and Week of Nerve un-earned
 * themselves — you could hold a seven-day streak, collect both, skip a
 * Tuesday, and watch them grey out. A badge that can be taken away is a
 * status light, not an achievement, and the Den presents these as
 * achievements ("3 / 6 badges").
 *
 * `currentStreak` is folded in as a floor because the session history is not
 * a complete record on its own: saveSession is best-effort, and reps recorded
 * before `challengeDate` existed carry no date at all.
 *
 * NOTE: this walks the whole history, so it is one of the two things (badges
 * being the other) that stop the dashboard's session query being bounded to a
 * recent window. Bounding it without addressing this would silently start
 * un-earning badges again once someone's history outgrew the limit.
 */
export function longestStreak(sessions: Session[], currentStreak = 0): number {
  const days = [
    ...new Set(
      sessions
        .map((s) => s.challengeDate)
        .filter(
          (d): d is string =>
            typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
        )
    ),
  ].sort();

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    run = previous !== null && daysBetween(previous, day) === 1 ? run + 1 : 1;
    previous = day;
    if (run > best) best = run;
  }

  return Math.max(best, currentStreak);
}

export function badgesFor(opts: {
  stats: UserStats | null;
  sessions: Session[];
}): Badge[] {
  const stats = opts.stats;
  const sessions = opts.sessions;
  const bestStreak = longestStreak(sessions, stats?.streakDays ?? 0);
  const best = sessions.reduce((m, s) => Math.max(m, s.analysis?.overall ?? 0), 0);
  const cleanest = sessions.length
    ? Math.min(...sessions.map((s) => s.analysis?.fillerWords ?? 99))
    : null;
  const withCamera = sessions.some((s) => s.withVideo);

  return [
    {
      id: "first-words",
      name: "First Words",
      hint: "Record your first rep",
      emoji: "🎙️",
      earned: sessions.length >= 1,
    },
    {
      id: "no-um-ninja",
      name: "No-Um Ninja",
      hint: "Finish a rep with no filler words at all",
      emoji: "🥷",
      earned: cleanest === 0,
    },
    {
      id: "crowd-charmer",
      name: "Crowd Charmer",
      // Pinned to the good-tier floor, not a round number. This said 80,
      // which lib/scoring.ts calls MIDDLING — so the report could tell you
      // the delivery did not land while the Den handed you a badge for it.
      hint: `Score ${GOOD_MIN} or above`,
      emoji: "✨",
      earned: best >= GOOD_MIN,
    },
    {
      id: "three-day-fox",
      name: "Three-Day Fox",
      hint: "Practise three days running",
      emoji: "🔥",
      earned: bestStreak >= 3,
    },
    {
      id: "week-of-nerve",
      name: "Week of Nerve",
      hint: "Hold a seven-day streak",
      emoji: "🗓️",
      earned: bestStreak >= 7,
    },
    {
      id: "on-camera",
      name: "On Camera",
      hint: "Practise once with the camera on",
      emoji: "🎬",
      earned: withCamera,
    },
  ];
}

/**
 * Felix's wardrobe. Level-gated rather than bought: XP is the only currency
 * this app has ever minted, and inventing a second one would mean a balance
 * to store, spend and reconcile. Levelling already costs exactly the work a
 * shop would charge for, so the level IS the price.
 */
export interface Outfit {
  /** Matches the accessories <Felix> can actually draw. */
  id: FelixAccessory;
  name: string;
  emoji: string;
  level: number;
  unlocked: boolean;
}

const WARDROBE: Omit<Outfit, "unlocked">[] = [
  { id: "bow-tie", name: "The bow tie", emoji: "🎀", level: 2 },
  // NOT the professor's specs, however tempting: those are part of Felix's
  // coach mood and a new account already sees him wearing them, so promising
  // them at Level 4 advertised something the fox on the same screen had on.
  { id: "mortarboard", name: "Scholar's cap", emoji: "🎓", level: 4 },
  { id: "scarf", name: "Winter scarf", emoji: "🧣", level: 6 },
  { id: "headset", name: "Broadcast headset", emoji: "🎧", level: 8 },
  { id: "laurels", name: "Laurel wreath", emoji: "🏆", level: 10 },
  { id: "crown", name: "Voice of the Room", emoji: "👑", level: LEVELS.length },
];

export function wardrobeFor(level: number): Outfit[] {
  return WARDROBE.map((o) => ({ ...o, unlocked: level >= o.level }));
}

/** The next thing to work toward, or null once everything is unlocked. */
export function nextOutfit(level: number): Outfit | null {
  return wardrobeFor(level).find((o) => !o.unlocked) ?? null;
}

/**
 * What Felix is actually wearing: the highest-level thing unlocked so far.
 * He changes into each new one rather than piling them on, so levelling up
 * visibly changes the fox on the dashboard.
 */
export function currentOutfit(level: number): Outfit | null {
  const unlocked = wardrobeFor(level).filter((o) => o.unlocked);
  return unlocked.at(-1) ?? null;
}

// --- Felix's mood --------------------------------------------------------

/**
 * What Felix is doing on the dashboard, from where the user actually is.
 * Order matters: the first true branch wins, and they run from the most
 * specific celebration down to the gentlest nudge.
 */
export function moodFor(opts: {
  stats: UserStats | null;
  challenge: ChallengeState | null;
}): "cheer" | "coach" | "idle" | "sleepy" {
  const streak = opts.stats?.streakDays ?? 0;
  const used = opts.challenge?.attempts.length ?? 0;

  if (used >= MAX_DAILY_ATTEMPTS || streak >= 3) return "cheer";
  if (used > 0) return "idle";
  // Practised before, but not lately: the ears go down. Never shown to
  // someone brand new, who has done nothing wrong.
  if ((opts.stats?.challengesCompleted ?? 0) > 0 && streak === 0) return "sleepy";
  return "coach";
}

/** A line from Felix, matched to the same state the mood came from. */
export function felixLine(opts: {
  stats: UserStats | null;
  challenge: ChallengeState | null;
}): string {
  const streak = opts.stats?.streakDays ?? 0;
  const used = opts.challenge?.attempts.length ?? 0;
  const done = opts.challenge?.complete ?? false;

  if (done) return "All three, done. Rest the voice, I'll set a new one at midnight.";
  if (used > 0 && streak > 1) {
    return `${streak} days running, and you've already spoken today. Go again and beat yourself.`;
  }
  if (used > 0) return "One in the bag. The second take is usually the good one.";
  if (streak >= 3) return `${streak}-day streak on the line. One minute keeps it alive.`;
  if ((opts.stats?.challengesCompleted ?? 0) > 0 && streak === 0) {
    return "It's been a while. Start a new streak, today is day one.";
  }
  return "Sixty seconds, no script. Let's find out how you sound.";
}
