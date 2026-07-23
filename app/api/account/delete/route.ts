import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser } from "@/lib/verify";

// Account erasure — the self-serve half of the deletion right promised in
// /privacy. Runs server-side because deleting a user's data needs the Admin
// SDK: the browser can't recursively delete a subtree, and it must never be
// able to delete the Firebase Auth record of anyone but itself.
//
// Order matters. Stripe first: if we deleted the Firestore data first and
// then failed to cancel, we'd have lost the subscription id and the user
// would keep being billed for an account that no longer exists. Billing
// records themselves stay with Stripe — tax and accounting law requires it,
// and the privacy policy says so.
//
// The client re-authenticates before calling this (see deleteAccount in
// lib/auth.ts), so a stolen, idle session can't wipe an account.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json(
      { error: "Account deletion isn't available right now." },
      { status: 503 }
    );
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // 1. Stop the money. Cancel immediately rather than at period end — the
  //    account is going away, so there's nothing left to keep access to.
  const stripe = getStripe();
  if (stripe) {
    try {
      const planSnap = await db.doc(`users/${uid}/profile/plan`).get();
      const subId = planSnap.exists
        ? (planSnap.data()?.stripeSubscriptionId as string | undefined)
        : undefined;
      if (subId) await stripe.subscriptions.cancel(subId);
    } catch (err) {
      // A subscription that's already gone (or a Stripe blip) must not block
      // erasure — the user asked to be deleted and that has to win.
      console.error(`[account] stripe cancel failed for ${uid}`, err);
    }
  }

  // 2. Delete every document under users/{uid}: sessions, challenges, usage,
  //    profile (including the plan doc, which only the Admin SDK can touch).
  await db.recursiveDelete(db.doc(`users/${uid}`));

  // 3. Delete the login itself. Do this last: while the auth record exists
  //    the user could still sign in and see an empty account, which is odd
  //    but harmless — whereas deleting it first would strand the data with
  //    no owner and no way to retry.
  const { getAuth } = await import("firebase-admin/auth");
  await getAuth(app).deleteUser(uid);

  return NextResponse.json({ deleted: true });
}
