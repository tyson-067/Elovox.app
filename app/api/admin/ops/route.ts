import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  adminIdentity,
  adminEmailList,
  makeRateLimiter,
  clientIp,
} from "@/lib/verify";
import {
  recordAdminDenied,
  recordOpsEvent,
  purgeExpiredOpsEvents,
  invalidateOpsFlagsCache,
} from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";

// The Ops tab: pipeline health, security events, and the emergency brake.
//
// GET → the last 14 days of opsDaily counters (written best-effort by
// /api/analyze), the recent security-event log, the current flags, and the
// operator config worth eyeballing (who is on ADMIN_EMAILS, whether App
// Check is enforcing). Reading the events also schedules a purge of expired
// ones via after(), which is what keeps the privacy policy's "short
// operational window" true in practice.
//
// POST {pauseAnalyze} → flip the analyze kill switch (ops/flags). The flag is
// read FAIL-OPEN with a 60s per-instance cache on the analyze hot path, so:
// pausing takes up to a minute to reach every warm instance, and a Firestore
// outage can never pause the product on its own. Flag changes are both
// audit-logged and dropped into the event log.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(60);

export async function GET(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/ops", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const [dailySnap, eventsSnap, flagsSnap] = await Promise.all([
    // Doc ids are YYYY-MM-DD, so descending id order is descending date order
    // (same trick as lib/streakReward.ts).
    db
      .collection("opsDaily")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(14)
      .get(),
    db.collection("opsEvents").orderBy("at", "desc").limit(100).get(),
    db.doc("ops/flags").get(),
  ]);

  // Keep the "short operational window" promise without a cron: every look
  // at the Ops tab sweeps a batch of expired events, after the response.
  after(() => purgeExpiredOpsEvents(db));

  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

  const days = dailySnap.docs
    .map((d) => {
      const x = d.data();
      const avg = (sum: unknown, count: unknown) =>
        num(count) > 0 ? Math.round(num(sum) / num(count)) : null;
      return {
        date: d.id,
        runs: num(x.runs),
        ok: num(x.ok),
        noSpeech: num(x.noSpeech),
        unreadableAudio: num(x.unreadableAudio),
        transcribeFailed: num(x.transcribeFailed),
        modelFailed: num(x.modelFailed),
        paused: num(x.paused),
        premiumRuns: num(x.premiumRuns),
        cameraRuns: num(x.cameraRuns),
        avgTotalMs: avg(x.totalMsSum, x.totalMsCount),
        avgTranscribeMs: avg(x.transcribeMsSum, x.transcribeMsCount),
        avgModelMs: avg(x.modelMsSum, x.modelMsCount),
      };
    })
    .reverse(); // oldest → newest for charting

  const events = eventsSnap.docs.map((d) => {
    const e = d.data();
    return {
      id: d.id,
      type: typeof e.type === "string" ? e.type : "unknown",
      route: typeof e.route === "string" ? e.route : null,
      uid: typeof e.uid === "string" ? e.uid : null,
      ip: typeof e.ip === "string" ? e.ip : null,
      detail: typeof e.detail === "string" ? e.detail : null,
      at: num(e.at),
    };
  });

  const flags = flagsSnap.exists ? (flagsSnap.data() ?? {}) : {};

  return NextResponse.json(
    {
      generatedAt: Date.now(),
      days,
      events,
      flags: {
        pauseAnalyze: flags.pauseAnalyze === true,
        pauseCheckout: flags.pauseCheckout === true,
        banner: typeof flags.banner === "string" ? flags.banner : "",
      },
      flagsUpdatedBy:
        typeof flags.updatedBy === "string" ? flags.updatedBy : null,
      flagsUpdatedAt:
        typeof flags.updatedAt === "number" ? flags.updatedAt : null,
      config: {
        adminEmails: adminEmailList(),
        appCheckEnforced: process.env.APPCHECK_ENFORCE === "true",
      },
    },
    { headers: { "cache-control": "private, no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/ops", clientIp(req));
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
  // Partial updates: only the fields present are written, so flipping one
  // switch can't clobber another set from a different tab.
  const update: Record<string, unknown> = {};
  if (typeof body.pauseAnalyze === "boolean") {
    update.pauseAnalyze = body.pauseAnalyze;
  }
  if (typeof body.pauseCheckout === "boolean") {
    update.pauseCheckout = body.pauseCheckout;
  }
  if (typeof body.banner === "string") {
    // Plain text only: strip angle brackets outright and cap the length. The
    // banner renders as a text node, this is belt-and-braces, not the defense.
    update.banner = body.banner.replace(/[<>]/g, "").trim().slice(0, 140);
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "Nothing to change: send pauseAnalyze, pauseCheckout, or banner." },
      { status: 400 }
    );
  }

  await db.doc("ops/flags").set(
    { ...update, updatedBy: admin.email, updatedAt: Date.now() },
    { merge: true }
  );
  // This instance sees the change immediately; others converge within the
  // 60s cache window, which is fine for an emergency brake.
  invalidateOpsFlagsCache();

  const detailLine = Object.entries(update)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  await recordAdminAction(db, {
    action: "ops.flags",
    actor: admin.email,
    detail: Object.fromEntries(
      Object.entries(update).map(([k, v]) => [k, v as string | boolean])
    ),
  });
  await recordOpsEvent(db, {
    type: "flags-changed",
    route: "admin/ops",
    uid: admin.uid,
    detail: detailLine,
  });

  return NextResponse.json({ ok: true, updated: update });
}
