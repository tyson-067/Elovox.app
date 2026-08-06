import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { foldHandle } from "@/lib/leaderboardServer";

// Moderation for the ONE user-authored thing strangers can see: the
// leaderboard handle. /dmca is explicit that everything else a user creates
// is private to their own account and "the one thing other users can see is
// the display name you pick for the leaderboard" — which makes this the one
// moderation surface that needs no new policy language at all.
//
// GET → the public board, exactly what any signed-in user can already read.
// POST {uid, action:"clear-handle"} → drop an offensive handle. The row
// reverts to the designed anonymous rendering (publishRow never writes a
// handle, so a row without one is "an anonymous speaker", ranks intact), and
// the handles/{folded} reservation is released in the same transaction so
// the name isn't stranded forever — the same pairing setHandle maintains.

export const runtime = "nodejs";

const UID_RE = /^[A-Za-z0-9]{1,128}$/;

export async function GET(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/leaderboard", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-leaderboard", clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const snap = await db
    .collection("leaderboard")
    .orderBy("xp", "desc")
    .limit(200)
    .get();
  const rows = snap.docs.map((d) => {
    const r = d.data();
    return {
      uid: d.id,
      handle: typeof r.handle === "string" ? r.handle : null,
      xp: typeof r.xp === "number" ? r.xp : 0,
      level: typeof r.level === "number" ? r.level : 0,
      streakDays: typeof r.streakDays === "number" ? r.streakDays : 0,
    };
  });

  return NextResponse.json(
    { generatedAt: Date.now(), rows },
    { headers: { "cache-control": "private, max-age=60" } }
  );
}

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/leaderboard", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-leaderboard", admin.uid)) {
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
  if (!UID_RE.test(uid) || body.action !== "clear-handle") {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const rowRef = db.doc(`leaderboard/${uid}`);
  const outcome = await db.runTransaction(async (tx) => {
    const row = await tx.get(rowRef);
    const handle = row.data()?.handle;
    if (typeof handle !== "string" || !handle) {
      return { cleared: false as const };
    }
    // Release the reservation with the row edit, atomically — the same
    // invariant setHandle keeps, from the other direction.
    const folded = foldHandle(handle);
    if (folded) tx.delete(db.doc(`handles/${folded}`));
    tx.set(
      rowRef,
      { handle: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { cleared: true as const, handle };
  });

  if (!outcome.cleared) {
    return NextResponse.json(
      { error: "That row has no handle to clear." },
      { status: 409 }
    );
  }

  await recordAdminAction(db, {
    action: "leaderboard.clear-handle",
    actor: admin.email,
    targetUid: uid,
    detail: { hadHandle: outcome.handle },
  });

  return NextResponse.json({ ok: true });
}
