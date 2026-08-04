/**
 * The Resend REST client.
 *
 * Dependency-free on purpose: this is `fetch` against a documented HTTP API,
 * and the official SDK would add a package to the bundle for the privilege of
 * hiding the two headers below. Everything the SDK gives us that actually
 * matters — retries, idempotency, the batch endpoint, rate-limit awareness —
 * is here and is tuned to THIS app's free-plan constraints rather than to a
 * generic default.
 *
 * THE CONTRACT EVERY FUNCTION IN THIS FILE KEEPS: it never throws. Email is
 * never the point of the request that triggers it. A caller mid-checkout, or
 * mid-login, must not fail because a mail API had a bad minute — so failures
 * come back as data (`{ ok: false, reason }`) and the caller decides. What a
 * caller must NOT do is report "we've emailed you" without checking.
 */

import { FREE_PLAN, mailFrom, mailReplyTo } from "./config";

const API = "https://api.resend.com";

/** A send never holds a user-facing request open longer than this. */
const TIMEOUT_MS = 8000;

export interface ResendTag {
  /** ASCII letters, numbers, underscores and dashes only — Resend rejects
   *  anything else, and it rejects the whole send, not just the tag. */
  name: string;
  value: string;
}

export interface OutgoingEmail {
  to: string | string[];
  subject: string;
  html?: string;
  text: string;
  replyTo?: string;
  /** Extra headers. List-Unsubscribe lives here. */
  headers?: Record<string, string>;
  tags?: ResendTag[];
  /** ISO 8601, or natural language ("in 1 hour"). Resend holds it and sends
   *  later — which is how a digest run spreads itself across a day without
   *  this app owning a queue. */
  scheduledAt?: string;
}

export type SendFailure =
  | "not-configured"
  | "rejected"
  | "rate-limited"
  | "timeout"
  | "error";

export interface SendOk {
  ok: true;
  /** Resend's message id. Worth storing — it is the join key for every
   *  webhook event that follows. */
  id: string | null;
}
export interface SendErr {
  ok: false;
  reason: SendFailure;
  /** HTTP status, when there was one. Never a response body: Resend echoes
   *  the recipient address in errors and these lines go to a shared log. */
  status?: number;
}
export type SendResult = SendOk | SendErr;

/* --- Tag hygiene ---------------------------------------------------------- */

/**
 * Tags are how the Resend dashboard becomes useful — "show me delivery rate
 * for billing mail" is a tag filter and nothing else. But an invalid tag
 * fails the entire send, so every value is scrubbed rather than trusted.
 * Never pass a user-controlled string in unscrubbed; never pass an email
 * address at all (tags are visible in the dashboard and in webhook payloads).
 */
export function cleanTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "unknown";
}

/* --- Transport ------------------------------------------------------------ */

/**
 * One HTTP call to Resend, with the retry policy the free plan needs.
 *
 * Retries only what is worth retrying: 429 (we exceeded 2 req/s) and 5xx.
 * A 4xx is our bug or a bad address and will fail identically forever, so
 * retrying it just spends the clock. 402/403 mean the plan's quota is gone —
 * also permanent for today, also not retried.
 *
 * `Idempotency-Key` is what makes the retry safe. Without it, a request that
 * times out AFTER Resend accepted it would send the email twice on retry. It
 * is required, not optional, on every POST this file makes.
 */
async function call(
  path: string,
  init: { method: string; body?: unknown; idempotencyKey?: string }
): Promise<{ ok: true; data: unknown } | { ok: false; reason: SendFailure; status?: number }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "not-configured" };

  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  if (init.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey.slice(0, 256);
  }

  // Three attempts, ~0.6s then ~1.8s apart. Deliberately short: this can be
  // on a user-facing path, and a 6-second retry ladder is worse than a
  // best-effort miss. Bulk paths that can afford to wait use sendBatch, which
  // makes far fewer requests in the first place.
  const MAX_ATTEMPTS = 3;
  let last: { ok: false; reason: SendFailure; status?: number } = {
    ok: false,
    reason: "error",
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Jittered, so two instances retrying the same 429 don't collide again.
      const backoff = 600 * Math.pow(3, attempt - 1) * (0.75 + Math.random() / 2);
      await new Promise((r) => setTimeout(r, backoff));
    }
    try {
      const res = await fetch(`${API}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, data };
      }

      if (res.status === 429) {
        last = { ok: false, reason: "rate-limited", status: 429 };
        continue;
      }
      if (res.status >= 500) {
        last = { ok: false, reason: "error", status: res.status };
        continue;
      }
      // Permanent. Status only — the body echoes the recipient address.
      console.warn(`[mail] ${init.method} ${path} rejected: ${res.status}`);
      return { ok: false, reason: "rejected", status: res.status };
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      last = { ok: false, reason: name === "TimeoutError" ? "timeout" : "error" };
    }
  }

  console.warn(`[mail] ${init.method} ${path} failed after ${MAX_ATTEMPTS}: ${last.reason}`);
  return last;
}

/* --- Message shaping ------------------------------------------------------ */

function payloadFor(message: OutgoingEmail, from: string) {
  const body: Record<string, unknown> = {
    from,
    to: Array.isArray(message.to) ? message.to : [message.to],
    subject: message.subject,
    text: message.text,
    reply_to: message.replyTo ?? mailReplyTo(),
  };
  if (message.html) body.html = message.html;
  if (message.headers && Object.keys(message.headers).length) {
    body.headers = message.headers;
  }
  if (message.tags?.length) {
    body.tags = message.tags.map((t) => ({
      name: cleanTag(t.name),
      value: cleanTag(t.value),
    }));
  }
  if (message.scheduledAt) body.scheduled_at = message.scheduledAt;
  return body;
}

/* --- Public API ----------------------------------------------------------- */

/**
 * Send one email.
 *
 * `idempotencyKey` should be derived from what the message IS, not from when
 * it was sent — "welcome:{uid}" rather than a random uuid — so that a retry
 * from anywhere (this file's own loop, a Vercel function retry, a redelivered
 * webhook) collapses into the one send Resend already accepted. Resend holds
 * these keys for 24 hours.
 */
export async function sendEmail(
  message: OutgoingEmail,
  idempotencyKey?: string
): Promise<SendResult> {
  const from = mailFrom();
  if (!from) return { ok: false, reason: "not-configured" };

  const res = await call("/emails", {
    method: "POST",
    body: payloadFor(message, from),
    idempotencyKey,
  });
  if (!res.ok) return res;
  const id = (res.data as { id?: unknown })?.id;
  return { ok: true, id: typeof id === "string" ? id : null };
}

/**
 * Send up to 100 emails in ONE request.
 *
 * This is the single most valuable thing on the free plan and the reason the
 * digest crons are viable at all: the account limit is 2 requests per second,
 * so 100 individual sends is a 50-second stall and a fistful of 429s, while
 * 100 batched is one request and one round trip.
 *
 * Batch is deliberately narrower than single-send — no tags, no scheduling,
 * no attachments — so anything needing those must go one at a time. The
 * caller gets one id per message, positionally matched to the input, with
 * null where Resend returned nothing for that slot.
 */
export async function sendBatch(
  messages: OutgoingEmail[],
  idempotencyKey?: string
): Promise<{ ok: boolean; ids: Array<string | null>; reason?: SendFailure }> {
  const from = mailFrom();
  if (!from) return { ok: false, ids: [], reason: "not-configured" };
  if (messages.length === 0) return { ok: true, ids: [] };
  if (messages.length > FREE_PLAN.batchMax) {
    // A caller that gets here has a chunking bug. Refuse rather than let
    // Resend reject the whole batch and lose every message in it.
    console.error(
      `[mail] batch of ${messages.length} exceeds ${FREE_PLAN.batchMax}; chunk it`
    );
    return { ok: false, ids: [], reason: "rejected" };
  }

  const res = await call("/emails/batch", {
    method: "POST",
    body: messages.map((m) => {
      const p = payloadFor(m, from);
      delete p.tags;
      delete p.scheduled_at;
      return p;
    }),
    idempotencyKey,
  });
  if (!res.ok) return { ok: false, ids: [], reason: res.reason };

  const data = (res.data as { data?: Array<{ id?: unknown }> })?.data ?? [];
  return {
    ok: true,
    ids: messages.map((_, i) => {
      const id = data[i]?.id;
      return typeof id === "string" ? id : null;
    }),
  };
}

/** Split a list into batch-sized chunks. Every bulk caller uses this; it is
 *  here so nobody re-derives the constant. */
export function chunkForBatch<T>(items: T[], size = FREE_PLAN.batchMax): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Pause between requests so a multi-chunk run stays under 2 req/s.
 *
 * Called BETWEEN chunks, never before the first — a single-chunk run should
 * cost nothing. 600ms rather than the arithmetic 500ms because the limit is
 * account-wide and a transactional send can land in the same second.
 */
export function throttle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 600));
}

/* --- Read-side ------------------------------------------------------------ */

/** One sent message's current state, for the admin console. Null when the
 *  lookup fails — this is diagnostics, never a decision input. */
export async function getEmail(id: string): Promise<Record<string, unknown> | null> {
  const res = await call(`/emails/${encodeURIComponent(id)}`, { method: "GET" });
  return res.ok ? (res.data as Record<string, unknown>) : null;
}

/**
 * The verified sending domains on the account, with their DNS status.
 *
 * Surfaced in the admin console because domain verification is the one part
 * of this system that lives outside the codebase (it is DNS records at a
 * registrar) and therefore the one part that silently rots. A domain that
 * falls out of verification doesn't error — it just starts landing in spam.
 */
export async function listDomains(): Promise<Array<Record<string, unknown>> | null> {
  const res = await call("/domains", { method: "GET" });
  if (!res.ok) return null;
  const data = (res.data as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/** Raw access for the few callers that need an endpoint not wrapped above
 *  (contacts, broadcasts). Same never-throws contract. */
export { call as resendCall };
