import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  verifyUser,
  makeRateLimiter,
  isPremiumServer,
  logRejectedInput,
} from "@/lib/verify";
import { usageDateKey, reserveMeteredUse, refundMeteredUse } from "@/lib/quota";

// Deletes one practice session from the user's history, with a reason, under
// a small daily cap. The cap is why this is a route at all: sessions are
// owner-writable, but client-side deletes can't be counted, so
// firestore.rules now denies client deletes and this is the only door.
//
// Why cap deletions at all: history curation. Deleting every bad take turns
// the progress chart and session list into a highlight reel, and (for the
// daily) hides the attempts the shared challenge was scored across. One a
// day for free (three for Premium, who simply have more attempts to manage —
// the difference is deliberately NOT advertised anywhere) keeps deletion for
// "that one was noise", not "prune everything under 80".
//
// What deletion does NOT do, all deliberate:
//   - No XP/coin clawback. The rep happened; score/progress is a ledger.
//   - No daily-attempt refund. Deleting a daily's record doesn't hand the
//     attempt back, or deletes become free retries.
//   - The reason goes to `sessionDeletions` (deny-all to clients), which is
//     product feedback, not surveillance: it's why the delete happened.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(20); // per user per hour, above any cap

const REASONS = new Set([
  "mic-test",
  "interrupted",
  "wrong-scenario",
  "privacy",
  "other",
]);

const DELETES_PER_DAY_FREE = 1;
const DELETES_PER_DAY_PREMIUM = 3;

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (rateLimited(uid)) {
    return NextResponse.json(
      { error: "Too many requests. Give it a moment." },
      { status: 429 }
    );
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Deleting isn't available right now." },
      { status: 503 }
    );
  }

  let sessionId = "";
  let reason = "";
  try {
    const body = await req.json();
    sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    reason = typeof body.reason === "string" ? body.reason : "";
  } catch {
    // fall through to the checks below
  }
  // Doc ids are client-minted (base36 + random); bound and sanity-check
  // rather than pattern-match so older ids never become undeletable. The
  // three excluded shapes are Firestore-RESERVED ids ("." / ".." / "__x__")
  // that throw INVALID_ARGUMENT at db.doc() — a real base36 id is never any
  // of them, so nothing legitimate becomes undeletable, and a crafted one is
  // a clean 400 instead of an unhandled 500.
  if (
    !sessionId ||
    sessionId.length > 64 ||
    sessionId.includes("/") ||
    sessionId === "." ||
    sessionId === ".." ||
    /^__.*__$/.test(sessionId)
  ) {
    logRejectedInput("session/delete", "bad-session-id");
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!REASONS.has(reason)) {
    logRejectedInput("session/delete", "bad-reason");
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Confirm it exists before spending a metered delete on it.
  const ref = db.doc(`users/${uid}/sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "That session is already gone." }, { status: 404 });
  }

  const entitlement = await isPremiumServer(req, uid);
  const ceiling =
    entitlement === "premium" ? DELETES_PER_DAY_PREMIUM : DELETES_PER_DAY_FREE;

  const date = usageDateKey("");
  const { ok } = await reserveMeteredUse(db, uid, date, "sessionDeletes", ceiling);
  if (!ok) {
    // Same message for both plans: the cap difference is not a selling point.
    return NextResponse.json(
      {
        error: "delete-limit",
        message: "You've used today's delete. It comes back tomorrow.",
      },
      { status: 429 }
    );
  }

  try {
    const data = snap.data() ?? {};
    await ref.delete();
    // Why people delete is the product signal; keep it lean and off-client.
    await db
      .collection("sessionDeletions")
      .add({
        uid,
        sessionId,
        reason,
        mode: data.mode ?? null,
        category: data.category ?? null,
        overall: data.analysis?.overall ?? null,
        at: Date.now(),
      })
      .catch(() => {}); // losing the reason must not fail the delete
  } catch (err) {
    console.error("[session-delete] failed", uid, sessionId, err);
    await refundMeteredUse(db, uid, date, "sessionDeletes");
    return NextResponse.json(
      { error: "Couldn't delete that just now. Try again in a moment." },
      { status: 503 }
    );
  }

  return NextResponse.json({ deleted: true });
}
