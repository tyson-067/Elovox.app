import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser, makeRateLimiter } from "@/lib/verify";
import { equip, purchase } from "@/lib/coinsServer";

// Buying and wearing Felix's things.
//
// A route rather than a client write, for the same reason as
// /api/leaderboard/handle: the doc it changes (users/{uid}/score/progress) is
// deny-all to clients in firestore.rules and has to stay that way, because a
// client that could write one field of it could write its XP. So the price
// check, the balance check and the ownership check all happen here, where the
// user can't skip them.

export const runtime = "nodejs";

// Generous — the shop is a few taps, and someone trying on outfits is not an
// attack. It's here so a script can't hammer a transaction on a hot doc.
const rateLimited = makeRateLimiter(120);

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

  let body: { action?: unknown; item?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const item = typeof body.item === "string" ? body.item : null;

  try {
    if (body.action === "equip") {
      const kind = body.kind === "biome" ? "biome" : "accessory";
      // A null item is "take it off", which is a legitimate thing to ask for
      // and must not be read as a missing field.
      const result = await equip(db, uid, item, kind);
      if (!result.ok) {
        return NextResponse.json(
          {
            error:
              result.reason === "not-owned"
                ? "You don't own that yet."
                : "Never heard of that one.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json(result);
    }

    if (body.action === "buy") {
      if (!item) {
        return NextResponse.json({ error: "Pick something." }, { status: 400 });
      }
      const result = await purchase(db, uid, item);
      if (!result.ok) {
        const message =
          result.reason === "not-enough-coins"
            ? `That costs ${result.price} coins. You have ${result.coins}.`
            : result.reason === "already-owned"
              ? "You already have that."
              : "Never heard of that one.";
        // 400, not 402: "not enough coins" is a state the UI already knows
        // how to show, and a payment status code here would look like Stripe.
        return NextResponse.json({ error: message, ...result }, { status: 400 });
      }
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  } catch (err) {
    console.error("[shop] failed", uid, body.action, err);
    return NextResponse.json({ error: "Couldn't do that." }, { status: 500 });
  }
}
