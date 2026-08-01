import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { levelFromXp, xpForChallengeAttempt, xpForRep } from "./levels";
import {
  COINS_COMEBACK,
  COINS_DAILY,
  COMEBACK_DAYS,
  coinsForLevelUps,
  coinsForStreakDay,
  seedCoins,
} from "./coins";
import { payReferralBonus } from "./referral";

// Server-authoritative XP, and the public projection of it that the
// leaderboard reads.
//
// WHY THIS EXISTS AT ALL, given lib/daily.ts already tracks XP: it doesn't
// track it anywhere trustworthy. firestore.rules lets the owner write every
// doc under users/{uid}/profile except `plan`, so `stats.xp` is a number the
// user can set to anything they like from the browser console. That is fine
// for a progress bar they're looking at alone. It is not fine the moment two
// users are ranked against each other, so a leaderboard built on it would be
// cheatable by typing.
//
// The rule this file exists to enforce: XP that ranks you is only ever
// awarded here, inside /api/analyze, at the moment a real score comes back
// from the pipeline — the one point in the system where a score exists that
// the client did not make up. It is written through the Admin SDK, which
// bypasses rules, into paths every client is denied write access to:
//
//   users/{uid}/score/progress   private: xp, streak, per-day best
//   leaderboard/{uid}            public projection: handle, xp, level
//
// The same reasoning will apply to coins and to referral bonuses. Award them
// from here, off data the client cannot write, or don't award them.

/** Private, server-only progress doc. Clients may read it, never write it. */
export interface ServerProgress {
  xp: number;
  streakDays: number;
  longestStreak: number;
  /** Local-ish day key of the last counted daily attempt. */
  lastDailyDate: string | null;
  /** The day `dailyBest` belongs to; a new day resets the best. */
  dailyBestDate: string | null;
  dailyBest: number | null;
  challengesCompleted: number;
  /** Set once, so the one-time backfill below never runs twice. */
  seeded?: boolean;

  // --- Fox coins (lib/coins.ts) ---
  // Here rather than in profile/stats for the same reason as xp: this is a
  // balance that buys things, so it has to sit in a doc rules deny the client
  // write access to. Everything below is written only by this file and by
  // lib/coinsServer.ts, both Admin SDK.
  coins?: number;
  /** Set once the level-based starting balance has been granted. */
  coinsSeeded?: boolean;
  /** Shop item ids bought. Free items are not listed; see ownedItems(). */
  purchased?: string[];
  equippedAccessory?: string | null;
  equippedBiome?: string | null;
  /**
   * Activity key → the day it was last practiced, which is what makes the
   * comeback bonus payable off evidence rather than off the client saying
   * "I haven't done this in ages".
   */
  lastPlayed?: Record<string, string>;
}

const EMPTY: ServerProgress = {
  xp: 0,
  streakDays: 0,
  longestStreak: 0,
  lastDailyDate: null,
  dailyBestDate: null,
  dailyBest: null,
  challengesCompleted: 0,
  coins: 0,
  purchased: [],
  equippedAccessory: null,
  equippedBiome: null,
  lastPlayed: {},
};

/** Whole days from day key `a` to day key `b`. Negative if `b` is earlier. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
  );
}

/**
 * What one already-recorded practice attempt is worth when we are rebuilding
 * history rather than scoring it live. Deliberately pessimistic: it's
 * xpForRep at a middling score with no improvement bonus, no all-three bonus
 * and no streak multiplier, so the backfill can only ever under-credit.
 */
const BACKFILL_XP_PER_ATTEMPT = xpForRep(60);

/**
 * Existing accounts have XP, and it lives in the doc they can edit. Starting
 * everyone at zero would take away levels people really earned; trusting
 * `stats.xp` would let one console command seed the top of the board on day
 * one. So we rebuild from the only history the client never had write access
 * to: the usage meter at users/{uid}/usage/{date}, which /api/analyze writes
 * through the Admin SDK on every daily attempt.
 *
 * It under-counts on purpose (see BACKFILL_XP_PER_ATTEMPT, and non-daily reps
 * were never metered at all). An honest low number beats a forgeable high one,
 * and everything from here forward is scored properly.
 */
async function backfillXp(db: Firestore, uid: string): Promise<number> {
  try {
    const snap = await db.collection(`users/${uid}/usage`).get();
    let attempts = 0;
    for (const doc of snap.docs) {
      const n = Number(doc.data()?.dailyAnalyses ?? 0);
      if (Number.isFinite(n) && n > 0) attempts += Math.min(n, 3);
    }
    return attempts * BACKFILL_XP_PER_ATTEMPT;
  } catch (err) {
    // A failed backfill must never cost the user the XP for the rep they
    // just did. Start them at zero and carry on.
    console.error("[leaderboard] backfill failed", uid, err);
    return 0;
  }
}

export interface AwardInput {
  /** The overall score the pipeline just produced. */
  score: number;
  /** True when this was the Daily Minute (streaks and bonuses apply). */
  isDaily: boolean;
  /** Server-validated day key, from lib/quota.ts usageDateKey(). */
  date: string;
  /**
   * Which attempt at today's daily this is, 1-based. Comes from the usage
   * meter, which was already incremented by reserveDailyAttempt, so it is
   * the server's count and not the client's.
   */
  attemptNumber: number;
  /**
   * Which surface this rep came from — "daily", or the category id for
   * everything else. Only the comeback bonus reads it; it never touches XP,
   * so a lie here can never move a rank.
   *
   * It comes off the request, which is worth being precise about. A client
   * that cycles activity keys can't mint anything from unknown ones — the
   * bonus needs a lastPlayed entry that is already COMEBACK_DAYS old, and a
   * key nobody has used has no entry. The real bound is one bonus per known
   * activity per 14 days, and every one of them still costs a genuine trip
   * through the paid pipeline. That's the same shape of defence as the
   * referral bonus in lib/referral.ts: make the work cost more than the prize.
   */
  activity?: string;
}

/**
 * Award XP for one completed analysis and republish the public leaderboard
 * row. Runs in a transaction so two concurrent analyses can't both read the
 * same "previous best" and double-pay the improvement bonus.
 *
 * Returns the new XP total, or null if nothing was written.
 */
export async function awardXp(
  db: Firestore,
  uid: string,
  input: AwardInput
): Promise<number | null> {
  const progressRef = db.doc(`users/${uid}/score/progress`);

  // The backfill reads a whole collection, which a transaction can't do, so
  // it happens before the transaction and only when the doc is missing. If
  // two requests race here they both compute the same number from the same
  // immutable history, and the transaction below applies it once.
  const existing = await progressRef.get();
  const seedXp = existing.exists ? 0 : await backfillXp(db, uid);

  const inviteRef = db.doc(`users/${uid}/score/invite`);

  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(progressRef);
    // Referral bonus parked while this account had no progress doc yet (see
    // payReferralBonus). Read it — before any write — only when we're about to
    // create the doc, and fold it into the seed so it isn't lost. All reads in
    // a Firestore transaction must precede all writes.
    let pendingBonusXp = 0;
    let hadPending = false;
    if (!snap.exists) {
      const inviteSnap = await tx.get(inviteRef);
      if (inviteSnap.exists) {
        pendingBonusXp = Number(inviteSnap.data()?.pendingBonusXp ?? 0);
        hadPending = pendingBonusXp > 0;
      }
    }
    const prev: ServerProgress = snap.exists
      ? { ...EMPTY, ...(snap.data() as Partial<ServerProgress>) }
      : { ...EMPTY, xp: seedXp + pendingBonusXp, seeded: true };

    let { streakDays, challengesCompleted, longestStreak } = prev;
    let dailyBest = prev.dailyBestDate === input.date ? prev.dailyBest : null;

    let earned: number;
    if (input.isDaily) {
      // The streak advances once a day, on the first attempt. Same gap
      // handling as lib/daily.ts: only a real gap of two days or more breaks
      // a run, because a zero or negative gap means a duplicate write or a
      // clock that moved backwards, neither of which is a missed day.
      if (input.attemptNumber === 1) {
        const gap = prev.lastDailyDate
          ? daysBetween(prev.lastDailyDate, input.date)
          : null;
        if (gap === null || gap > 1) {
          streakDays = 1;
          challengesCompleted += 1;
        } else if (gap === 1) {
          streakDays += 1;
          challengesCompleted += 1;
        } else {
          streakDays = Math.max(1, streakDays);
        }
        longestStreak = Math.max(longestStreak, streakDays);
      }
      earned = xpForChallengeAttempt({
        score: input.score,
        previousBest: dailyBest,
        attemptNumber: input.attemptNumber,
        streakDays,
      }).xp;
      if (dailyBest === null || input.score > dailyBest) dailyBest = input.score;
    } else {
      earned = xpForRep(input.score);
    }

    // --- Coins ---------------------------------------------------------
    // Inside this transaction rather than after it, so the same concurrency
    // guarantee that stops the improvement bonus paying twice covers the
    // balance too. A coin award that raced the XP award would be a balance
    // computed from a level the user may not have reached yet.
    const nextXp = prev.xp + earned;

    // The starting balance for an account that predates the shop, granted off
    // the XP already in this doc and BEFORE this session's level-ups are
    // added, so the two can't pay for the same level.
    //
    // On a FIRST write the seed excludes `pendingBonusXp`, the parked referral
    // bonus: lib/referral.ts is explicit that the level crossing a referral
    // causes is deliberately never paid in coins. Folding it in here paid an
    // inviter whose only XP was the parked 100 a Level 2 crossing (25 coins),
    // while an inviter whose doc already existed got nothing for the same
    // event. On an EXISTING doc prev.xp is their real total and seedXp is 0,
    // so that case must keep using prev.xp or the pre-shop backfill vanishes.
    const base = prev.coinsSeeded
      ? (prev.coins ?? 0)
      : seedCoins(snap.exists ? prev.xp : seedXp);

    let coinsEarned = coinsForLevelUps(prev.xp, nextXp);
    // Paid once a day, on the attempt that also advanced the streak, so the
    // second and third goes at the daily don't each pay for showing up.
    if (input.isDaily && input.attemptNumber === 1) {
      coinsEarned += COINS_DAILY;
      coinsEarned += coinsForStreakDay(streakDays);
    }

    const activity = input.activity || (input.isDaily ? "daily" : null);
    const lastPlayed = { ...(prev.lastPlayed ?? {}) };
    if (activity) {
      const last = lastPlayed[activity];
      if (last && daysBetween(last, input.date) >= COMEBACK_DAYS) {
        coinsEarned += COINS_COMEBACK;
      }
      lastPlayed[activity] = input.date;
    }

    const updated: ServerProgress = {
      ...prev,
      xp: nextXp,
      coins: base + coinsEarned,
      coinsSeeded: true,
      lastPlayed,
      streakDays,
      longestStreak: Math.max(longestStreak, streakDays),
      challengesCompleted,
      lastDailyDate: input.isDaily ? input.date : prev.lastDailyDate,
      dailyBestDate: input.isDaily ? input.date : prev.dailyBestDate,
      // Only a daily rep updates dailyBest; a non-daily award must leave the
      // pair untouched, or it would null out the best score while keeping the
      // stale dailyBestDate (the two guards above already do this for the date).
      dailyBest: input.isDaily ? dailyBest : prev.dailyBest,
    };
    tx.set(progressRef, { ...updated, updatedAt: FieldValue.serverTimestamp() });
    // Consumed the parked credit into the seed above, so clear exactly that
    // much. Decrement (not zero) so a bonus parked concurrently isn't dropped;
    // the transaction's read of inviteRef already forces a retry on a racing
    // write, but decrement is the robust form.
    if (hadPending) {
      tx.set(
        inviteRef,
        { pendingBonusXp: FieldValue.increment(-pendingBonusXp) },
        { merge: true }
      );
    }
    return updated;
  });

  await publishRow(db, uid, next.xp, next.streakDays);

  // The referral bonus lands on the invited account's FIRST scored session,
  // which is exactly the award that created the progress doc. Paying at
  // signup instead would make farming free; making someone push a real
  // recording through the paid pipeline first is what costs an abuser more
  // than the bonus is worth. See lib/referral.ts.
  if (!existing.exists) {
    try {
      const { paid, inviterUid } = await payReferralBonus(db, uid);
      if (paid) {
        // Both totals moved, so both public rows are stale.
        await Promise.all([
          republish(db, uid),
          inviterUid ? republish(db, inviterUid) : Promise.resolve(),
        ]);
      }
    } catch (err) {
      console.error("[referral] bonus on first session failed", uid, err);
    }
  }

  return next.xp;
}

/** Re-publish a user's public row from whatever their private total says now. */
export async function republish(db: Firestore, uid: string): Promise<void> {
  const snap = await db.doc(`users/${uid}/score/progress`).get();
  if (!snap.exists) return;
  const data = snap.data() as Partial<ServerProgress>;
  await publishRow(db, uid, Number(data.xp ?? 0), Number(data.streakDays ?? 0));
}

/**
 * The public row. Only ever holds what a stranger is allowed to see: the
 * handle the user chose for this purpose, their XP and the level it buys.
 * Never the signup name, which is a real (and often a minor's) legal name.
 *
 * merge:true and no handle here on purpose — publishing must not clobber a
 * handle the user has set, and a row without one is rendered as an anonymous
 * speaker rather than being hidden, so ranks stay honest.
 */
async function publishRow(
  db: Firestore,
  uid: string,
  xp: number,
  streakDays: number
): Promise<void> {
  try {
    await db.doc(`leaderboard/${uid}`).set(
      {
        xp,
        level: levelFromXp(xp).level,
        streakDays,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    // The private total is already committed and is the source of truth; a
    // missed publish self-heals on the next attempt. Never fail the user's
    // analysis over a leaderboard write.
    console.error("[leaderboard] publish failed", uid, err);
  }
}

// --- handles -------------------------------------------------------------

export const HANDLE_MIN = 2;
export const HANDLE_MAX = 20;

/**
 * Handles are shown to strangers, so they're deliberately boring: letters,
 * digits, spaces, and a few name punctuation marks so "O'Neil" and "Anne-Marie"
 * work. No URLs, no @, no zero-width or bidi characters to spoof another
 * user's row with.
 */
const HANDLE_RE = /^[\p{L}\p{N} '._-]+$/u;

export type HandleCheck =
  | { ok: true; handle: string }
  | { ok: false; error: string };

/**
 * Names nobody may take: the product and its mascot (so a row can't pose as
 * an official one), and the usual staff/authority words.
 */
const RESERVED_HANDLES = new Set([
  "elovox",
  "felix",
  "admin",
  "administrator",
  "moderator",
  "mod",
  "staff",
  "support",
  "official",
  "system",
  "team",
  "help",
  "root",
  "owner",
]);

/**
 * The form a handle is RESERVED under, which is deliberately more aggressive
 * than the form it is displayed in.
 *
 * NFKC folds fullwidth and other compatibility forms (Ｆｅｌｉｘ → Felix), then
 * confusable Cyrillic/Greek letters are mapped onto their Latin lookalikes and
 * separators are stripped. Without this, an exact-match uniqueness check is
 * decorative: `\p{L}` happily admits "Felіx" with a Cyrillic і, which reads as
 * identical on the board.
 */
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c",
  т: "t", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", ɡ: "g",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t",
  υ: "u", χ: "x", "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t",
};

export function foldHandle(handle: string): string {
  return handle
    .normalize("NFKC")
    .toLowerCase()
    .split("")
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join("")
    .replace(/[\s'._-]/g, "");
}

export function checkHandle(raw: unknown): HandleCheck {
  if (typeof raw !== "string") return { ok: false, error: "Pick a name." };
  // Collapse runs of whitespace: "A          B" renders as a wide row that
  // pushes everyone else's XP off a narrow screen.
  const handle = raw.trim().replace(/\s+/g, " ");
  if (handle.length < HANDLE_MIN) {
    return { ok: false, error: `At least ${HANDLE_MIN} characters.` };
  }
  if (handle.length > HANDLE_MAX) {
    return { ok: false, error: `At most ${HANDLE_MAX} characters.` };
  }
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: "Letters, numbers, spaces and - ' . _ only." };
  }
  const folded = foldHandle(handle);
  if (!folded) {
    return { ok: false, error: "Pick a name with some letters in it." };
  }
  if (RESERVED_HANDLES.has(folded)) {
    return { ok: false, error: "That name is reserved. Pick another." };
  }
  return { ok: true, handle };
}

/**
 * Set the name this user appears under. Admin SDK only.
 *
 * Reserves the folded form in `handles/{folded}` inside a transaction, so two
 * people can't end up on the same public board under the same name. Every row
 * on /leaderboard is readable by every signed-in user, so without this anyone
 * could take the exact handle of the person above them — or of the product
 * itself — and the board stopped meaning anything.
 *
 * Returns false when the name is already taken.
 */
export async function setHandle(
  db: Firestore,
  uid: string,
  handle: string
): Promise<boolean> {
  const folded = foldHandle(handle);
  const claimRef = db.doc(`handles/${folded}`);
  const rowRef = db.doc(`leaderboard/${uid}`);

  const claimed = await db.runTransaction(async (tx) => {
    const [claimSnap, rowSnap] = await Promise.all([
      tx.get(claimRef),
      tx.get(rowRef),
    ]);
    const holder = claimSnap.data()?.uid;
    if (claimSnap.exists && holder !== uid) return false;

    // Release the previous reservation in the SAME transaction, so a rename
    // can't strand a name nobody can ever take again.
    const previous = rowSnap.data()?.handle;
    if (typeof previous === "string") {
      const previousFolded = foldHandle(previous);
      if (previousFolded && previousFolded !== folded) {
        tx.delete(db.doc(`handles/${previousFolded}`));
      }
    }

    tx.set(claimRef, { uid, handle, at: FieldValue.serverTimestamp() });
    // ONLY the handle. The xp/level are republished by awardXp, which owns
    // them: reading xp here (outside any transaction) and writing it back
    // meant a rename landing next to a finishing analysis could overwrite the
    // fresh total with the stale one it had read moments earlier, showing a
    // wrong number on the ranked surface until the next rep.
    tx.set(rowRef, { handle, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });

  if (!claimed) return false;

  // A row created by naming yourself before your first scored rep still needs
  // xp/level, or it sorts as missing and drops off the board. Written only
  // when absent, so this can never clobber a real total.
  const rowSnap = await rowRef.get();
  if (rowSnap.data()?.xp === undefined) {
    const progress = await db.doc(`users/${uid}/score/progress`).get();
    const xp = Number(progress.data()?.xp ?? 0);
    await rowRef.set({ xp, level: levelFromXp(xp).level }, { merge: true });
  }
  return true;
}
