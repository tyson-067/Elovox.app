import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { usageDateKey } from "@/lib/quota";

// Support tool: hand a user their day's attempts back. The refund paths in
// /api/analyze cover the failures it can see; this covers the ones it can't
// (a crash after reservation, a user emailing "it ate my attempt"), which
// otherwise meant editing Firestore by hand.
//
// POST {uid, date?} — zeroes dailyAnalyses and premiumAnalyses on that day's
// meter doc (default: today UTC). The doc itself is kept: firstAt stays, so
// the streak evidence in lib/streakReward.ts is untouched — this hands back
// ATTEMPTS, it never manufactures a practice day.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(30);

const UID_RE = /^[A-Za-z0-9]{1,128}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/usage", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed;
    }
  } catch {
    // falls through to validation below
  }
  const uid = typeof body.uid === "string" ? body.uid : "";
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }
  // Same ±1-day trust boundary as the meter itself: an arbitrary past date
  // would let a typo quietly zero a doc the streak scan still reads.
  const rawDate = typeof body.date === "string" ? body.date : "";
  const date = DATE_RE.test(rawDate) ? usageDateKey(rawDate) : usageDateKey("");

  const ref = db.doc(`users/${uid}/usage/${date}`);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { existed: false as const };
    const data = snap.data() ?? {};
    const before = {
      dailyAnalyses: Number(data.dailyAnalyses ?? 0),
      premiumAnalyses: Number(data.premiumAnalyses ?? 0),
    };
    tx.set(ref, { dailyAnalyses: 0, premiumAnalyses: 0 }, { merge: true });
    return { existed: true as const, before };
  });

  if (!outcome.existed) {
    return NextResponse.json({
      ok: true,
      date,
      note: "No meter doc for that day — nothing was spent, nothing to reset.",
    });
  }

  await recordAdminAction(db, {
    action: "usage.reset",
    actor: admin.email,
    targetUid: uid,
    detail: {
      date,
      hadDaily: outcome.before.dailyAnalyses,
      hadPremium: outcome.before.premiumAnalyses,
    },
  });

  return NextResponse.json({ ok: true, date, before: outcome.before });
}
