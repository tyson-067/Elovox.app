import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { usageDateKey } from "@/lib/quota";
import { seedCoins } from "@/lib/coins";
import { levelFromXp } from "@/lib/levels";
import { getModerationStatus, effectiveState } from "@/lib/moderation";

// One account's operational detail, for the drawer behind a row click on the
// /admin user list: auth record, billing terms, server progress, today's
// meter, and session METADATA (a count and a last-practiced date).
//
// THE LINE THIS ROUTE MUST NEVER CROSS: account and operational metadata only,
// no practice content. /dmca promises recordings, transcripts and briefs are
// "private to your own account and never shown to anyone else", and /terms
// grants processing "for one purpose only: producing your feedback and your
// practice history" — so no transcript, no report, no per-session scores ever
// leaves this endpoint. Counts and dates are how the account behaves;
// contents are what the user said. Only the first is operations.
//
// Same access story as the rest of /api/admin: ADMIN_EMAILS allow-list, flat
// 404 for everyone else, response marked private.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(120);

const UID_RE = /^[A-Za-z0-9]{1,128}$/;

export async function GET(req: NextRequest) {
  // isAdmin FIRST, same reasoning as /api/admin/stats: an anonymous caller
  // must not be able to tell a busy real route from a missing one.
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/user", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const uid = new URL(req.url).searchParams.get("uid") ?? "";
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }

  const { getAuth } = await import("firebase-admin/auth");
  let user;
  try {
    user = await getAuth(app).getUser(uid);
  } catch (err) {
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      return NextResponse.json({ error: "No such account." }, { status: 404 });
    }
    throw err;
  }

  const today = usageDateKey("");
  const [planSnap, progressSnap, rowSnap, usageSnap, lastSessionSnap, countSnap, moderation] =
    await Promise.all([
      db.doc(`users/${uid}/profile/plan`).get(),
      db.doc(`users/${uid}/score/progress`).get(),
      db.doc(`leaderboard/${uid}`).get(),
      db.doc(`users/${uid}/usage/${today}`).get(),
      db
        .collection(`users/${uid}/sessions`)
        .orderBy("createdAt", "desc")
        .limit(1)
        .select("createdAt")
        .get(),
      // Count only: an empty projection returns refs without payload, so even
      // a heavy account costs bandwidth-nothing. Capped — the drawer says
      // "2000+", it doesn't need the exact figure past that.
      db.collection(`users/${uid}/sessions`).select().limit(2001).get(),
      getModerationStatus(db, uid),
    ]);

  const plan = planSnap.exists ? (planSnap.data() ?? {}) : {};
  const progress = progressSnap.exists ? (progressSnap.data() ?? {}) : null;
  const usage = usageSnap.exists ? (usageSnap.data() ?? {}) : {};

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" ? v : null;

  // Displayed balance follows the same rule as lib/coinsServer.ts balanceOf:
  // before the seed flag is set, the real spendable balance is derived from
  // XP, not from the (absent) coins field.
  const xp = num(progress?.xp) ?? 0;
  const coins =
    progress === null
      ? null
      : progress.coinsSeeded
        ? (num(progress.coins) ?? 0)
        : seedCoins(xp);

  const sessionCount = countSnap.docs.length;
  const lastSession = lastSessionSnap.docs[0]?.data();

  return NextResponse.json(
    {
      generatedAt: Date.now(),
      account: {
        uid,
        name: user.displayName ?? null,
        email: user.email ?? null,
        verified: user.emailVerified,
        disabled: user.disabled,
        createdAt: user.metadata.creationTime
          ? Date.parse(user.metadata.creationTime)
          : null,
        lastSignInAt: user.metadata.lastSignInTime
          ? Date.parse(user.metadata.lastSignInTime)
          : null,
        providers: user.providerData.map((p) => p.providerId),
      },
      plan: {
        plan: strOrNull(plan.plan) ?? "free",
        status: strOrNull(plan.status),
        cycle: strOrNull(plan.cycle),
        since: num(plan.since),
        trialEnd: num(plan.trialEnd),
        currentPeriodEnd: num(plan.currentPeriodEnd),
        cancelAtPeriodEnd: plan.cancelAtPeriodEnd === true,
        cancelAt: num(plan.cancelAt),
        premiumUntil: num(plan.premiumUntil),
        grantReason: strOrNull(plan.grantReason),
        stripeCustomerId: strOrNull(plan.stripeCustomerId),
        stripeSubscriptionId: strOrNull(plan.stripeSubscriptionId),
      },
      progress: progress
        ? {
            exists: true,
            xp,
            level: levelFromXp(xp).level,
            coins,
            coinsSeeded: progress.coinsSeeded === true,
            streakDays: num(progress.streakDays) ?? 0,
            longestStreak: num(progress.longestStreak) ?? 0,
            challengesCompleted: num(progress.challengesCompleted) ?? 0,
          }
        : { exists: false },
      sessions: {
        count: Math.min(sessionCount, 2000),
        countCapped: sessionCount > 2000,
        lastAt: num(lastSession?.createdAt),
      },
      usageToday: {
        date: today,
        dailyAnalyses: num(usage.dailyAnalyses) ?? 0,
        premiumAnalyses: num(usage.premiumAnalyses) ?? 0,
      },
      leaderboard: {
        handle: strOrNull(rowSnap.data()?.handle),
      },
      moderation: {
        strikes: moderation?.strikes ?? 0,
        state: effectiveState(moderation),
        suspendedUntil: moderation?.suspendedUntil ?? null,
      },
    },
    { headers: { "cache-control": "private, no-store" } }
  );
}
