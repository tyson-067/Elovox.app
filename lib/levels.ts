// The gamified layer. Speaking is a habit before it's a skill, so the
// numbers reward showing up and improving, not raw talent:
//
//   - every rep earns XP scaled to the score
//   - beating your own best on a daily challenge earns an improvement bonus
//   - finishing all three daily attempts earns a completion bonus
//   - streaks multiply the daily challenge payout
//
// Levels are cumulative XP thresholds with speaking-themed titles. Both
// free and premium users level up — the daily challenge is universal.

export interface Level {
  level: number;
  title: string;
  minXp: number;
}

// Curve: each level costs ~15% more than the last, so early levels come
// quickly (habit forming) and later ones take real weeks of practice.
const TITLES = [
  "First Words",
  "Nervous Starter",
  "Finding Your Voice",
  "Steady Speaker",
  "Room Reader",
  "Confident Voice",
  "Persuader",
  "Storyteller",
  "Presence",
  "Commanding",
  "Orator",
  "Voice of the Room",
];

export const LEVELS: Level[] = TITLES.map((title, i) => ({
  level: i + 1,
  title,
  // 0, 100, 230, 400, 620, ... — closed form of the 15% growth curve
  minXp: i === 0 ? 0 : Math.round(100 * ((Math.pow(1.15, i) - 1) / 0.15)),
}));

export const MAX_LEVEL = LEVELS.length;

export interface LevelProgress {
  level: number;
  title: string;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number; // 0 at max level
  percent: number; // 0-100 through the current level
  isMax: boolean;
}

export function levelFromXp(xp: number): LevelProgress {
  const safeXp = Math.max(0, Math.round(xp));
  let current = LEVELS[0];
  for (const l of LEVELS) {
    if (safeXp >= l.minXp) current = l;
  }
  const next = LEVELS[current.level]; // LEVELS is 0-indexed, so this is level+1
  const isMax = !next;

  const xpIntoLevel = safeXp - current.minXp;
  const span = isMax ? 0 : next.minXp - current.minXp;

  return {
    level: current.level,
    title: current.title,
    xp: safeXp,
    xpIntoLevel,
    xpForNextLevel: isMax ? 0 : next.minXp - safeXp,
    percent: isMax ? 100 : Math.round((xpIntoLevel / span) * 100),
    isMax,
  };
}

// --- Earning -------------------------------------------------------------

export const XP_PRACTICE_BASE = 10; // just for showing up and finishing a rep

/** XP for any single recorded rep. Score-weighted, floor for effort. */
export function xpForRep(score: number): number {
  return XP_PRACTICE_BASE + Math.round(Math.max(0, Math.min(100, score)) / 4);
}

/**
 * XP for a daily-challenge attempt. Beating your own previous best on the
 * same challenge is the point of having three attempts, so improvement is
 * where the real reward sits.
 */
export function xpForChallengeAttempt(opts: {
  score: number;
  previousBest: number | null;
  attemptNumber: number; // 1-based
  streakDays: number;
}): { xp: number; reasons: string[] } {
  const reasons: string[] = [];
  let xp = xpForRep(opts.score);
  reasons.push(`Attempt ${opts.attemptNumber} · ${opts.score} score`);

  if (opts.previousBest !== null && opts.score > opts.previousBest) {
    const gain = opts.score - opts.previousBest;
    const bonus = 15 + Math.min(35, gain * 3);
    xp += bonus;
    reasons.push(`+${bonus} beat your best by ${gain}`);
  }

  if (opts.attemptNumber === 3) {
    xp += 20;
    reasons.push("+20 used all three attempts");
  }

  // Streaks cap at 2x so a long streak never trivializes the climb.
  if (opts.streakDays > 1) {
    const multiplier = Math.min(2, 1 + (opts.streakDays - 1) * 0.1);
    const before = xp;
    xp = Math.round(xp * multiplier);
    reasons.push(`×${multiplier.toFixed(1)} ${opts.streakDays}-day streak (+${xp - before})`);
  }

  return { xp, reasons };
}
