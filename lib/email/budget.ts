/**
 * The free-plan budget.
 *
 * Resend's Free tier is 100 emails a day and 3,000 a month. Both are hard —
 * message 101 is not delayed, it is refused. So the interesting question is
 * never "did we run out?" but "who ran out FIRST", and left alone the answer
 * is whoever happened to send at 9am. A weekly digest going to 80 people at
 * dawn would leave 20 for the rest of the day, and the person locked out of
 * their account at 3pm would get nothing.
 *
 * This file makes that impossible. Every send reserves against a durable
 * counter before it goes out, and each category may only ever consume its
 * share of the day (see CATEGORY in ./config): a digest run can take 60, and
 * a security notice can take the hundredth message. Bulk callers ask for many
 * and are told how many they actually got — they must send exactly that many
 * and no more.
 *
 * Counters are per UTC day, matching lib/quota.ts and lib/opsMetrics.ts so
 * every "day" in this codebase means the same thing.
 *
 * The reservation is a Firestore transaction, so two instances running the
 * same cron cannot both see 40 remaining and both send 40.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { CATEGORY, FREE_PLAN, type MailCategory } from "./config";
import { utcDayKey } from "../opsMetrics";

const COLLECTION = "emailBudget";

/** Month key, UTC, matching the day key's slicing. */
export function utcMonthKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

function dayRef(db: Firestore, now: number) {
  return db.doc(`${COLLECTION}/${utcDayKey(now)}`);
}
function monthRef(db: Firestore, now: number) {
  // "m-" prefix so month docs can share the collection with day docs without
  // a 2026-08 ever colliding with a 2026-08-01.
  return db.doc(`${COLLECTION}/m-${utcMonthKey(now)}`);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export interface Reservation {
  /** How many messages the caller may actually send. Can be 0. */
  granted: number;
  /** Why fewer were granted than asked for. Null when granted === asked. */
  limited: "day" | "month" | "category" | null;
}

/**
 * Claim `count` sends for `category`, returning how many are allowed.
 *
 * With no database configured this grants everything asked for: the budget is
 * a safety rail, and a missing service account should degrade to "sends might
 * hit the provider cap", not to "nothing sends at all". The provider's own
 * 429 is the backstop, and ./client.ts handles it.
 */
export async function reserve(
  db: Firestore | null,
  category: MailCategory,
  count = 1,
  now: number = Date.now()
): Promise<Reservation> {
  if (count <= 0) return { granted: 0, limited: null };
  if (!db) return { granted: count, limited: null };

  const policy = CATEGORY[category];
  const categoryCap = Math.floor(FREE_PLAN.daily * policy.dailyShare);

  try {
    return await db.runTransaction<Reservation>(async (tx) => {
      const day = dayRef(db, now);
      const month = monthRef(db, now);
      const [daySnap, monthSnap] = await Promise.all([tx.get(day), tx.get(month)]);

      const dayData = daySnap.data() ?? {};
      const usedToday = num(dayData.total);
      const usedByCategory = num(dayData[category]);
      const usedThisMonth = num(monthSnap.data()?.total);

      const headroom = [
        { limit: FREE_PLAN.daily - usedToday, why: "day" as const },
        { limit: FREE_PLAN.monthly - usedThisMonth, why: "month" as const },
        { limit: categoryCap - usedByCategory, why: "category" as const },
      ];
      const tightest = headroom.reduce((a, b) => (b.limit < a.limit ? b : a));
      const granted = Math.max(0, Math.min(count, tightest.limit));

      if (granted > 0) {
        tx.set(
          day,
          {
            total: FieldValue.increment(granted),
            [category]: FieldValue.increment(granted),
            day: utcDayKey(now),
          },
          { merge: true }
        );
        tx.set(
          month,
          { total: FieldValue.increment(granted), month: utcMonthKey(now) },
          { merge: true }
        );
      }

      return {
        granted,
        limited: granted < count ? tightest.why : null,
      };
    });
  } catch (err) {
    // Firestore unreachable. Grant the request rather than silently muting
    // the app's email — the provider cap still protects the account, and a
    // security notice that doesn't send because a counter was unavailable is
    // the worse of the two failures.
    console.error("[mail-budget] reservation failed, allowing send", err);
    return { granted: count, limited: null };
  }
}

/**
 * Give back budget for messages that were reserved but never sent.
 *
 * Called on every send failure. Without this, a provider outage burns the
 * whole day's allowance on emails that never left the building, and the
 * retry an hour later finds nothing left.
 *
 * Never throws and never drives a decision — a lost release costs a few
 * messages of headroom, an exception here would cost the caller's request.
 */
export async function release(
  db: Firestore | null,
  category: MailCategory,
  count = 1,
  now: number = Date.now()
): Promise<void> {
  if (!db || count <= 0) return;
  try {
    await Promise.all([
      dayRef(db, now).set(
        {
          total: FieldValue.increment(-count),
          [category]: FieldValue.increment(-count),
        },
        { merge: true }
      ),
      monthRef(db, now).set({ total: FieldValue.increment(-count) }, { merge: true }),
    ]);
  } catch (err) {
    console.warn("[mail-budget] release failed", err);
  }
}

export interface BudgetSnapshot {
  day: string;
  month: string;
  usedToday: number;
  dailyCap: number;
  usedThisMonth: number;
  monthlyCap: number;
  byCategory: Record<string, { used: number; cap: number }>;
}

/** What the admin console shows. Read-only; never reserves. */
export async function snapshot(
  db: Firestore | null,
  now: number = Date.now()
): Promise<BudgetSnapshot> {
  const empty: BudgetSnapshot = {
    day: utcDayKey(now),
    month: utcMonthKey(now),
    usedToday: 0,
    dailyCap: FREE_PLAN.daily,
    usedThisMonth: 0,
    monthlyCap: FREE_PLAN.monthly,
    byCategory: {},
  };
  if (!db) return empty;

  try {
    const [daySnap, monthSnap] = await Promise.all([
      dayRef(db, now).get(),
      monthRef(db, now).get(),
    ]);
    const dayData = daySnap.data() ?? {};
    const byCategory: BudgetSnapshot["byCategory"] = {};
    for (const [name, policy] of Object.entries(CATEGORY)) {
      byCategory[name] = {
        used: num(dayData[name]),
        cap: Math.floor(FREE_PLAN.daily * policy.dailyShare),
      };
    }
    return {
      ...empty,
      usedToday: num(dayData.total),
      usedThisMonth: num(monthSnap.data()?.total),
      byCategory,
    };
  } catch (err) {
    console.warn("[mail-budget] snapshot failed", err);
    return empty;
  }
}

/**
 * The daily history behind the admin sparkline.
 *
 * Day docs are pure counters — no addresses, no uids, nothing to purge — so
 * unlike opsEvents they are kept indefinitely. Seeing that sends have crept
 * from 30/day to 85/day is the only warning anyone gets before the free plan
 * stops being enough.
 */
export async function recentDays(
  db: Firestore | null,
  days = 30,
  now: number = Date.now()
): Promise<Array<{ day: string; total: number }>> {
  if (!db) return [];
  const wanted: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    wanted.push(utcDayKey(now - i * 86_400_000));
  }
  try {
    const snaps = await db.getAll(...wanted.map((d) => db.doc(`${COLLECTION}/${d}`)));
    return snaps.map((s, i) => ({ day: wanted[i], total: num(s.data()?.total) }));
  } catch (err) {
    console.warn("[mail-budget] history failed", err);
    return wanted.map((day) => ({ day, total: 0 }));
  }
}
