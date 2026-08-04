import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { clientIp, makeRateLimiter, timingSafeCompare } from "@/lib/verify";
import { isMailConfigured } from "@/lib/email/config";
import {
  runStreakNudge,
  runWeeklyDigest,
  runWinBack,
  type CampaignResult,
} from "@/lib/email/campaigns";

/**
 * The scheduled email runs. ONE cron entry, three jobs.
 *
 * Why one route rather than three: Vercel's Hobby plan allows two cron jobs
 * per project and one invocation a day each, and `/api/cron/purge-ops` is
 * already one of them. Three more entries would not schedule — they would
 * fail at deploy or silently never fire, which is exactly the kind of thing
 * nobody notices for a month. So this is a dispatcher: it runs daily and
 * decides for itself what today's work is.
 *
 * ORDER MATTERS, and it is the priority order for the day's allowance. The
 * weekly digest goes first on the day it runs because it is the message
 * people actually opted into; the streak nudge and win-back take what's left.
 * lib/email/budget.ts enforces the ceiling; this just decides who asks first.
 *
 * Same auth story as the purge cron next door: CRON_SECRET when set, the
 * platform's un-forgeable `x-vercel-cron` header otherwise, and neither in
 * production means refuse.
 *
 * Idempotent by construction. Every message carries a key derived from what it
 * IS (`weekly:{uid}:{week}`), so a double invocation is deduplicated at Resend
 * rather than delivered twice, and the win-back's once-ever claim is durable
 * in Firestore.
 */

export const runtime = "nodejs";
/** The digest scans a collection group and can outlast the default budget on a
 *  cold instance. This is the ceiling Vercel allows on Hobby. */
export const maxDuration = 60;

const rateLimited = makeRateLimiter(6, 60 * 60 * 1000);

type Job = "weekly" | "streak" | "winback";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  if (secret) {
    // Constant-time: `!==` on a shared secret returns at the first mismatched
    // byte, which is a timing oracle you can walk a character at a time.
    if (!auth || !timingSafeCompare(auth, `Bearer ${secret}`)) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // `x-vercel-cron` is set by the platform on its own scheduled invocations
    // and STRIPPED from inbound client requests, so it can't be forged. It is
    // the only credential accepted when CRON_SECRET is unset — and unlike the
    // purge next door, what this route does is SEND EMAIL, so there is no
    // "harmless anyway" argument for an anonymous fallback.
    if (!req.headers.get("x-vercel-cron")) {
      console.error(
        "[cron] CRON_SECRET is unset and this is not a platform cron invocation — email run refused."
      );
      return NextResponse.json({ error: "Not available." }, { status: 503 });
    }
    console.warn("[cron] running on the platform cron header because CRON_SECRET is unset — set it.");
  } else if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  if (!isMailConfigured()) {
    // Not an error. A deploy without a mail key should say so plainly once a
    // day rather than look like a broken cron.
    return NextResponse.json({ ok: true, skipped: "mail-not-configured" });
  }

  const app = getAdminApp();
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Not available." }, { status: 503 });

  const now = Date.now();
  // Monday, UTC. Chosen over Sunday because a week's summary lands better at
  // the start of a working week than in the middle of someone's weekend.
  const isMonday = new Date(now).getUTCDay() === 1;

  // `?only=` runs a single job, for exercising one of these by hand without
  // sending the other two. Development and an authenticated operator only —
  // getting here at all already required the cron credential.
  const only = req.nextUrl.searchParams.get("only") as Job | null;
  const wants = (job: Job) => (only ? only === job : true);

  const results: Partial<Record<Job, CampaignResult>> = {};

  try {
    if (wants("weekly") && (isMonday || only === "weekly")) {
      results.weekly = await runWeeklyDigest(app, db, now);
    }
    if (wants("streak")) {
      results.streak = await runStreakNudge(app, db, now);
    }
    if (wants("winback")) {
      results.winback = await runWinBack(app, db, now);
    }
  } catch (err) {
    // Partial results are still reported: knowing the digest went out and the
    // win-back died is much more useful than a bare 500.
    console.error("[cron] email run failed", err);
    return NextResponse.json({ ok: false, results }, { status: 500 });
  }

  const line = Object.entries(results)
    .map(([job, r]) => `${job}=${r.sent}/${r.candidates}`)
    .join(" ");
  console.info(`[cron] email run: ${line || "nothing due"}`);

  return NextResponse.json({ ok: true, results });
}
