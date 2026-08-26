/**
 * The one door every email in this app goes out through.
 *
 * Nothing else calls ./client.ts directly. That is the point: consent,
 * suppression, the free-plan budget, the unsubscribe headers, the tagging and
 * the delivery log are not things a caller should have to remember, and the
 * first caller that forgets one is the one that gets the domain filtered.
 *
 * The order below is deliberate and each step earns its place:
 *
 *   configured? → suppressed? → budget? → render → send → log
 *
 * Suppression is checked BEFORE the budget, so a bounced address never spends
 * an allowance. The budget is claimed BEFORE the send and released on failure,
 * so a provider outage doesn't silently eat the day. The log is written AFTER,
 * because its only job is to be joinable with the webhook events that follow.
 *
 * Never throws. Returns why.
 */

import type { Firestore } from "firebase-admin/firestore";
import {
  CATEGORY,
  isMailConfigured,
  type EmailPrefKey,
  type MailCategory,
} from "./config";
import { chunkForBatch, sendBatch, sendEmail, throttle, type ResendTag } from "./client";
import { release, reserve } from "./budget";
import { filterSuppressed, suppressionFor } from "./suppression";
import { unsubHeaders, unsubUrl } from "./prefs";
import { render, type EmailDoc } from "./render";

/** Retention on the delivery log. It holds addresses, so it lives under the
 *  same "short operational window" the privacy policy promises for logs. The
 *  purge cron sweeps it; see lib/email/retention.ts. */
export const EMAIL_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AppMessage {
  to: string;
  subject: string;
  category: MailCategory;
  /** Machine slug for the log and the Resend tag: "welcome", "trial-ending".
   *  Makes "how does billing mail perform?" a one-click dashboard filter. */
  type: string;
  /** The body, minus the unsubscribe line, which this file fills in. */
  doc: Omit<EmailDoc, "unsubscribeUrl" | "unsubscribeLabel">;
  /**
   * Narrower consent than the category's default. A streak nudge and a weekly
   * digest are both `lifecycle`, but somebody may well want one and not the
   * other, and a single switch for both means they turn off both.
   */
  prefKey?: EmailPrefKey;
  /** Human phrase for the footer: "weekly progress emails". */
  prefLabel?: string;
  /**
   * Stable across retries, derived from what the message IS. "welcome:{uid}",
   * not a uuid — see ./client.ts. Strongly recommended for anything a webhook
   * or a cron might trigger twice.
   */
  key?: string;
  /** Resend holds it and sends later. Free plan supports this. */
  scheduledAt?: string;
  /** For the log only. Never put a uid or an address in a tag. */
  uid?: string;
}

export type SendOutcome =
  | "sent"
  | "not-configured"
  | "suppressed"
  | "budget"
  | "failed";

export interface AppSendResult {
  sent: boolean;
  outcome: SendOutcome;
  id?: string | null;
  /** Present when outcome is "suppressed" or "budget" — the specific reason. */
  detail?: string;
}

function tagsFor(m: AppMessage): ResendTag[] {
  return [
    { name: "category", value: m.category },
    { name: "type", value: m.type },
  ];
}

/* --- Single ---------------------------------------------------------------- */

export async function send(
  db: Firestore | null,
  message: AppMessage
): Promise<AppSendResult> {
  if (!isMailConfigured()) return { sent: false, outcome: "not-configured" };

  const policy = CATEGORY[message.category];
  const prefKey = message.prefKey ?? policy.prefKey;

  const blocked = await suppressionFor(db, message.to, {
    optional: policy.optional,
    prefKey,
  });
  if (blocked) {
    return { sent: false, outcome: "suppressed", detail: blocked };
  }

  // The reservation's own timestamp, threaded through to release().
  // release() defaults `now` to Date.now(), so a send that reserved at
  // 23:59 UTC and failed at 00:00 credited the NEXT day: the day that
  // actually spent the message stayed burned, and the new day started
  // with a message of phantom headroom. Small, but it is a counter whose
  // whole job is to be exact.
  const reservedAt = Date.now();
  const budget = await reserve(db, message.category, 1, reservedAt);
  if (budget.granted < 1) {
    // Loud, because this is the failure mode the whole budget system exists
    // to make visible rather than mysterious. Someone reading the log should
    // learn which cap bound and therefore what to do about it.
    console.warn(
      `[mail] dropped ${message.type} (${message.category}): ${budget.limited} cap reached`
    );
    return { sent: false, outcome: "budget", detail: budget.limited ?? "cap" };
  }

  const unsub = policy.optional ? unsubUrl(message.to, prefKey ?? undefined) : null;
  const { html, text } = render({
    ...message.doc,
    unsubscribeUrl: unsub,
    unsubscribeLabel: message.prefLabel,
  });

  const res = await sendEmail(
    {
      to: message.to,
      subject: message.subject,
      html,
      text,
      headers: unsubHeaders(message.to, prefKey, policy.optional),
      tags: tagsFor(message),
      scheduledAt: message.scheduledAt,
    },
    message.key
  );

  if (!res.ok) {
    await release(db, message.category, 1, reservedAt);
    return { sent: false, outcome: "failed", detail: res.reason };
  }

  await logSent(db, [{ message, id: res.id }]);
  return { sent: true, outcome: "sent", id: res.id };
}

/* --- Bulk ------------------------------------------------------------------ */

export interface BulkResult {
  sent: number;
  /** Removed by the suppression list before anything was reserved. */
  suppressed: number;
  /** Trimmed because the day's allowance for this category ran out. */
  overBudget: number;
  failed: number;
  /**
   * Exactly who was sent to, lower-cased.
   *
   * Counts alone are not enough for any caller that has to record "this person
   * has now had this message". The queue gets reordered — suppressed addresses
   * are filtered out, then the tail is trimmed to fit the budget — so
   * "the first `sent` of the input" is simply wrong, and a drip that advances
   * on it skips a tip for everybody downstream of a suppressed subscriber.
   */
  sentTo: string[];
}

/**
 * Send many messages of the SAME category in as few API requests as possible.
 *
 * This is the path every cron takes, and it is the reason a 3,000-a-month plan
 * can run a real lifecycle programme: 100 messages leave in one request rather
 * than 100, which matters because the account limit is two requests a second
 * and has nothing to do with the monthly quota.
 *
 * The trim is the important part. If 80 people are due a digest and only 43
 * of today's allowance is left for `lifecycle`, this sends 43 and reports 37
 * over budget — it does not send 80 and let the provider reject an arbitrary
 * subset, which would be the same emails failing every week.
 */
export async function sendBulk(
  db: Firestore | null,
  category: MailCategory,
  messages: AppMessage[]
): Promise<BulkResult> {
  const empty: BulkResult = {
    sent: 0,
    suppressed: 0,
    overBudget: 0,
    failed: 0,
    sentTo: [],
  };
  if (!isMailConfigured() || messages.length === 0) return empty;

  const policy = CATEGORY[category];
  const prefKey = messages[0]?.prefKey ?? policy.prefKey;

  const { allowed } = await filterSuppressed(
    db,
    messages.map((m) => m.to),
    { optional: policy.optional, prefKey }
  );
  const allowedSet = new Set(allowed.map((e) => e.trim().toLowerCase()));
  let queue = messages.filter((m) => allowedSet.has(m.to.trim().toLowerCase()));
  const suppressed = messages.length - queue.length;

  // The reservation's own timestamp, threaded through to release().
  // release() defaults `now` to Date.now(), so a send that reserved at
  // 23:59 UTC and failed at 00:00 credited the NEXT day: the day that
  // actually spent the message stayed burned, and the new day started
  // with a message of phantom headroom. Small, but it is a counter whose
  // whole job is to be exact.
  const reservedAt = Date.now();
  const budget = await reserve(db, category, queue.length, reservedAt);
  const overBudget = queue.length - budget.granted;
  if (overBudget > 0) {
    console.warn(
      `[mail] ${category} run trimmed by ${overBudget} (${budget.limited} cap)`
    );
  }
  queue = queue.slice(0, budget.granted);
  if (queue.length === 0) return { ...empty, suppressed, overBudget };

  let sent = 0;
  let failed = 0;
  const sentTo: string[] = [];
  const chunks = chunkForBatch(queue);

  for (let c = 0; c < chunks.length; c++) {
    if (c > 0) await throttle();
    const chunk = chunks[c];
    const res = await sendBatch(
      chunk.map((m) => {
        const unsub = policy.optional
          ? unsubUrl(m.to, m.prefKey ?? prefKey ?? undefined)
          : null;
        const { html, text } = render({
          ...m.doc,
          unsubscribeUrl: unsub,
          unsubscribeLabel: m.prefLabel,
        });
        return {
          to: m.to,
          subject: m.subject,
          html,
          text,
          headers: unsubHeaders(m.to, m.prefKey ?? prefKey, policy.optional),
        };
      }),
      // One key per chunk, stable in content and position, so a retried cron
      // run collapses instead of double-sending the whole batch.
      chunks.length === 1 && messages[0]?.key
        ? messages[0].key
        : `${category}:${chunk[0]?.key ?? chunk[0]?.to}:${chunk.length}`
    );

    if (!res.ok) {
      failed += chunk.length;
      await release(db, category, chunk.length, reservedAt);
      continue;
    }
    sent += chunk.length;
    for (const m of chunk) sentTo.push(m.to.trim().toLowerCase());
    await logSent(
      db,
      chunk.map((m, i) => ({ message: m, id: res.ids[i] ?? null }))
    );
  }

  return { sent, suppressed, overBudget, failed, sentTo };
}

/* --- The delivery log ------------------------------------------------------ */

/**
 * One row per message handed to Resend, keyed by Resend's own id.
 *
 * That key is the whole design. Every webhook event — delivered, bounced,
 * opened, complained — carries `email_id`, so keying on it turns the webhook
 * into a plain update of an existing row rather than a second, unjoinable
 * stream of events. Without it, "which of our emails bounced?" is unanswerable.
 *
 * Best-effort, always. Losing a log row must never turn a delivered email into
 * a failed API call.
 */
async function logSent(
  db: Firestore | null,
  entries: Array<{ message: AppMessage; id: string | null }>
): Promise<void> {
  if (!db || entries.length === 0) return;
  const now = Date.now();
  try {
    const batch = db.batch();
    for (const { message, id } of entries) {
      const ref = id
        ? db.doc(`emailLog/${id}`)
        : db.collection("emailLog").doc();
      batch.set(
        ref,
        {
          to: message.to.trim().toLowerCase(),
          category: message.category,
          type: message.type,
          uid: message.uid ?? null,
          resendId: id,
          status: message.scheduledAt ? "scheduled" : "sent",
          at: now,
          expiresAt: now + EMAIL_LOG_TTL_MS,
        },
        { merge: true }
      );
    }
    await batch.commit();
  } catch (err) {
    console.warn("[mail] delivery log write failed", err);
  }
}
