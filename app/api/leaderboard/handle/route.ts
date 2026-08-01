import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser, makeRateLimiter } from "@/lib/verify";
import { checkHandle, setHandle } from "@/lib/leaderboardServer";

// Sets the name a user appears under on the leaderboard.
//
// This is a route rather than a client write because leaderboard/{uid} is
// deny-all in firestore.rules, and it has to be: everything else in that doc
// is server-computed, and a client that could write one field of it could
// write all of them. Validation therefore has to happen somewhere the user
// can't skip, which is here.

export const runtime = "nodejs";

// Renaming yourself is not something anyone does often. The limit is here so
// a script can't churn the row (and everyone else's view of it) in a loop.
const rateLimited = makeRateLimiter(20);

export async function POST(req: NextRequest) {
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available right now." }, { status: 503 });
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (rateLimited(uid)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Pick a name." }, { status: 400 });
  }

  const check = checkHandle((body as { handle?: unknown })?.handle);
  if (!check.ok) {
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
