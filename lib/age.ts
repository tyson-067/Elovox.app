"use client";

import { useSyncExternalStore } from "react";
import { LEGAL } from "./legal";

// Age gate for signup. Elovox records voices, and under-13 accounts would
// pull COPPA (and its parental-consent machinery) into scope, so the terms
// set a floor and this is what enforces it at the door.
//
// Deliberately NOT stored: we ask for a date of birth, use it once to
// compute an age, and throw it away. Keeping birth dates would mean holding
// more personal data about minors than we need, the opposite of what the
// privacy policy promises. The only trace kept is the boolean below.
//
// This is a neutral age screen, not a security control. Anyone can type a
// different date, and no client-side check can prove an age. What it does is
// stop us from *knowingly* signing up a child, which is the standard the law
// actually applies.

export const MINIMUM_AGE = LEGAL.minimumAge;

/**
 * Whole years between `dob` and today, or null if the input isn't a usable
 * date. Counts a birthday as reached only once the day arrives.
 */
export function ageFromDob(dob: string, today = new Date()): number | null {
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  if (born > today) return null;
  // Sanity ceiling, a typo'd century shouldn't read as a valid age.
  if (today.getFullYear() - born.getFullYear() > 120) return null;

  let age = today.getFullYear() - born.getFullYear();
  const monthDiff = today.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) {
    age -= 1;
  }
  return age;
}

// Bumping this version resets every existing lockout: browsers still holding
// an old flag no longer match the key we read, so they get the signup form
// back and a fresh run at the age question. Bump again, and retire the old
// key below, whenever the lockouts need clearing.
//
// v2 is retired because it collected false positives: the signup form used
// to judge the date field as it changed, and iOS reports every value the
// picker wheels pass through, so adults scrolling back to their birth year
// were locked out in transit. Those flags are not honest answers and don't
// get to stand.
//
// v3 is retired for the same reason one layer up. It recorded the block at
// submit — i.e. *before* the "Confirm your age" screen the whole flow is
// built around — so a mistyped year locked the browser out for good at the
// moment the visitor was one tap away from correcting it. Nothing written by
// that version can be trusted to be a considered answer either. Anyone still
// carrying a v3 flag has been staring at "We can't sign you up" ever since,
// with no way back, which is the bug this pass exists to end; dropping the
// key hands them the form back.
const BLOCK_KEY = "elovox.age.blocked.v4";
const STALE_BLOCK_KEYS = [
  "elovox.age.blocked.v1",
  "elovox.age.blocked.v2",
  "elovox.age.blocked.v3",
];

/**
 * How long a block stands before the question gets asked again.
 *
 * It used to stand forever, which is a heavier thing than it looks: the
 * screen it produces has no retry, no appeal and no explanation beyond the
 * message, so *any* wrong answer — a typo, a phone handed to a child for
 * five minutes, a shared family laptop — permanently removed the ability to
 * create an account in that browser. The deterrent only ever needed to stop
 * an immediate second guess at the date; that job is done long before a
 * month is out, and re-asking after one is not "re-prompting a child", it's
 * asking a question again a month later and honouring whatever comes back.
 */
const BLOCK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How many times a blocked browser may say "that wasn't my date of birth"
 * and get the signup form back. Unlimited, by operator decision.
 *
 * Know what this setting trades. A wrong answer is never final, so nobody is
 * locked out of the product by a mis-tapped wheel — and equally, the block
 * becomes a screen anyone can walk past, so it slows a second guess at the
 * date without preventing one. The age question is on the honour system.
 *
 * That is a defensible place to stand rather than an oversight: no
 * client-side check can prove an age anyway (see the header), and the
 * standard the law applies is that we not KNOWINGLY sign up a child. The
 * confirmation screen still says the age back to the visitor, the rule is
 * still stated plainly, and the account is still refused.
 *
 * To put a cap back, set a finite number here and change
 * {@link AGE_CORRECTION_EXPLAINER}, which promises what this allows. The
 * count below is still kept and still carried across corrections, so a cap
 * added later applies correctly to browsers that have already used the
 * unlimited allowance — no migration, no key bump.
 */
const MAX_CORRECTIONS = Number.POSITIVE_INFINITY;

/**
 * What we keep about a failed age check. Still no date of birth, still no
 * age: `at` dates the block for the TTL, `standing` is whether it is closing
 * the form right now, and `corrections` counts how many times this browser
 * has been handed the form back.
 *
 * A corrected block is kept rather than deleted. The record is the only thing
 * that remembers a correction was spent, and while {@link MAX_CORRECTIONS} is
 * unlimited that count is doing nothing — but it is what a future cap would
 * be measured against, and a count only kept once capping starts would read
 * every existing browser as fresh.
 */
type BlockRecord = { at: number; corrections: number; standing: boolean };

/**
 * The live block, or null if there isn't one. Pure — no writes, no cleanup —
 * because the snapshot reads below run on every render.
 */
function readBlock(): BlockRecord | null {
  try {
    const raw = window.localStorage.getItem(BLOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; corrections?: unknown; standing?: unknown };
    // Unreadable or undated: it isn't evidence of anything, so don't block on
    // it. (A stale entry is simply ignored from now on.)
    if (typeof parsed?.at !== "number") return null;
    if (Date.now() - parsed.at >= BLOCK_TTL_MS) return null;
    return {
      at: parsed.at,
      // Records written before corrections existed carry neither field, and
      // the defaults read them correctly: a standing block that has spent
      // nothing. So everyone already locked out gets the way back too,
      // without a key bump — which would have released the honest answers
      // along with the typos.
      corrections:
        typeof parsed.corrections === "number" ? parsed.corrections : 0,
      standing: parsed.standing !== false,
    };
  } catch {
    return null;
  }
}

function writeBlock(record: BlockRecord): void {
  try {
    window.localStorage.setItem(BLOCK_KEY, JSON.stringify(record));
  } catch {
    /* private mode / storage disabled, the gate still ran this session */
  }
  listeners.forEach((fn) => fn());
}

/**
 * Remember that this browser failed the age check, so the form stays closed
 * instead of inviting an immediate retry with a different date. A soft
 * deterrent — clearing site data resets it, and so does {@link BLOCK_TTL_MS}
 * — but re-prompting straight away would defeat the point of asking.
 *
 * Call this only for an answer the visitor has explicitly confirmed. See
 * the note on v3 above for what happens when it's called any earlier.
 *
 * Carries the correction count forward. Inert while
 * {@link MAX_CORRECTIONS} is unlimited, and load-bearing the moment it isn't:
 * without this, correct → pick another date → still under age → block would
 * write `corrections: 0` and buy a fresh allowance every round, which is how
 * a cap silently becomes no cap at all.
 */
export function rememberAgeBlock(): void {
  writeBlock({
    at: Date.now(),
    corrections: readBlock()?.corrections ?? 0,
    standing: true,
  });
}

/**
 * True while a blocked browser still has a correction left — i.e. the lockout
 * screen has a way back to offer.
 */
function correctionAvailable(): boolean {
  const block = readBlock();
  return !!block && block.standing && block.corrections < MAX_CORRECTIONS;
}

/**
 * Spend a correction: stand the block down and hand the form back. Returns
 * false, changing nothing, when there was nothing to stand down — an expired
 * block, an already-corrected one, or (under a finite {@link MAX_CORRECTIONS})
 * a spent allowance. That guard is why a stale button or a second click
 * landing behind the first can't reopen anything.
 */
export function takeAgeBlockCorrection(): boolean {
  const block = readBlock();
  if (!block || !block.standing || block.corrections >= MAX_CORRECTIONS) {
    return false;
  }
  writeBlock({ ...block, corrections: block.corrections + 1, standing: false });
  return true;
}

function isAgeBlocked(): boolean {
  const block = readBlock();
  return !!block && block.standing;
}

// localStorage is an external store, so it's read through
// useSyncExternalStore rather than an effect: no setState-in-effect, no
// hydration mismatch (the server snapshot is always false, and the client
// re-reads immediately after mount).
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  // Drop the retired flags on the way past. Done here rather than in the
  // snapshot read, which has to stay pure and gets called often.
  try {
    STALE_BLOCK_KEYS.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage disabled; the stale key is inert either way */
  }
  listeners.add(onChange);
  // Catch the flag being set in another tab as well as in this one.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** True once this browser has failed the age check. */
export function useAgeBlocked(): boolean {
  return useSyncExternalStore(subscribe, isAgeBlocked, () => false);
}

/**
 * True while the lockout screen still has a correction to offer. Read through
 * the same store as {@link useAgeBlocked}, so spending one re-renders both,
 * and returned as a boolean rather than the record itself because
 * useSyncExternalStore compares snapshots by identity — a fresh object every
 * read would loop forever.
 */
export function useAgeCorrectionAvailable(): boolean {
  return useSyncExternalStore(subscribe, correctionAvailable, () => false);
}

/**
 * Shown to anyone under the minimum age. The screen it lands on always offers
 * a way back to the form — see {@link MAX_CORRECTIONS}.
 */
export const AGE_BLOCK_MESSAGE = `Sorry, you need to be at least ${MINIMUM_AGE} to use Elovox.`;

/**
 * The lockout screen's way out. Named after the mistake rather than the
 * remedy: "Try again" invites a second guess at the question, which is the
 * behaviour the block is there to stop, while this only makes sense to press
 * if the date on file was actually wrong.
 */
export const AGE_CORRECTION_ACTION = "I entered the wrong date of birth";

/** Sits above it, so the offer can't be read as "keep guessing until it opens". */
export const AGE_CORRECTION_EXPLAINER =
  "Picked the wrong year by mistake? You can go back and enter your date of birth again.";

/**
 * Shown beside the picker afterwards. Points at the year specifically, since
 * that is the wheel that produces this mistake — the day and month are rarely
 * off by enough to matter, and a slipped century is the whole story.
 */
export const AGE_CORRECTION_NOTICE =
  "Your last answer is still filled in below. Check it, the year especially, before you continue.";

/** Shown to 13–17 year olds, who may sign up with permission. */
export const MINOR_NOTICE =
  "You're under 18, so please make sure a parent or guardian is okay with you using Elovox.";
