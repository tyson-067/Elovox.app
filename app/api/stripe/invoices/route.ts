import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";

// Billing history for the signed-in user: everything that moved money, in
// both directions. Stripe generates an invoice for every subscription charge
// (including the $0 one that opens a trial), so the charges are just a read
// of what Billing already produced — we never create or finalize invoices
// ourselves — and the refunds are read back off the charges they were made
// against.
//
// Money OUT used to be the whole story here, and that was the bug. We refund
// on our own initiative in two places (lib/refunds.ts: account deletion, and
// the webhook's superseded-duplicate cleanup), so the person most likely to
// open this page is someone who has just been refunded — and they saw the
// charge, no refund, and no sign anything had been given back. It reads as if
// the refund never happened, which is the one thing a billing page must never
// suggest.
//
// The customer id comes from the user's own plan doc, which only the webhook
// writes, so a caller can never ask for someone else's invoices by passing
// an id. Links are Stripe-hosted and short-lived by design; we hand them to
// the browser rather than proxying PDFs through our server.

export const runtime = "nodejs";

/**
 * One page of history. This asked Stripe for 12 and told nobody, so a weekly
 * subscriber past three months saw a list that just stopped — with no way to
 * tell a complete history from a cut-off one. 100 is Stripe's own page
 * maximum, which covers years of monthly billing in a single call; `hasMore`
 * says when even that ran out, and the account page states plainly that the
 * list is the most recent N rather than pretending it is everything.
 */
const MAX_ROWS = 100;

export interface InvoiceRow {
  id: string;
  /**
   * Which direction the money went. Refund rows carry a negative `total` and
   * no invoice number — they are Stripe Refund objects, not invoices, so the
   * UI has to label them rather than infer it from the sign.
   */
  kind: "invoice" | "refund";
  number: string | null;
  created: number; // ms
  total: number; // minor units (cents); negative on a refund row
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
      `[stripe] billing unconfigured, STRIPE_SECRET_KEY:${stripe ? "ok" : "MISSING"} FIREBASE_SERVICE_ACCOUNT:${db ? "ok" : "MISSING"}`
    );
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (await limited(getAdminDb(), "stripe-invoices", uid)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429 }
    );
  }

  const snap = await db.doc(`users/${uid}/profile/plan`).get();
  const customerId = snap.exists
    ? (snap.data()?.stripeCustomerId as string | undefined)
    : undefined;
  // Never subscribed, an empty history, not an error.
  if (!customerId) return NextResponse.json({ invoices: [] });

  // Every other Stripe route wraps its API calls; this one didn't, so a
  // Stripe-side failure escaped as a bare 500 with no JSON body and the
  // account page fell back to a generic message.
  //
  // The two reads travel together, and a failure of either one fails the whole
  // request. Serving the invoices alone when the refund lookup breaks would
  // quietly rebuild the exact page this route exists to stop showing — a
  // charge with no refund beside it — and "we couldn't load your history" is
  // an honest sentence, where a refund-blind history is not.
  let list: Stripe.ApiList<Stripe.Invoice>;
  let charges: Stripe.ApiList<Stripe.Charge>;
  try {
    [list, charges] = await Promise.all([
      stripe.invoices.list({ customer: customerId, limit: MAX_ROWS }),
      // Refunds are not reachable from the invoice in this API version — an
      // Invoice carries no refund total and no charge id, only a `payments`
      // sub-list — and lib/refunds.ts issues plain Refunds against the
      // payment, not credit notes, so nothing lands on the invoice at all.
      // The charge is where they are visible, and `data.refunds` is what makes
      // them come back with amounts and dates instead of just a total.
      stripe.charges.list({
        customer: customerId,
        limit: MAX_ROWS,
        expand: ["data.refunds"],
      }),
    ]);
  } catch (err) {
    console.error(`[stripe] invoice list failed for ${uid} (${customerId})`, err);
    return NextResponse.json(
      { error: "Couldn't load billing history." },
      { status: 502 }
    );
  }

  const invoices: InvoiceRow[] = list.data
    // Drafts aren't finalized yet: no number, no hosted page, and the amount
    // can still change. Showing one would be showing a charge that may never
    // happen.
    .filter((inv) => inv.status !== "draft")
    .map((inv) => ({
      id: inv.id ?? "",
      kind: "invoice" as const,
      number: inv.number ?? null,
      created: inv.created * 1000,
      total: inv.total,
      currency: inv.currency,
      status: inv.status ?? null,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
    }));

  const refunds: InvoiceRow[] = charges.data.flatMap((charge) =>
    (charge.refunds?.data ?? [])
      // A failed or canceled refund never reached the card, so showing it
      // would promise money that isn't coming. A pending one has left our
      // side and is worth showing — it carries its own status, and a user
      // waiting on a bank is better served by "pending" than by silence.
      .filter((r) => r.status !== "failed" && r.status !== "canceled")
      .map((r) => ({
        id: r.id,
        kind: "refund" as const,
        // Refunds have no invoice number of their own.
        number: null,
        created: r.created * 1000,
        // Negative, so a row reads as money coming back at a glance and any
        // future total over these rows adds up to what was actually kept.
        total: -r.amount,
        currency: r.currency,
        status: r.status ?? null,
        // Stripe keeps a charge's receipt current with its refunds, so this
        // link shows the refund. There is no separate hosted page for one.
        hostedUrl: charge.receipt_url ?? null,
        pdfUrl: null,
      }))
  );

  // Newest first, charges and refunds interleaved, so a refund sits next to
  // the period it belongs to rather than in a section of its own.
  const rows = [...invoices, ...refunds].sort((a, b) => b.created - a.created);

  return NextResponse.json({
    invoices: rows,
    // Said out loud rather than left for the reader to guess. lib/checkout.ts's
    // fetchInvoices only forwards the rows, so the account page states the cap
    // in its own words too; this is here for anything that reads the route
    // directly.
    hasMore: list.has_more || charges.has_more,
    limit: MAX_ROWS,
  });
}
