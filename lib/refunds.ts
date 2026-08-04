import type Stripe from "stripe";
import type { Firestore } from "firebase-admin/firestore";

// One place, one rule: money we give back for an early-ended subscription goes
// to the CARD, never to Stripe account credit the user can't withdraw. Both
// callers — account deletion and the webhook's superseded-duplicate cleanup —
// share this so the behavior can't drift between them.

/**
 * Refund a paid subscription period to the card.
 *
 * Two modes, and picking the right one is a fairness decision, not a technical
 * one:
 *
 * - `"prorated"` (default) — `amount_paid * (time_remaining / period_length)`
 *   of the most recent paid invoice. Correct when the subscription was
 *   legitimate and is ending early: they had the thing for the elapsed part.
 *
 * - `"full"` — the whole invoice. Correct when the charge should never have
 *   existed at all. A duplicate subscription is the case this was added for:
 *   prorating it means the user eats the elapsed portion of a charge that was
 *   OUR bug, which is less generous than the refund policy we publish
 *   ("If you were charged because of a bug on our side… we'll refund it").
 *   Caught seconds later the two modes agree; caught after months — the real
 *   incident, a Portal plan switch that left both subscriptions live — they do
 *   not, and prorating quietly kept most of the money.
 *
 * `amount_paid` is tax-inclusive, so the proportional tax comes back too.
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
  opts: {
    uid: string | null;
    context: string;
    mode?: "prorated" | "full";
    /**
     * The unused fraction as it stood WHEN THE CANCELLATION HAPPENED.
     *
     * Only the admin retry passes this, and it has to. The fraction is
     * normally computed from the clock — correct at the moment of
     * cancellation, and wrong every day after: a retry two days later refunds
     * two days less than was owed, and a retry after the period has ended
     * takes the `remaining <= 0` early return, refunds nothing, writes
     * nothing, and can therefore never be resolved. The alert records the
     * fraction; the retry hands it back.
     */
    fractionOverride?: number;
  }
): Promise<void> {
  const alertRef = db.doc(`billingAlerts/unused-refund-${sub.id}`);
  const full = opts.mode === "full";

  /**
   * Record that money is owed and we could not pay it.
   *
   * The early returns below used to be bare `return`s. Two of them are honest
   * "nothing is owed" cases (a trial that never paid, a period fully elapsed);
   * two are FAILURES TO FIND THE MONEY — no paid invoice, or no payment to
   * refund against. Those wrote nothing, so the money was owed, nothing
   * happened, and nothing was queryable afterward. Worse, the admin console
   * reads the absence of this doc as "nothing owed back" and told an operator
   * exactly that.
   */
  const flagUnpaid = (reason: string, fraction?: number) =>
    alertRef
      .set(
        {
          kind: "unused-portion-refund",
          context: opts.context,
          uid: opts.uid,
          subscriptionId: sub.id,
          mode: full ? "full" : "prorated",
          // Recorded on FAILURE as well as success, because that is when a
          // retry needs it: the fraction owed is a fact about the moment of
          // cancellation, and by the time a human presses Retry the clock has
          // moved.
          ...(fraction !== undefined ? { unusedFraction: fraction } : {}),
          error: reason,
          resolved: false,
          at: Date.now(),
        },
        { merge: true }
      )
      .catch(() => {});

  try {
    // A trial was never paid for — nothing unused to give back.
    if (sub.status === "trialing") return;

    const item = sub.items.data[0];
    const start = item?.current_period_start;
    const end = item?.current_period_end;
    if (!start || !end || end <= start) return;
    const now = Math.floor(Date.now() / 1000);
    const remaining = end - now;
    const liveFraction = Math.min(1, Math.max(0, remaining / (end - start)));
    const unusedFraction = opts.fractionOverride ?? liveFraction;
    // Nothing owed back only when we are computing live. A retry carrying a
    // recorded fraction is settling a debt from an earlier moment, and the
    // clock having moved on since is not a reason to refuse it.
    if (opts.fractionOverride === undefined && remaining <= 0) return;
    if (!full && unusedFraction <= 0) return;

    // Every paid invoice on the subscription, newest first.
    //
    // `full` mode has to walk ALL of them, not just the newest. The case it
    // exists for is a duplicate subscription that ran unnoticed — the real
    // incident was months of double billing — and "refund it in full" that
    // returns one month of six is not a full refund; it is a prorated refund
    // wearing the word. Worse, it then wrote `resolved: true` and the admin
    // console reported the case settled.
    //
    // `prorated` mode is unchanged and still uses only the current period's
    // invoice: earlier periods were used, and were not owed back.
    const invoices = await stripe.invoices.list({
      subscription: sub.id,
      status: "paid",
      limit: 100,
    });
    const paid = invoices.data
      .filter((i) => i.id && (i.amount_paid ?? 0) > 0)
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    if (paid.length === 0) {
      // A comped or 100%-off subscription HAS invoices, all of them zero. That
      // is genuinely nothing owed, and flagging it created a permanent
      // "money owed, unresolved" alert nobody could ever settle — noise in the
      // one queue that is supposed to mean money is outstanding.
      //
      // No invoices AT ALL on a non-trialing subscription is the other case:
      // we cannot find the money, and that IS worth a human's attention.
      if (invoices.data.length > 0) return;
      await flagUnpaid("no-invoices-found", unusedFraction);
      return;
    }

    const targets = full ? paid : paid.slice(0, 1);
    const refundIds: string[] = [];
    const failures: string[] = [];
    let refunded = 0;

    for (const invoice of targets) {
      const invoiceId = invoice.id;
      if (!invoiceId || !invoice.amount_paid) continue;
      const amount = full
        ? invoice.amount_paid
        : Math.floor(invoice.amount_paid * unusedFraction);
      if (amount <= 0) continue;

      // The payment to refund against. This API version keeps it on
      // invoice.payments, not a top-level charge field.
      const pays = await stripe.invoicePayments.list({
        invoice: invoiceId,
        limit: 1,
      });
      const payment = pays.data[0]?.payment;
      const paymentIntent =
        typeof payment?.payment_intent === "string"
          ? payment.payment_intent
          : payment?.payment_intent?.id;
      const charge =
        typeof payment?.charge === "string" ? payment.charge : payment?.charge?.id;
      if (!paymentIntent && !charge) {
        failures.push(`${invoiceId}:no-payment`);
        continue;
      }

      try {
        const refund = await stripe.refunds.create(
          {
            ...(paymentIntent
              ? { payment_intent: paymentIntent }
              : { charge: charge as string }),
            amount,
            reason: "requested_by_customer",
            metadata: {
              reason: opts.context,
              uid: opts.uid ?? "",
              subscriptionId: sub.id,
              invoiceId,
            },
          },
          // Keyed PER INVOICE, not per subscription. A single key across the
          // loop would have made Stripe answer every call after the first with
          // the FIRST refund — so a six-month duplicate refunded one month and
          // reported five successes.
          { idempotencyKey: `unused-refund-${sub.id}-${invoiceId}` }
        );
        refundIds.push(refund.id);
        refunded += amount;
      } catch (err) {
        failures.push(
          `${invoiceId}:${err instanceof Error ? err.message : "failed"}`
        );
      }
    }

    if (refundIds.length === 0) {
      await flagUnpaid(
        failures.length ? failures.join(" | ") : "no-payment-to-refund-against",
        unusedFraction
      );
      return;
    }

    const invoice = targets[0];
    const amount = refunded;
    const refund = { id: refundIds.join(",") };

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
          invoicesRefunded: refundIds.length,
          amount,
          currency: invoice.currency ?? null,
          mode: full ? "full" : "prorated",
          unusedFraction,
          refundId: refund.id,
          // Cleared explicitly. The doc is written with { merge: true }, so a
          // previous FAILED attempt's `error` survived a later success and the
          // admin console showed a settled refund with a red error string
          // attached to it.
          error: null,
          // A partial success is not resolved. Some money went back, some did
          // not, and an operator has to finish it.
          resolved: failures.length === 0,
          ...(failures.length ? { partialFailures: failures.join(" | ") } : {}),
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
          mode: full ? "full" : "prorated",
          error: message,
          resolved: false,
          at: Date.now(),
        },
        { merge: true }
      )
      .catch(() => {});
  }
}
