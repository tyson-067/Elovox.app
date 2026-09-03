import type { App } from "firebase-admin/app";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { refundUnusedPortion } from "./refunds";
import { foldHandle } from "./leaderboardServer";
import { deleteContact } from "./email/audience";
import { audienceId } from "./email/config";

// The account-erasure sequence, shared by the self-serve route
// (/api/account/delete — the deletion right promised in /privacy) and the
// operator route (/api/admin/account — servicing an emailed deletion request,
// or the /children COPPA promise to delete an under-13's data on report).
// One implementation so the two can't drift — the same reasoning as
// lib/refunds.ts: this is a money-and-data path where drift IS the bug.
//
// Order matters, and it is fail-CLOSED on billing: cancel every live
// subscription first, and if that can't be confirmed, delete NOTHING and let
// the caller retry. Erasing the Firestore data first would take the
// subscription ids with it and leave a former user billed forever for an
// account that no longer exists. Billing records themselves stay with Stripe,
// tax and accounting law requires it, and the privacy policy says so.
//
// THE OTHER ORDERING RULE: everything that can only be BEST-EFFORT — anything
// whose failure must not deny somebody their deletion — comes after the
// irreversible steps, and is bounded. Step 7 is the whole of it, and the
// reason is that it is the only call here that leaves the building.
//
// AUTH IS THE CALLER'S JOB. The self route requires a fresh sign-in from the
// account itself; the admin route requires adminIdentity plus a typed email
// confirmation. Nothing here checks anything — it erases the uid it is given.

// Live subscription statuses: still entitled or still owed money, so still
// worth canceling before erasure. Mirrors the set the checkout route treats
// as "already subscribed".
const LIVE_SUB = ["trialing", "active", "past_due", "unpaid"];

/** Which step failed, so each route can keep its own user-facing wording. */
export type EraseFailure = "billing" | "cleanup" | "data" | "auth-record";

export type EraseResult = { ok: true } | { ok: false; step: EraseFailure };

/* --- The Resend Audience purge queue --------------------------------------- */

/**
 * Addresses that have been erased here but not yet removed from the Resend
 * Audience. Written by step 7, drained by `reconcileAudiencePurges`.
 *
 * Top-level rather than under users/{uid} for the obvious reason: by the time
 * a row is written the uid has no documents left.
 */
const AUDIENCE_PURGE_QUEUE = "audiencePurges";

/**
 * How long an erasure will wait for Resend to confirm a removal.
 *
 * lib/email/client.ts is tuned for sends, not for this: three attempts, an 8s
 * timeout each, plus ~0.6s then ~1.8s of backoff, so a Resend outage can hold
 * `deleteContact` for around 26 seconds. That is longer than the default
 * function budget of /api/account/delete, which declares no maxDuration — so
 * a bad minute at a third party turned into a timed-out erasure, and the user
 * saw a failure for an account that was already half gone. A healthy round
 * trip is well under a second; anything past this is an outage, and an outage
 * belongs on the queue rather than in somebody's request.
 */
const AUDIENCE_PURGE_TIMEOUT_MS = 3000;

/** Firestore throws synchronously out of `db.doc()` for an id matching
 *  `__x__`, and `__a@b.co__` is a valid address — the same guard, for the same
 *  reason, as lib/email/suppression.ts and the leads route. */
function purgeDocId(email: string): string | null {
  const id = encodeURIComponent(email.trim().toLowerCase());
  if (!id || /^__.*__$/.test(id) || id === "." || id === "..") return null;
  return id;
}

/**
 * Race `work` against a deadline, resolving `null` if the deadline wins or the
 * work throws — so a caller only ever sees a CONFIRMED result and can never
 * mistake "we never found out" for "it is gone".
 */
function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  label: string
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The work promise gets its own catch rather than relying on the race: a
  // rejection arriving after the deadline has already won would otherwise be
  // an unhandled rejection, which Node treats as fatal.
  const guarded: Promise<T | null> = work.catch((err) => {
    console.error(`[account] ${label} threw`, err);
    return null;
  });
  return Promise.race([
    guarded,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Ask Resend to drop one contact, leaving a durable note when that cannot be
 * confirmed.
 *
 * The queue row is written BEFORE the attempt and cleared only on a confirmed
 * removal. The other order looks tidier and is wrong: a timeout, a thrown
 * request, or a serverless function frozen the instant it returns all leave
 * the work unfinished, and the row is the only thing that remembers. A
 * leftover row for an address that was in fact removed costs one wasted DELETE
 * on the next reconcile; a missing row for an address that was not costs an
 * erased user their plaintext address, live at a US processor, with nothing
 * anywhere recording that it is still there.
 *
 * The row holds the address and nothing else — deliberately no uid. The uid
 * has just been erased from every other store, and pairing the two again here
 * would rebuild the one link this whole sequence exists to break.
 */
async function purgeFromAudience(
  db: Firestore,
  uid: string,
  email: string
): Promise<boolean> {
  // Nothing is mirrored anywhere when no Audience is configured, so there is
  // nothing to remove and nothing to queue. Queueing anyway would fill the
  // collection with rows no reconcile could ever clear.
  if (!audienceId()) return true;

  const id = purgeDocId(email);
  const ref = id ? db.doc(`${AUDIENCE_PURGE_QUEUE}/${id}`) : null;
  if (ref) {
    try {
      await ref.set({
        email: email.trim().toLowerCase(),
        at: Date.now(),
        attempts: 0,
      });
    } catch (err) {
      // Loud, because from here on nothing durable remembers this address.
      console.error(`[account] could not queue the audience purge for ${uid}`, err);
    }
  }

  const removed = await withDeadline(
    deleteContact(email),
    AUDIENCE_PURGE_TIMEOUT_MS,
    `resend contact delete for ${uid}`
  );
  if (removed === true) {
    if (ref) {
      try {
        await ref.delete();
      } catch (err) {
        // Harmless: the next reconcile issues one redundant DELETE.
        console.warn(`[account] audience purge row left behind for ${uid}`, err);
      }
    }
    return true;
  }

  // Loud on a plain `false` too, not just on a throw or a timeout:
  // deleteContact reports "Resend refused" the same way it reports success,
  // and both leave an address that somebody or something has to come back for.
  console.error(
    `[account] resend contact NOT removed for ${uid} — queued at ${AUDIENCE_PURGE_QUEUE}/${id ?? "(unqueueable address)"} for the reconcile sweep`
  );
  return false;
}

/**
 * Retry the addresses step 7 could not confirm.
 *
 * Idempotent and reconciled against "what is still queued now" rather than
 * against what happened last time, the same shape as the retention sweeps in
 * lib/email/retention.ts and lib/opsMetrics.ts — a double run removes nothing
 * extra, and a missed run is picked up by the next one. Meant to be called
 * from the daily cron; until it is, the queue is at least a queryable list of
 * the addresses a human has to remove by hand, which is what the erasure had
 * no way of telling anyone before.
 *
 * `attempts` is only ever counted up. A row that will not clear is a Resend
 * problem needing a person, and dropping it after N tries would silently throw
 * away the only record that the address is still out there.
 */
export async function reconcileAudiencePurges(
  db: Firestore | null,
  limit = 100
): Promise<{ removed: number; pending: number }> {
  if (!db || !audienceId()) return { removed: 0, pending: 0 };
  let snap;
  try {
    snap = await db.collection(AUDIENCE_PURGE_QUEUE).orderBy("at").limit(limit).get();
  } catch (err) {
    console.error("[account] audience purge sweep could not read the queue", err);
    return { removed: 0, pending: 0 };
  }

  let removed = 0;
  let pending = 0;
  for (const doc of snap.docs) {
    const row = doc.data() as { email?: unknown; attempts?: unknown };
    const email = typeof row.email === "string" ? row.email : null;
    if (!email) {
      // A row with no address is unusable and unfixable; keeping it would make
      // the queue length meaningless forever.
      await doc.ref.delete().catch(() => {});
      continue;
    }
    const ok = await withDeadline(
      deleteContact(email),
      AUDIENCE_PURGE_TIMEOUT_MS,
      "resend contact delete (sweep)"
    );
    if (ok === true) {
      try {
        await doc.ref.delete();
        removed += 1;
      } catch {
        pending += 1;
      }
      continue;
    }
    pending += 1;
    const attempts = typeof row.attempts === "number" ? row.attempts + 1 : 1;
    await doc.ref.set({ attempts, lastTriedAt: Date.now() }, { merge: true }).catch(() => {});
  }
  if (pending > 0) {
    console.error(
      `[account] ${pending} erased address(es) still present in the Resend audience — remove them by hand if this persists`
    );
  }
  return { removed, pending };
}

export async function eraseAccount(
  app: App,
  db: Firestore,
  uid: string,
  opts: {
    /** Lands in Stripe refund metadata + billingAlerts.context, so a refund
     *  is attributable to the flow that caused it. */
    refundContext: string;
  }
): Promise<EraseResult> {
  const { getAuth } = await import("firebase-admin/auth");

  // 1. Stop the money, fail-CLOSED. Cancel every live subscription on this
  //    customer, not just the one id on the plan doc (a legacy customer can
  //    hold two). If we can't confirm the money is stopped, we delete nothing
  //    and let the user retry, rather than erasing the ids that would let us
  //    ever cancel it.
  const stripe = getStripe();
  if (stripe) {
    try {
      const planSnap = await db.doc(`users/${uid}/profile/plan`).get();
      const data = planSnap.exists ? planSnap.data() : undefined;
      const customerId = data?.stripeCustomerId as string | undefined;
      const subId = data?.stripeSubscriptionId as string | undefined;

      // Every customer this uid owns, not just the one the plan doc happens to
      // remember. A concurrent checkout could historically mint a second
      // customer and the plan doc kept only the last writer — so cancelling
      // against the stored id alone left the twin billing a deleted user
      // forever, the exact outcome this step is fail-closed to prevent.
      const customerIds = new Set<string>();
      if (customerId) customerIds.add(customerId);
      try {
        const owned = await stripe.customers.search({
          query: `metadata["firebaseUid"]:"${uid}"`,
          limit: 100,
        });
        for (const c of owned.data) if (!c.deleted) customerIds.add(c.id);
      } catch (err) {
        // Search is eventually consistent and can be unavailable; a miss here
        // must not silently narrow the sweep, so treat it as a failure to
        // confirm and let the outer catch keep the account intact.
        throw err;
      }

      const liveSubs = new Map<string, Stripe.Subscription>();
      for (const cid of customerIds) {
        const subs = await stripe.subscriptions.list({
          customer: cid,
          status: "all",
          limit: 100,
        });
        for (const s of subs.data) {
          if (LIVE_SUB.includes(s.status)) liveSubs.set(s.id, s);
        }
      }
      if (liveSubs.size === 0 && subId) {
        // No customer id anywhere (older record): fall back to the one sub id,
        // retrieved so the cancel — and the refund below — have what they need.
        try {
          const s = await stripe.subscriptions.retrieve(subId);
          if (LIVE_SUB.includes(s.status)) liveSubs.set(s.id, s);
        } catch (err) {
          if ((err as { code?: string })?.code !== "resource_missing") throw err;
        }
      }

      for (const [id, sub] of liveSubs) {
        try {
          await stripe.subscriptions.cancel(id);
        } catch (err) {
          // "Already canceled / no such subscription" is success: the money
          // is already stopped. Anything else is a real failure to confirm.
          const code = (err as { code?: string })?.code;
          if (code !== "resource_missing") throw err;
        }
        // Hand back the unused portion of the period they'd already paid for,
        // to the card. Best-effort: never blocks the deletion, idempotent on
        // the sub id.
        await refundUnusedPortion(stripe, db, sub, {
          uid,
          context: opts.refundContext,
        });
      }
    } catch (err) {
      // We could not confirm billing is stopped. Do NOT delete: erasing now
      // would lose the ids and bill a former user indefinitely.
      console.error(`[account] stripe cancel failed for ${uid}`, err);
      return { ok: false, step: "billing" };
    }
  }

  // 2. Remove the public projections and cross-user mirrors BEFORE wiping the
  //    subtree that tells us where they are (the friends list). Fail closed
  //    like the Stripe step: if this can't commit, delete nothing and let the
  //    user retry. Otherwise a deletion leaves the public leaderboard row, the
  //    invite code, and friend mirrors behind — and redeeming the orphaned
  //    invite code would resurrect a plan/score doc under the deleted uid.
  try {
    const [rowSnap, friendsSnap, invitesSnap] = await Promise.all([
      db.doc(`leaderboard/${uid}`).get(),
      db.collection(`users/${uid}/friends`).get(),
      db.collection("invites").where("uid", "==", uid).get(),
    ]);
    // Commit in chunks of 500: a Firestore WriteBatch caps at 500 writes, and
    // a user with a large friends list (mirrors are written both ways on every
    // invite) would otherwise exceed it and never be able to delete.
    const refs = [
      db.doc(`leaderboard/${uid}`),
      ...invitesSnap.docs.map((d) => d.ref),
      // The reciprocal mirror: everyone who has THIS user as a friend.
      ...friendsSnap.docs.map((d) => db.doc(`users/${d.id}/friends/${uid}`)),
    ];

    // The handle reservation goes with the row it belongs to. handles/{folded}
    // holds { uid, handle } — the deleted account's id and the public name
    // they picked — and nothing else in this sequence reaches it, so an erased
    // account was leaving both behind for good, in the one collection that can
    // map a display name back to an account id (see firestore.rules, which
    // denies clients even read for exactly that reason).
    //
    // Released rather than kept as an anonymous tombstone. The reservation
    // exists to stop two LIVE rows appearing under one name, and the row is
    // being deleted in this same batch — after this there is nobody left to be
    // confused with, so holding the name would burn it forever to prevent an
    // impersonation that no longer has a target. It is also what the rest of
    // the codebase already does the moment a handle stops being displayed:
    // setHandle frees the previous fold on a rename, and /api/admin/leaderboard
    // frees it when an operator clears an offensive one. The cost — the name
    // becomes available to someone else — is the ordinary state of a name
    // nobody is using, and the brand names nobody may take are protected by
    // RESERVED_HANDLES, not by leftovers.
    const previousHandle = rowSnap.data()?.handle;
    if (typeof previousHandle === "string") {
      const folded = foldHandle(previousHandle);
      if (folded) refs.push(db.doc(`handles/${folded}`));
    }
    for (let i = 0; i < refs.length; i += 500) {
      const batch = db.batch();
      for (const ref of refs.slice(i, i + 500)) batch.delete(ref);
      await batch.commit();
    }
  } catch (err) {
    console.error(`[account] cleanup failed for ${uid}`, err);
    return { ok: false, step: "cleanup" };
  }

  // 3. The tips-list signup, which lives outside users/{uid} (keyed by email)
  //    and so survived every step above. The signup form and its route are
  //    gone, but the rows they wrote are not, so this step still has work. "Permanently erases
  //    everything" has to include it, or a deleted account's address is still
  //    sitting in a mailing list. Best-effort: an address that was never
  //    submitted simply isn't there, and failing to remove a lead must not
  //    block the deletion the user asked for.
  //
  //    Firestore is only half of it. The address was also mirrored into the
  //    Resend Audience when it was submitted (by the removed tips form, and
  //    still by /api/account/email-prefs), and Resend is a US processor that fans out
  //    broadcasts from ITS copy, not from ours. That removal is step 7, at the
  //    very end: it is the only part of this sequence that depends on a third
  //    party being awake, so it happens where a slow one cannot cost anybody
  //    their deletion.
  //
  //    The address is read here rather than in step 7 because step 6 deletes
  //    the Auth record it comes from.
  let email: string | undefined;
  try {
    email = (await getAuth(app).getUser(uid)).email ?? undefined;
  } catch (err) {
    console.error(`[account] lead lookup failed for ${uid}`, err);
  }
  if (email) {
    try {
      await db.doc(`leads/${encodeURIComponent(email.toLowerCase())}`).delete();
    } catch (err) {
      console.error(`[account] lead cleanup failed for ${uid}`, err);
    }
  }

  // 4. The deletion-reason log. sessionDeletions lives outside users/{uid}
  //    (written server-side by /api/session/delete, deny-all to clients), so
  //    like the tips-list lead above it survived every step: a deleted user
  //    was leaving behind a uid, a session id and the score of each session
  //    they had removed, permanently.
  //
  //    Scrubbed rather than deleted. The row exists to answer "why do people
  //    delete a take", and people who go on to leave entirely are the cohort
  //    that question most wants to hear from, so dropping the rows would
  //    quietly lose exactly the feedback worth having. Removing the uid and
  //    the session id severs the link to a person; what is left (reason,
  //    mode, category, score, timestamp) is aggregate and belongs to nobody.
  //
  //    Best-effort, like the lead sweep: this is product analytics, and it
  //    must never be the reason a user cannot erase their account.
  try {
    const snap = await db
      .collection("sessionDeletions")
      .where("uid", "==", uid)
      .get();
    // Chunked at 500 for the same WriteBatch cap as the cleanup step above.
    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + 500)) {
        batch.update(doc.ref, {
          uid: FieldValue.delete(),
          sessionId: FieldValue.delete(),
          erasedAccount: true,
        });
      }
      await batch.commit();
    }
  } catch (err) {
    console.error(`[account] deletion-log scrub failed for ${uid}`, err);
  }

  // 5. Delete every document under users/{uid}: sessions, challenges, usage,
  //    profile (including the plan doc, which only the Admin SDK can touch).
  //
  //    Guarded like the steps above. recursiveDelete is a BulkWriter and can
  //    fail partway; unguarded it threw a bare 500 with no JSON body, so the
  //    client showed its generic message while the user was left half-deleted
  //    — public projections gone, an arbitrary subset of their data gone, and
  //    a login that still worked.
  try {
    await db.recursiveDelete(db.doc(`users/${uid}`));
  } catch (err) {
    console.error(`[account] data delete failed for ${uid}`, err);
    return { ok: false, step: "data" };
  }

  // 6. Delete the login itself. Do this last: while the auth record exists
  //    the user could still sign in and see an empty account, which is odd
  //    but harmless, whereas deleting it first would strand the data with
  //    no owner and no way to retry.
  try {
    await getAuth(app).deleteUser(uid);
  } catch (err) {
    console.error(`[account] auth delete failed for ${uid}`, err);
    return { ok: false, step: "auth-record" };
  }

  // 7. The Resend Audience mirror of the address. LAST, and hard-bounded.
  //
  //    This used to sit inside step 3, ahead of recursiveDelete and the Auth
  //    delete, and it is the one call in the sequence that leaves the building.
  //    lib/email/client.ts retries it three times with an 8s timeout and
  //    ~0.6s/1.8s of backoff, so a Resend outage could hold the request for
  //    ~26 seconds — past the default function budget of a route that declares
  //    no maxDuration. The user then saw a FAILED deletion for an account
  //    whose leaderboard row, handle and subscription were already gone: the
  //    worst possible outcome for the one operation that has to feel reliable.
  //
  //    Here, everything irreversible has already happened and succeeded, so a
  //    slow third party can no longer change the answer this function gives.
  //    It is still bounded on top of that, because the caller is holding a
  //    request open either way, and an unconfirmed removal goes on the durable
  //    queue above instead of being reported as done.
  if (email) {
    await purgeFromAudience(db, uid, email);
  }

  return { ok: true };
}
