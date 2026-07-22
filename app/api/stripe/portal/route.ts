import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser } from "@/lib/verify";

// Opens the Stripe Customer Portal for the signed-in user — the one place
// they cancel, switch plans (with proration), update their card, and pull
// invoices. Plan-switch proration behavior is configured in the Portal
// settings in the Stripe dashboard, not here (see lib/pricing.ts).

export const runtime = "nodejs";

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

  const snap = await db.doc(`users/${uid}/profile/plan`).get();
  const customerId = snap.exists ? (snap.data()?.stripeCustomerId as string | undefined) : undefined;
  if (!customerId) {
    return NextResponse.json({ error: "No subscription to manage." }, { status: 404 });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl(req)}/account`,
  });

  return NextResponse.json({ url: session.url });
}
