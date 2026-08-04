import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAppCheck } from "firebase-admin/app-check";
import { getAdminApp, getAdminDb } from "./firebaseAdmin";

// Shared abuse protection for the paid-API routes. Every expensive route
// (transcription, LLM generation) only runs for callers holding a valid
// Firebase ID token, verified against Google's identitytoolkit endpoint —
// no admin SDK or service account needed.

/** The account behind a request's ID token, or null if there isn't a valid one. */
async function lookupUser(
  req: NextRequest
): Promise<{ uid: string; email: string; emailVerified: boolean } | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  // Firebase not configured: a `next dev` convenience so the app is usable
  // without credentials. Gated on NODE_ENV so a misconfigured production or
  // preview deploy (secrets present, NEXT_PUBLIC_ client vars missing) can
  // never fall into this branch and serve the paid pipeline to anyone with
  // no token at all. On Vercel, NODE_ENV is "production" for prod AND preview.
  if (!apiKey) {
    return process.env.NODE_ENV !== "production"
      ? { uid: "local-dev", email: "", emailVerified: true }
      : null;
  }
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
  // An account disabled in the Firebase console must lose API access, not keep
  // it until its ID token happens to expire. accounts:lookup still returns the
  // record for a disabled user, so check the flag explicitly and treat it as no
  // valid caller. (Firebase Auth already refuses to mint NEW tokens for them;
  // this closes the ≤1h window on tokens minted just before the ban.)
  if (record.disabled === true) return null;
  return {
    uid: record.localId,
    email: typeof record.email === "string" ? record.email : "",
    emailVerified: Boolean(record.emailVerified),
  };
}

/** The ADMIN_EMAILS allow-list, normalized. Empty means nobody is an admin. */
export function adminEmailList(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The operator behind a request, per the ADMIN_EMAILS allow-list, or null.
 * Matches on the verified email from the ID token rather than a uid so the
 * list stays readable, and requires emailVerified so a hostile signup can't
 * claim an operator's address. Empty/unset list means nobody is an admin, the
 * admin surfaces simply 404 rather than falling open.
 *
 * Returns the identity (not a bool) so mutating admin routes can write WHO
 * did WHAT to the adminAudit log — an admin console without attribution is a
 * console nobody can answer questions about later.
 */
export async function adminIdentity(
  req: NextRequest
): Promise<{ uid: string; email: string } | null> {
  const allowed = adminEmailList();
  if (allowed.length === 0) return null;
  const found = await lookupUser(req);
  if (!found || !found.emailVerified || !found.email) return null;
  const email = found.email.toLowerCase();
  return allowed.includes(email) ? { uid: found.uid, email } : null;
}

/** Whether the caller is an operator. See adminIdentity. */
export async function isAdmin(req: NextRequest): Promise<boolean> {
  return (await adminIdentity(req)) !== null;
}

export async function verifyUser(req: NextRequest): Promise<string | null> {
  return (await lookupUser(req))?.uid ?? null;
}

/**
 * The uid AND the address on the caller's token.
 *
 * `verifyUser` returns only the uid, which is right for every route that acts
 * on "whoever is signed in". The login guard needs the address too, because
 * clearing an account's lockout has to prove the token belongs to THAT
 * account — otherwise anyone holding any valid session could clear anyone
 * else's. Same verification path, one more field.
 */
export async function verifiedIdentity(
  req: NextRequest
): Promise<{ uid: string; email: string | null } | null> {
  const found = await lookupUser(req);
  return found ? { uid: found.uid, email: found.email ?? null } : null;
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

// --- Firebase App Check (client attestation) ---------------------------
// A valid ID token proves WHO is calling; it does not prove the call came
// from our real web client. A script holding a signed-in user's token can hit
// the paid routes straight from curl, skipping the reCAPTCHA attestation every
// real browser performs, and spend our AssemblyAI/Gemini budget up to the
// per-day quota. App Check closes that: the client attaches a short-lived
// attestation JWT (X-Firebase-AppCheck; see lib/appCheck.ts + lib/analyze.ts)
// and we verify it here, before the paid work, with the Admin SDK.
//
// App Check is ALREADY enforced on Firestore (README "3. App Check"), so live
// clients are already minting these tokens. This extends the same attestation
// to the API routes, which firestore.rules never covered.
//
// ROLLOUT — soft-fail by default. A missing/invalid token is LOGGED, not
// rejected, until APPCHECK_ENFORCE=true. This mirrors the ship-key-then-
// enforce order the README documents for Firestore, and it matters even more
// here: the X-Firebase-AppCheck header is NEW, so a browser still running a
// bundle from before that client change attests to Firestore yet sends no
// header. Enforcing before those bundles drain would 403 real, paying users
// mid-practice. Watch the soft-fail logs fall to ~zero, THEN flip the flag.
const APPCHECK_ENFORCE = process.env.APPCHECK_ENFORCE === "true";

type AppCheckVerdict = "valid" | "missing" | "invalid" | "unconfigured";

async function verifyAppCheck(req: NextRequest): Promise<AppCheckVerdict> {
  // No Admin app (local dev, or a deploy with no service account) means there
  // is nothing to verify the token against. Skip rather than reject:
  // production always has the service account (the durable quota meters need
  // it), so this only short-circuits environments that aren't spending real
  // money anyway — the same posture as isPremiumServer below.
  const app = getAdminApp();
  if (!app) return "unconfigured";
  const token = req.headers.get("x-firebase-appcheck");
  if (!token) return "missing";
  try {
    await getAppCheck(app).verifyToken(token);
    return "valid";
  } catch {
    // Expired, malformed, minted for another project, or forged. Under
    // soft-fail the caller logs this; once enforcing, it becomes a 403.
    return "invalid";
  }
}

/**
 * Gate a paid route on App Check attestation. Returns a 403 `NextResponse` to
 * hand back when the request should be rejected, or null to proceed.
 *
 * SOFT-FAIL (the default, APPCHECK_ENFORCE unset): never returns a response —
 * an unattested request is logged and allowed through, so a bad rollout can't
 * lock out real users. Flip APPCHECK_ENFORCE=true only after the soft-fail
 * logs show real traffic is attesting. See the rollout note above.
 */
export async function enforceAppCheck(
  req: NextRequest,
  route: string
): Promise<NextResponse | null> {
  const verdict = await verifyAppCheck(req);
  if (verdict === "valid" || verdict === "unconfigured") return null;

  // verdict is "missing" or "invalid": a request that did not attest.
  if (!APPCHECK_ENFORCE) {
    console.warn(
      `[app-check] unattested ${route}: ${verdict} (soft-fail, not enforced)`
    );
    return null;
  }
  console.warn(`[app-check] rejected ${route}: ${verdict}`);
  return NextResponse.json(
    {
      error: "app-check-failed",
      message:
        "Couldn't verify this request came from the Elovox app. Reload the page and try again.",
    },
    { status: 403 }
  );
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
 * Whether a comped Premium window is still open. Accepts the raw value from
 * either Firestore path — the Admin SDK hands back a number, the REST API a
 * numeric string — and treats anything else as no grant at all.
 */
function isGrantOpen(raw: unknown, now: number = Date.now()): boolean {
  const until = typeof raw === "string" ? Number(raw) : raw;
  return typeof until === "number" && Number.isFinite(until) && until > now;
}

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
  // Firebase not configured: grant premium in local dev so every feature is
  // explorable, but never on a real deploy. In production/preview a missing
  // project id returns "unknown", which routes into the existing 503
  // "couldn't check your subscription" path rather than handing out Premium.
  if (!projectId) return process.env.NODE_ENV !== "production" ? "premium" : "unknown";

  const db = getAdminDb();
  if (db) {
    try {
      const snap = await db.doc(`users/${uid}/profile/plan`).get();
      // A missing doc is a real answer: this account has never subscribed.
      if (!snap.exists) return "free";
      const data = snap.data();
      if (data?.plan === "premium" && !pastDueLapsed(data)) return "premium";
      // A comped week from a 21-day streak (lib/streakReward.ts) is real
      // Premium for as long as it lasts, and it is NOT reflected in `plan` —
      // that field mirrors Stripe and only the webhook writes it.
      return isGrantOpen(data?.premiumUntil) ? "premium" : "free";
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
    // The SAME past-due lapse check the Admin path applies, in REST's
    // encoding. Without it the two branches of one function disagreed about
    // one document: a stored `premium` whose 14-day dunning grace had run out
    // was refused by the Admin path and granted by this one, so the answer
    // depended on whether a service account happened to be configured.
    const restPlan = {
      plan: data.fields?.plan?.stringValue,
      status: data.fields?.status?.stringValue,
      currentPeriodEnd: Number(
        data.fields?.currentPeriodEnd?.integerValue ??
          data.fields?.currentPeriodEnd?.doubleValue ??
          NaN
      ),
    };
    if (restPlan.plan === "premium" && !pastDueLapsed(restPlan)) return "premium";
    // REST encodes numbers as integerValue (a string) or doubleValue.
    const until = data.fields?.premiumUntil;
    return isGrantOpen(until?.integerValue ?? until?.doubleValue)
      ? "premium"
      : "free";
  } catch (err) {
    console.error("[entitlement] REST plan read threw", uid, err);
    return "unknown";
  }
}

/**
 * A stored `plan: "premium"` that has already lapsed.
 *
 * The read-time twin of the same bound in lib/stripe.ts `isEntitled` and
 * lib/plan.ts `pastDueLapsed`. Duplicated rather than imported because
 * lib/plan.ts is a "use client" module and this one runs on the server; the
 * number lives in three places and must move in all three at once.
 *
 * Why it matters here: the webhook writes `plan: free` once dunning ends, but
 * on a Stripe account configured to leave a failed card `past_due`
 * indefinitely the terminal event may never arrive. Without this check the
 * server granted Premium where the client showed Free — the two entitlement
 * readers disagreeing about the same document.
 */
const PAST_DUE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

function pastDueLapsed(
  data:
    | { status?: unknown; currentPeriodEnd?: unknown }
    | FirebaseFirestore.DocumentData
    | undefined,
  now = Date.now()
): boolean {
  return (
    data?.status === "past_due" &&
    typeof data.currentPeriodEnd === "number" &&
    data.currentPeriodEnd + PAST_DUE_GRACE_MS < now
  );
}

/**
 * Constant-time comparison of two secrets.
 *
 * `a === b` on a shared secret leaks its content one character at a time: the
 * comparison returns at the first mismatched byte, so an attacker who can time
 * the response can recover the value byte by byte instead of guessing it whole.
 * The window is small over a network and it is not zero, and there is no reason
 * to leave it open — this is one line.
 *
 * Both sides are hashed to a fixed 32 bytes first, so `timingSafeEqual` (which
 * throws on length mismatch) can be used at all, and so the LENGTH of the
 * secret doesn't leak either. Comparing hashes, not strings, is the same
 * reason `crypto.timingSafeEqual` exists.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** One warn line per rejected input so probing of the validation
 *  boundaries shows up in monitoring. Reasons are machine codes; the
 *  input itself is never logged. */
export function logRejectedInput(route: string, reason: string): void {
  console.warn(`[validate] ${route}: ${reason}`);
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
 * Best-effort client IP for per-IP rate limiting. Never used for anything but
 * rate-limit keying.
 *
 * The header choice is a security decision, not a formatting one. A client can
 * send any X-Forwarded-For it likes; the platform APPENDS the real connecting
 * IP to the right of whatever the client sent. So the LEFTMOST entry is
 * attacker-controlled (rotating it defeats a per-IP limit entirely), and the
 * RIGHTMOST is the trustworthy platform value. Prefer x-real-ip (Vercel sets
 * it to the real peer and it can't be spoofed the same way), then fall back to
 * the rightmost x-forwarded-for entry. A missing header fails safe to one
 * shared bucket rather than disabling the limiter.
 */
export function clientIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || "unknown";
  }
  return "unknown";
}
