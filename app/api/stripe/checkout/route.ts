import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser } from "@/lib/verify";
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

function baseUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    req.headers.get("origin") ||
    new URL(req.url).origin
  );
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const db = getAdminDb();
  if (!stripe || !db) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
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

  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { firebaseUid: uid },
    });
    customerId = customer.id;
    // Persist immediately so a retried checkout reuses it even before the
    // webhook writes the full record.
    await planRef.set({ stripeCustomerId: customerId }, { merge: true });
  }

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
      // Omitted entirely for the weekly plan — Stripe rejects a zero-day
      // trial, so "no trial" has to mean "no parameter".
      ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
      metadata: { firebaseUid: uid },
    },
    allow_promotion_codes: true,
    // The webhook is the source of truth; these just route the browser back.
    success_url: `${baseUrl(req)}/account?checkout=success`,
    cancel_url: `${baseUrl(req)}/pricing?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
