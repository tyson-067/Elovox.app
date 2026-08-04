import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { makeRateLimiter } from "@/lib/verify";
import { eraseAccount, type EraseFailure } from "@/lib/accountDeletion";

// Account erasure, the self-serve half of the deletion right promised in
// /privacy. Runs server-side because deleting a user's data needs the Admin
// SDK: the browser can't recursively delete a subtree, and it must never be
// able to delete the Firebase Auth record of anyone but itself.
//
// The sequence itself (cancel billing fail-closed → public projections →
// tips list → data subtree → login) lives in lib/accountDeletion.ts, shared
// with the operator route so the two can never drift. This file owns what is
// specific to SELF-service: the caller may only erase their own uid, and only
// with a fresh sign-in.
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

// Deletion is irreversible and cancels a subscription on the way out, so a
// handful of attempts per hour is generous. A retry after a transient failure
// still works; a loop does not.
const rateLimited = makeRateLimiter(5);

// The same user-facing wording each failure step has always had. Every step
// is a 503 that says nothing (or how much) was deleted, so the user retries
// rather than wondering.
const FAILURE_MESSAGE: Record<EraseFailure, string> = {
  billing:
    "We couldn't cancel your subscription just now, so nothing was deleted. Please try again in a moment.",
  cleanup:
    "We couldn't finish deleting your account, so nothing was deleted. Please try again in a moment.",
  data: "We couldn't finish deleting your data. Some of it may already be gone — please try again, and contact us if this keeps happening.",
  "auth-record":
    "Your data was removed, but we couldn't close the login itself. Please try again in a moment.",
};

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

  const result = await eraseAccount(app, db, uid, {
    refundContext: "account-deletion",
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: FAILURE_MESSAGE[result.step] },
      { status: 503 }
    );
  }

  return NextResponse.json({ deleted: true });
}
