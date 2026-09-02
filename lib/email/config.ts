/**
 * Everything the email system needs to know about ITSELF: which addresses it
 * sends from, what the plan allows, and whether it is configured at all.
 *
 * The numbers in FREE_PLAN are not arbitrary caps we invented — they are
 * Resend's Free tier, written down here so the code can stay *under* them
 * deliberately instead of discovering them as 429s in production. Getting
 * throttled by a provider is not a rate limit, it is a dropped email, and a
 * dropped password-reset notice is a support ticket.
 *
 * If the plan is ever upgraded, this file is the only edit: raise the numbers,
 * nothing else changes.
 */

import { LEGAL } from "../legal";

/* --- What the Free plan actually gives us --------------------------------- */

export const FREE_PLAN = {
  /** Hard monthly ceiling. Resend rejects past this. */
  monthly: 3000,
  /** Hard daily ceiling. This is the one that bites — 3000/30 is 100, so the
   *  monthly and daily caps bind at the same place if sending is even. It is
   *  never even, which is what lib/email/budget.ts exists to manage. */
  daily: 100,
  /**
   * API requests per second, across the whole account.
   *
   * This is the limit people forget, because it isn't about volume. Sending
   * 80 separate emails in a loop is 80 requests and will start returning 429
   * around the third one. The batch endpoint takes 100 messages in ONE
   * request, which is why every bulk path in this codebase goes through
   * `sendBatch` and never through a loop over `sendEmail`.
   */
  requestsPerSecond: 2,
  /** Messages accepted by POST /emails/batch in a single request. */
  batchMax: 100,
  /** Custom sending domains included. One — so MAIL_FROM and every other
   *  address below must all live on the same domain. */
  domains: 1,
} as const;

/* --- Addresses ------------------------------------------------------------ */

/**
 * The envelope sender. Required; without it nothing sends.
 *
 * Should be a real, monitored address on the verified domain, in
 * `Name <address@domain>` form — a display name measurably improves both
 * open rate and the odds of clearing a spam filter, and costs nothing.
 */
export function mailFrom(): string | null {
  const raw = process.env.MAIL_FROM?.trim();
  if (!raw) return null;
  // Bare address in the env var? Wrap it in the service name. Someone setting
  // MAIL_FROM=hello@elovox.app should not silently get worse deliverability
  // than someone who happened to know the display-name syntax.
  return raw.includes("<") ? raw : `${LEGAL.serviceName} <${raw}>`;
}

/**
 * Where replies go. A `no-reply` From with no Reply-To is the single most
 * common self-inflicted deliverability wound: mailbox providers score it, and
 * a user who replies with a real problem gets a bounce.
 *
 * Defaults to the public contact address, which is a mailbox a human reads.
 */
export function mailReplyTo(): string {
  return process.env.MAIL_REPLY_TO?.trim() || LEGAL.emails.support;
}

/** Absolute base URL for links inside emails. Emails have no "current origin",
 *  so a relative link is a broken link — everything must be absolute. */
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || LEGAL.siteUrl
  );
}

/* --- Configuration -------------------------------------------------------- */

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && mailFrom());
}

/** The Resend Audience that mirrors the tips list. Optional: without it,
 *  contacts simply aren't synced and Broadcasts aren't available, while every
 *  transactional path keeps working. */
export function audienceId(): string | null {
  return process.env.RESEND_AUDIENCE_ID?.trim() || null;
}

/* --- Categories ----------------------------------------------------------- */

/**
 * What kind of message this is. This drives three separate decisions, which
 * is why it is one value and not three booleans:
 *
 *   1. Budget priority — whether it may spend the last of today's 100.
 *   2. Consent — whether a user's preferences can switch it off. A security
 *      notice cannot; a weekly digest must be able to.
 *   3. Headers — only opt-in categories carry List-Unsubscribe.
 *
 * Getting (2) wrong in either direction is bad: suppressing a security notice
 * is a safety failure, and sending marketing to someone who opted out is a
 * CAN-SPAM violation. So the mapping is declared once, here.
 */
export type MailCategory =
  /** Account security and access: lockout notices. Never suppressible. */
  | "security"
  /** Money: payment failed, refund issued, subscription confirmed. The user
   *  is in a paid relationship and these are the terms of it. */
  | "billing"
  /** Asked-for, one-shot: welcome, export ready. Consented by the action. */
  | "transactional"
  /** Ongoing, useful, opt-out: weekly progress, streak-at-risk. */
  | "lifecycle"
  /** The tips list, and anything else purely promotional. Opt-IN only. */
  | "marketing";

export interface CategoryPolicy {
  /** Can a user preference or an unsubscribe stop this? */
  optional: boolean;
  /** Share of the daily allowance this category may consume, at most.
   *  Reserves headroom so a 60-message digest run can never eat the quota a
   *  password-reset notice needs an hour later. */
  dailyShare: number;
  /** Preference key in the user's email settings doc. Null = not switchable. */
  prefKey: EmailPrefKey | null;
}

export type EmailPrefKey = "progress" | "streak" | "product" | "tips";

export const CATEGORY: Record<MailCategory, CategoryPolicy> = {
  // 1.0 — a security notice may use the last message of the day. If the
  // choice is between sending this and staying tidy, send this.
  security: { optional: false, dailyShare: 1.0, prefKey: null },
  billing: { optional: false, dailyShare: 1.0, prefKey: null },
  transactional: { optional: false, dailyShare: 0.9, prefKey: null },
  lifecycle: { optional: true, dailyShare: 0.6, prefKey: "progress" },
  marketing: { optional: true, dailyShare: 0.5, prefKey: "tips" },
};

/** Order used when a queue has to be trimmed to fit the budget. */
export const CATEGORY_RANK: MailCategory[] = [
  "security",
  "billing",
  "transactional",
  "lifecycle",
  "marketing",
];
