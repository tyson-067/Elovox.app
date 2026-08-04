import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getStripe } from "@/lib/stripe";
import { adminIdentity, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { refundUnusedPortion } from "@/lib/refunds";

// Operator subscription controls, for the support requests that arrive by
// email instead of through the Portal ("please cancel my subscription, I
// can't sign in"). Three actions, POST {uid, action}:
//
//   cancel_at_period_end — stop the next charge, access runs out its period.
//   resume               — undo a scheduled cancellation before it lands.
//   cancel_now_refund    — end access today AND refund the unused portion of
//                          the period to the CARD via lib/refunds.ts. Card,
//                          never Stripe credit — that's the house rule, and
//                          reusing the shared helper is what keeps it true.
//
// This route deliberately writes NOTHING to users/{uid}/profile/plan. The
// Stripe webhook is the only writer of that doc; every action here emits a
// customer.subscription.updated/deleted event and the webhook mirrors it
// within moments. Writing it here too would race the webhook and reintroduce
// exactly the drift that single-writer rule exists to prevent.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(20);

const UID_RE = /^[A-Za-z0-9]{1,128}$/;
const ACTIONS = ["cancel_at_period_end", "resume", "cancel_now_refund"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/subscription", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  const stripe = getStripe();
  if (!db || !stripe) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
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
  const action = body.action as Action;
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Bad action." }, { status: 400 });
  }

  const planSnap = await db.doc(`users/${uid}/profile/plan`).get();
  const subId = planSnap.data()?.stripeSubscriptionId as string | undefined;
  if (!subId) {
    return NextResponse.json(
      { error: "No Stripe subscription on record for this account." },
      { status: 409 }
    );
  }

  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(subId);
  } catch (err) {
    if ((err as { code?: string })?.code === "resource_missing") {
      return NextResponse.json(
        { error: "The recorded subscription no longer exists in Stripe." },
        { status: 409 }
      );
    }
    throw err;
  }

  if (action === "cancel_at_period_end") {
    if (sub.status === "canceled") {
      return NextResponse.json(
        { error: "Already canceled." },
        { status: 409 }
      );
    }
    const updated = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: true,
    });
    await recordAdminAction(db, {
      action: "subscription.cancel-at-period-end",
      actor: admin.email,
      targetUid: uid,
      detail: { subscriptionId: subId },
    });
    return NextResponse.json({
      ok: true,
      status: updated.status,
      cancelAtPeriodEnd: true,
      note: "The plan doc syncs via the Stripe webhook within a few moments.",
    });
  }

  if (action === "resume") {
    if (sub.status === "canceled") {
      return NextResponse.json(
        { error: "Already fully canceled — Stripe can't resume it." },
        { status: 409 }
      );
    }
    // Both spellings of "scheduled to stop": the boolean, and the explicit
    // cancel_at timestamp the Customer Portal sets. Clear whichever is there
    // (the webhook derives cancelAtPeriodEnd from the OR of the two).
    const updated = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: false,
      ...(sub.cancel_at != null ? { cancel_at: "" } : {}),
    });
    await recordAdminAction(db, {
      action: "subscription.resume",
      actor: admin.email,
      targetUid: uid,
      detail: { subscriptionId: subId },
    });
    return NextResponse.json({
      ok: true,
      status: updated.status,
      cancelAtPeriodEnd: false,
      note: "The plan doc syncs via the Stripe webhook within a few moments.",
    });
  }

  // cancel_now_refund. The pre-cancel subscription object is what the refund
  // helper needs (period bounds), same order as account deletion's step 1.
  if (sub.status === "canceled") {
    return NextResponse.json({ error: "Already canceled." }, { status: 409 });
  }
  try {
    await stripe.subscriptions.cancel(subId);
  } catch (err) {
    // Already gone means the money is already stopped — proceed to refund.
    if ((err as { code?: string })?.code !== "resource_missing") throw err;
  }
  await refundUnusedPortion(stripe, db, sub, {
    uid,
    context: "admin-cancel",
  });
  // The helper wrote its outcome (refunded, or resolved:false for follow-up)
  // to billingAlerts; surface that so the operator sees it without a tab hop.
  const alertSnap = await db.doc(`billingAlerts/unused-refund-${subId}`).get();
  const alert = alertSnap.exists ? alertSnap.data() : null;
  await recordAdminAction(db, {
    action: "subscription.cancel-now-refund",
    actor: admin.email,
    targetUid: uid,
    detail: {
      subscriptionId: subId,
      refundResolved: alert?.resolved === true,
      refundAmount: typeof alert?.amount === "number" ? alert.amount : null,
    },
  });
  return NextResponse.json({
    ok: true,
    status: "canceled",
    refund: alert
      ? {
          resolved: alert.resolved === true,
          amount: typeof alert.amount === "number" ? alert.amount : null,
          currency: typeof alert.currency === "string" ? alert.currency : null,
          error: typeof alert.error === "string" ? alert.error : null,
        }
      : // Nothing owed back (trial, or a fully-elapsed period) writes no alert.
        null,
    note: "The plan doc syncs via the Stripe webhook within a few moments.",
  });
}
