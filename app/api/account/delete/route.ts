import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { makeRateLimiter } from "@/lib/verify";

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

      const toCancel = new Set<string>();
      if (customerId) {
        const subs = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 100,
        });
        for (const s of subs.data) {
          if (LIVE_SUB.includes(s.status)) toCancel.add(s.id);
        }
      } else if (subId) {
        // No customer id stored (older record): fall back to the one sub id.
        toCancel.add(subId);
      }

      for (const id of toCancel) {
        try {
          await stripe.subscriptions.cancel(id);
        } catch (err) {
          // "Already canceled / no such subscription" is success: the money
          // is already stopped. Anything else is a real failure to confirm.
          const code = (err as { code?: string })?.code;
          if (code !== "resource_missing") throw err;
        }
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

  // 3. Delete every document under users/{uid}: sessions, challenges, usage,
  //    profile (including the plan doc, which only the Admin SDK can touch).
  await db.recursiveDelete(db.doc(`users/${uid}`));

  // 4. Delete the login itself. Do this last: while the auth record exists
  //    the user could still sign in and see an empty account, which is odd
  //    but harmless, whereas deleting it first would strand the data with
  //    no owner and no way to retry.
  await getAuth(app).deleteUser(uid);

  return NextResponse.json({ deleted: true });
}
