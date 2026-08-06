import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getStripe } from "@/lib/stripe";
import { adminIdentity, clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { refundUnusedPortion } from "@/lib/refunds";

// The billing-alerts queue. lib/refunds.ts and the webhook have been writing
// `billingAlerts` docs "for manual follow-up" since they shipped — a failed
// refund is money OWED to a user, parked with resolved:false — but until this
// route existed no surface ever read them, so a failure was only ever found
// by opening Firestore by hand. This is the queue those docs were always
// meant to land in.
//
// GET → the most recent alerts (unresolved first in the UI).
// POST {id, action}:
//   retry     — for an unresolved unused-portion refund: re-retrieve the
//               subscription and run the SAME refundUnusedPortion helper.
//               Safe by construction: idempotent on the sub id at both ends
//               (Stripe idempotency key + keyed alert doc), card-only by the
//               same shared code path.
//   resolve   — mark handled (e.g. settled by hand in the Stripe dashboard).
//   unresolve — reopen one closed by mistake.

export const runtime = "nodejs";

// Doc ids here are subscription-derived ("unused-refund-sub_x", "sub_x") but
// validate like the leads route does before handing anything to db.doc():
// no path separators, no reserved __id__ forms.
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

export async function GET(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/billing", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-billing", clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  // Newest 200 by `at`, filtered in memory — alert volume is tiny (one per
  // billing anomaly), so this avoids a composite index for resolved+at.
  const snap = await db
    .collection("billingAlerts")
    .orderBy("at", "desc")
    .limit(200)
    .get();
  const alerts = snap.docs.map((d) => {
    const a = d.data();
    return {
      id: d.id,
      kind: typeof a.kind === "string" ? a.kind : "unknown",
      context: typeof a.context === "string" ? a.context : null,
      uid: typeof a.uid === "string" ? a.uid : null,
      subscriptionId:
        typeof a.subscriptionId === "string"
          ? a.subscriptionId
          : typeof a.canceledSubId === "string"
            ? a.canceledSubId
            : null,
      customerId: typeof a.customerId === "string" ? a.customerId : null,
      amount: typeof a.amount === "number" ? a.amount : null,
      currency: typeof a.currency === "string" ? a.currency : null,
      refundId: typeof a.refundId === "string" ? a.refundId : null,
      error: typeof a.error === "string" ? a.error : null,
      resolved: a.resolved === true,
      at: typeof a.at === "number" ? a.at : null,
    };
  });

  return NextResponse.json(
    {
      generatedAt: Date.now(),
      alerts,
      unresolved: alerts.filter((a) => !a.resolved).length,
    },
    { headers: { "cache-control": "private, no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/billing", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-billing", admin.uid)) {
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
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action;
  if (!ID_RE.test(id) || /^__.*__$/.test(id)) {
    return NextResponse.json({ error: "Bad alert id." }, { status: 400 });
  }
  if (action !== "resolve" && action !== "unresolve" && action !== "retry") {
    return NextResponse.json({ error: "Bad action." }, { status: 400 });
  }

  const ref = db.doc(`billingAlerts/${id}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "No such alert." }, { status: 404 });
  }
  const alert = snap.data() ?? {};

  if (action === "resolve" || action === "unresolve") {
    await ref.set(
      {
        resolved: action === "resolve",
        resolvedBy: admin.email,
        resolvedAt: Date.now(),
      },
      { merge: true }
    );
    await recordAdminAction(db, {
      action: `billing.${action}`,
      actor: admin.email,
      targetUid: typeof alert.uid === "string" ? alert.uid : undefined,
      detail: { alertId: id },
    });
    return NextResponse.json({ ok: true, resolved: action === "resolve" });
  }

  // retry
  if (alert.kind !== "unused-portion-refund") {
    return NextResponse.json(
      { error: "Only unused-portion refunds can be retried from here." },
      { status: 409 }
    );
  }
  if (alert.resolved === true) {
    return NextResponse.json(
      { error: "Already resolved — nothing to retry." },
      { status: 409 }
    );
  }
  const subId =
    typeof alert.subscriptionId === "string" ? alert.subscriptionId : null;
  if (!subId) {
    return NextResponse.json(
      { error: "The alert has no subscription id to retry against." },
      { status: 409 }
    );
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe isn't configured." }, { status: 503 });
  }

  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(subId);
  } catch (err) {
    if ((err as { code?: string })?.code === "resource_missing") {
      return NextResponse.json(
        {
          error:
            "That subscription no longer exists in Stripe. Settle it from the Stripe dashboard and mark the alert resolved.",
        },
        { status: 409 }
      );
    }
    throw err;
  }

  // RECONCILE BEFORE RE-REFUNDING. The helper's Stripe idempotency key is not
  // a durable guard for a human-timescale retry: the amount is recomputed
  // from the clock, so inside Stripe's ~24h idempotency window a retry gets
  // idempotency_error (the button could never succeed), and past it the key
  // has expired and a second real refund would go to the card. An unresolved
  // alert can genuinely mean "the refund already happened but the outcome
  // write was lost" — so ask Stripe what actually exists: the helper stamps
  // every refund it makes with metadata.subscriptionId, which makes prior
  // work findable. If one exists, the fix is recording it, not repeating it.
  try {
    const invoices = await stripe.invoices.list({
      subscription: subId,
      status: "paid",
      limit: 5,
    });
    const invoice = invoices.data
      .filter((i) => (i.amount_paid ?? 0) > 0)
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
    if (invoice?.id) {
      const pays = await stripe.invoicePayments.list({
        invoice: invoice.id,
        limit: 1,
      });
      const payment = pays.data[0]?.payment;
      const paymentIntent =
        typeof payment?.payment_intent === "string"
          ? payment.payment_intent
          : payment?.payment_intent?.id;
      // The charge is checked too, not just the intent. An invoice paid
      // without a PaymentIntent (an older or off-session charge) had no
      // `paymentIntent`, so this whole block was skipped, reconciliation
      // found nothing, and Retry issued a SECOND refund for money that had
      // already gone back.
      const chargeId =
        typeof payment?.charge === "string" ? payment.charge : payment?.charge?.id;
      if (paymentIntent || chargeId) {
        const refunds = await stripe.refunds.list({
          ...(paymentIntent
            ? { payment_intent: paymentIntent }
            : { charge: chargeId as string }),
          limit: 100,
        });
        const existing = refunds.data.find(
          (r) => r.metadata?.subscriptionId === subId && r.status !== "failed"
        );
        if (existing) {
          await ref.set(
            {
              resolved: true,
              refundId: existing.id,
              amount: existing.amount,
              currency: existing.currency,
              error: FieldValue.delete(),
              reconciled: true,
              resolvedBy: admin.email,
              resolvedAt: Date.now(),
            },
            { merge: true }
          );
          await recordAdminAction(db, {
            action: "billing.retry",
            actor: admin.email,
            targetUid: typeof alert.uid === "string" ? alert.uid : undefined,
            detail: {
              alertId: id,
              reconciled: true,
              refundId: existing.id,
              amount: existing.amount,
            },
          });
          return NextResponse.json({
            ok: true,
            resolved: true,
            reconciled: true,
            amount: existing.amount,
            error: null,
          });
        }
      }
    }
  } catch (err) {
    // Reconciliation is a safety read; if Stripe won't answer, refuse to
    // guess. Re-refunding blind is the one outcome this block exists to
    // prevent.
    console.error(`[admin] refund reconciliation failed for ${subId}`, err);
    return NextResponse.json(
      {
        error:
          "Couldn't verify whether a refund already exists. Try again in a moment — retrying blind risks a double refund.",
      },
      { status: 503 }
    );
  }

  // No prior refund found: run the shared helper for real. It rewrites this
  // same alert doc with the outcome.
  //
  // The MODE and the FRACTION are carried over from the alert, and both matter.
  // Without the mode a retry of a `full` refund (a duplicate subscription —
  // our bug, our whole charge to give back) silently downgraded itself to
  // prorated. Without the fraction the amount was recomputed from today's
  // clock, so a retry refunded less the longer it waited, and a retry after
  // the period ended refunded nothing at all while leaving the alert
  // permanently unresolved.
  const recordedMode = alert.mode === "full" ? "full" : "prorated";
  const recordedFraction =
    typeof alert.unusedFraction === "number" &&
    alert.unusedFraction > 0 &&
    alert.unusedFraction <= 1
      ? alert.unusedFraction
      : undefined;
  await refundUnusedPortion(stripe, db, sub, {
    uid: typeof alert.uid === "string" ? alert.uid : null,
    context: "admin-retry",
    mode: recordedMode,
    fractionOverride: recordedFraction,
  });

  const after = (await ref.get()).data() ?? {};
  await recordAdminAction(db, {
    action: "billing.retry",
    actor: admin.email,
    targetUid: typeof alert.uid === "string" ? alert.uid : undefined,
    detail: {
      alertId: id,
      resolved: after.resolved === true,
      amount: typeof after.amount === "number" ? after.amount : null,
    },
  });

  return NextResponse.json({
    ok: true,
    resolved: after.resolved === true,
    amount: typeof after.amount === "number" ? after.amount : null,
    error: typeof after.error === "string" ? after.error : null,
  });
}
