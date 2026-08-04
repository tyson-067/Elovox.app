/**
 * The suppression list: addresses this app must never write to again.
 *
 * This is the highest-leverage thing in the whole email system, and it has
 * nothing to do with volume. A sending domain's reputation is mostly a
 * function of two numbers — how often mail bounces, and how often someone
 * hits "spam" — and both are cumulative. Send to a dead address ten times and
 * every mailbox provider learns that this domain doesn't clean its list;
 * after that, mail to *good* addresses starts landing in spam folders. On a
 * shared-IP free plan there is no separate reputation to fall back on.
 *
 * So: Resend tells us (via the webhook) when something hard-bounced or was
 * marked as spam, that lands here, and ./send.ts checks here before every
 * single message. A hard bounce is permanent and covers every category. A
 * complaint is permanent too, and is treated as stricter than an unsubscribe:
 * someone who pressed the spam button is not asking for better preferences.
 *
 * Soft bounces (full mailbox, temporary failure) are NOT suppressed — those
 * recover, and dropping the address would be the system punishing a user for
 * their provider's bad afternoon.
 *
 * Doc id is the URI-encoded address, matching `leads/{email}`, so a lookup is
 * a point read rather than a query and a repeat suppression is one row.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { EmailPrefKey } from "./config";

const COLLECTION = "emailSuppression";

export type SuppressionReason =
  /** Address does not exist. Permanent, everything. */
  | "hard-bounce"
  /** Marked as spam. Permanent, everything, and never re-openable by us. */
  | "complaint"
  /** Used the unsubscribe link. Optional categories only. */
  | "unsubscribe"
  /** An operator added it by hand. */
  | "manual";

/** Reasons that block EVERY category, including security and billing.
 *
 *  A complaint is on this list deliberately. It is tempting to argue that a
 *  password-reset notice is exempt from a spam complaint — legally it may be —
 *  but continuing to mail someone who reported this domain as spam is how the
 *  domain stops being able to mail anyone. The user still has every in-app
 *  path to their account. */
const BLOCKS_EVERYTHING: SuppressionReason[] = ["hard-bounce", "complaint"];

export interface SuppressionRecord {
  email: string;
  reason: SuppressionReason;
  at: number;
  /** Which optional categories are off, when the reason is `unsubscribe`.
   *  Empty/absent means all of them. */
  categories?: EmailPrefKey[];
  /** Provider detail, e.g. the bounce subtype. Never the full payload. */
  detail?: string;
}

/** Firestore rejects ids matching `__x__` by throwing out of `db.doc()` —
 *  synchronously — and `__a@b.co__` is a valid address. Same guard the leads
 *  route applies. */
function docId(email: string): string | null {
  const id = encodeURIComponent(email.trim().toLowerCase());
  if (!id || /^__.*__$/.test(id) || id === "." || id === "..") return null;
  return id;
}

/**
 * Is this address suppressed for a message that is (or is not) optional?
 *
 * Returns the reason rather than a boolean so callers can log WHY a message
 * was dropped — "we didn't email them" with no reason is unanswerable when
 * somebody asks two months later.
 */
export async function suppressionFor(
  db: Firestore | null,
  email: string,
  opts: { optional: boolean; prefKey: EmailPrefKey | null }
): Promise<SuppressionReason | null> {
  if (!db) return null;
  const id = docId(email);
  if (!id) return null;

  let record: SuppressionRecord | undefined;
  try {
    const snap = await db.doc(`${COLLECTION}/${id}`).get();
    if (!snap.exists) return null;
    record = snap.data() as SuppressionRecord;
  } catch (err) {
    // Fail OPEN. A Firestore blip must not silence a security notice. The
    // cost of the opposite choice — failing closed — is a user locked out of
    // an account with no warning email, which is worse than one message to a
    // stale address.
    console.warn("[mail-suppress] lookup failed, allowing send", err);
    return null;
  }

  const reason = record.reason;
  if (BLOCKS_EVERYTHING.includes(reason)) return reason;

  // Everything below is an opt-out, which cannot touch a non-optional message.
  if (!opts.optional) return null;

  // A scoped unsubscribe ("stop the weekly digest") only stops that category.
  // An unscoped one stops all optional mail.
  const scoped = record.categories;
  if (Array.isArray(scoped) && scoped.length > 0) {
    return opts.prefKey && scoped.includes(opts.prefKey) ? reason : null;
  }
  return reason;
}

/**
 * Add an address to the list. Idempotent; a second hard bounce for the same
 * address updates the timestamp and count rather than adding a row.
 *
 * `categories` narrows an unsubscribe to specific streams. It is ignored for
 * bounces and complaints, which are never partial.
 */
export async function suppress(
  db: Firestore | null,
  email: string,
  reason: SuppressionReason,
  extra: { detail?: string; categories?: EmailPrefKey[] } = {}
): Promise<boolean> {
  if (!db) return false;
  const normalized = email.trim().toLowerCase();
  const id = docId(normalized);
  if (!id) return false;

  try {
    await db.doc(`${COLLECTION}/${id}`).set(
      {
        email: normalized,
        reason,
        at: Date.now(),
        hits: FieldValue.increment(1),
        ...(extra.detail ? { detail: extra.detail.slice(0, 120) } : {}),
        // A hard reason always widens to everything, even if a narrower
        // unsubscribe was recorded first.
        categories: BLOCKS_EVERYTHING.includes(reason)
          ? FieldValue.delete()
          : (extra.categories ?? FieldValue.delete()),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.error("[mail-suppress] write failed", err);
    return false;
  }
}

/**
 * Take an address off the list.
 *
 * Only ever an operator action, and only ever for a bounce or a manual entry:
 * an address can be fixed at the receiving end, or added here by mistake.
 * Re-subscribing someone who complained or who unsubscribed is not an
 * operator's decision to make, so the route that calls this refuses those.
 */
export async function unsuppress(
  db: Firestore | null,
  email: string
): Promise<boolean> {
  if (!db) return false;
  const id = docId(email);
  if (!id) return false;
  try {
    await db.doc(`${COLLECTION}/${id}`).delete();
    return true;
  } catch (err) {
    console.error("[mail-suppress] delete failed", err);
    return false;
  }
}

export async function getSuppression(
  db: Firestore | null,
  email: string
): Promise<SuppressionRecord | null> {
  if (!db) return null;
  const id = docId(email);
  if (!id) return null;
  try {
    const snap = await db.doc(`${COLLECTION}/${id}`).get();
    return snap.exists ? (snap.data() as SuppressionRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Drop every suppressed address from a bulk list, in as few reads as possible.
 *
 * The obvious implementation — `suppressionFor` in a loop — is one Firestore
 * read per recipient, which for a 500-person digest is 500 reads before a
 * single email is sent. `getAll` collapses that into a handful.
 */
export async function filterSuppressed(
  db: Firestore | null,
  emails: string[],
  opts: { optional: boolean; prefKey: EmailPrefKey | null }
): Promise<{ allowed: string[]; dropped: number }> {
  if (!db || emails.length === 0) return { allowed: emails, dropped: 0 };

  const ids = new Map<string, string>(); // docId -> email
  for (const e of emails) {
    const id = docId(e);
    if (id) ids.set(id, e.trim().toLowerCase());
  }
  if (ids.size === 0) return { allowed: emails, dropped: 0 };

  const blocked = new Set<string>();
  const keys = [...ids.keys()];
  const CHUNK = 300; // getAll is generous but not unbounded

  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = keys.slice(i, i + CHUNK);
      const snaps = await db.getAll(
        ...slice.map((k) => db.doc(`${COLLECTION}/${k}`))
      );
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const record = snap.data() as SuppressionRecord;
        const hard = BLOCKS_EVERYTHING.includes(record.reason);
        if (hard) {
          blocked.add(record.email);
          continue;
        }
        if (!opts.optional) continue;
        const scoped = record.categories;
        if (Array.isArray(scoped) && scoped.length > 0) {
          if (opts.prefKey && scoped.includes(opts.prefKey)) blocked.add(record.email);
        } else {
          blocked.add(record.email);
        }
      }
    }
  } catch (err) {
    // Same fail-open posture as the single lookup.
    console.warn("[mail-suppress] bulk lookup failed, allowing sends", err);
    return { allowed: emails, dropped: 0 };
  }

  const allowed = emails.filter((e) => !blocked.has(e.trim().toLowerCase()));
  return { allowed, dropped: emails.length - allowed.length };
}

/** The admin list view. Newest first, capped. */
export async function listSuppressed(
  db: Firestore | null,
  limit = 200
): Promise<SuppressionRecord[]> {
  if (!db) return [];
  try {
    const snap = await db
      .collection(COLLECTION)
      .orderBy("at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as SuppressionRecord);
  } catch (err) {
    console.warn("[mail-suppress] list failed", err);
    return [];
  }
}

export { BLOCKS_EVERYTHING };
