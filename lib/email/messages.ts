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
