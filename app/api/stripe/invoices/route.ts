import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser, makeRateLimiter } from "@/lib/verify";

// Billing history for the signed-in user. Stripe generates an invoice for
// every subscription charge (including the $0 one that opens a trial), so
// this is just a read of what Billing already produced — we never create or
// finalize invoices ourselves.
//
// The customer id comes from the user's own plan doc, which only the webhook
// writes, so a caller can never ask for someone else's invoices by passing
// an id. Links are Stripe-hosted and short-lived by design; we hand them to
// the browser rather than proxying PDFs through our server.

export const runtime = "nodejs";

// Read-only, but each call hits Stripe's API — cap it so a loop on the
// account screen can't burn through rate limits shared with checkout.
const rateLimited = makeRateLimiter(60);

export interface InvoiceRow {
  id: string;
  number: string | null;
  created: number; // ms
  total: number; // minor units (cents)
  currency: string;
  status: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

export async function GET(req: NextRequest) {
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
  const customerId = snap.exists
    ? (snap.data()?.stripeCustomerId as string | undefined)
    : undefined;
  // Never subscribed — an empty history, not an error.
  if (!customerId) return NextResponse.json({ invoices: [] });

  const list = await stripe.invoices.list({ customer: customerId, limit: 12 });

  const invoices: InvoiceRow[] = list.data
    // Drafts aren't finalized yet: no number, no hosted page, and the amount
    // can still change. Showing one would be showing a charge that may never
    // happen.
    .filter((inv) => inv.status !== "draft")
    .map((inv) => ({
      id: inv.id ?? "",
      number: inv.number ?? null,
      created: inv.created * 1000,
      total: inv.total,
      currency: inv.currency,
      status: inv.status ?? null,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
    }));

  return NextResponse.json({ invoices });
}
