import { describe, expect, it } from "vitest";
import {
  LEVELS,
  MAX_LEVEL,
  XP_PRACTICE_BASE,
  levelFromXp,
  xpForChallengeAttempt,
  xpForRep,
} from "@/lib/levels";

describe("levelFromXp", () => {
  it("starts everyone at level 1, including on nonsense input", () => {
    for (const xp of [0, -1, -99999, Number.NaN ? 0 : 0]) {
      expect(levelFromXp(xp).level).toBe(1);
    }
  });

  it("lands exactly on a threshold as the NEW level, not the old one", () => {
    // Off-by-one here means the level-up celebration fires a rep late.
    for (const l of LEVELS) {
      expect(levelFromXp(l.minXp).level).toBe(l.level);
    }
  });

  it("never reports a percent outside 0..100", () => {
    for (let xp = 0; xp <= LEVELS[MAX_LEVEL - 1].minXp + 5000; xp += 137) {
      const p = levelFromXp(xp).percent;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("caps at max level with no next-level debt", () => {
    const top = levelFromXp(LEVELS[MAX_LEVEL - 1].minXp + 1_000_000);
    expect(top.isMax).toBe(true);
    expect(top.level).toBe(MAX_LEVEL);
    expect(top.xpForNextLevel).toBe(0);
    expect(top.percent).toBe(100);
  });

  it("is monotonic — more XP can never mean a lower level", () => {
    let last = 0;
    for (let xp = 0; xp < 20000; xp += 61) {
      const lvl = levelFromXp(xp).level;
      expect(lvl).toBeGreaterThanOrEqual(last);
      last = lvl;
    }
  });
});

describe("earning XP", () => {
  it("pays a floor for effort even on a bad rep", () => {
    expect(xpForRep(0)).toBe(XP_PRACTICE_BASE);
    expect(xpForRep(-50)).toBe(XP_PRACTICE_BASE); // clamped, not negative
  });

  it("clamps a score above 100 instead of paying out for it", () => {
    expect(xpForRep(100)).toBe(xpForRep(1000));
  });

  it("rewards beating your own best more than simply scoring well", () => {
    const flat = xpForChallengeAttempt({
      score: 80, previousBest: 80, attemptNumber: 1, streakDays: 1,
    });
    const improved = xpForChallengeAttempt({
      score: 80, previousBest: 60, attemptNumber: 1, streakDays: 1,
    });
    // The whole point of three attempts is improvement, so improvement is
    // where the reward has to sit.
    expect(improved.xp).toBeGreaterThan(flat.xp);
    expect(improved.reasons.join(" ")).toMatch(/beat your best/);
  });

  it("caps the streak multiplier at 2x however long the streak runs", () => {
    const at10 = xpForChallengeAttempt({
      score: 80, previousBest: null, attemptNumber: 1, streakDays: 11,
    }).xp;
    const at500 = xpForChallengeAttempt({
      score: 80, previousBest: null, attemptNumber: 1, streakDays: 500,
    }).xp;
    // A long streak must never trivialise the climb.
    expect(at500).toBe(at10);
    expect(at500).toBeLessThanOrEqual(xpForRep(80) * 2);
  });

  it("explains every bonus it awards", () => {
    const r = xpForChallengeAttempt({
      score: 90, previousBest: 70, attemptNumber: 3, streakDays: 4,
    });
    // The report prints these strings as an XP receipt; a silent bonus reads
    // as the number being made up.
    expect(r.reasons.length).toBeGreaterThanOrEqual(4);
    expect(r.xp).toBeGreaterThan(xpForRep(90));
  });
});
