import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { isAdmin, makeRateLimiter, clientIp } from "@/lib/verify";

// Operator dashboard numbers, computed from data Elovox already stores, no
// third-party analytics, no cookies, nothing that isn't already in Firestore
// and Firebase Auth. Answers the questions Vercel Analytics can't: how many
// accounts exist, how many convert to Premium, how many actually practise.
//
// Access is the ADMIN_EMAILS allow-list (see isAdmin). Unauthorized callers
// get a flat 404 rather than 403, so the endpoint's existence isn't
// advertised to anyone poking around.
//
// SCALE NOTE: this reads every user record and every recent session on each
// request, which is fine at launch scale (tens to low thousands) and is why
// it's cached for a minute below. Past that, move to a nightly aggregate doc
// rather than making this query bigger.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(60);

const DAY = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }
  if (!(await isAdmin(req))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const now = Date.now();
  const d7 = now - 7 * DAY;
  const d30 = now - 30 * DAY;

  // --- Accounts, from Firebase Auth ---------------------------------------
  const { getAuth } = await import("firebase-admin/auth");
  const auth = getAuth(app);

  let total = 0;
  let verified = 0;
  let google = 0;
  let password = 0;
  let new7 = 0;
  let new30 = 0;
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      total++;
      if (u.emailVerified) verified++;
      const providers = u.providerData.map((p) => p.providerId);
      if (providers.includes("google.com")) google++;
      if (providers.includes("password")) password++;
      const created = u.metadata.creationTime
        ? Date.parse(u.metadata.creationTime)
        : 0;
      if (created >= d7) new7++;
      if (created >= d30) new30++;
    }
    pageToken = page.pageToken;
  } while (pageToken);

  // --- Subscriptions, from the plan docs the webhook writes ----------------
  const plans = await db.collectionGroup("profile").get();
  let premium = 0;
  let trialing = 0;
  let activePaid = 0;
  let cancelling = 0;
  const byCycle: Record<string, number> = { weekly: 0, monthly: 0, annual: 0 };
  for (const doc of plans.docs) {
    if (doc.id !== "plan") continue;
    const d = doc.data();
    if (d.plan !== "premium") continue;
    premium++;
    if (d.status === "trialing") trialing++;
    if (d.status === "active") activePaid++;
    if (d.cancelAtPeriodEnd) cancelling++;
    if (typeof d.cycle === "string" && d.cycle in byCycle) byCycle[d.cycle]++;
  }

  // --- Practice activity, from the session records -------------------------
  // A single collectionGroup query beats walking users one at a time. The
  // date-filtered version needs a COLLECTION_GROUP_ASC index on createdAt
  // (see firestore.indexes.json); until that's deployed Firestore rejects it
  // with FAILED_PRECONDITION, so fall back to an unfiltered scan and filter
  // in memory. Slower and unbounded, but a dashboard that loads beats a 500.
  let recent;
  try {
    recent = await db
      .collectionGroup("sessions")
      .where("createdAt", ">=", d30)
      .get();
  } catch (err) {
    if ((err as { code?: number })?.code !== 9) throw err;
    console.warn(
      "[admin] sessions index missing, falling back to a full scan. Deploy firestore.indexes.json."
    );
    recent = await db.collectionGroup("sessions").get();
  }

  const active7 = new Set<string>();
  const active30 = new Set<string>();
  let sessions7 = 0;
  // Counted rather than taken from recent.size: on the fallback path above the
  // snapshot holds every session ever, not just the last 30 days.
  let sessions30 = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let withVideo = 0;
  for (const doc of recent.docs) {
    // users/{uid}/sessions/{id}, the uid is the grandparent document.
    const uid = doc.ref.parent.parent?.id;
    const d = doc.data();
    const created = typeof d.createdAt === "number" ? d.createdAt : 0;
    if (created < d30) continue;
    sessions30++;
    if (uid) active30.add(uid);
    if (created >= d7) {
      sessions7++;
      if (uid) active7.add(uid);
    }
    const overall = d.analysis?.overall;
    if (typeof overall === "number") {
      scoreSum += overall;
      scoreCount++;
    }
    if (d.withVideo) withVideo++;
  }

  const pct = (n: number, of: number) =>
    of === 0 ? 0 : Math.round((n / of) * 1000) / 10;

  return NextResponse.json(
    {
      generatedAt: now,
      accounts: {
        total,
        verified,
        unverified: total - verified,
        verifiedPct: pct(verified, total),
        newLast7: new7,
        newLast30: new30,
        viaGoogle: google,
        viaPassword: password,
      },
      subscriptions: {
        premium,
        trialing,
        activePaid,
        cancelling,
        byCycle,
        conversionPct: pct(premium, total),
      },
      activity: {
        activeLast7: active7.size,
        activeLast30: active30.size,
        sessionsLast7: sessions7,
        sessionsLast30: sessions30,
        avgSessionsPerActive7:
          active7.size === 0
            ? 0
            : Math.round((sessions7 / active7.size) * 10) / 10,
        avgScore: scoreCount === 0 ? null : Math.round(scoreSum / scoreCount),
        withVideoLast30: withVideo,
      },
    },
    {
      headers: {
        // Aggregate business data, never let a proxy hold a copy, and give
        // the browser a short window so a refresh doesn't re-run the scan.
        "cache-control": "private, max-age=60",
      },
    }
  );
}
