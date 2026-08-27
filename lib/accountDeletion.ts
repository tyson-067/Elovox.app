import type { App } from "firebase-admin/app";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { refundUnusedPortion } from "./refunds";

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
    const [friendsSnap, invitesSnap] = await Promise.all([
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
    for (let i = 0; i < refs.length; i += 500) {
      const batch = db.batch();
      for (const ref of refs.slice(i, i + 500)) batch.delete(ref);
      await batch.commit();
    }
  } catch (err) {
    console.error(`[account] cleanup failed for ${uid}`, err);
    return { ok: false, step: "cleanup" };
  }

  // 3. The tips-list signup, which lives outside users/{uid} (keyed by email,
  //    see /api/leads) and so survived every step above. "Permanently erases
  //    everything" has to include it, or a deleted account's address is still
  //    sitting in a mailing list. Best-effort: an address that was never
  //    submitted simply isn't there, and failing to remove a lead must not
  //    block the deletion the user asked for.
  try {
    const email = (await getAuth(app).getUser(uid)).email;
    if (email) {
      await db.doc(`leads/${encodeURIComponent(email.toLowerCase())}`).delete();
    }
  } catch (err) {
    console.error(`[account] lead cleanup failed for ${uid}`, err);
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

  return { ok: true };
}
