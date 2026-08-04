/**
 * Resend's webhook: signature verification, and what each event means here.
 *
 * This is the half of the email system that closes the loop. Without it the
 * app knows what it *tried* to send and nothing about what happened — and the
 * two events that matter most, a hard bounce and a spam complaint, are exactly
 * the two that never appear in an API response. They arrive minutes or hours
 * later, here, or not at all.
 *
 * VERIFICATION IS NOT OPTIONAL. This endpoint is public, and what it does is
 * write to the suppression list. Unverified, anyone who found the URL could
 * post a forged `email.bounced` and permanently stop this app from mailing any
 * address they chose — including their own victim's password-reset notice. So
 * the route below refuses every request when no secret is configured, rather
 * than degrading to "accept everything".
 *
 * Resend signs with Svix. The scheme is implemented here rather than pulling
 * in the `svix` package: it is thirty lines of HMAC, and a dependency in the
 * verification path of a security boundary is a dependency you have to trust
 * on every release.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { suppress } from "./suppression";
import { markUnsubscribed } from "./audience";

/** How far a signed timestamp may be from now. Svix's own default. Rejecting
 *  old timestamps is what stops a captured payload being replayed forever. */
const TOLERANCE_MS = 5 * 60 * 1000;

export type VerifyFailure =
  | "not-configured"
  | "missing-headers"
  | "bad-timestamp"
  | "bad-signature";

/**
 * Verify a Svix-signed webhook body.
 *
 * `raw` must be the EXACT bytes received. Re-serializing parsed JSON changes
 * key order and whitespace and the signature will never match — which is why
 * the route reads `req.text()` and parses afterwards.
 */
export function verifySignature(
  raw: string,
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
  now: number = Date.now()
): { ok: true } | { ok: false; reason: VerifyFailure } {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return { ok: false, reason: "not-configured" };
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: "missing-headers" };
  }

  const seconds = Number(headers.timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: "bad-timestamp" };
  if (Math.abs(now - seconds * 1000) > TOLERANCE_MS) {
    return { ok: false, reason: "bad-timestamp" };
  }

  // The secret is base64 AFTER the "whsec_" prefix; the prefix itself is not
  // part of the key. Using the whole string as the key is the classic way to
  // get a verifier that rejects every real request.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${raw}`)
    .digest();

  // The header can carry several space-separated versioned signatures during
  // a secret rotation. Any one matching is a pass.
  for (const part of headers.signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length !== expected.length) continue;
    if (timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "bad-signature" };
}

/* --- Events ---------------------------------------------------------------- */

export type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.bounced"
  | "email.complained"
  | "email.opened"
  | "email.clicked"
  | (string & {});

export interface ParsedEvent {
  type: ResendEventType;
  emailId: string | null;
  to: string[];
  /** The provider's own words, kept verbatim for the log. */
  bounceType: string | null;
  bounceSubType: string | null;
  /** Whether this bounce is permanent. See `isHardBounce` — this is the field
   *  that decides whether an address is suppressed forever. */
  hardBounce: boolean;
  createdAt: number;
}

/**
 * Is a bounce permanent?
 *
 * Resend uses SES's vocabulary, not the words "hard" and "soft":
 *
 *   type    — "Permanent" | "Transient" | "Undetermined"
 *   subType — "General" | "NoEmail" | "Suppressed" | "MailboxFull" | …
 *
 * A first version of this looked for the substring "hard" and therefore
 * matched none of them: every permanent bounce was quietly filed as transient
 * and no address was ever suppressed. Caught by posting a real-shaped
 * `Permanent` payload at the route and finding the suppression list empty.
 *
 * "Undetermined" is deliberately treated as SOFT. A genuinely dead address
 * bounces again, and the next one usually arrives classified; guessing
 * permanent on an ambiguous one risks silently cutting off a real user's
 * billing and security mail forever.
 */
export function isHardBounce(type: string | null, subType: string | null): boolean {
  const t = (type ?? "").toLowerCase();
  const s = (subType ?? "").toLowerCase();
  if (t === "transient" || t === "undetermined") return false;
  return (
    t === "permanent" ||
    t.includes("hard") || // some providers, and Resend's older payloads
    s === "noemail" ||
    s === "suppressed" ||
    s === "onaccountsuppressionlist"
  );
}

export function parseEvent(payload: unknown): ParsedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const type = typeof p.type === "string" ? p.type : null;
  if (!type) return null;

  const data = (p.data ?? {}) as Record<string, unknown>;
  const to = Array.isArray(data.to)
    ? data.to.filter((x): x is string => typeof x === "string")
    : typeof data.to === "string"
      ? [data.to]
      : [];

  const bounce = data.bounce as Record<string, unknown> | undefined;
  const bounceType =
    typeof bounce?.type === "string"
      ? bounce.type
      : typeof data.bounce_type === "string"
        ? (data.bounce_type as string)
        : null;
  const bounceSubType =
    typeof bounce?.subType === "string"
      ? bounce.subType
      : typeof bounce?.sub_type === "string"
        ? (bounce.sub_type as string)
        : null;

  const created = typeof p.created_at === "string" ? Date.parse(p.created_at) : NaN;

  return {
    type,
    emailId: typeof data.email_id === "string" ? data.email_id : null,
    to,
    bounceType,
    bounceSubType,
    hardBounce: isHardBounce(bounceType, bounceSubType),
    createdAt: Number.isFinite(created) ? created : Date.now(),
  };
}

/**
 * Apply an event.
 *
 * Two things happen: the `emailLog` row for this message id gets its status,
 * and — for the two events that mean "never write here again" — the address
 * goes on the suppression list.
 *
 * The bounce rule is the one worth being careful about. Only a HARD bounce
 * suppresses. A soft bounce is a full mailbox or a server having a bad hour,
 * and both recover; suppressing on one would quietly drop a paying user's
 * receipts forever because their inbox was full on a Tuesday. When Resend
 * doesn't say which kind it was, this treats it as soft — the conservative
 * direction, since a repeat hard bounce will come back labelled.
 */
export async function applyEvent(
  db: Firestore | null,
  event: ParsedEvent
): Promise<{ suppressed: boolean }> {
  const address = event.to[0]?.trim().toLowerCase() ?? null;

  if (db && event.emailId) {
    const status = event.type.replace(/^email\./, "");
    try {
      // merge:true, never create-if-missing-with-full-shape: a delivered
      // event for a message this app didn't log (a broadcast, a dashboard
      // test send) should leave a thin row, not a fake one.
      await db.doc(`emailLog/${event.emailId}`).set(
        {
          status,
          // Nested, not a dotted key. A key containing a dot passed to `set()`
          // is a LITERAL field name, so `events.delivered` would become a
          // flat field of that name rather than a member of `events` — which
          // is unqueryable and reads as a typo forever after.
          events: { [status]: event.createdAt },
          lastEventAt: event.createdAt,
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("[mail-webhook] log update failed", err);
    }
  }

  if (!address) return { suppressed: false };

  if (event.type === "email.complained") {
    await suppress(db, address, "complaint", { detail: "spam-report" });
    // Also at Resend's end, so a Broadcast — which this app doesn't filter —
    // respects it too.
    await markUnsubscribed(address);
    return { suppressed: true };
  }

  if (event.type === "email.bounced") {
    if (event.hardBounce) {
      await suppress(db, address, "hard-bounce", {
        // Both halves, so the admin list can say "Permanent / NoEmail" rather
        // than just "bounced" — the difference between a typo'd address and a
        // mail server that refused us matters when someone asks.
        detail: [event.bounceType, event.bounceSubType].filter(Boolean).join(" / ") || undefined,
      });
      await markUnsubscribed(address);
      return { suppressed: true };
    }
    // Transient or undetermined: full mailbox, a server having a bad hour.
    // These recover, and suppressing one would drop a paying user's receipts
    // forever because their inbox was full on a Tuesday.
    console.info(`[mail-webhook] soft bounce (${event.bounceType ?? "unclassified"}), not suppressing`);
  }

  return { suppressed: false };
}
