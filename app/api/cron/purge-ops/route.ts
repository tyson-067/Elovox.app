import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { purgeExpiredOpsEvents } from "@/lib/opsMetrics";
import { purgeExpiredLoginRows } from "@/lib/loginGuard";
import { purgeExpiredEmailLog } from "@/lib/email/retention";
import { reconcileAudiencePurges } from "@/lib/accountDeletion";
import { clientIp, timingSafeCompare } from "@/lib/verify";
import { limited, purgeExpiredRateLimits } from "@/lib/rateLimit";

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

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  if (secret) {
    // Configured: this is the only way in. Vercel sends the value as a
    // Bearer token on every cron invocation.
    // Constant-time. `!==` on a shared secret returns at the first mismatched
    // byte, which is a timing oracle you can walk a character at a time — and
    // this is the only bearer secret in the tree we compare ourselves (the
    // Stripe webhook's HMAC is verified inside constructEvent, which is
    // already constant-time).
    if (!auth || !timingSafeCompare(auth, `Bearer ${secret}`)) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // NO SECRET SET. This branch used to run the purge for any anonymous
    // caller, rate-limited, on the argument that deleting already-expired
    // telemetry is harmless. The argument holds for the DATA and misses the
    // point about the SHAPE: it made this the one route in the tree whose
    // authentication depended on somebody remembering an environment
    // variable, and a route that is only protected when configured is a route
    // that is not protected.
    //
    // But failing closed outright would trade one silent failure for another:
    // the retention promise in /privacy would simply stop being kept, loudly
    // in a log nobody reads. So there is a second credential, and only one:
    // `x-vercel-cron`, which the platform sets on its own scheduled
    // invocations and STRIPS from inbound client requests — an external caller
    // cannot forge it. Anonymous callers get nothing either way.
    if (!req.headers.get("x-vercel-cron")) {
      console.error(
        "[cron] CRON_SECRET is unset and this is not a platform cron invocation — purge refused. Set CRON_SECRET."
      );
      return NextResponse.json({ error: "Not available." }, { status: 503 });
    }
    console.warn(
      "[cron] running on the platform cron header because CRON_SECRET is unset — set it."
    );
  } else if (await limited(getAdminDb(), "cron-purge", clientIp(req))) {
    // Development only: usable without a secret so the sweep can be exercised
    // locally, still rate-limited so a loop can't hammer the emulator.
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }

  // Five jobs, independently. The login ledgers are here for the same reason
  // opsEvents is: a Firestore TTL policy is the natural home for this and
  // creating one needs an IAM grant the console currently answers 403 to.
  // Retention should not wait on that.
  // The email delivery log joins the sweeps for the
  // same reason the other two are here: it holds addresses, so it lives under
  // the privacy policy's "short operational window", and a Firestore TTL
  // policy — the natural home for all four — needs an IAM grant the console
  // still answers 403 to. The rate-limit counters are the highest-volume of
  // the set (one document per key per window across every route), so they are
  // given a larger batch: left unswept they would outgrow the other three
  // combined.
  // The fifth is not a purge but a reconcile, and it is here because it is the
  // same promise: erasing an account removes the address from Resend too, and
  // that call is deliberately made AFTER the irreversible steps and under a
  // short deadline, so a Resend outage cannot fail or stall a deletion. What it
  // leaves behind is a queued address, and a queue nothing drains is just a
  // slower way of keeping the data. This drains it, idempotently, against
  // "what is still queued now" like everything else in this route.
  const [deleted, logins, mail, rates, audience] = await Promise.all([
    purgeExpiredOpsEvents(db, 500),
    purgeExpiredLoginRows(db, 500),
    purgeExpiredEmailLog(db, 500),
    purgeExpiredRateLimits(db, 2000),
    reconcileAudiencePurges(db, 100),
  ]);
  console.info(
    `[cron] purged ${deleted} expired opsEvents, ${logins} expired login rows, ${mail} expired email log rows, ${rates} expired rate rows; removed ${audience.removed} queued address(es) from the email audience, ${audience.pending} still pending`
  );
  return NextResponse.json({
    ok: true,
    deleted,
    logins,
    mail,
    rates,
    audienceRemoved: audience.removed,
    audiencePending: audience.pending,
  });
}
