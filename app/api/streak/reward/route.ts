import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser, makeRateLimiter } from "@/lib/verify";
import { claimStreakReward, STREAK_REWARD_DAYS } from "@/lib/streakReward";

// Claims the 21-day-streak comp week. The client calls this when its local
// streak counter looks like it qualifies, but that number is only a hint —
// everything that decides the outcome is re-derived here from the
// server-written usage docs. See lib/streakReward.ts for why.

export const runtime = "nodejs";

// A claim is a Firestore read of ~60 docs plus one transaction. Nothing
// expensive, but there's no reason for a user to call it more than a handful
// of times an hour.
const rateLimited = makeRateLimiter(10);

export async function POST(req: NextRequest) {
  const db = getAdminDb();
  if (!db) {
    // Without a service account there are no usage docs to check against, so
    // there is no honest answer. Never grant on a missing credential.
    console.error("[streak] FIREBASE_SERVICE_ACCOUNT unset, cannot verify streaks");
    return NextResponse.json({ error: "Not available right now." }, { status: 503 });
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (rateLimited(uid)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  try {
    const result = await claimStreakReward(db, uid);
    if (result.granted) {
      console.info(`[streak] comp week granted to ${uid} on a ${result.streakDays}-day streak`);
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[streak] claim failed", uid, err);
    return NextResponse.json(
      { error: `Couldn't check your ${STREAK_REWARD_DAYS}-day streak just now.` },
      { status: 500 }
    );
  }
}
