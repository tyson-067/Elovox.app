/**
 * Every email Elovox sends, written out in one place.
 *
 * One file, so the whole programme can be read top to bottom and judged as a
 * whole — which is the only way to notice that a user could get four emails
 * in a day, or that two of them say almost the same thing. A message defined
 * next to the route that triggers it is a message nobody ever reads again.
 *
 * VOICE: short, plain, no exclamation marks, no "we're excited". Two sentences
 * where one would do is the failure mode users already flagged on the site.
 * American spelling — "practice", "practiced", never "practise".
 *
 * Every builder returns a complete AppMessage including its category and its
 * idempotency key, so a caller cannot accidentally send a marketing message
 * as transactional or forget the key that stops a retried cron double-sending.
 */

import { LEGAL } from "../legal";
import { siteUrl } from "./config";
import type { Block } from "./render";
import type { AppMessage } from "./send";

const app = () => siteUrl();

/* --- Security -------------------------------------------------------------- */

/**
 * Somebody has been failing the password on this account.
 *
 * Never suppressible, never carries an unsubscribe link, and the reset URL is
 * printed as a plain `link` block as well as a button — a mail client that
 * mangles the button must not leave the user with no way through.
 */
export function lockoutNotice(
  email: string,
  resetLink: string,
  lockMinutes: number
): AppMessage {
  return {
    to: email,
    category: "security",
    type: "lockout",
    // The link is single-use and Firebase re-issues one per attempt, so the
    // key is time-bucketed: repeated lockouts inside an hour are one email,
    // a fresh one tomorrow is a fresh email.
    key: `lockout:${email}:${Math.floor(Date.now() / 3_600_000)}`,
    subject: `Someone's trying to sign in to your ${LEGAL.serviceName} account`,
    doc: {
      preheader: "We paused sign-in for a bit. Here's how to take it back.",
      heading: "Failed sign-in attempts on your account",
      blocks: [
        {
          kind: "lead",
          text: `Someone has been getting your ${LEGAL.serviceName} password wrong.`,
        },
        {
          kind: "p",
          text: `We've paused sign-in on the account for ${lockMinutes} minutes. If that was you, try again after that.`,
        },
        { kind: "p", text: "If it wasn't you, set a new password now." },
        { kind: "cta", label: "Set a new password", href: resetLink },
        { kind: "link", href: resetLink },
        {
          kind: "note",
          text: "This link works once and expires. Ignore it and your password stays as it is.",
        },
      ],
    },
  };
}

/* --- Onboarding ------------------------------------------------------------ */

export function welcome(email: string, uid: string, firstName?: string): AppMessage {
  const hello = firstName ? `${firstName}, your account is ready.` : "Your account is ready.";
  return {
    to: email,
    category: "transactional",
    type: "welcome",
    uid,
    key: `welcome:${uid}`,
    subject: `Welcome to ${LEGAL.serviceName}`,
    doc: {
      preheader: "Record one speech. You'll have a score in about a minute.",
      heading: hello,
      blocks: [
        {
          kind: "lead",
          text: "Record one speech and you'll have feedback in about a minute.",
        },
        {
          kind: "p",
          text: "Elovox listens to how you actually speak — pace, filler words, clarity — and tells you what to fix next.",
        },
        { kind: "cta", label: "Start today's speech", href: `${app()}/practice` },
        { kind: "rule" },
        {
          kind: "bullets",
          items: [
            "Two minutes a day is enough to move the numbers.",
            "Your recordings stay yours. Delete any of them any time.",
            "Turn on a daily reminder in the app if you want the nudge.",
          ],
        },
        {
          kind: "note",
          text: "Reply to this email if something doesn't work. A person reads it.",
        },
      ],
    },
  };
}

/** Confirms the tips list. The only email a non-account address ever gets
 *  beyond the tips themselves. */
export function tipsWelcome(email: string): AppMessage {
  return {
    to: email,
    category: "marketing",
    type: "tips-welcome",
    prefKey: "tips",
    prefLabel: "speaking tips list",
    key: `tips-welcome:${email}`,
    subject: "You're on the list",
    doc: {
      preheader: "One speaking tip at a time, nothing else.",
      heading: "You're on the list",
      blocks: [
        { kind: "lead", text: "One speaking tip at a time. Nothing else." },
        {
          kind: "p",
          text: "First one: record yourself reading anything for sixty seconds, then listen back. Most people find their filler words in the first take.",
        },
        {
          kind: "p",
          text: `If you'd rather have it scored for you, ${LEGAL.serviceName} does that part.`,
        },
        { kind: "cta", label: "Try it", href: app() },
      ],
    },
  };
}

/* --- Billing --------------------------------------------------------------- */

export function subscriptionStarted(
  email: string,
  uid: string,
  cycle: string,
  renewsOn: string | null
): AppMessage {
  return {
    to: email,
    category: "billing",
    type: "subscription-started",
    uid,
    key: `sub-start:${uid}:${cycle}`,
    subject: `${LEGAL.serviceName} Premium is on`,
    doc: {
      preheader: "Unlimited practice, full reports, the whole library.",
      heading: "Premium is on",
      blocks: [
        { kind: "lead", text: `You're on the ${cycle} plan.` },
        {
          kind: "p",
          text: renewsOn
            ? `It renews on ${renewsOn}. You can cancel any time from your account — no email required, no retention offer.`
            : "You can cancel any time from your account — no email required, no retention offer.",
        },
        { kind: "cta", label: "Open Elovox", href: `${app()}/practice` },
        {
          kind: "note",
          text: "Cancel early and we refund the part you didn't use, back to your card. See the refunds page for the detail.",
        },
      ],
    },
  };
}

/**
 * "Your free trial is about to become a charge."
 *
 * THIS IS THE MOST IMPORTANT BILLING EMAIL THE APP SENDS, and it was missing.
 *
 * Everything else about the trial is already honest — the pricing page says
 * what happens, checkout says it again, and cancelling takes a minute with no
 * email or phone call. But disclosure at the moment of signup is not the same
 * as a reminder seven days later, when the person has forgotten and the card
 * gets charged anyway. That gap is the single most common subscription
 * complaint there is, it is what makes people feel tricked by companies that
 * did technically tell them, and in a growing number of places it is also
 * simply required.
 *
 * So: sent before the money moves, naming the exact amount and the exact date,
 * with the cancel link right there. Category "billing", which means no
 * preference can switch it off — a reminder you can accidentally disable is
 * not a safeguard.
 *
 * TONE IS ADJUSTABLE, SUBSTANCE IS NOT. The wording here is deliberately
 * neutral — it states the date, the amount, and where to manage the plan, and
 * it does not editorialize in either direction. An earlier draft leaned toward
 * "cancel before then and you won't be charged at all", which is friendlier
 * than it needs to be; this reads as a heads-up rather than an exit sign. That
 * is a legitimate call and it costs nothing, because all three required facts
 * are still here.
 *
 * What must NOT be softened away: the date, the amount, and a route to cancel.
 * Visa and Mastercard both require a pre-charge notification carrying exactly
 * those for a free-trial conversion, and an unexpected charge is the single
 * most common cause of a chargeback — which costs the disputed amount plus a
 * fee and, at volume, gets a Stripe account reviewed. Removing this email
 * would not protect the revenue; it would convert some of it into disputes.
 *
 * No retention play either — no discount, no "don't lose your progress". This
 * is a notice, not a save attempt.
 */
export function trialEnding(
  email: string,
  uid: string,
  endsOn: string,
  amount: string,
  unit: string,
  manageUrl: string
): AppMessage {
  return {
    to: email,
    category: "billing",
    type: "trial-ending",
    // Keyed on the trial's own end date, so someone who trials again later
    // gets a fresh reminder while a redelivery today collapses.
    key: `trial-ending:${uid}:${endsOn}`,
    subject: `Your Premium starts ${endsOn}`,
    doc: {
      preheader: `Your free trial ends ${endsOn}. From then it's ${amount} a ${unit}.`,
      heading: "Your Premium starts soon",
      blocks: [
        {
          kind: "lead",
          text: `Your free trial ends on ${endsOn}. From then, Premium is ${amount} a ${unit}.`,
        },
        {
          kind: "p",
          text: "Nothing to do if you'd like to keep it. You can manage or cancel your plan any time from your account.",
        },
        { kind: "cta", label: "Manage your plan", href: manageUrl },
      ],
    },
  };
}

export function paymentFailed(email: string, uid: string, portalUrl: string): AppMessage {
  return {
    to: email,
    category: "billing",
    type: "payment-failed",
    uid,
    key: `payment-failed:${uid}:${new Date().toISOString().slice(0, 10)}`,
    subject: "Your card was declined",
    doc: {
      preheader: "Premium stays on for now. Updating the card takes a minute.",
      heading: "Your card was declined",
      blocks: [
        {
          kind: "lead",
          text: "We couldn't take this month's payment.",
        },
        {
          kind: "p",
          text: "Premium stays on while we retry. If it keeps failing, the account drops back to free — nothing is deleted.",
        },
        { kind: "cta", label: "Update your card", href: portalUrl },
      ],
    },
  };
}

export function subscriptionCanceled(
  email: string,
  uid: string,
  endsOn: string | null
): AppMessage {
  return {
    to: email,
    category: "billing",
    type: "subscription-canceled",
    uid,
    key: `sub-cancel:${uid}:${endsOn ?? "now"}`,
    subject: "Your Premium is ending",
    doc: {
      preheader: endsOn ? `Premium runs until ${endsOn}.` : "Premium has ended.",
      heading: "Premium is ending",
      blocks: [
        {
          kind: "lead",
          text: endsOn
            ? `You keep Premium until ${endsOn}. After that the account goes back to free.`
            : "Your account is back on the free plan.",
        },
        {
          kind: "p",
          text: "Your recordings, scores and streak all stay. Nothing is deleted when a subscription ends.",
        },
        {
          kind: "note",
          text: "If something wasn't working, reply and tell us what. That's more useful to us than the cancellation.",
        },
      ],
    },
  };
}

export function refundIssued(
  email: string,
  uid: string,
  amount: string
): AppMessage {
  return {
    to: email,
    category: "billing",
    type: "refund",
    uid,
    key: `refund:${uid}:${amount}`,
    subject: `${amount} is on its way back`,
    doc: {
      preheader: "Back to the card you paid with. Five to ten working days.",
      heading: `${amount} refunded`,
      blocks: [
        {
          kind: "lead",
          text: `We've sent ${amount} back to the card you paid with.`,
        },
        {
          kind: "p",
          text: "Banks usually take five to ten working days to show it. It goes back to the card — never account credit.",
        },
      ],
    },
  };
}

/* --- Lifecycle ------------------------------------------------------------- */

export interface WeekStats {
  sessions: number;
  bestScore: number | null;
  streak: number;
  minutes: number;
}

export function weeklyProgress(
  email: string,
  uid: string,
  weekKey: string,
  stats: WeekStats
): AppMessage {
  const line =
    stats.sessions === 0
      ? "Nothing recorded this week."
      : stats.sessions === 1
        ? "One speech this week."
        : `${stats.sessions} speeches this week.`;

  return {
    to: email,
    category: "lifecycle",
    type: "weekly-progress",
    prefKey: "progress",
    prefLabel: "weekly progress emails",
    uid,
    key: `weekly:${uid}:${weekKey}`,
    subject: `Your week: ${stats.sessions} ${stats.sessions === 1 ? "speech" : "speeches"}`,
    doc: {
      preheader: line,
      heading: "Your week",
      blocks: [
        { kind: "lead", text: line },
        {
          kind: "stats",
          items: [
            { label: "Speeches", value: String(stats.sessions) },
            { label: "Best score", value: stats.bestScore == null ? "—" : String(stats.bestScore) },
            { label: "Streak", value: `${stats.streak}d` },
            { label: "Minutes", value: String(stats.minutes) },
          ],
        },
        {
          kind: "p",
          text:
            stats.sessions === 0
              ? "No judgment. Two minutes tomorrow puts you back on the board."
              : "Same time next week.",
        },
        { kind: "cta", label: "See your progress", href: `${app()}/progress` },
      ],
    },
  };
}

export function streakAtRisk(email: string, uid: string, streak: number, dayKey: string): AppMessage {
  return {
    to: email,
    category: "lifecycle",
    type: "streak-at-risk",
    prefKey: "streak",
    prefLabel: "streak reminders",
    uid,
    key: `streak:${uid}:${dayKey}`,
    // Deliberately not "your streak ends tonight". Day boundaries here are the
    // USER's local ones (lib/daily.ts keys on the device clock) and this runs
    // on a UTC server, so a hard claim about tonight is a claim this code
    // cannot actually make. "Nothing recorded yet" is true either way.
    subject: `${streak} days, and nothing recorded yet`,
    doc: {
      preheader: "Two minutes keeps it.",
      heading: `Your ${streak}-day streak is still going`,
      blocks: [
        { kind: "lead", text: "Nothing recorded yet. Two minutes keeps it." },
        { kind: "cta", label: "Record today's speech", href: `${app()}/practice?daily=1` },
        {
          kind: "note",
          text: "At most one of these a day, and only for a streak you've already built. Turn it off below if you'd rather not have it.",
        },
      ],
    },
  };
}

/**
 * Win-back. Sent ONCE, at a fixed distance from the last session — never on a
 * schedule that keeps arriving. Somebody who has been gone a month and
 * ignored this has told us their answer.
 */
export function winBack(email: string, uid: string, weeksAway: number): AppMessage {
  return {
    to: email,
    category: "lifecycle",
    type: "win-back",
    prefKey: "product",
    prefLabel: "occasional product emails",
    uid,
    key: `winback:${uid}`,
    subject: "Your speeches are still here",
    doc: {
      preheader: "Nothing was deleted. Pick up where you left off.",
      heading: "Still here when you want it",
      blocks: [
        {
          kind: "lead",
          text: `It's been about ${weeksAway} weeks. Everything you recorded is still there.`,
        },
        {
          kind: "p",
          text: "One speech is enough to start the streak again. It doesn't have to be a good one.",
        },
        { kind: "cta", label: "Record one", href: `${app()}/practice` },
        {
          kind: "note",
          text: "This is the only one of these we send.",
        },
      ],
    },
  };
}

/* --- Operations ------------------------------------------------------------ */

/**
 * The daily operator check-in.
 *
 * Two shapes from one builder, because they are the same message: "here is
 * what needs you" and "nothing needs you". The second only goes out weekly,
 * and it exists so the first one's absence means something — see the note at
 * the top of ./opsAlert.ts.
 *
 * Written to be actionable at a glance on a phone: the subject says how many
 * and how bad, the body says what and where to go. No dashboards to open
 * before you know whether it matters.
 */
export function operatorAlert(
  email: string,
  concerns: Array<{ level: "urgent" | "watch"; title: string; detail: string }>,
  dayKey: string
): AppMessage {
  const urgent = concerns.filter((c) => c.level === "urgent");
  const watch = concerns.filter((c) => c.level === "watch");
  const allClear = concerns.length === 0;

  const subject = allClear
    ? `${LEGAL.serviceName}: all clear`
    : urgent.length > 0
      ? `${LEGAL.serviceName}: ${urgent.length} thing${urgent.length === 1 ? "" : "s"} need${urgent.length === 1 ? "s" : ""} you`
      : `${LEGAL.serviceName}: ${watch.length} thing${watch.length === 1 ? "" : "s"} worth a look`;

  const blocks: Block[] = [];

  if (allClear) {
    blocks.push(
      {
        kind: "lead",
        text: "Nothing needs you. Checked billing, the kill switches, the email budget, bounces, the sending domain, and the tips drip.",
      },
      {
        kind: "note",
        text: "This one arrives weekly whether or not anything is wrong — so that silence on the other days means the check is running, not that it has died.",
      }
    );
  } else {
    if (urgent.length > 0) {
      blocks.push({
        kind: "lead",
        text:
          urgent.length === 1
            ? "One thing needs attention today."
            : `${urgent.length} things need attention today.`,
      });
      for (const c of urgent) {
        blocks.push({ kind: "p", text: `${c.title} — ${c.detail}` });
      }
    }
    if (watch.length > 0) {
      if (urgent.length > 0) blocks.push({ kind: "rule" });
      blocks.push({
        kind: "p",
        text: urgent.length > 0 ? "Also worth a look:" : "Worth a look, nothing urgent:",
      });
      blocks.push({ kind: "bullets", items: watch.map((c) => `${c.title} — ${c.detail}`) });
    }
    blocks.push({ kind: "cta", label: "Open the console", href: `${app()}/admin` });
  }

  return {
    to: email,
    category: "transactional",
    type: allClear ? "ops-all-clear" : "ops-alert",
    // One per operator per day. A re-run of the cron collapses at Resend.
    key: `ops-alert:${dayKey}:${email}`,
    subject,
    doc: {
      preheader: allClear
        ? "Nothing needs you today."
        : concerns[0]?.title ?? "Something needs a look.",
      heading: allClear ? "All clear" : "Elovox needs you",
      blocks,
    },
  };
}

/** The admin console's "send me a test" button. Exercises the real path —
 *  render, budget, tags, log — so a green result means the real thing works. */
export function operatorTest(email: string): AppMessage {
  return {
    to: email,
    category: "transactional",
    type: "operator-test",
    key: `test:${email}:${Date.now()}`,
    subject: `${LEGAL.serviceName} mail test`,
    doc: {
      preheader: "If you can read this, sending works.",
      heading: "Mail is working",
      blocks: [
        { kind: "lead", text: "If you can read this, sending works." },
        {
          kind: "p",
          text: "Sent through the real path: budget reserved, suppression checked, tagged, and logged.",
        },
        { kind: "stats", items: [{ label: "Sent at", value: new Date().toISOString().slice(0, 16).replace("T", " ") }] },
      ],
    },
  };
}
