import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser, logRejectedInput } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { checkHandle, setHandle } from "@/lib/leaderboardServer";
import { isRestricted } from "@/lib/moderation";
import { readJsonObject } from "@/lib/requestBody";

// Sets the name a user appears under on the leaderboard.
//
// This is a route rather than a client write because leaderboard/{uid} is
// deny-all in firestore.rules, and it has to be: everything else in that doc
// is server-computed, and a client that could write one field of it could
// write all of them. Validation therefore has to happen somewhere the user
// can't skip, which is here.

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
  if (await limited(getAdminDb(), "leaderboard-handle", uid)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  // The handle is the one thing strangers see, so a suspended or banned
  // account doesn't get to change it (an operator may have JUST cleared an
  // offensive one — see /api/admin/leaderboard). Fail-open on read trouble,
  // same as every moderation check.
  const restriction = await isRestricted(db, uid);
  if (restriction.blocked) {
    return NextResponse.json(
      { error: "Your account can't change its public name right now." },
      { status: 403 }
    );
  }

  const parsed = await readJsonObject(req);
  if (!parsed.ok) {
    logRejectedInput("leaderboard/handle", parsed.reason);
    return NextResponse.json({ error: "Pick a name." }, { status: 400 });
  }

  const check = checkHandle(parsed.body.handle);
  if (!check.ok) {
    logRejectedInput("leaderboard/handle", "bad-handle");
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  try {
    const claimed = await setHandle(db, uid, check.handle);
    if (!claimed) {
      return NextResponse.json(
        { error: "Someone's already using that name. Try another." },
        { status: 409 }
      );
    }
    return NextResponse.json({ handle: check.handle });
  } catch (err) {
    console.error("[leaderboard] setHandle failed", uid, err);
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }
}
