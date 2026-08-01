import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser, makeRateLimiter } from "@/lib/verify";
import { normalizeCode, redeemInvite } from "@/lib/referral";

// Redeems an invite code for the signed-in account: records who invited them
// and makes the two of them friends. Pays no XP — that happens on the
// invitee's first scored session, from inside the analysis pipeline, where
// the client can't reach it.

export const runtime = "nodejs";

// A tight limit: this is the endpoint someone would point a script at to
// guess codes. Eight characters from a 31-letter alphabet is ~8.5e11
// combinations, so guessing is hopeless anyway, but there's no reason to
// serve the attempt.
const rateLimited = makeRateLimiter(10);

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
    return NextResponse.json({ error: "No code." }, { status: 400 });
  }

  const code = normalizeCode((body as { code?: unknown })?.code);
  if (!code) {
    return NextResponse.json({ error: "That invite link isn't valid." }, { status: 400 });
  }

  try {
    const result = await redeemInvite(db, uid, code);
    if (!result.ok) {
      // 200, not an error status. Every one of these outcomes is ordinary
      // (already redeemed, own link, established account) and the client
      // treats them all the same way: stop asking, say nothing loud.
      return NextResponse.json({ redeemed: false, reason: result.reason });
    }
    return NextResponse.json({ redeemed: true });
  } catch (err) {
    console.error("[referral] redeem failed", uid, err);
    return NextResponse.json({ error: "Couldn't use that link." }, { status: 500 });
  }
}
