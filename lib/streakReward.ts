import { FieldPath, FieldValue, type Firestore } from "firebase-admin/firestore";

// A free user who shows up 21 days running gets a week of Premium, free.
//
// The whole feature is server-side, and it has to be. The obvious streak
// number — users/{uid}/profile/stats.streakDays — is written by the browser
// (firestore.rules lets the owner write every profile doc except `plan`), so
// anyone could set it to 21 and mint themselves Premium forever. It is a UI
// number, not evidence.
//
// The evidence is users/{uid}/usage/{date}. That doc is created by the Admin
// SDK when a daily attempt is reserved (lib/quota.ts) and rules deny every
// client write to it, so its existence is proof the user actually recorded
// something that day and can't be forged. Counting consecutive day-keys there
// is the real streak.
//
// No Stripe object is involved. Granting a $0 subscription or a coupon would
// mean webhook races, a $0 invoice in the books, and a cancellation call to
// make it end. Instead the grant is a timestamp on the plan doc, and
// entitlement reads treat "plan says premium" OR "the comp window is still
// open" as Premium (see isPremiumServer in lib/verify.ts and lib/plan.ts).
// It expires by itself with nothing left to clean up.

/** Consecutive days of daily-challenge practice that earn a comp week. */
export const STREAK_REWARD_DAYS = 21;

/** How much Premium a qualifying streak buys. */
export const STREAK_REWARD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How far back the usage scan reads. Comfortably past the 21 it needs, and
 * bounded so a user with two years of history doesn't drag the whole
 * collection into memory on a claim.
 */
const SCAN_LIMIT = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function utcDateKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Whole days from day key `a` to day key `b`. Negative if `b` is earlier. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export interface StreakRewardRecord {
  /** Epoch ms the comp window closes. Absent or past means no comp. */
  premiumUntil?: number;
  /** Last day already counted toward a granted reward; days at or before it don't count again. */
  streakRewardAnchor?: string;
  streakRewardsGranted?: number;
}

/** True when a comp window is currently open. */
export function hasOpenGrant(
  record: StreakRewardRecord | undefined,
  now: number = Date.now()
): boolean {
  return typeof record?.premiumUntil === "number" && record.premiumUntil > now;
}

/**
 * Length of the run of consecutive practice days ending today or yesterday.
 *
 * Yesterday counts as current because the streak is a local-midnight idea and
 * these keys are UTC — someone practicing at 9pm in Los Angeles writes
 * tomorrow's UTC key, and someone claiming at 8am there is a day "behind".
 * Requiring the run to reach today exactly would deny honest users west of
 * UTC their reward for a timezone detail. A run that stopped two days ago is
 * genuinely broken and returns 0.
 *
 * Days at or before `anchor` are excluded, so a granted reward can't be
 * claimed twice off the same 21 days — the next one needs 21 fresh days.
 */
export async function currentUsageStreak(
  db: Firestore,
  uid: string,
  opts: { now?: number; anchor?: string } = {}
): Promise<{ days: number; lastDay: string | null }> {
  const now = opts.now ?? Date.now();
  const today = utcDateKey(now);

  const snap = await db
    .collection(`users/${uid}/usage`)
    .orderBy(FieldPath.documentId(), "desc")
    .limit(SCAN_LIMIT)
    .get();

  // Doc ids are YYYY-MM-DD, so descending id order is descending date order.
  // Count a day ONLY if it has a real daily-challenge attempt on it
  // (dailyAnalyses > 0), not merely because a usage doc exists. Other writes
  // now touch this doc — a metered session deletion, a premium analysis — and
  // a bare doc created by one of those would otherwise count as a practice
  // day, letting someone earn the free-Premium comp week (which this streak
  // grants) without practicing. The query already fetches full docs, so
  // reading the field costs no extra reads.
  const days = snap.docs
    .filter((d) => Number(d.data()?.dailyAnalyses ?? 0) > 0)
    .map((d) => d.id)
    .filter((id) => DATE_RE.test(id))
    .filter((id) => !opts.anchor || daysBetween(opts.anchor, id) > 0);

  if (days.length === 0) return { days: 0, lastDay: null };

  const gapToToday = daysBetween(days[0], today);
  // Ahead of the server's UTC date (a client one timezone forward) is fine;
  // more than a day behind means the run is over.
  if (gapToToday > 1) return { days: 0, lastDay: null };

  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (daysBetween(days[i], days[i - 1]) !== 1) break;
    run++;
  }
  return { days: run, lastDay: days[0] };
}

export type ClaimOutcome =
  | { granted: true; premiumUntil: number; streakDays: number }
  | {
      granted: false;
      reason: "not-eligible" | "already-premium" | "already-granted";
      streakDays: number;
      needed: number;
    };

/**
 * Checks the real streak and, if it qualifies, opens a comp week.
 *
 * Runs in a transaction against the plan doc so two tabs claiming at the same
 * instant can't stack two weeks onto one streak.
 */
export async function claimStreakReward(
  db: Firestore,
  uid: string,
  now: number = Date.now()
): Promise<ClaimOutcome> {
  const planRef = db.doc(`users/${uid}/profile/plan`);
  const planSnap = await planRef.get();
  const plan = (planSnap.data() ?? {}) as StreakRewardRecord & { plan?: string };

  // Paying subscribers are excluded: this is a reason to come back to the
  // free tier, and comping a week onto a live subscription buys nothing.
  if (plan.plan === "premium") {
    return { granted: false, reason: "already-premium", streakDays: 0, needed: STREAK_REWARD_DAYS };
  }
  if (hasOpenGrant(plan, now)) {
    return { granted: false, reason: "already-granted", streakDays: 0, needed: STREAK_REWARD_DAYS };
  }

  const { days, lastDay } = await currentUsageStreak(db, uid, {
    now,
    anchor: plan.streakRewardAnchor,
  });

  if (days < STREAK_REWARD_DAYS || !lastDay) {
    return { granted: false, reason: "not-eligible", streakDays: days, needed: STREAK_REWARD_DAYS };
  }

  const premiumUntil = now + STREAK_REWARD_MS;

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(planRef);
    const data = (fresh.data() ?? {}) as StreakRewardRecord & { plan?: string };
    // Re-check inside the transaction: the read above is not serialized with
    // a concurrent claim from another tab.
    if (data.plan === "premium" || hasOpenGrant(data, now)) return;
    tx.set(
      planRef,
      {
        premiumUntil,
        grantReason: "streak-21",
        // Everything up to and including today is spent. The next comp week
        // needs 21 days built on top of it.
        streakRewardAnchor: lastDay,
        streakRewardsGranted: FieldValue.increment(1),
        streakRewardAt: now,
      },
      { merge: true }
    );
  });

  return { granted: true, premiumUntil, streakDays: days };
}
