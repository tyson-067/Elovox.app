import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { isAdmin, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { PLANS, perMonth, type BillingCycle } from "@/lib/pricing";
import { seedCoins } from "@/lib/coins";

// Operator dashboard numbers, computed from data Elovox already stores, no
// third-party analytics, no cookies, nothing that isn't already in Firestore
// and Firebase Auth. Answers the questions Vercel Analytics can't: how many
// accounts exist, how many convert to Premium, how many actually practice.
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
  // isAdmin FIRST. The 503 and 429 branches used to run ahead of it, so an
  // anonymous visitor could tell the difference between "no such route" and
  // "a real route that is busy or unconfigured" — the client maps only 404 to
  // "denied", so anything else rendered a real error message and confirmed
  // /admin exists. That is exactly what the flat-404 design is for.
  if (!(await isAdmin(req))) {
    await recordAdminDenied(getAdminDb(), "admin/stats", clientIp(req));
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

  const now = Date.now();
  const d7 = now - 7 * DAY;
  const d30 = now - 30 * DAY;

  // --- Accounts, from Firebase Auth ---------------------------------------
  const { getAuth } = await import("firebase-admin/auth");
  const auth = getAuth(app);

  // Day keys for the 30-day growth series, oldest → newest, zero-filled so
  // the charts render a bar per day rather than skipping quiet ones.
  const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const seriesDays: string[] = [];
  for (let i = 29; i >= 0; i--) seriesDays.push(dayKey(now - i * DAY));
  const signupsByDay = new Map<string, number>(seriesDays.map((d) => [d, 0]));
  const sessionsByDay = new Map<string, number>(seriesDays.map((d) => [d, 0]));

  let total = 0;
  let verified = 0;
  let google = 0;
  let password = 0;
  let new7 = 0;
  let new30 = 0;
  let disabled = 0;
  // uid → created, for the retention join against the sessions scan below.
  // Launch-scale memory (a few bytes per account), same posture as the scans.
  const createdByUid = new Map<string, number>();
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      total++;
      if (u.emailVerified) verified++;
      if (u.disabled) disabled++;
      const providers = u.providerData.map((p) => p.providerId);
      if (providers.includes("google.com")) google++;
      if (providers.includes("password")) password++;
      const created = u.metadata.creationTime
        ? Date.parse(u.metadata.creationTime)
        : 0;
      createdByUid.set(u.uid, created);
      if (created >= d7) new7++;
      if (created >= d30) new30++;
      if (created >= d30) {
        const key = dayKey(created);
        if (signupsByDay.has(key)) {
          signupsByDay.set(key, (signupsByDay.get(key) ?? 0) + 1);
        }
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  // --- Subscriptions, from the plan docs the webhook writes ----------------
  const plans = await db.collectionGroup("profile").get();
  let premium = 0;
  let trialing = 0;
  let activePaid = 0;
  let canceling = 0;
  const byCycle: Record<string, number> = { weekly: 0, monthly: 0, annual: 0 };
  // Cycle counts for ACTIVE paid subscriptions only — the revenue estimate's
  // denominator. Trials and comps are premium but not (yet) revenue.
  const activeByCycle: Record<string, number> = { weekly: 0, monthly: 0, annual: 0 };
  let comped = 0;
  for (const doc of plans.docs) {
    if (doc.id !== "plan") continue;
    const d = doc.data();
    // Entitlement is `plan === "premium"` OR an open `premiumUntil` window —
    // the 21-day streak reward grants the latter and deliberately never sets
    // `plan` (lib/streakReward.ts). Counting only `plan` made this tile
    // disagree with the Users table on the same screen, and with the app
    // itself, about who is Premium. Same rule as lib/plan.ts entitlementFrom.
    const paid = d.plan === "premium";
    const comp = typeof d.premiumUntil === "number" && d.premiumUntil > now;
    if (!paid && !comp) continue;
    premium++;
    if (comp && !paid) comped++;
    if (d.status === "trialing") trialing++;
    if (d.status === "active") activePaid++;
    if (d.cancelAtPeriodEnd) canceling++;
    if (typeof d.cycle === "string" && d.cycle in byCycle) {
      byCycle[d.cycle]++;
      if (paid && d.status === "active") activeByCycle[d.cycle]++;
    }
  }

  // Estimated recurring revenue from LIST prices (lib/pricing.ts) × active
  // paid subscriptions per cycle. An estimate on purpose: Stripe is the book
  // of record for actual money (discounts, taxes, currency), and this tile
  // says so — it answers "roughly what does the subscriber base bill per
  // month", not "what did we earn".
  const estMrr =
    Math.round(
      PLANS.reduce(
        (sum, p) =>
          sum + perMonth(p) * (activeByCycle[p.cycle as BillingCycle] ?? 0),
        0
      ) * 100
    ) / 100;
  const estArr = Math.round(estMrr * 12 * 100) / 100;

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
    {
      const key = dayKey(created);
      if (sessionsByDay.has(key)) {
        sessionsByDay.set(key, (sessionsByDay.get(key) ?? 0) + 1);
      }
    }
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

  // --- Retention, from data already in hand --------------------------------
  // Honest proxies, not a cohort engine: "of accounts old enough to have
  // settled in (7-30 days), how many practiced this week", and "of this
  // week's signups, how many actually recorded something". Both are the
  // numbers that say whether the product keeps people, at launch scale, with
  // zero extra reads.
  let settledCohort = 0; // accounts created 7-30 days ago
  let settledRetained = 0; // …of those, practiced in the last 7 days
  let activation7 = 0; // accounts created this week that already practiced
  for (const [uid, created] of createdByUid) {
    if (created > 0 && created < d7 && created >= d30) {
      settledCohort++;
      if (active7.has(uid)) settledRetained++;
    }
    if (created >= d7 && active7.has(uid)) activation7++;
  }

  // --- Economy & engagement, from the server progress docs -----------------
  // One collection-group scan of users/{uid}/score/progress (the same trick
  // as the plan scan above; the group also matches score/invite docs, so
  // filter on the doc id). Everything aggregate: totals and distributions,
  // never a per-user number leaving this route.
  let rankedAccounts = 0;
  let coinsCirculating = 0;
  let purchasesTotal = 0;
  const purchasesByItem: Record<string, number> = {};
  const streakBuckets = { none: 0, warming: 0, solid: 0, onFire: 0 };
  let longestStreakEver = 0;
  const scoreDocs = await db.collectionGroup("score").get();
  for (const doc of scoreDocs.docs) {
    if (doc.id !== "progress") continue;
    const d = doc.data();
    rankedAccounts++;
    const xp = typeof d.xp === "number" ? d.xp : 0;
    // Same balance rule as lib/coinsServer.ts: pre-seed accounts' spendable
    // balance derives from XP.
    coinsCirculating += d.coinsSeeded
      ? Number(d.coins ?? 0)
      : seedCoins(xp);
    if (Array.isArray(d.purchased)) {
      purchasesTotal += d.purchased.length;
      for (const item of d.purchased) {
        if (typeof item === "string") {
          purchasesByItem[item] = (purchasesByItem[item] ?? 0) + 1;
        }
      }
    }
    const streak = Number(d.streakDays ?? 0);
    if (streak >= 21) streakBuckets.onFire++;
    else if (streak >= 7) streakBuckets.solid++;
    else if (streak >= 1) streakBuckets.warming++;
    else streakBuckets.none++;
    longestStreakEver = Math.max(
      longestStreakEver,
      Number(d.longestStreak ?? 0)
    );
  }
  const topItems = Object.entries(purchasesByItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([item, count]) => ({ item, count }));

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
        disabled,
      },
      subscriptions: {
        premium,
        // Of `premium`, how many hold it on a comp window rather than a
        // subscription — so the tile can't be mistaken for revenue.
        comped,
        trialing,
        activePaid,
        canceling,
        byCycle,
        conversionPct: pct(premium, total),
      },
      revenue: {
        estMrr,
        estArr,
        activeByCycle,
        note: "List-price estimate; Stripe is the book of record.",
      },
      series: {
        signupsByDay: seriesDays.map((date) => ({
          date,
          count: signupsByDay.get(date) ?? 0,
        })),
        sessionsByDay: seriesDays.map((date) => ({
          date,
          count: sessionsByDay.get(date) ?? 0,
        })),
      },
      retention: {
        // Of accounts old enough to have settled in (created 7-30d ago), the
        // share that practiced this week.
        settledCohort,
        settledRetained,
        settledRetainedPct: pct(settledRetained, settledCohort),
        // Of this week's signups, the share that actually recorded something.
        activation7,
        activationPct: pct(activation7, new7),
      },
      engagement: {
        rankedAccounts,
        coinsCirculating,
        purchasesTotal,
        topItems,
        streakBuckets,
        longestStreakEver,
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
