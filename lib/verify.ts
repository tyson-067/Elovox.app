import type { NextRequest } from "next/server";
import { getAdminDb } from "./firebaseAdmin";

// Shared abuse protection for the paid-API routes. Every expensive route
// (transcription, LLM generation) only runs for callers holding a valid
// Firebase ID token, verified against Google's identitytoolkit endpoint —
// no admin SDK or service account needed.

/** The account behind a request's ID token, or null if there isn't a valid one. */
async function lookupUser(
  req: NextRequest
): Promise<{ uid: string; email: string; emailVerified: boolean } | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return { uid: "local-dev", email: "", emailVerified: true }; // Firebase not configured
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return null;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const record = data.users?.[0];
  if (!record?.localId) return null;
  return {
    uid: record.localId,
    email: typeof record.email === "string" ? record.email : "",
    emailVerified: Boolean(record.emailVerified),
  };
}

/**
 * Whether the caller is an operator, per the ADMIN_EMAILS allow-list. Matches
 * on the verified email from the ID token rather than a uid so the list stays
 * readable, and requires emailVerified so a hostile signup can't claim an
 * operator's address. Empty/unset list means nobody is an admin, the admin
 * surfaces simply 404 rather than falling open.
 */
export async function isAdmin(req: NextRequest): Promise<boolean> {
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  const found = await lookupUser(req);
  if (!found || !found.emailVerified || !found.email) return false;
  return allowed.includes(found.email.toLowerCase());
}

export async function verifyUser(req: NextRequest): Promise<string | null> {
  return (await lookupUser(req))?.uid ?? null;
}

/**
 * Like `verifyUser`, but also requires the account's email to be verified —
 * the server half of the /verify-email gate in components/RequireAuth.tsx.
 * That gate is a redirect, which protects nobody: an unverified account still
 * holds a valid ID token and can call these routes directly. Enforce it here,
 * where the money is actually spent.
 *
 * Returns `"unverified"` rather than null so callers can answer 403 (do
 * something about it) instead of 401 (sign in), which are different problems.
 * Google accounts arrive already verified and pass straight through.
 */
export async function verifyVerifiedUser(
  req: NextRequest
): Promise<string | null | "unverified"> {
  const found = await lookupUser(req);
  if (!found) return null;
  return found.emailVerified ? found.uid : "unverified";
}

/**
 * What the entitlement lookup found.
 *
 * Three values, not a boolean, and that distinction is the whole point of
 * this type. "free" means we read the plan doc and it does not say premium.
 * "unknown" means we never got an answer — no token to read with, Firestore
 * refused or was down, the fetch threw. Those are completely different facts
 * and they must not produce the same response.
 *
 * They used to. This returned a bool that was `false` for both, so a single
 * failed read told a paying subscriber "Free practice is the Daily Minute. Go
 * Premium" in the middle of a take they had already recorded — the paywall
 * copy, for a feature they were paying for, triggered by our own infra. It
 * looked exactly like a billing bug and it was reported as one on the speech
 * library, on interview practice and on my-material, because it was never
 * about any of those surfaces: every non-daily recording goes through this
 * one check. `unknown` now gets an honest "couldn't check, try again", and
 * the paywall is reserved for accounts we actually know are free.
 */
export type Entitlement = "premium" | "free" | "unknown";

/**
 * Server-side entitlement check, for the routes where Premium costs real
 * money (the camera pass runs a second vision call).
 *
 * Reads users/{uid}/profile/plan — the doc the Stripe webhook writes — through
 * the Admin SDK where one is configured. That's the authoritative path: same
 * credential that writes the doc, no security rules in the way, no ID token
 * being forwarded to a second Google API that has its own opinions about it.
 * Without a service account it falls back to the Firestore REST API using the
 * caller's own token, which is subject to the normal rules.
 */
export async function isPremiumServer(
  req: NextRequest,
  uid: string
): Promise<Entitlement> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) return "premium"; // Firebase not configured, local dev, don't block

  const db = getAdminDb();
  if (db) {
    try {
      const snap = await db.doc(`users/${uid}/profile/plan`).get();
      // A missing doc is a real answer: this account has never subscribed.
      if (!snap.exists) return "free";
      return snap.data()?.plan === "premium" ? "premium" : "free";
    } catch (err) {
      // Firestore unreachable, credential rejected. We know nothing.
      console.error("[entitlement] admin plan read failed", uid, err);
      return "unknown";
    }
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return "unknown";
  try {
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/profile/plan`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    // 404 is the one non-2xx that means something: no plan doc, never
    // subscribed. Everything else (403 from rules, 429, 5xx) is a failure to
    // find out, and saying "free" to that is how subscribers got paywalled.
    if (res.status === 404) return "free";
    if (!res.ok) {
      console.error("[entitlement] REST plan read failed", uid, res.status);
      return "unknown";
    }
    const data = await res.json();
    return data.fields?.plan?.stringValue === "premium" ? "premium" : "free";
  } catch (err) {
    console.error("[entitlement] REST plan read threw", uid, err);
    return "unknown";
  }
}

/**
 * Best-effort per-instance rate limiting. Not a security boundary, it's a
 * budget guard that stops one signed-in user (or one IP) from looping a route.
 * The key is caller-supplied: pass a uid for per-user limits, or an IP for
 * per-IP limits on unauthenticated routes.
 */
export function makeRateLimiter(limit: number, windowMs = 60 * 60 * 1000) {
  const buckets = new Map<string, number[]>();
  return function rateLimited(key: string): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length >= limit) return true;
    hits.push(now);
    buckets.set(key, hits);

    // Evict keys whose window has fully expired. Without this the map only
    // ever grew: every uid and every IP the instance had ever seen kept an
    // entry for the life of the process, because expired timestamps were
    // filtered on read but the empty bucket was never dropped.
    if (buckets.size > 1000) {
      for (const [k, times] of buckets) {
        if (k !== key && times.every((t) => t <= cutoff)) buckets.delete(k);
      }
    }
    return false;
  };
}

/**
 * Best-effort client IP for per-IP rate limiting. Reads the proxy headers set
 * by the host (Vercel/most platforms set x-forwarded-for). Falls back to a
 * constant bucket so a missing header fails safe (shared limit) rather than
 * disabling the limiter. Never used for anything but rate-limit keying.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
