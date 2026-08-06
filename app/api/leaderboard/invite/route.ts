import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { getOrCreateInviteCode } from "@/lib/referral";

// The caller's invite code, minted on first ask and stable forever after —
// a link someone already sent has to keep working.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available right now." }, { status: 503 });
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (await limited(getAdminDb(), "leaderboard-invite", uid)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  try {
    const code = await getOrCreateInviteCode(db, uid);
    return NextResponse.json({ code });
  } catch (err) {
    console.error("[referral] code allocation failed", uid, err);
    return NextResponse.json({ error: "Couldn't make a link." }, { status: 500 });
  }
}
