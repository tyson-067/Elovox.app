import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";

// Comped Premium, the operator version of the streak reward: a make-good for
// a billing hiccup, a tester account, a refund alternative. Same mechanism as
// lib/streakReward.ts on purpose — a timestamp on the plan doc, never the
// `plan` field (that mirrors Stripe and the webhook is its only writer, so a
// grant written there would be wiped by the next subscription event). The
// window expires by itself with nothing to cancel and no $0 invoice.
//
// POST   {uid, days}  → open/extend a window (days 1-90)
// DELETE {uid}        → close an open window early
//
// Both are audit-logged with the operator's identity. ADMIN_EMAILS gate,
// flat 404 for everyone else, like every /api/admin route.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(30);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_COMP_DAYS = 90;
const UID_RE = /^[A-Za-z0-9]{1,128}$/;

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/comp", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const body = await readBody(req);
  const uid = typeof body.uid === "string" ? body.uid : "";
  const days = Number(body.days);
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }
  if (!Number.isInteger(days) || days < 1 || days > MAX_COMP_DAYS) {
    return NextResponse.json(
      { error: `days must be a whole number from 1 to ${MAX_COMP_DAYS}.` },
      { status: 400 }
    );
  }

  const planRef = db.doc(`users/${uid}/profile/plan`);
  const now = Date.now();

  // Transaction for the same reason claimStreakReward uses one: two grants
  // landing together must extend one window, not race to overwrite it.
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(planRef);
    const data = snap.data() ?? {};
    // A live Stripe subscription already grants everything a comp would, and
    // stacking a window under it buys nothing until the subscription lapses —
    // at which point the operator can comp with a fresh, visible decision.
    if (data.plan === "premium") {
      return { granted: false as const, reason: "already-premium" as const };
    }
    const existing =
      typeof data.premiumUntil === "number" ? data.premiumUntil : 0;
    // Extend from whichever is later — an open window grows, a stale one is
    // ignored — so granting twice is additive rather than clobbering.
    const premiumUntil = Math.max(now, existing) + days * DAY_MS;
    tx.set(
      planRef,
      {
        premiumUntil,
        grantReason: "admin-comp",
        adminCompAt: now,
        adminCompBy: admin.email,
      },
      { merge: true }
    );
    return { granted: true as const, premiumUntil };
  });

  if (!outcome.granted) {
    return NextResponse.json(
      { error: "This account has a live subscription — nothing to comp." },
      { status: 409 }
    );
  }

  await recordAdminAction(db, {
    action: "comp.grant",
    actor: admin.email,
    targetUid: uid,
    detail: { days, premiumUntil: outcome.premiumUntil },
  });

  return NextResponse.json({ ok: true, premiumUntil: outcome.premiumUntil });
}

export async function DELETE(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/comp", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const body = await readBody(req);
  const uid = typeof body.uid === "string" ? body.uid : "";
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }

  const planRef = db.doc(`users/${uid}/profile/plan`);
  const now = Date.now();

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(planRef);
    const data = snap.data() ?? {};
    const until = typeof data.premiumUntil === "number" ? data.premiumUntil : 0;
    if (until <= now) {
      return { revoked: false as const };
    }
    // Close the window; leave streakRewardAnchor and the granted counter
    // alone so a revoked streak comp still can't be re-claimed off the same
    // 21 days.
    tx.set(
      planRef,
      {
        premiumUntil: FieldValue.delete(),
        grantReason: FieldValue.delete(),
      },
      { merge: true }
    );
    return { revoked: true as const, hadUntil: until };
  });

  if (!outcome.revoked) {
    return NextResponse.json(
      { error: "No open comp window on this account." },
      { status: 409 }
    );
  }

  await recordAdminAction(db, {
    action: "comp.revoke",
    actor: admin.email,
    targetUid: uid,
    detail: { hadUntil: outcome.hadUntil },
  });

  return NextResponse.json({ ok: true });
}
