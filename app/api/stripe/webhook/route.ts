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

  const priceId = sub.items.data[0]?.price?.id;
  const entitled = isEntitled(sub.status);

  await db.doc(`users/${uid}/profile/plan`).set(
    {
      plan: entitled ? "premium" : "free",
      status: sub.status,
      cycle: priceId ? cycleForPriceId(priceId) ?? null : null,
      since: ms(sub.start_date) ?? null,
      trialEnd: ms(sub.trial_end) ?? null,
      currentPeriodEnd: ms(sub.items.data[0]?.current_period_end) ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
    },
    { merge: true }
  );
}

/**
 * The signing secret, from the environment if it's right and from Firestore
 * if it isn't.
 *
 * STRIPE_WEBHOOK_SECRET is the proper home for this and stays authoritative.
 * The fallback exists because a wrong value there is invisible from outside —
 * every failure looks like an identical 400 — and fixing it means a dashboard
 * round-trip plus a redeploy per attempt. `config/stripe` is admin-only
 * (firestore.rules denies the whole collection; only the Admin SDK reads it),
 * so this is the same trust boundary as the service-account credential the
 * route already holds, and it can be corrected without a deploy.
 *
 * Prefers the env var whenever it verifies, so removing the Firestore doc
 * once the environment is correct changes nothing.
 */
async function signingSecrets(
  db: FirebaseFirestore.Firestore
): Promise<string[]> {
  const fromEnv = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const secrets = fromEnv ? [fromEnv] : [];
  try {
    const snap = await db.doc("config/stripe").get();
    const fallback = snap.exists
      ? (snap.data()?.webhookSecret as string | undefined)?.trim()
      : undefined;
    if (fallback && fallback !== fromEnv) secrets.push(fallback);
  } catch {
    // Firestore unreachable — the env var alone still has to do.
  }
  return secrets;
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const db = getAdminDb();
  if (!stripe || !db) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }
  const secrets = await signingSecrets(db);
  if (secrets.length === 0) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "No signature." }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event | null = null;
  let lastErr: unknown;
  for (const [i, secret] of secrets.entries()) {
    try {
      event = stripe.webhooks.constructEvent(raw, sig, secret);
      if (i > 0) {
        console.warn(
          "[stripe] verified with the Firestore fallback secret — STRIPE_WEBHOOK_SECRET is wrong or stale"
        );
      }
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!event) {
    // Shape, never content: enough to tell a stale secret from a
    // whitespace-padded one, and it goes to the server log only. This endpoint
    // is public, so putting it in the response would hand any anonymous caller
    // real characters of the signing secret.
    const shapes = secrets
      .map((s) => `len=${s.length} prefix=${s.slice(0, 9)} suffix=${s.slice(-4)}`)
      .join(" | ");
    console.error(`[stripe] bad signature — tried ${secrets.length}: ${shapes}`, lastErr);
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
