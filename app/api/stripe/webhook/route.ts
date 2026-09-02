import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, isEntitled } from "@/lib/stripe";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { cycleForPriceId } from "@/lib/pricing";
import { refundUnusedPortion } from "@/lib/refunds";
import { clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { isMailConfigured, siteUrl } from "@/lib/email/config";
import { send } from "@/lib/email/send";
import {
  paymentFailed,
  subscriptionCanceled,
  subscriptionStarted,
} from "@/lib/email/messages";

// Stripe → Firestore entitlement sync. This is the ONLY writer of
// users/{uid}/profile/plan (the Admin SDK bypasses the read-only rule on
// that doc). Everything the UI knows about a subscription originates here.
//
// Hardening: the raw body is signature-verified, and every event id is
// claimed in `stripeEvents/{id}` and then marked `done` once handled, so a
// redelivery of finished work is a no-op while a crashed attempt can still be
// retried. We fail loudly (non-2xx) on unexpected errors so Stripe retries.

export const runtime = "nodejs";

function ms(seconds: number | null | undefined): number | undefined {
  return seconds ? seconds * 1000 : undefined;
}

/**
 * The subscription that generated an invoice.
 *
 * This is NOT `invoice.subscription`. That top-level field was removed from
 * the Invoice object in the Basil API release and does not exist on the
 * version this SDK targets (2026-06-24.dahlia), it now lives under
 * `parent.subscription_details.subscription`. The old path read as plain
 * `undefined` at runtime, which silently turned both invoice cases below into
 * no-ops: the events were received, recorded as processed, and dropped.
 *
 * The legacy field is still read as a fallback so that pinning an older API
 * version (or replaying an archived event) keeps working.
 */
function subscriptionIdForInvoice(invoice: Stripe.Invoice): string | undefined {
  const ref = invoice.parent?.subscription_details?.subscription;
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object") return ref.id;

  const legacy = (invoice as { subscription?: unknown }).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) {
    return (legacy as { id: string }).id;
  }
  return undefined;
}

/** Writes the derived entitlement + raw subscription state for one user. */
async function syncSubscription(
  db: FirebaseFirestore.Firestore,
  sub: Stripe.Subscription
) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Two places carry the mapping back to a Firebase user: the subscription's
  // own metadata (set by our Checkout call) and the customer's (set when we
  // create the customer). Prefer the subscription, fall back to the customer.
  const customerMeta =
    typeof sub.customer !== "string" && "metadata" in sub.customer
      ? (sub.customer.metadata?.firebaseUid as string | undefined)
      : undefined;
  let uid = (sub.metadata?.firebaseUid as string | undefined) ?? customerMeta;

  // `customer.subscription.*` events deliver the subscription unexpanded, so
  // `sub.customer` is a bare id string and the customer-metadata fallback
  // above can never fire. That only matters for a subscription lacking our
  // metadata, one created from the Stripe dashboard, say, to comp an
  // account, which would otherwise be dropped outright. Fetch the customer
  // and check there before giving up.
  if (!uid) {
    try {
      const stripe = getStripe();
      if (stripe) {
        const customer = await stripe.customers.retrieve(customerId);
        if (!customer.deleted) {
          uid = customer.metadata?.firebaseUid as string | undefined;
        }
      }
    } catch (err) {
      console.error(`[stripe] couldn't retrieve customer ${customerId}`, err);
    }
  }

  if (!uid) {
    // No mapping back to a user, nothing we can safely write.
    console.error(
      `[stripe] subscription ${sub.id} (customer ${customerId}) has no firebaseUid`
    );
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
    } catch (err) {
      // Only "user-not-found" means the account is really gone and this event
      // should be skipped. A transient admin-auth failure must rethrow so
      // POST's handler-error path releases the idempotency claim and returns
      // 500 for Stripe to retry, rather than silently dropping a real
      // subscription event and stranding a paying user without entitlement.
      if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
      console.log(`[stripe] skipping ${sub.id}, user ${uid} was deleted`);
      return;
    }
  }

  // Entitlement is a property of the CUSTOMER, not of whichever subscription
  // this event happens to describe. Deriving it from `sub` alone revokes
  // Premium from someone who still holds another live subscription, a
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
      const entitling = all.data.filter((s) =>
        isEntitled(s.status, s.items.data[0]?.current_period_end)
      );
      if (entitling.length > 0) {
        source = entitling.reduce((best, s) =>
          (s.items.data[0]?.current_period_end ?? 0) >
          (best.items.data[0]?.current_period_end ?? 0)
            ? s
            : best
        );
      } else if (all.data.length > 0) {
        // None entitle, keep the most recent for an accurate status/date.
        source = all.data.reduce((a, b) => (b.created > a.created ? b : a));
      }

      // Nobody is meant to hold two Elovox subscriptions at once, and until
      // now nothing enforced that — the code above merely picked the best of
      // them for the entitlement and left the rest running. So a monthly
      // subscriber who moved to annual kept paying for BOTH: the plan doc
      // said "premium, annual", the app looked correct, and Stripe quietly
      // billed the old monthly alongside it every month. (Reported by a real
      // subscriber who switched; the note above already knew the Portal
      // "can leave a superseded subscription behind" and stopped at reading
      // around it.)
      //
      // Cancel the leftovers, keeping the one entitlement is derived from.
      // Immediately, not at period end: the whole problem is a charge for
      // something already replaced, and letting it ride to the end of the
      // period is another month of exactly the bug.
      //
      // Plain cancel (no prorate), then refund the unused portion to the CARD
      // via lib/refunds — NOT a customer-balance credit. Elovox's rule is that
      // money given back for an early-ended subscription comes back to the card,
      // never as account credit the user can't withdraw. A durable billingAlerts
      // doc is still written per canceled sub so the case stays queryable from
      // the admin side; the refund writes its own alert too. Keyed by the
      // canceled sub id, so a webhook redelivery is idempotent (and the refund
      // itself carries a Stripe idempotency key).
      if (entitling.length > 1) {
        const superseded = entitling.filter((s) => s.id !== source.id);
        console.warn(
          `[stripe] customer ${customerId} held ${entitling.length} live subscriptions; keeping ${source.id}, canceling ${superseded.map((s) => s.id).join(", ")}`
        );
        for (const dupe of superseded) {
          let canceled = false;
          try {
            await stripe.subscriptions.cancel(dupe.id);
            canceled = true;
          } catch (err) {
            // Already gone, or canceled by a concurrent delivery of this
            // same event. Not worth failing the webhook and replaying it —
            // the entitlement write below is the part that must land.
            const code = (err as { code?: string })?.code;
            if (code === "resource_missing") canceled = true; // already stopped
            else console.error(`[stripe] couldn't cancel duplicate ${dupe.id}`, err);
          }
          // Give the money for the superseded sub back to the card, IN FULL.
          // Best-effort, never throws (see lib/refunds). Only after a confirmed
          // cancel, so we never refund a subscription that's still billing.
          //
          // Full, not prorated: this charge should never have existed. A user
          // holding two entitling subscriptions was never getting two products
          // — they were getting one, twice-billed, by our bug. Prorating meant
          // the longer the duplicate went unnoticed the more of it we kept,
          // which inverts the incentive and is less generous than the refunds
          // page promises for exactly this case. Caught in the same second (a
          // double-click) the two modes agree anyway.
          //
          // `supersededAfter` is what makes "in full" true. Without it
          // lib/refunds cannot know which of the duplicate's invoices were
          // double-billed, falls back to the duplicate's own current period,
          // and refunds one or two of them — a six-month duplicate came back
          // as $24 of $72 while the alert said resolved. The double billing
          // starts when the KEPT subscription started, so that is the cutoff:
          // `source.start_date`, NOT the kept subscription's
          // `current_period_start` read a few lines below. That one is only
          // the latest billing cycle — on a monthly plan it is a month old
          // however long both subscriptions have been running, so it would
          // have reproduced the same under-refund with an authoritative-
          // looking number attached.
          if (canceled) {
            await refundUnusedPortion(stripe, db, dupe, {
              uid: uid ?? null,
              context: "superseded-subscription",
              mode: "full",
              supersededAfter: source.start_date,
            });
          }
          try {
            await db.doc(`billingAlerts/${dupe.id}`).set(
              {
                kind: "duplicate-subscription",
                uid: uid ?? null,
                customerId,
                keptSubId: source.id,
                canceledSubId: dupe.id,
                at: Date.now(),
                resolved: false,
              },
              { merge: true }
            );
          } catch (err) {
            console.error(`[stripe] couldn't record billing alert for ${dupe.id}`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[stripe] couldn't list subscriptions for ${customerId}`, err);
  }

  const priceId = source.items.data[0]?.price?.id;
  const entitled = isEntitled(
    source.status,
    source.items.data[0]?.current_period_end
  );

  // What the plan doc said BEFORE this event, so the mail below can tell a
  // state CHANGE from a redelivery. Stripe sends `customer.subscription.updated`
  // for things as small as a card-brand refresh; mailing on every one of them
  // would be several "your subscription changed" emails a month for a user
  // whose subscription did not change.
  const priorSnap = await db
    .doc(`users/${uid}/profile/plan`)
    .get()
    .catch(() => null);
  const prior = priorSnap?.data() ?? {};

  await db.doc(`users/${uid}/profile/plan`).set(
    {
      plan: entitled ? "premium" : "free",
      status: source.status,
      cycle: priceId ? cycleForPriceId(priceId) ?? null : null,
      since: ms(source.start_date) ?? null,
      trialEnd: ms(source.trial_end) ?? null,
      currentPeriodEnd: ms(source.items.data[0]?.current_period_end) ?? null,
      // Two ways Stripe records "this is going to stop": the boolean, and an
      // explicit `cancel_at` timestamp, which is what the Customer Portal
      // actually set when the first real subscriber canceled, leaving the
      // boolean false. Reading only the boolean told a canceled user they
      // were about to be billed.
      cancelAtPeriodEnd:
        (source.cancel_at_period_end ?? false) || source.cancel_at != null,
      cancelAt: ms(source.cancel_at) ?? null,
      stripeCustomerId: customerId,
      stripeSubscriptionId: source.id,
    },
    { merge: true }
  );

  await notifyPlanChange(db, uid, prior, {
    entitled,
    status: source.status,
    cycle: priceId ? (cycleForPriceId(priceId) ?? null) : null,
    periodEnd: ms(source.items.data[0]?.current_period_end) ?? null,
    canceling:
      (source.cancel_at_period_end ?? false) || source.cancel_at != null,
  });
}

/**
 * The billing emails, decided by comparing the plan doc before and after.
 *
 * TRANSITIONS, NEVER STATES. Every one of these fires on a change and nothing
 * fires on a redelivery, because Stripe redelivers freely and because
 * `customer.subscription.updated` arrives for changes a user would not call a
 * change at all. The comparison against the prior doc is what makes that true;
 * the per-message idempotency keys in lib/email/messages.ts are the second
 * line, collapsing anything that slips through within 24 hours.
 *
 * Category "billing" — non-optional, no unsubscribe link, entitled to the
 * day's allowance ahead of anything promotional. Somebody whose card just
 * failed needs to hear about it whatever their email preferences say.
 *
 * Never throws and never blocks: the entitlement write above is the part that
 * must land, and an email provider having a bad minute must not make Stripe
 * retry a subscription sync that already succeeded.
 */
async function notifyPlanChange(
  db: FirebaseFirestore.Firestore,
  uid: string,
  prior: FirebaseFirestore.DocumentData,
  next: {
    entitled: boolean;
    status: string;
    cycle: string | null;
    periodEnd: number | null;
    canceling: boolean;
  }
): Promise<void> {
  try {
    if (!isMailConfigured()) return;

    const app = getAdminApp();
    if (!app) return;
    const { getAuth } = await import("firebase-admin/auth");
    const user = await getAuth(app).getUser(uid);
    // Unverified means an address somebody typed, not one anybody proved they
    // own. Billing mail is the last place to guess.
    if (!user.email || !user.emailVerified) return;
    const email = user.email;

    const wasPremium = prior.plan === "premium";
    const wasPastDue = prior.status === "past_due" || prior.status === "unpaid";
    const wasCanceling = prior.cancelAtPeriodEnd === true;
    const date = (ms: number | null) =>
      ms ? new Date(ms).toLocaleDateString("en-US", { dateStyle: "long" }) : null;

    // 1. Payment trouble. Ahead of the others because it is the one the user
    //    has to act on, and because `past_due` also flips `plan` around.
    if (
      (next.status === "past_due" || next.status === "unpaid") &&
      !wasPastDue
    ) {
      await send(
        db,
        paymentFailed(email, uid, `${siteUrl()}/account`)
      );
      return;
    }

    // 2. Premium turned on. Only from a genuinely non-premium prior state, so
    //    a renewal — premium before, premium after — is silent, as it should
    //    be. Stripe emails its own receipt for that.
    if (next.entitled && !wasPremium) {
      await send(
        db,
        subscriptionStarted(email, uid, next.cycle ?? "premium", date(next.periodEnd))
      );
      return;
    }

    // 3. Cancellation, at the moment it is scheduled, and again never on a
    //    redelivery of the same state.
    if (next.canceling && !wasCanceling) {
      await send(db, subscriptionCanceled(email, uid, date(next.periodEnd)));
      return;
    }

    // 4. Premium actually lapsed. Skipped when the cancellation was already
    //    announced above — the user has had that email and knows the date.
    if (!next.entitled && wasPremium && !wasCanceling) {
      await send(db, subscriptionCanceled(email, uid, null));
    }
  } catch (err) {
    console.warn(`[stripe] billing email for ${uid} failed`, err);
  }
}

/**
 * A ceiling on invocations, not on Stripe.
 *
 * Signature verification is the real control and it rejects an unsigned body
 * cheaply — but "cheaply" is still a serverless invocation on a public,
 * unauthenticated endpoint, and this is the one route in the tree that had no
 * limiter at all. The ceiling is set far above anything Stripe produces (their
 * retries are per-event with backoff, from a small set of source IPs), so a
 * legitimate delivery can never meet it; a flood of forged bodies from one
 * source will.
 */

export async function POST(req: NextRequest) {
  if (await limited(getAdminDb(), "stripe-webhook", clientIp(req))) {
    return new NextResponse(null, { status: 429 });
  }
  const stripe = getStripe();
  const db = getAdminDb();
  // Trimmed: a value pasted into a dashboard field is the likeliest place for
  // stray whitespace, and it costs a redeploy to discover.
  const rawSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const secret = rawSecret?.trim();
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
    // Shape and a hash, never the secret's own characters. This endpoint is
    // public and unauthenticated before verification, so anyone can trigger
    // this branch at will; logging real prefix/suffix characters of the
    // signing secret would leak them to anyone with log access. len +
    // hadWhitespace still catches a padded paste, and sha8 lets the operator
    // compare against a hash of the dashboard value to spot a stale secret.
    const { createHash } = await import("node:crypto");
    console.error(
      `[stripe] bad signature, configured secret len=${secret.length} hasWhsecPrefix=${secret.startsWith(
        "whsec_"
      )} hadWhitespace=${rawSecret !== secret} sha8=${createHash("sha256")
        .update(secret)
        .digest("hex")
        .slice(0, 8)}`,
      err
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Idempotency: claim the event id, and if it's already handled, ack and skip.
  //
  // The claim is deliberately two-phase. Claiming and never marking completion
  // means any death between the claim and the end of the handler, a function
  // timeout on a slow Stripe list call, an instance being torn down, leaves a
  // claim standing for work that never happened, and Stripe's retry is then
  // rejected as a duplicate. The event is lost for good, which for
  // `checkout.session.completed` is a paying customer who never gets Premium.
  //
  // So: a claim is only honored as "don't redo this" once `done` is set. A
  // claim still in flight blocks concurrent redelivery, but goes stale after
  // the window below so a crashed attempt can be retried rather than dropped.
  const seenRef = db.doc(`stripeEvents/${event.id}`);
  const CLAIM_STALE_MS = 5 * 60 * 1000;

  let claimed = false;
  let alreadyDone = false;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(seenRef);
      if (snap.exists) {
        const prior = snap.data() ?? {};
        if (prior.done) {
          alreadyDone = true;
          return; // genuinely handled already
        }
        const at = typeof prior.at === "number" ? prior.at : 0;
        if (Date.now() - at < CLAIM_STALE_MS) return; // another attempt in flight
        console.warn(`[stripe] reclaiming stale event ${event.id} (${event.type})`);
      }
      tx.set(seenRef, { type: event.type, at: Date.now(), done: false });
      claimed = true;
    });
  } catch (err) {
    // Couldn't even reach Firestore, 500 so Stripe retries rather than
    // treating an infrastructure blip as a processed event.
    console.error(`[stripe] idempotency claim failed for ${event.id}`, err);
    return NextResponse.json({ error: "Claim failed." }, { status: 500 });
  }

  // Only a COMPLETED prior attempt earns a 2xx. This used to ack the
  // in-flight case too, which quietly threw events away: attempt #1 exceeds
  // the function limit and dies without responding, Stripe's retry lands
  // inside the 5-minute window, gets a 200, and stops retrying — so `done` is
  // never set, nothing ever runs the handler, and for
  // checkout.session.completed that is a paying customer who never gets
  // Premium. A 409 keeps the retry schedule alive; by the next attempt the
  // claim has gone stale and can be reclaimed.
  if (alreadyDone) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (!claimed) {
    return NextResponse.json(
      { error: "Already processing this event; retry shortly.", inFlight: true },
      { status: 409 }
    );
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
        const subId = subscriptionIdForInvoice(invoice);
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId, {
            expand: ["customer"],
          });
          await syncSubscription(db, sub);
        }
        break;
      }
      default:
        // Unhandled types are fine, we acked and recorded them.
        break;
    }
  } catch (err) {
    // Let the idempotency claim stand? No, release it so the retry can work.
    console.error(`[stripe] handler error for ${event.type}`, err);
    await seenRef.delete().catch(() => {});
    return NextResponse.json({ error: "Handler error." }, { status: 500 });
  }

  // Only now is the claim meaningful as "this has been handled". Failing to
  // record completion is not worth failing the event over, Stripe would
  // retry work that already succeeded, so log and still ack.
  await seenRef
    .set({ done: true, completedAt: Date.now() }, { merge: true })
    .catch((err) => console.error(`[stripe] couldn't mark ${event.id} done`, err));

  return NextResponse.json({ received: true });
}
