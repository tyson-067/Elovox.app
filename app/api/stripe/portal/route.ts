import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser, makeRateLimiter } from "@/lib/verify";

// Opens the Stripe Customer Portal for the signed-in user — the one place
// they cancel, switch plans (with proration), update their card, and pull
// invoices. Plan-switch proration behavior is configured in the Portal
// settings in the Stripe dashboard, not here (see lib/pricing.ts).

export const runtime = "nodejs";

// Each call mints a Stripe Portal session; 20/hour per user is far above
// normal use and well below anything that could be used to hammer Stripe.
const rateLimited = makeRateLimiter(20);

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
    console.error(
      `[stripe] billing unconfigured — STRIPE_SECRET_KEY:${stripe ? "ok" : "MISSING"} FIREBASE_SERVICE_ACCOUNT:${db ? "ok" : "MISSING"}`
    );
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (rateLimited(uid)) {
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

  // The Portal throws if it has no configuration in this mode — a live-mode
  // setup that was only ever done in test is the usual cause. Surface Stripe's
  // message instead of letting it collapse into a bare 500.
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl(req)}/account`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe] portal failed for ${uid} (customer ${customerId})`, err);
    return NextResponse.json(
      { error: `Couldn't open billing: ${message}` },
      { status: 502 }
    );
  }
}
