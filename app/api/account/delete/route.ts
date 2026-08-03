import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { makeRateLimiter } from "@/lib/verify";
import { refundUnusedPortion } from "@/lib/refunds";

// Account erasure, the self-serve half of the deletion right promised in
// /privacy. Runs server-side because deleting a user's data needs the Admin
// SDK: the browser can't recursively delete a subtree, and it must never be
// able to delete the Firebase Auth record of anyone but itself.
//
// Order matters, and it is fail-CLOSED on billing: cancel every live
// subscription first, and if that can't be confirmed, delete NOTHING and ask
// the caller to retry. Erasing the Firestore data first would take the
// subscription ids with it and leave a former user billed forever for an
// account that no longer exists. Billing records themselves stay with Stripe,
// tax and accounting law requires it, and the privacy policy says so.
//
// The client re-authenticates before calling this, and the token's auth_time
// is re-checked below, so a stolen idle session can't wipe an account: this
// route requires a sign-in within the last few minutes, not merely any valid
// (up to ~1h old, refreshable indefinitely) token.

export const runtime = "nodejs";

// A recent-enough sign-in for an irreversible action. The client's
// reauthenticate() + getIdToken(true) mints a token whose auth_time is now,
// so an honest deletion always clears this; a replayed old token does not.
const MAX_AUTH_AGE_S = 5 * 60;

// Live subscription statuses: still entitled or still owed money, so still
// worth canceling before erasure. Mirrors the set the checkout route treats
// as "already subscribed".
const LIVE_SUB = ["trialing", "active", "past_due", "unpaid"];

// Deletion is irreversible and cancels a subscription on the way out, so a
// handful of attempts per hour is generous. A retry after a transient failure
// still works; a loop does not.
const rateLimited = makeRateLimiter(5);

export async function POST(req: NextRequest) {
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json(
      { error: "Account deletion isn't available right now." },
      { status: 503 }
    );
  }

  // Admin-SDK verification, not just verifyUser: we need auth_time to enforce
  // recency, and the route already guarantees a non-null Admin app.
  const { getAuth } = await import("firebase-admin/auth");
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  let decoded: import("firebase-admin/auth").DecodedIdToken | null = null;
  try {
    decoded = token ? await getAuth(app).verifyIdToken(token) : null;
  } catch {
    decoded = null;
  }
  if (!decoded) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const uid = decoded.uid;
  if (rateLimited(uid)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429 }
    );
  }
  // Deletion is irreversible: require a fresh sign-in. The client already
  // reauthenticates before calling this; this makes that the actual boundary
  // rather than a client-side courtesy a direct POST could skip.
  if (Date.now() / 1000 - decoded.auth_time > MAX_AUTH_AGE_S) {
    return NextResponse.json(
      { error: "For security, sign in again, then delete your account." },
      { status: 401 }
    );
  }

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
          context: "account-deletion",
        });
      }
    } catch (err) {
      // We could not confirm billing is stopped. Do NOT delete: erasing now
      // would lose the ids and bill a former user indefinitely.
      console.error(`[account] stripe cancel failed for ${uid}`, err);
      return NextResponse.json(
        {
          error:
            "We couldn't cancel your subscription just now, so nothing was deleted. Please try again in a moment.",
        },
        { status: 503 }
      );
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
    return NextResponse.json(
      {
        error:
          "We couldn't finish deleting your account, so nothing was deleted. Please try again in a moment.",
      },
      { status: 503 }
    );
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

  // 4. Delete every document under users/{uid}: sessions, challenges, usage,
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
    return NextResponse.json(
      {
        error:
          "We couldn't finish deleting your data. Some of it may already be gone — please try again, and contact us if this keeps happening.",
      },
      { status: 503 }
    );
  }

  // 5. Delete the login itself. Do this last: while the auth record exists
  //    the user could still sign in and see an empty account, which is odd
  //    but harmless, whereas deleting it first would strand the data with
  //    no owner and no way to retry.
  try {
    await getAuth(app).deleteUser(uid);
  } catch (err) {
    console.error(`[account] auth delete failed for ${uid}`, err);
    return NextResponse.json(
      {
        error:
          "Your data was removed, but we couldn't close the login itself. Please try again in a moment.",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ deleted: true });
}
