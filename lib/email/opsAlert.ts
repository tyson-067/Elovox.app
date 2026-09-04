/**
 * The operator alert: the thing that tells you when something needs you.
 *
 * Every other automated part of this app is silent by design and that is
 * correct — but a system that only ever writes its problems into a database
 * has not reported them, it has filed them. `lib/refunds.ts` records
 * `resolved: false` when it cannot find the money to give back; a kill switch
 * left on quietly keeps the paid pipeline off; the free plan's daily allowance
 * runs out at a hundred whether or not anyone is watching. All of those are
 * recorded correctly today, and all of them are invisible until somebody
 * happens to open the console on the right afternoon.
 *
 * So: one check a day, and an email ONLY when something is actually wrong.
 *
 * THE HARD PART OF A MONITOR IS ITS SILENCE. An alerting system that has
 * nothing to say is indistinguishable from one that has died — and the day it
 * dies is, by construction, a day nobody notices. Hence the weekly all-clear:
 * once a week, even with nothing wrong, it says so. That single message is
 * what makes the other six days' silence mean anything.
 *
 * Goes to ADMIN_EMAILS. Category `transactional` — it is not marketing, it
 * cannot be unsubscribed from, and it is not `billing` because it is about the
 * service rather than about anybody's own money.
 */

import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { adminEmailList } from "../verify";
import { getOpsFlags, invalidateOpsFlagsCache, utcDayKey } from "../opsMetrics";
import { snapshot } from "./budget";
import { listDomains } from "./client";
import { isMailConfigured } from "./config";
import { sendBulk } from "./send";
import { operatorAlert } from "./messages";
import { claimOnce, confirmOnce, releaseOnce } from "./once";
import { TIPS } from "./tips";

export interface Concern {
  /** `urgent` needs attention today; `watch` is a heads-up. Urgent items sort
   *  first and are the only ones that can trigger an out-of-band send. */
  level: "urgent" | "watch";
  title: string;
  detail: string;
}

const DAY_MS = 86_400_000;

/* --- The checks ------------------------------------------------------------ */

/**
 * Everything worth waking somebody for.
 *
 * Each check is independently wrapped: one failing lookup must not silence the
 * other six. A monitor that goes quiet because one of its own queries threw is
 * worse than no monitor, because it looks like good news.
 */
export async function collectConcerns(
  app: App | null,
  db: Firestore | null,
  now: number = Date.now()
): Promise<Concern[]> {
  const out: Concern[] = [];
  if (!db) return out;

  const safe = async (fn: () => Promise<void>, label: string) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[ops-alert] check "${label}" failed`, err);
      out.push({
        level: "watch",
        title: `Couldn't run the ${label} check`,
        detail: "It may be fine. Worth a look in the console.",
      });
    }
  };

  // 1. Money we owe and couldn't return. The single most important one: every
  //    row here is a real person owed a real refund that failed.
  await safe(async () => {
    const snap = await db.collection("billingAlerts").where("resolved", "==", false).get();
    if (snap.empty) return;
    const kinds = new Map<string, number>();
    for (const d of snap.docs) {
      const kind = (d.data().kind as string) ?? "unknown";
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    out.push({
      level: "urgent",
      title: `${snap.size} unresolved billing alert${snap.size === 1 ? "" : "s"}`,
      detail:
        [...kinds].map(([k, n]) => `${n} × ${k}`).join(", ") +
        ". Admin → Billing. These are refunds that didn't complete or duplicate subscriptions.",
    });
  }, "billing alerts");

  // 2. Kill switches. Both are meant to be temporary, and both are easy to
  //    leave on — pauseAnalyze stops the product working, pauseCheckout stops
  //    it selling, and neither announces itself anywhere a user would see.
  await safe(async () => {
    // Read them FRESH. getOpsFlags caches per instance for a minute, which is
    // right for the hot path it was built for and wrong here: this runs once a
    // day, and a cached miss means a paused pipeline goes unreported until
    // tomorrow. Caught in testing — a warm instance saw 3 of 5 planted
    // problems, a cold one saw all 5.
    invalidateOpsFlagsCache();
    const flags = await getOpsFlags(db);
    if (flags.pauseAnalyze) {
      out.push({
        level: "urgent",
        title: "Analysis is paused",
        detail: "Nobody can get feedback on a recording. Admin → Ops to resume.",
      });
    }
    if (flags.pauseCheckout) {
      out.push({
        level: "urgent",
        title: "Checkout is paused",
        detail: "Nobody can subscribe. Admin → Ops to resume.",
      });
    }
    if (flags.banner) {
      out.push({
        level: "watch",
        title: "A site banner is showing",
        detail: `"${flags.banner.slice(0, 80)}" is still visible to every visitor.`,
      });
    }
  }, "ops flags");

  // 3. The free plan. Two different problems: today running out (mail starts
  //    getting dropped this afternoon) and the month trending over (it starts
  //    getting dropped for the rest of the month).
  await safe(async () => {
    const b = await snapshot(db, now);
    if (b.usedToday >= b.dailyCap * 0.8) {
      out.push({
        level: b.usedToday >= b.dailyCap ? "urgent" : "watch",
        title: `Email: ${b.usedToday} of ${b.dailyCap} sent today`,
        detail:
          b.usedToday >= b.dailyCap
            ? "The daily cap is gone. Anything else today is being dropped, including security and billing mail."
            : "Close to the daily cap. Optional mail will be trimmed first.",
      });
    }
    // Straight-line projection from the month so far. Crude, and enough:
    // the question is only "is this heading somewhere bad".
    const dayOfMonth = new Date(now).getUTCDate();
    const projected = (b.usedThisMonth / dayOfMonth) * 30;
    if (dayOfMonth >= 5 && projected > b.monthlyCap) {
      out.push({
        level: "watch",
        title: "Email is trending over the monthly limit",
        detail: `${b.usedThisMonth} sent in ${dayOfMonth} days, on track for about ${Math.round(
          projected
        )} against a cap of ${b.monthlyCap}.`,
      });
    }
  }, "email budget");

  // 4. Suppression spikes. A handful of bounces is life; a sudden cluster is
  //    usually a broken template, a bad address import, or a reputation
  //    problem starting — and all three are much cheaper to catch early.
  await safe(async () => {
    const since = now - DAY_MS;
    const snap = await db
      .collection("emailSuppression")
      .where("at", ">=", since)
      .get();
    const hard = snap.docs.filter((d) => {
      const r = d.data().reason;
      return r === "hard-bounce" || r === "complaint";
    });
    const complaints = hard.filter((d) => d.data().reason === "complaint").length;
    // Any complaint at all is worth knowing about at this scale. Bounces need
    // a few before they mean anything.
    if (complaints > 0) {
      out.push({
        level: "urgent",
        title: `${complaints} spam complaint${complaints === 1 ? "" : "s"} in 24h`,
        detail:
          "Someone marked Elovox mail as spam. A few of these is how a sending domain starts landing in spam folders for everyone.",
      });
    } else if (hard.length >= 5) {
      out.push({
        level: "watch",
        title: `${hard.length} hard bounces in 24h`,
        detail: "Higher than usual. Admin → Email → Suppressed.",
      });
    }
  }, "suppression");

  // 5. The sending domain. DNS rots silently: nothing errors, mail simply
  //    starts going to spam. This is the check that would otherwise never
  //    happen, because nobody thinks to re-open the Resend dashboard.
  await safe(async () => {
    if (!isMailConfigured()) {
      out.push({
        level: "urgent",
        title: "Email isn't configured",
        detail: "RESEND_API_KEY or MAIL_FROM is unset. Nothing is being sent at all.",
      });
      return;
    }
    if (!process.env.RESEND_WEBHOOK_SECRET) {
      out.push({
        level: "watch",
        title: "No webhook secret",
        detail:
          "Bounces and complaints aren't being recorded, so dead addresses stay on the list.",
      });
    }
    const domains = await listDomains();
    // null means the lookup failed (or the key is send-only, which is the
    // recommended setup) — not a finding.
    for (const d of domains ?? []) {
      if (typeof d.status === "string" && d.status !== "verified") {
        out.push({
          level: "urgent",
          title: `Sending domain ${d.name} is "${d.status}"`,
          detail: "Mail from an unverified domain lands in spam. Check the DNS records.",
        });
      }
    }
  }, "domain");

  // 6. Is the tips drip actually moving? A schedule nobody has to touch is a
  //    schedule nobody would notice had stopped. Subscribers piling up as
  //    "due" across days means the cron isn't reaching it.
  await safe(async () => {
    const snap = await db.collection("leads").get();
    if (snap.empty) return;
    let due = 0;
    for (const d of snap.docs) {
      const x = d.data();
      const index = typeof x.tipIndex === "number" ? x.tipIndex : 0;
      if (index >= TIPS.length) continue;
      const raw = x.lastTipAt ?? x.since;
      const last =
        typeof raw === "number"
          ? raw
          : raw && typeof raw.toMillis === "function"
            ? raw.toMillis()
            : null;
      // Two weeks overdue, not one: one week overdue is simply someone whose
      // turn is today and hasn't been reached yet.
      if (last != null && now - last >= 14 * DAY_MS) due++;
    }
    if (due > 0) {
      out.push({
        level: "watch",
        title: `${due} tips subscriber${due === 1 ? " is" : "s are"} overdue`,
        detail: "More than two weeks since their last tip. The drip may not be running.",
      });
    }
  }, "tips drip");

  // Urgent first — the email is read top-down and possibly on a phone.
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "urgent" ? -1 : 1));
}

/* --- The run --------------------------------------------------------------- */

export interface OpsAlertResult {
  concerns: number;
  urgent: number;
  sent: number;
  /** Why nothing was sent, when nothing was. */
  skipped?: "all-clear" | "no-recipients" | "already-sent";
}

/**
 * Check, and mail the operators if there is anything to say.
 *
 * Sends when there is at least one concern, OR on Mondays regardless — see the
 * note at the top about why a monitor has to prove it is alive.
 *
 * Claimed once per day so a re-run of the cron can't send twice, and released
 * if the send didn't actually happen so the next run can try again.
 */
export async function runOperatorAlert(
  app: App | null,
  db: Firestore | null,
  now: number = Date.now()
): Promise<OpsAlertResult> {
  const concerns = await collectConcerns(app, db, now);
  const urgent = concerns.filter((c) => c.level === "urgent").length;

  // Monday, matching the weekly digest's day.
  const isWeeklyCheckIn = new Date(now).getUTCDay() === 1;
  if (concerns.length === 0 && !isWeeklyCheckIn) {
    return { concerns: 0, urgent: 0, sent: 0, skipped: "all-clear" };
  }

  const operators = adminEmailList();
  if (operators.length === 0) {
    // Worth a log line: the alerting is switched off and it isn't obvious.
    console.warn("[ops-alert] ADMIN_EMAILS is empty — nobody to alert.");
    return { concerns: concerns.length, urgent, sent: 0, skipped: "no-recipients" };
  }

  const day = utcDayKey(now);
  const claimKey = `${day}`;
  if (!(await claimOnce(db, "ops-alert", claimKey))) {
    return { concerns: concerns.length, urgent, sent: 0, skipped: "already-sent" };
  }

  const result = await sendBulk(
    db,
    "transactional",
    operators.map((email) => operatorAlert(email, concerns, day))
  );

  if (result.sent > 0) await confirmOnce(db, "ops-alert", claimKey);
  else await releaseOnce(db, "ops-alert", claimKey);

  return { concerns: concerns.length, urgent, sent: result.sent };
}
