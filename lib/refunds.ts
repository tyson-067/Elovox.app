import type Stripe from "stripe";
import type { Firestore } from "firebase-admin/firestore";

// One place, one rule: money we give back for an early-ended subscription goes
// to the CARD, never to Stripe account credit the user can't withdraw. Both
// callers — account deletion and the webhook's superseded-duplicate cleanup —
// share this so the behavior can't drift between them.

/**
 * Refund the UNUSED portion of a paid subscription period to the card, prorated
 * by time left in the period: `amount_paid * (time_remaining / period_length)`
 * of the most recent paid invoice. `amount_paid` is tax-inclusive, so the
 * proportional tax comes back too.
 *
 * Best-effort BY DESIGN — the action that triggered it (a deletion, a webhook)
 * must never be blocked by a refund we couldn't make. It never throws: every
 * outcome is written to a top-level `billingAlerts` doc (which survives a user's
 * data being erased) so a failure is `resolved: false` for manual follow-up.
 * Idempotent on the subscription id, so a retry can't double-refund. Refunds
 * nothing for a trial (never paid) or a fully-elapsed period (nothing unused).
 */
export async function refundUnusedPortion(
  stripe: Stripe,
  db: Firestore,
  sub: Stripe.Subscription,
  opts: { uid: string | null; context: string }
): Promise<void> {
  const alertRef = db.doc(`billingAlerts/unused-refund-${sub.id}`);
  try {
    // A trial was never paid for — nothing unused to give back.
    if (sub.status === "trialing") return;

    const item = sub.items.data[0];
    const start = item?.current_period_start;
    const end = item?.current_period_end;
    if (!start || !end || end <= start) return;
    const now = Math.floor(Date.now() / 1000);
    const remaining = end - now;
    if (remaining <= 0) return; // period already fully used, nothing owed back
    const unusedFraction = Math.min(1, remaining / (end - start));

    // What they actually paid for this period, from the most recent paid
    // invoice on the subscription.
    const invoices = await stripe.invoices.list({
      subscription: sub.id,
      status: "paid",
      limit: 5,
    });
    const invoice = invoices.data
      .filter((i) => (i.amount_paid ?? 0) > 0)
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
    if (!invoice?.id || !invoice.amount_paid) return;

    const amount = Math.floor(invoice.amount_paid * unusedFraction);
    if (amount <= 0) return;

    // The payment to refund against. This API version keeps it on
    // invoice.payments, not a top-level charge field.
    const pays = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 1 });
    const payment = pays.data[0]?.payment;
    const paymentIntent =
      typeof payment?.payment_intent === "string"
        ? payment.payment_intent
        : payment?.payment_intent?.id;
    const charge =
      typeof payment?.charge === "string" ? payment.charge : payment?.charge?.id;
    if (!paymentIntent && !charge) return;

    const refund = await stripe.refunds.create(
      {
        ...(paymentIntent ? { payment_intent: paymentIntent } : { charge: charge! }),
        amount,
        reason: "requested_by_customer",
        metadata: {
          reason: opts.context,
          uid: opts.uid ?? "",
          subscriptionId: sub.id,
        },
      },
      // Stable across retries → Stripe returns the first refund, never a second.
      { idempotencyKey: `unused-refund-${sub.id}` }
    );

    await alertRef
      .set(
        {
          kind: "unused-portion-refund",
          context: opts.context,
          uid: opts.uid,
          subscriptionId: sub.id,
          customerId:
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
          invoiceId: invoice.id,
          amount,
          currency: invoice.currency ?? null,
          unusedFraction,
          refundId: refund.id,
          resolved: true,
          at: Date.now(),
        },
        { merge: true }
      )
      .catch(() => {});
  } catch (err) {
    // Couldn't refund (Stripe error, missing payment, network). Record it so a
    // human can settle it, and let the caller proceed regardless.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[refund] unused-portion refund failed for ${sub.id}`, err);
    await alertRef
      .set(
        {
          kind: "unused-portion-refund",
          context: opts.context,
          uid: opts.uid,
          subscriptionId: sub.id,
          error: message,
          resolved: false,
          at: Date.now(),
        },
        { merge: true }
      )
      .catch(() => {});
  }
}
