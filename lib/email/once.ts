/**
 * "Send this to this person exactly once, ever."
 *
 * Resend's idempotency keys are the right tool for a retry — they last 24
 * hours, which covers a cron that ran twice or a webhook redelivered. They are
 * the wrong tool for a win-back, where "once" means once in the lifetime of
 * the account and the second attempt comes a month later.
 *
 * So this is a durable claim: a doc per (kind, uid), written before the send
 * and only kept if the send succeeded. Claim-then-confirm rather than
 * write-after, because a crash between sending and recording would otherwise
 * send it again next month — and a win-back that arrives twice reads as a
 * system that has forgotten you exist.
 */

import type { Firestore } from "firebase-admin/firestore";

const COLLECTION = "emailOnce";

function ref(db: Firestore, kind: string, uid: string) {
  // Colon is fine in a Firestore id; slash is not, and neither is the
  // reserved __x__ shape. `kind` and `uid` are both internal values, never
  // user input, so the only sanitizing needed is the separator itself.
  return db.doc(`${COLLECTION}/${kind}:${uid.replace(/\//g, "_")}`);
}

/**
 * Claim the one send. True means "you may send it, nobody has".
 *
 * With no database this returns true — the alternative is a lifecycle
 * programme that silently does nothing on a misconfigured deploy, and a
 * duplicate win-back is the smaller failure.
 */
export async function claimOnce(
  db: Firestore | null,
  kind: string,
  uid: string
): Promise<boolean> {
  if (!db) return true;
  try {
    // create() fails with ALREADY_EXISTS (code 6) rather than overwriting, so
    // two instances of the same cron cannot both win the claim.
    await ref(db, kind, uid).create({ kind, uid, claimedAt: Date.now(), sent: false });
    return true;
  } catch (err) {
    if ((err as { code?: number })?.code === 6) return false;
    console.warn(`[mail-once] claim failed for ${kind}`, err);
    return true; // fail open, same reasoning as above
  }
}

/** Confirm a claimed send actually went out. */
export async function confirmOnce(
  db: Firestore | null,
  kind: string,
  uid: string
): Promise<void> {
  if (!db) return;
  await ref(db, kind, uid)
    .set({ sent: true, sentAt: Date.now() }, { merge: true })
    .catch(() => {});
}

/**
 * Hand a claim back when the send didn't happen — over budget, suppressed,
 * provider down. Without this a single bad afternoon costs those users their
 * one win-back permanently.
 */
export async function releaseOnce(
  db: Firestore | null,
  kind: string,
  uid: string
): Promise<void> {
  if (!db) return;
  await ref(db, kind, uid).delete().catch(() => {});
}
