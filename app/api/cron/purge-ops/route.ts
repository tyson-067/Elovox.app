import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { purgeExpiredOpsEvents } from "@/lib/opsMetrics";
import { makeRateLimiter, clientIp } from "@/lib/verify";

// The scheduled sweep of expired opsEvents — the backstop that makes the
// "short operational window" in /privacy true without anyone having to open
// the admin Ops tab.
//
// WHY THIS EXISTS rather than a Firestore TTL policy: a TTL policy is the
// natural home for this, but creating one needs `datastore.indexes.update`,
// which neither the app's service account nor the operator's console session
// currently holds (both 403). Retention shouldn't wait on an IAM grant, so
// the app takes responsibility for its own data. If a TTL policy is added
// later the two are complementary — both only ever delete already-expired
// rows, so whichever runs first simply leaves the other nothing to do.
//
// Vercel calls this daily (see vercel.json). It is idempotent by
// construction, which is exactly what Vercel's own cron guidance asks for:
// duplicate invocations delete nothing extra, and a missed day is picked up
// by the next run, because every run reconciles against "what is expired
// now" rather than against what happened last time.

export const runtime = "nodejs";

// Bounded work per invocation; the purge itself caps its batch. This only
// matters for the unauthenticated case below.
const rateLimited = makeRateLimiter(6, 60 * 60 * 1000); // per IP per hour

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  if (secret) {
    // Configured: this is the only way in. Vercel sends the value as a
    // Bearer token on every cron invocation.
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  } else {
    // Not configured: still run, rate-limited. Refusing outright would mean
    // the retention promise silently depends on an env var nobody set, which
    // is the failure mode this route was written to end. The exposure is
    // small by construction — the only thing an anonymous caller can cause
    // is the deletion of telemetry rows that were already past their expiry.
    if (rateLimited(clientIp(req))) {
      return NextResponse.json({ error: "Slow down." }, { status: 429 });
    }
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }

  const deleted = await purgeExpiredOpsEvents(db, 500);
  console.info(`[cron] purged ${deleted} expired opsEvents`);
  return NextResponse.json({ ok: true, deleted });
}
