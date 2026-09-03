/**
 * Unsubscribe: the links, the tokens behind them, and the switches.
 *
 * ONE SOURCE OF TRUTH, deliberately. It is tempting to keep a preferences doc
 * under `users/{uid}` for signed-in people and a suppression row for everyone
 * else, and that is two systems that disagree the first time somebody
 * unsubscribes from a link while signed in on another device. So there is one
 * store — `emailSuppression/{email}` in ./suppression.ts — and both the
 * account-settings switches and the footer link write to it. The address is
 * the identity here, because the address is what the mail actually goes to.
 *
 * THE LINK MUST WORK WITHOUT SIGNING IN. An unsubscribe link that opens a
 * login page is not an unsubscribe link; mailbox providers know it, users
 * know it, and the reliable next step is the spam button. Hence a signed
 * token: it proves this app minted the link for this address, so the endpoint
 * needs no session and still can't be used to unsubscribe a stranger.
 *
 * Tokens do not expire. An email from six months ago is exactly when someone
 * finally gets round to unsubscribing, and a dead link at that moment is the
 * worst possible time for one.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { siteUrl, type EmailPrefKey } from "./config";
import { LEGAL } from "../legal";
import { getSuppression, suppress, unsuppress } from "./suppression";

/** Every switch a user gets, in the order the account page shows them. */
export const PREF_KEYS: EmailPrefKey[] = ["progress", "streak", "product", "tips"];

/**
 * Whether optional email is paused right now.
 *
 * Every one of the four switches below is on a `lifecycle` or `marketing`
 * category, and lib/email/send.ts holds both while LEGAL.postalAddress is
 * blank — CAN-SPAM wants a postal address in commercial mail and we chose to
 * hold the mail rather than publish one. So while this is true these switches
 * record a preference for mail that is not being sent, and a panel headed
 * "which optional emails you get" would be describing something that is not
 * happening.
 *
 * The switches deliberately stay usable: the preference is real and applies
 * the moment sending resumes, so a hidden switch would silently discard an
 * intent the user expressed. What changes is that the panel says so.
 *
 * Reads the same constant the server gate reads, so filling the address in
 * un-pauses the copy and the mail together and neither can drift.
 */
export function optionalMailPaused(): boolean {
  return LEGAL.postalAddress.trim() === "";
}

export const OPTIONAL_MAIL_PAUSED_NOTE =
  "We've paused all optional email for now, so these won't arrive until we start sending again. Your choices are saved. Account and billing emails are unaffected.";

export const PREF_LABELS: Record<EmailPrefKey, { title: string; blurb: string }> = {
  progress: {
    title: "Weekly progress",
    blurb: "What you practiced, and how your scores moved.",
  },
  streak: {
    title: "Streak reminders",
    blurb: "A nudge when a streak you've built is about to break.",
  },
  product: {
    title: "New features",
    blurb: "Occasional. Only when something worth using ships.",
  },
  tips: {
    title: "Speaking tips",
    blurb: "The occasional speaking tip, when there's one worth sending.",
  },
};

/* --- Token signing -------------------------------------------------------- */

/**
 * The signing key.
 *
 * Prefers an explicit EMAIL_TOKEN_SECRET. Falls back to a hash of the Firebase
 * service-account private key, which is already a secret this app holds and is
 * stable across deploys — so unsubscribe links work out of the box rather than
 * being silently omitted because one more env var wasn't set. The fallback is
 * hashed, never used raw, so a token can never carry key material.
 *
 * The tradeoff of the fallback is that rotating the service account
 * invalidates every link in every email already delivered. Set the explicit
 * variable and that stops being true.
 */
function signingKey(): Buffer | null {
  const explicit = process.env.EMAIL_TOKEN_SECRET?.trim();
  if (explicit) return createHash("sha256").update(explicit).digest();
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svc) return null;
  return createHash("sha256").update(`elovox.unsub.v1:${svc}`).digest();
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface UnsubClaim {
  /** Lower-cased address. */
  email: string;
  /** Which stream this link came from. Absent = all optional mail. */
  key?: EmailPrefKey;
}

/** Mint a token. Returns null when no key is available, and every caller
 *  treats that as "no unsubscribe link" rather than an unsigned one. */
export function signUnsubToken(claim: UnsubClaim): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = b64url(
    JSON.stringify({ e: claim.email.trim().toLowerCase(), k: claim.key ?? null })
  );
  const sig = b64url(createHmac("sha256", key).update(payload).digest());
  return `v1.${payload}.${sig}`;
}

/** Verify a token, returning the claim or null. Constant-time comparison —
 *  a byte-at-a-time `!==` on a signature is a forgery oracle. */
export function verifyUnsubToken(token: string): UnsubClaim | null {
  const key = signingKey();
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payload, sig] = parts;

  const expected = createHmac("sha256", key).update(payload).digest();
  const given = fromB64url(sig);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  try {
    const data = JSON.parse(fromB64url(payload).toString("utf8"));
    const email = typeof data.e === "string" ? data.e.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) return null;
    const k = data.k;
    return {
      email,
      key: PREF_KEYS.includes(k as EmailPrefKey) ? (k as EmailPrefKey) : undefined,
    };
  } catch {
    return null;
  }
}

/** The URL that goes in an email footer and in the List-Unsubscribe header. */
export function unsubUrl(email: string, key?: EmailPrefKey): string | null {
  const token = signUnsubToken({ email, key });
  return token ? `${siteUrl()}/api/email/unsubscribe?t=${encodeURIComponent(token)}` : null;
}

/**
 * The headers that make one-click unsubscribe work (RFC 8058).
 *
 * Both headers are required together: Gmail and Yahoo render their own
 * "Unsubscribe" button next to the sender name only when `List-Unsubscribe`
 * carries an https URL AND `List-Unsubscribe-Post` promises that a bare POST
 * to it will do the job with no further interaction. That button is worth
 * having — every press of it is a press that wasn't the spam button, and
 * since 2024 both providers require it for bulk senders anyway.
 *
 * Returns an empty object when the message isn't optional (a security notice
 * with an unsubscribe header is a lie) or when no key is configured.
 */
export function unsubHeaders(
  email: string,
  key: EmailPrefKey | null,
  optional: boolean
): Record<string, string> {
  if (!optional) return {};
  const url = unsubUrl(email, key ?? undefined);
  if (!url) return {};
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/* --- Reading and writing the switches -------------------------------------- */

export type PrefState = Record<EmailPrefKey, boolean>;

const ALL_ON: PrefState = {
  progress: true,
  streak: true,
  product: true,
  tips: true,
};

/**
 * Which optional streams this address still receives.
 *
 * Default is everything on — but note what that does and does not mean. These
 * switches govern mail the user is already receiving because they made an
 * account or joined the tips list; nothing here is a channel that starts
 * sending to a stranger. The one genuinely promotional stream, `tips`, is
 * gated on its own separate opt-in (a row in `leads`), so "on by default"
 * here still cannot mail somebody who never asked.
 */
export async function readPrefs(
  db: Firestore | null,
  email: string
): Promise<PrefState> {
  const record = await getSuppression(db, email);
  if (!record) return { ...ALL_ON };
  if (record.reason !== "unsubscribe") {
    // Bounced or complained: everything is off and no switch can turn it back
    // on. The account page renders this as its own explanatory state.
    return { progress: false, streak: false, product: false, tips: false };
  }
  const scoped = record.categories;
  if (!Array.isArray(scoped) || scoped.length === 0) {
    return { progress: false, streak: false, product: false, tips: false };
  }
  const out = { ...ALL_ON };
  for (const k of scoped) if (k in out) out[k] = false;
  return out;
}

/**
 * Write the switches back.
 *
 * Refuses to re-enable anything for an address that hard-bounced or
 * complained — see ./suppression.ts for why that is not ours to undo. Returns
 * what is actually in force, so the UI can repaint from the truth rather than
 * from what it optimistically set.
 */
export async function writePrefs(
  db: Firestore | null,
  email: string,
  next: Partial<PrefState>
): Promise<PrefState> {
  const record = await getSuppression(db, email);
  if (record && record.reason !== "unsubscribe") {
    return readPrefs(db, email);
  }

  const current = await readPrefs(db, email);
  const merged: PrefState = { ...current, ...next };
  const off = PREF_KEYS.filter((k) => !merged[k]);

  if (off.length === 0) {
    await unsuppress(db, email);
  } else {
    await suppress(db, email, "unsubscribe", { categories: off });
  }
  return merged;
}

/** What the one-click endpoint does: turn off one stream, or all of them. */
export async function applyUnsubscribe(
  db: Firestore | null,
  claim: UnsubClaim
): Promise<PrefState> {
  if (!claim.key) {
    // The same guard writePrefs has, and for the same reason. suppress()
    // merges, so writing reason:"unsubscribe" over an existing record
    // DOWNGRADES it — a `complaint` or `hard-bounce` becomes a plain
    // unsubscribe, which only blocks OPTIONAL mail. The effect is that
    // somebody who pressed the spam button starts receiving security and
    // billing mail again, which lib/email/suppression.ts says is never ours
    // to undo and which `unsuppress` explicitly refuses to do.
    //
    // Reachable from any claim with no key — and note verifyUnsubToken
    // returns key: undefined for any `k` outside PREF_KEYS, so retiring a
    // preference key turns every already-delivered link for that stream into
    // this path.
    const record = await getSuppression(db, claim.email);
    if (record && record.reason !== "unsubscribe") {
      return { progress: false, streak: false, product: false, tips: false };
    }
    await suppress(db, claim.email, "unsubscribe", {});
    return { progress: false, streak: false, product: false, tips: false };
  }
  return writePrefs(db, claim.email, { [claim.key]: false });
}
