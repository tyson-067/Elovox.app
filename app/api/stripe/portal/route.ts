import { NextRequest, NextResponse } from "next/server";
import { getStripe, appBaseUrl } from "@/lib/stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";

// Opens the Stripe Customer Portal for the signed-in user, the one place
// they cancel, switch plans (with proration), update their card, and pull
// invoices. Plan-switch proration behavior is configured in the Portal
// settings in the Stripe dashboard, not here (see lib/pricing.ts).

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const db = getAdminDb();
  if (!stripe || !db) {
    console.error(
      `[stripe] billing unconfigured, STRIPE_SECRET_KEY:${stripe ? "ok" : "MISSING"} FIREBASE_SERVICE_ACCOUNT:${db ? "ok" : "MISSING"}`
    );
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (await limited(getAdminDb(), "stripe-portal", uid)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429 }
    );
  }

  const snap = await db.doc(`users/${uid}/profile/plan`).get();
  const customerId = snap.exists ? (snap.data()?.stripeCustomerId as string | undefined) : undefined;
  if (!customerId) {
    return NextResponse.json({ error: "No subscription to manage." }, { status: 404 });
  }

  // The Portal throws if it has no configuration in this mode, a live-mode
  // setup that was only ever done in test is the usual cause. Caught so it
  // reaches the server log as that diagnosis instead of collapsing into a bare
  // 500 with no body.
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl(req)}/account`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Same rule as /api/stripe/checkout: Stripe's message is addressed to the
    // account owner and names internal objects (the customer id, the Portal
    // configuration id, which mode the key is in). It goes to the log next to
    // the uid and customer id; the browser gets a sentence a customer can act
    // on, since none of the real causes are anything they can fix.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[stripe] portal failed for ${uid} (customer ${customerId}): ${message}`,
      err
    );
    return NextResponse.json(
      { error: "Couldn't open billing. Please try again in a moment." },
      { status: 502 }
    );
  }
}
