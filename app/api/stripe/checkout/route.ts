import { NextRequest, NextResponse } from "next/server";
import { getStripe, appBaseUrl } from "@/lib/stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyVerifiedUser, makeRateLimiter } from "@/lib/verify";
import { PLANS, stripePriceIdFor, type BillingCycle } from "@/lib/pricing";

// Starts a Stripe Checkout session for a signed-in user. Subscription mode
// with card-up-front, so the trial captures a payment method and converts
// automatically. Payment methods themselves (cards, Apple/Google Pay, Link)
// are whatever the Stripe dashboard has enabled — we don't hardcode them.
//
// Returns { url } for the browser to redirect to. Nothing here writes the
// entitlement; that only happens later, in the webhook, once payment setup
// succeeds — so a user who bails at Checkout never gets Premium.

export const runtime = "nodejs";

const CYCLES: BillingCycle[] = ["weekly", "monthly", "annual"];

// Dashboard label for this Checkout flow (Stripe API 2026-03-25.dahlia+).
const CHECKOUT_INTEGRATION_ID = "elovox-premium-hqvbztkm";

// Nobody legitimately opens Checkout 20 times an hour. Keyed by uid (the route
// is authenticated), this stops a loop from minting endless Stripe customers.
const rateLimited = makeRateLimiter(20);

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const db = getAdminDb();
  if (!stripe || !db) {
    // Names the missing credential in the server log — "Billing is not
    // configured" alone can't distinguish a missing Stripe key from a
    // missing/truncated service account, which is the usual deploy slip.
    console.error(
      `[stripe] billing unconfigured — STRIPE_SECRET_KEY:${stripe ? "ok" : "MISSING"} FIREBASE_SERVICE_ACCOUNT:${db ? "ok" : "MISSING"}`
    );
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const uid = await verifyVerifiedUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  // A subscription on an unconfirmed address is a support problem waiting to
  // happen: receipts and password resets go to an inbox nobody owns.
  if (uid === "unverified") {
    return NextResponse.json(
      { error: "Please confirm your email address before subscribing." },
      { status: 403 }
    );
  }
  if (rateLimited(uid)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429 }
    );
  }

  let cycle: BillingCycle;
  try {
    ({ cycle } = await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!CYCLES.includes(cycle)) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }

  const priceId = stripePriceIdFor(cycle);
  if (!priceId) {
    return NextResponse.json({ error: "That plan isn't available yet." }, { status: 503 });
  }
  const plan = PLANS.find((p) => p.cycle === cycle)!;

  // Reuse an existing Stripe customer if this user already has one, so we
  // never create duplicates across repeat checkouts. The customer id lives
  // on the (admin-written) plan doc.
  const planRef = db.doc(`users/${uid}/profile/plan`);
  const planSnap = await planRef.get();
  let customerId = planSnap.exists ? (planSnap.data()?.stripeCustomerId as string | undefined) : undefined;

  // Pull the account email so the receipt/portal is addressed correctly.
  let email: string | undefined;
  try {
    const { getAdminApp } = await import("@/lib/firebaseAdmin");
    const app = getAdminApp();
    if (app) {
      const { getAuth } = await import("firebase-admin/auth");
      const user = await getAuth(app).getUser(uid);
      email = user.email ?? undefined;
    }
  } catch {
    // email is a nicety, not required
  }

  // Everything below talks to Stripe, so a misconfiguration (a test Price ID
  // paired with a live key, an unsupported parameter) surfaces as a thrown
  // StripeError. Uncaught, that becomes a bare 500 with no JSON body, and the
  // browser can only say "Something went wrong" — which hides the one detail
  // that would explain it. Log Stripe's own message and pass it back.
  try {
    if (!customerId) {
      // Before minting a new customer, look for one already on this email.
      //
      // Deleting an account recursively deletes users/{uid}, which takes the
      // plan doc and the stripeCustomerId with it — but the Stripe customer
      // survives, and so does its trial history. Without this lookup, the
      // delete → sign up again → trial again loop is free and repeatable.
      // The address is safe to match on: this route requires a verified
      // email, and Firebase Auth keeps it unique across accounts.
      if (email) {
        const found = await stripe.customers.list({ email, limit: 100 });
        // `list` returns newest first. Prefer a customer we created (one
        // carrying a firebaseUid) over any made by hand in the dashboard.
        const match =
          found.data.find((c) => !c.deleted && c.metadata?.firebaseUid) ??
          found.data.find((c) => !c.deleted);
        if (match) {
          customerId = match.id;
          // Point the customer at the account that now owns it, so the next
          // checkout, the webhook, and the dashboard all agree on the uid.
          if (match.metadata?.firebaseUid !== uid) {
            await stripe.customers.update(customerId, {
              metadata: { firebaseUid: uid },
            });
          }
        }
      }

      if (!customerId) {
        const customer = await stripe.customers.create({
          email,
          metadata: { firebaseUid: uid },
        });
        customerId = customer.id;
      }
      // Persist immediately so a retried checkout reuses it even before the
      // webhook writes the full record.
      await planRef.set({ stripeCustomerId: customerId }, { merge: true });
    }

    // What has this customer done before? Two things matter, and Stripe is the
    // source of truth for both — a Firestore flag would drift the moment a
    // subscription was changed from the dashboard.
    //
    //  - Already subscribed? Sending them through Checkout again bills them a
    //    second time for the same product. (Seen in the wild: one tester ended
    //    up with simultaneous monthly AND annual trials.) Send them to the
    //    Portal to switch plans instead.
    //  - Ever had a trial? The free week is once per customer, not once per
    //    price. Otherwise: trial monthly, cancel, trial annual, repeat —
    //    Premium indefinitely for nothing.
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });

    const live = existing.data.find((s) =>
      ["trialing", "active", "past_due", "unpaid"].includes(s.status)
    );
    if (live) {
      return NextResponse.json(
        {
          error:
            "You already have a subscription. Manage or switch your plan from your account page.",
          code: "already_subscribed",
        },
        { status: 409 }
      );
    }

    // trial_start is set by Stripe on any subscription that opened with a
    // trial, and it survives cancellation — which is exactly the history we
    // need. A returning customer subscribes at full price from day one.
    const hadTrial = existing.data.some((s) => s.trial_start != null);
    const grantTrial = plan.trialDays > 0 && !hadTrial;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Labels this flow in the Stripe dashboard so Checkout performance can be
      // compared across integrations. Static on purpose — it identifies the
      // flow, not the session.
      integration_identifier: CHECKOUT_INTEGRATION_ID,
      customer: customerId,
      client_reference_id: uid,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        // Omitted entirely for the weekly plan, and for anyone who has already
        // used their trial — Stripe rejects a zero-day trial, so "no trial"
        // has to mean "no parameter".
        ...(grantTrial ? { trial_period_days: plan.trialDays } : {}),
        metadata: { firebaseUid: uid },
      },
      allow_promotion_codes: true,
      // The webhook is the source of truth; these just route the browser back.
      success_url: `${appBaseUrl(req)}/account?checkout=success`,
      cancel_url: `${appBaseUrl(req)}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe] checkout failed for ${uid} (${cycle}, ${priceId})`, err);
    return NextResponse.json(
      { error: `Checkout couldn't start: ${message}` },
      { status: 502 }
    );
  }
}
