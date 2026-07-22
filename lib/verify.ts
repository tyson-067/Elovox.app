import type { NextRequest } from "next/server";

// Shared abuse protection for the paid-API routes. Every expensive route
// (transcription, LLM generation) only runs for callers holding a valid
// Firebase ID token, verified against Google's identitytoolkit endpoint —
// no admin SDK or service account needed.

export async function verifyUser(req: NextRequest): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return "local-dev"; // Firebase not configured — nothing to verify against
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
  return data.users?.[0]?.localId ?? null;
}

/**
 * Server-side entitlement check, for the routes where Premium costs real
 * money (the camera pass runs a second vision call). Reads the user's own
 * plan doc through the Firestore REST API using their ID token, so normal
 * security rules apply and no service account is needed.
 *
 * Fails closed: anything unexpected reads as free.
 */
export async function isPremiumServer(req: NextRequest, uid: string): Promise<boolean> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) return true; // Firebase not configured — local dev, don't block
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return false;

  try {
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/profile/plan`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return false; // 404 = no plan doc = never subscribed
    const data = await res.json();
    return data.fields?.plan?.stringValue === "premium";
  } catch {
    return false;
  }
}

/**
 * Best-effort per-instance rate limiting. Not a security boundary — it's a
 * budget guard that stops one signed-in user (or one IP) from looping a route.
 * The key is caller-supplied: pass a uid for per-user limits, or an IP for
 * per-IP limits on unauthenticated routes.
 */
export function makeRateLimiter(limit: number, windowMs = 60 * 60 * 1000) {
  const buckets = new Map<string, number[]>();
  return function rateLimited(key: string): boolean {
    const now = Date.now();
    const hits = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
    if (hits.length >= limit) return true;
    hits.push(now);
    buckets.set(key, hits);
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
