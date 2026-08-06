import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { seedCoins } from "@/lib/coins";

// Operator coin adjustment: a make-good for a shop bug, a community prize.
// POST {uid, delta} — positive grants, negative corrects, balance floors at 0.
//
// Runs as a transaction on users/{uid}/score/progress with the SAME balance
// rule as lib/coinsServer.ts: before coinsSeeded, the spendable balance is
// derived from XP (seedCoins), so an adjustment must materialize that seed
// first or the write would be invisible — balanceOf ignores `coins` until
// the flag is set, and the next awardXp would recompute the seed over it.
//
// NEVER creates the progress doc. Its non-existence is a signal three other
// systems rely on (backfill, referral bonus, invite redemption — see the
// header of lib/coinsServer.ts equip()); an account that has never scored
// has no balance to adjust.

export const runtime = "nodejs";

const UID_RE = /^[A-Za-z0-9]{1,128}$/;
const MAX_ABS_DELTA = 100_000;

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/coins", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-coins", admin.uid)) {
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
  const delta = Number(body.delta);
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }
  if (
    !Number.isInteger(delta) ||
    delta === 0 ||
    Math.abs(delta) > MAX_ABS_DELTA
  ) {
    return NextResponse.json(
      { error: `delta must be a nonzero whole number within ±${MAX_ABS_DELTA}.` },
      { status: 400 }
    );
  }

  const ref = db.doc(`users/${uid}/score/progress`);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const };
    const prev = snap.data() ?? {};
    const xp = typeof prev.xp === "number" ? prev.xp : 0;
    const before = prev.coinsSeeded
      ? Number(prev.coins ?? 0)
      : seedCoins(xp);
    const after = Math.max(0, before + delta);
    tx.set(
      ref,
      {
        coins: after,
        coinsSeeded: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true as const, before, after };
  });

  if (!outcome.ok) {
    return NextResponse.json(
      {
        error:
          "This account hasn't scored a session yet, so it has no coin balance to adjust.",
      },
      { status: 409 }
    );
  }

  await recordAdminAction(db, {
    action: "coins.adjust",
    actor: admin.email,
    targetUid: uid,
    detail: { delta, before: outcome.before, after: outcome.after },
  });

  return NextResponse.json({
    ok: true,
    before: outcome.before,
    after: outcome.after,
  });
}
