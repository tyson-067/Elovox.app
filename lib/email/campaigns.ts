/**
 * The three scheduled email runs: weekly progress, streak nudge, win-back.
 *
 * All the aggregation lives here rather than in the route, because the
 * interesting part is not the HTTP — it is doing this within a free plan's
 * budget without reading the whole database once per user.
 *
 * THE SHAPE THAT MAKES THIS AFFORDABLE. Every run is three bulk reads and one
 * batched send, regardless of how many users there are:
 *
 *   1. one collection-group query for the data the run is about,
 *   2. one `auth.getUsers` per 100 uids, for addresses,
 *   3. one `sendBulk`, which chunks into 100-per-request batches.
 *
 * The naive version — per user, read their sessions, look up their auth
 * record, send one email — is three round trips per person and, at 100
 * recipients, fifty seconds of rate-limited API calls. It would work at
 * launch scale and fall over quietly later, which is the worst kind of works.
 *
 * WHO IS EXCLUDED, everywhere: unverified addresses (an unverified address is
 * an address somebody typed, possibly somebody else's), disabled accounts, and
 * anyone the suppression list covers — the last of those is handled inside
 * sendBulk, so it can't be forgotten here.
 */

import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { sendBulk, type AppMessage } from "./send";
import {
  streakAtRisk,
  trialEnding,
  weeklyProgress,
  winBack,
  type WeekStats,
} from "./messages";
import { claimOnce, confirmOnce, releaseOnce } from "./once";
import { siteUrl } from "./config";

const DAY_MS = 86_400_000;

export interface CampaignResult {
  candidates: number;
  sent: number;
  suppressed: number;
  overBudget: number;
  failed: number;
}

const NOTHING: CampaignResult = {
  candidates: 0,
  sent: 0,
  suppressed: 0,
  overBudget: 0,
  failed: 0,
};

/* --- Recipients ------------------------------------------------------------ */

interface Recipient {
  uid: string;
  email: string;
  firstName?: string;
}

/**
 * Addresses for a set of uids, in one API call per 100.
 *
 * `getUsers` rather than `listUsers`: listing pages the entire user table
 * whether or not the run needs it, which is the difference between a query
 * proportional to the recipients and one proportional to the userbase.
 *
 * Silently drops anyone unverified or disabled. That is not a nicety —
 * mailing an unverified address is mailing whoever actually owns it.
 */
async function recipientsFor(
  app: App | null,
  uids: string[]
): Promise<Map<string, Recipient>> {
  const out = new Map<string, Recipient>();
  if (!app || uids.length === 0) return out;

  const { getAuth } = await import("firebase-admin/auth");
  const auth = getAuth(app);

  for (let i = 0; i < uids.length; i += 100) {
    const slice = uids.slice(i, i + 100).map((uid) => ({ uid }));
    try {
      const { users } = await auth.getUsers(slice);
      for (const u of users) {
        if (!u.email || !u.emailVerified || u.disabled) continue;
        out.set(u.uid, {
          uid: u.uid,
          email: u.email,
          firstName: u.displayName?.trim().split(/\s+/)[0] || undefined,
        });
      }
    } catch (err) {
      // One bad page shouldn't lose the whole run.
      console.warn("[mail-campaign] getUsers page failed", err);
    }
  }
  return out;
}

/** Every `users/{uid}/score/progress` doc, keyed by uid.
 *
 *  A collection-group scan of `score` and a filter on the document id, the
 *  same trick /api/admin/users uses for `profile` — Firestore has no "all
 *  docs named progress" query, and a doc read per user is the thing this file
 *  exists to avoid. */
async function allProgress(
  db: Firestore
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const snap = await db.collectionGroup("score").get();
  for (const doc of snap.docs) {
    if (doc.id !== "progress") continue;
    const uid = doc.ref.parent.parent?.id;
    if (uid) out.set(uid, doc.data());
  }
  return out;
}

function utcKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Firestore hands back either a number or a Timestamp depending on how the
 *  field was written; `updatedAt` on the progress doc is a serverTimestamp. */
function toMillis(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/* --- Weekly progress ------------------------------------------------------- */

/**
 * What each active user did in the last seven days.
 *
 * Only people who actually recorded something are included. A "you did
 * nothing this week" email to someone who has quietly stopped is a nudge they
 * did not ask for and the fastest route to the spam button; the win-back
 * below is the one message for that case, and it is sent once.
 */
export async function runWeeklyDigest(
  app: App | null,
  db: Firestore | null,
  now: number = Date.now()
): Promise<CampaignResult> {
  if (!db) return NOTHING;

  const since = now - 7 * DAY_MS;
  const weekKey = utcKey(since);

  const perUser = new Map<string, WeekStats>();
  try {
    const snap = await db
      .collectionGroup("sessions")
      .where("createdAt", ">=", since)
      .get();
    for (const doc of snap.docs) {
      const uid = doc.ref.parent.parent?.id;
      if (!uid) continue;
      const data = doc.data();
      const overall = num((data.analysis as { overall?: unknown } | undefined)?.overall);
      const current = perUser.get(uid) ?? {
        sessions: 0,
        bestScore: null,
        streak: 0,
        minutes: 0,
      };
      current.sessions += 1;
      current.minutes += Math.round(num(data.durationSec) / 60);
      if (overall > 0 && (current.bestScore == null || overall > current.bestScore)) {
        current.bestScore = overall;
      }
      perUser.set(uid, current);
    }
  } catch (err) {
    console.error("[mail-campaign] weekly aggregation failed", err);
    return NOTHING;
  }

  if (perUser.size === 0) return NOTHING;

  // Streaks come from the progress doc; a missing one just means zero.
  try {
    const progress = await allProgress(db);
    for (const [uid, stats] of perUser) {
      stats.streak = num(progress.get(uid)?.streakDays);
    }
  } catch (err) {
    console.warn("[mail-campaign] streak lookup failed, sending without", err);
  }

  const people = await recipientsFor(app, [...perUser.keys()]);
  const messages: AppMessage[] = [];
  for (const [uid, stats] of perUser) {
    const who = people.get(uid);
    if (!who) continue;
    messages.push(weeklyProgress(who.email, uid, weekKey, stats));
  }

  const result = await sendBulk(db, "lifecycle", messages);
  return { candidates: messages.length, ...result };
}

/* --- Streak nudge ---------------------------------------------------------- */

/**
 * People with a real streak who haven't recorded today.
 *
 * `MIN_STREAK` is 7 on purpose. A two-day streak is not something anyone
 * needs an email to protect, and this category shares a daily allowance with
 * the weekly digest — spending it on three-day streaks means the people who
 * have built something get nothing.
 *
 * The day comparison is inexact and known to be: `lastDailyDate` is keyed to
 * the user's LOCAL date (lib/daily.ts reads the device clock) and this runs in
 * UTC, so someone far enough east or west can be a day out. The message copy
 * is written so that being a day out doesn't make it untrue — it says nothing
 * was recorded, not that the streak dies tonight.
 */
const MIN_STREAK = 7;

export async function runStreakNudge(
  app: App | null,
  db: Firestore | null,
  now: number = Date.now()
): Promise<CampaignResult> {
  if (!db) return NOTHING;

  const today = utcKey(now);
  const yesterday = utcKey(now - DAY_MS);

  let progress: Map<string, Record<string, unknown>>;
  try {
    progress = await allProgress(db);
  } catch (err) {
    console.error("[mail-campaign] progress scan failed", err);
    return NOTHING;
  }

  const candidates: Array<{ uid: string; streak: number }> = [];
  for (const [uid, data] of progress) {
    const streak = num(data.streakDays);
    if (streak < MIN_STREAK) continue;
    const last = typeof data.lastDailyDate === "string" ? data.lastDailyDate : null;
    // Alive (yesterday) but not yet extended (not today).
    if (last !== yesterday || last === today) continue;
    candidates.push({ uid, streak });
  }
  if (candidates.length === 0) return NOTHING;

  // Longest streaks first, so if the allowance runs out it runs out on the
  // people with least to lose.
  candidates.sort((a, b) => b.streak - a.streak);

  const people = await recipientsFor(
    app,
    candidates.map((c) => c.uid)
  );
  const messages: AppMessage[] = [];
  for (const { uid, streak } of candidates) {
    const who = people.get(uid);
    if (!who) continue;
    messages.push(streakAtRisk(who.email, uid, streak, today));
  }

  const result = await sendBulk(db, "lifecycle", messages);
  return { candidates: messages.length, ...result };
}

/* --- Win-back -------------------------------------------------------------- */

/**
 * One message, once, to someone who stopped.
 *
 * A WINDOW, not a threshold: between three and five weeks since their last
 * activity. A threshold ("more than 21 days") would sweep up everyone who has
 * ever left, every single day, forever — the first run would mail the entire
 * lapsed userbase and blow a month's quota in an afternoon.
 *
 * `claimOnce` then makes it once per account for good, which Resend's
 * 24-hour idempotency keys cannot: the second attempt at this comes a month
 * later, not a minute later.
 *
 * Uses `updatedAt` on the progress doc as the activity clock. It is written on
 * every scored rep, so it is a good proxy and — unlike scanning sessions —
 * costs one collection-group read for the whole userbase.
 */
const GONE_MIN_DAYS = 21;
const GONE_MAX_DAYS = 35;

export async function runWinBack(
  app: App | null,
  db: Firestore | null,
  now: number = Date.now()
): Promise<CampaignResult> {
  if (!db) return NOTHING;

  let progress: Map<string, Record<string, unknown>>;
  try {
    progress = await allProgress(db);
  } catch (err) {
    console.error("[mail-campaign] progress scan failed", err);
    return NOTHING;
  }

  const candidates: Array<{ uid: string; weeks: number }> = [];
  for (const [uid, data] of progress) {
    const last = toMillis(data.updatedAt);
    if (last == null) continue;
    const days = (now - last) / DAY_MS;
    if (days < GONE_MIN_DAYS || days > GONE_MAX_DAYS) continue;
    // Somebody who never actually practiced isn't lapsed, they never started.
    if (num(data.xp) <= 0) continue;
    candidates.push({ uid, weeks: Math.round(days / 7) });
  }
  if (candidates.length === 0) return NOTHING;

  const people = await recipientsFor(
    app,
    candidates.map((c) => c.uid)
  );

  const messages: AppMessage[] = [];
  const claimed: string[] = [];
  for (const { uid, weeks } of candidates) {
    const who = people.get(uid);
    if (!who) continue;
    // Claim BEFORE building the message, so two concurrent runs of the cron
    // can't both decide to send it.
    if (!(await claimOnce(db, "winback", uid))) continue;
    claimed.push(uid);
    messages.push(winBack(who.email, uid, weeks));
  }
  if (messages.length === 0) return NOTHING;

  const result = await sendBulk(db, "lifecycle", messages);

  // Confirm the claims that were actually sent; hand the rest back so a bad
  // afternoon doesn't cost those people their one win-back permanently.
  //
  // Keyed on `result.sentTo` rather than on the count. The queue is reordered
  // by suppression filtering and trimmed by the budget, so "the first N of
  // what I queued" names the wrong people — it would burn the claim of someone
  // who got nothing while re-sending to someone who did.
  const sentSet = new Set(result.sentTo);
  for (const uid of claimed) {
    const address = people.get(uid)?.email.trim().toLowerCase();
    if (address && sentSet.has(address)) await confirmOnce(db, "winback", uid);
    else await releaseOnce(db, "winback", uid);
  }

  return { candidates: messages.length, ...result };
}

/* --- Trial ending ---------------------------------------------------------- */

/**
 * Warn people before a free trial turns into a charge.
 *
 * This is a billing run, not a lifecycle one: it uses the `billing` allowance,
 * no preference can switch it off, and it carries no unsubscribe link. See the
 * note on `trialEnding` in ./messages.ts for why it exists at all.
 *
 * Window is three days rather than one. The cron fires once a day, so a
 * 24-hour window would miss anyone whose trial ends between two runs, and
 * missing it is the whole failure this guards against. Three days means
 * everybody gets caught by at least one run with a day to spare, and
 * `claimOnce` — keyed on the uid AND the trial's end date — makes sure they
 * are told exactly once per trial.
 *
 * Reads the plan docs directly rather than asking Stripe: the webhook already
 * mirrors `status` and `trialEnd` into Firestore, so this costs one
 * collection-group scan instead of a paged API call over every customer.
 */
const TRIAL_WARN_WINDOW_MS = 3 * DAY_MS;

export async function runTrialEnding(
  app: App | null,
  db: Firestore | null,
  now: number = Date.now()
): Promise<CampaignResult> {
  if (!db) return NOTHING;

  const candidates: Array<{ uid: string; endsAt: number; cycle: string }> = [];
  try {
    // Same shape as allProgress: Firestore has no "every doc named plan"
    // query, so scan the group and filter on the id.
    const snap = await db.collectionGroup("profile").get();
    for (const doc of snap.docs) {
      if (doc.id !== "plan") continue;
      const uid = doc.ref.parent.parent?.id;
      if (!uid) continue;
      const data = doc.data();
      if (data.status !== "trialing") continue;

      const endsAt = toMillis(data.trialEnd);
      // Only a trial still ahead of us. A `trialEnd` in the past means it has
      // already converted — Stripe leaves the field set — and warning someone
      // about a charge they have already paid would be worse than silence.
      if (endsAt == null || endsAt <= now) continue;
      if (endsAt - now > TRIAL_WARN_WINDOW_MS) continue;

      // Somebody who has already cancelled is not about to be charged.
      if (data.cancelAtPeriodEnd === true) continue;

      candidates.push({
        uid,
        endsAt,
        cycle: typeof data.cycle === "string" ? data.cycle : "monthly",
      });
    }
  } catch (err) {
    console.error("[mail-campaign] trial scan failed", err);
    return NOTHING;
  }
  if (candidates.length === 0) return NOTHING;

  const people = await recipientsFor(
    app,
    candidates.map((c) => c.uid)
  );

  const { planFor, formatUSD } = await import("../pricing");
  const messages: AppMessage[] = [];
  const claimed: Array<{ uid: string; key: string; email: string }> = [];

  for (const { uid, endsAt, cycle } of candidates) {
    const who = people.get(uid);
    if (!who) continue;

    const plan = planFor(cycle as Parameters<typeof planFor>[0]);
    const endsOn = new Date(endsAt).toLocaleDateString("en-US", {
      dateStyle: "long",
    });

    // The claim carries the END DATE, so a second trial later is a second
    // warning while a redelivery today is not.
    const claimKey = `${uid}:${endsOn}`;
    if (!(await claimOnce(db, "trial-ending", claimKey))) continue;
    claimed.push({ uid, key: claimKey, email: who.email.trim().toLowerCase() });

    messages.push(
      trialEnding(
        who.email,
        uid,
        endsOn,
        formatUSD(plan.price),
        plan.unit,
        `${siteUrl()}/account`
      )
    );
  }
  if (messages.length === 0) return NOTHING;

  const result = await sendBulk(db, "billing", messages);

  // Only a confirmed send burns the claim; anything else is handed back so
  // tomorrow's run tries again while there is still time to be useful.
  const sentSet = new Set(result.sentTo);
  for (const c of claimed) {
    if (sentSet.has(c.email)) await confirmOnce(db, "trial-ending", c.key);
    else await releaseOnce(db, "trial-ending", c.key);
  }

  return { candidates: messages.length, ...result };
}
