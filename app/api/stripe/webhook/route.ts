import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, isEntitled } from "@/lib/stripe";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { cycleForPriceId } from "@/lib/pricing";

// Stripe → Firestore entitlement sync. This is the ONLY writer of
// users/{uid}/profile/plan (the Admin SDK bypasses the read-only rule on
// that doc). Everything the UI knows about a subscription originates here.
//
// Hardening: the raw body is signature-verified, and every event id is
// recorded in `stripeEvents/{id}` before processing so a redelivery is a
// no-op. We fail loudly (non-2xx) on unexpected errors so Stripe retries.

export const runtime = "nodejs";

function ms(seconds: number | null | undefined): number | undefined {
  return seconds ? seconds * 1000 : undefined;
}

/** Writes the derived entitlement + raw subscription state for one user. */
async function syncSubscription(
  db: FirebaseFirestore.Firestore,
  sub: Stripe.Subscription
) {
  const customerMeta =
    typeof sub.customer !== "string" && "metadata" in sub.customer
      ? (sub.customer.metadata?.firebaseUid as string | undefined)
      : undefined;
  const uid = (sub.metadata?.firebaseUid as string | undefined) ?? customerMeta;
  if (!uid) {
    // No mapping back to a user — nothing we can safely write.
    console.error(`[stripe] subscription ${sub.id} has no firebaseUid`);
    return;
  }

  // Deleting an account cancels its subscription, and Stripe's resulting
  // `customer.subscription.deleted` can land after the data is gone. Writing
  // it would resurrect a plan doc under a user that no longer exists, so
  // confirm the login is still there first.
  const app = getAdminApp();
  if (app) {
    const { getAuth } = await import("firebase-admin/auth");
    try {
      await getAuth(app).getUser(uid);
    } catch {
      console.log(`[stripe] skipping ${sub.id} — user ${uid} was deleted`);
      return;
    }
  }

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Entitlement is a property of the CUSTOMER, not of whichever subscription
  // this event happens to describe. Deriving it from `sub` alone revokes
  // Premium from someone who still holds another live subscription — a
  // cancellation event for one plan would write plan:"free" over an active
  // one. Checkout now refuses to create a second subscription, but accounts
  // predating that still have two, and the Portal can leave a superseded
  // subscription behind when switching plans.
  //
  // Falls back to the event's own subscription if the list call fails: a
  // slightly stale answer beats dropping the event and retrying forever.
  let source = sub;
  try {
    const stripe = getStripe();
    if (stripe) {
      const all = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      // Prefer any subscription that grants access; among those, the one
      // running longest, so the record reflects the access actually held.
      const entitling = all.data.filter((s) => isEntitled(s.status));
      if (entitling.length > 0) {
        source = entitling.reduce((best, s) =>
          (s.items.data[0]?.current_period_end ?? 0) >
          (best.items.data[0]?.current_period_end ?? 0)
            ? s
            : best
        );
      } else if (all.data.length > 0) {
        // None entitle — keep the most recent for an accurate status/date.
        source = all.data.reduce((a, b) => (b.created > a.created ? b : a));
      }
    }
  } catch (err) {
    console.error(`[stripe] couldn't list subscriptions for ${customerId}`, err);
  }

  const priceId = source.items.data[0]?.price?.id;
  const entitled = isEntitled(source.status);

  await db.doc(`users/${uid}/profile/plan`).set(
    {
      plan: entitled ? "premium" : "free",
      status: source.status,
      cycle: priceId ? cycleForPriceId(priceId) ?? null : null,
      since: ms(source.start_date) ?? null,
      trialEnd: ms(source.trial_end) ?? null,
      currentPeriodEnd: ms(source.items.data[0]?.current_period_end) ?? null,
      // Two ways Stripe records "this is going to stop": the boolean, and an
      // explicit `cancel_at` timestamp — which is what the Customer Portal
      // actually set when the first real subscriber cancelled, leaving the
      // boolean false. Reading only the boolean told a cancelled user they
      // were about to be billed.
      cancelAtPeriodEnd:
        (source.cancel_at_period_end ?? false) || source.cancel_at != null,
      cancelAt: ms(source.cancel_at) ?? null,
      stripeCustomerId: customerId,
      stripeSubscriptionId: source.id,
    },
    { merge: true }
  );
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const db = getAdminDb();
  // Trimmed: a value pasted into a dashboard field is the likeliest place for
  // stray whitespace, and it costs a redeploy to discover.
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !db || !secret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "No signature." }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    // Shape, never content — enough to tell a stale secret from a
    // whitespace-padded one without a redeploy to find out. Server log only:
    // this endpoint is public, so returning it would hand any anonymous
    // caller real characters of the signing secret.
    console.error(
      `[stripe] bad signature — configured secret len=${secret.length} prefix=${secret.slice(0, 9)} suffix=${secret.slice(-4)}`,
      err
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Idempotency: claim the event id, and if it's already claimed, ack and skip.
  const seenRef = db.doc(`stripeEvents/${event.id}`);
  try {
    await seenRef.create({ type: event.type, at: Date.now() });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string,
            { expand: ["customer"] }
          );
          await syncSubscription(db, sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // The deleted event still carries the final (canceled) status.
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(db, sub);
        break;
      }
      case "invoice.payment_failed":
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof (invoice as { subscription?: unknown }).subscription === "string"
            ? ((invoice as { subscription?: string }).subscription as string)
            : undefined;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId, {
            expand: ["customer"],
          });
          await syncSubscription(db, sub);
        }
        break;
      }
      default:
        // Unhandled types are fine — we acked and recorded them.
        break;
    }
  } catch (err) {
    // Let the idempotency claim stand? No — release it so the retry can work.
    console.error(`[stripe] handler error for ${event.type}`, err);
    await seenRef.delete().catch(() => {});
    return NextResponse.json({ error: "Handler error." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
