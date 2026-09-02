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
 *   of the invoice for THE CURRENT PERIOD. Correct when the subscription was
 *   legitimate and is ending early: they had the thing for the elapsed part.
 *
 * - `"full"` — the whole invoice, for every invoice that overlaps the
 *   subscription which superseded this one. Correct when the charge should
 *   never have existed at all. A duplicate subscription is the case this was
 *   added for: prorating it means the user eats the elapsed portion of a
 *   charge that was OUR bug, which is less generous than the refund policy we
 *   publish ("If you were charged because of a bug on our side… we'll refund
 *   it"). Caught seconds later the two modes agree; caught after months — the
 *   real incident, a Portal plan switch that left both subscriptions live —
 *   they do not, and prorating quietly kept most of the money.
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
    /**
     * When the subscription that SUPERSEDED this one started, in epoch
     * seconds — only `full` mode reads it.
     *
     * `full` mode is for a duplicate that ran unnoticed, and what was
     * double-charged is the overlap between the two subscriptions. Periods
     * that ended before the kept subscription existed were single-billed
     * service that we actually delivered, and refunding those was refunding
     * two years of legitimate weekly service on the strength of one
     * duplicated month.
     *
     * app/api/stripe/webhook/route.ts passes the KEPT subscription's
     * `start_date` here; it holds that object at the call site. Its
     * `current_period_start` is the wrong field and was the wrong advice: that
     * is the kept subscription's LATEST billing cycle, a month old on a
     * monthly plan no matter how long the two subscriptions have overlapped,
     * so it refunds the last month of a six-month duplicate.
     *
     * Optional because the webhook is the only caller that can know it — when
     * it is absent we fall back to the superseded subscription's own current
     * period, which can refund far less than is owed. A guessed cutoff is
     * recorded as `overlapCutoffGuessed` on the alert, because a guess that
     * under-refunds looks exactly like a correct refund otherwise, and this is
     * the one direction of error a customer cannot see and we cannot defend.
     */
    supersededAfter?: number;
  }
): Promise<void> {
  const alertRef = db.doc(`billingAlerts/unused-refund-${sub.id}`);
  const full = opts.mode === "full";
  /**
   * Did we have to guess where the double billing started?
   *
   * Recorded on every alert `full` mode writes, and deliberately as a boolean
   * rather than only when true: the doc is merged, so a `true` left by an
   * earlier guessed attempt would otherwise outlive the computed retry that
   * corrected it — the same trap the `error: null` below exists to close.
   */
  const overlapCutoffGuessed = full && opts.supersededAfter === undefined;

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
          ...(full ? { overlapCutoffGuessed } : {}),
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
    // `full` mode has to walk more than the newest. The case it exists for is
    // a duplicate subscription that ran unnoticed — the real incident was
    // months of double billing — and "refund it in full" that returns one
    // month of six is not a full refund; it is a prorated refund wearing the
    // word. Worse, it then wrote `resolved: true` and the admin console
    // reported the case settled.
    //
    // `prorated` mode wants the current period's invoice only: earlier periods
    // were used, and are not owed back.
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

    // Which of those invoices is money we owe back.
    //
    // Prorated: the invoice for THE CURRENT PERIOD, matched on the period
    // bounds rather than taken as "the newest paid one". `past_due` and
    // `unpaid` are both in lib/accountDeletion's LIVE_SUB and both land here,
    // and on those the current period's charge is precisely the one that
    // FAILED — so the newest PAID invoice is the previous period, which the
    // user consumed in full. A monthly subscriber whose month-2 charge bounced
    // was deleting on day 2 of month 2 and getting ~97% of month 1 back.
    //
    // Full: the invoices whose service reaches into the kept subscription's
    // life (see `supersededAfter`). Everything that ended before it was
    // single-billed service, delivered.
    const cutoff = full ? opts.supersededAfter ?? start : 0;
    const targets = full
      ? paid.filter((i) => invoiceServiceEnd(i) >= cutoff)
      : paid.filter((i) => coversPeriodStart(i, start));
    if (targets.length === 0) {
      // Paid invoices exist but none of them is ours to give back. In prorated
      // mode that is exactly the `past_due` case and genuinely nothing is
      // owed — but "the period was never paid for" and "we could not identify
      // the period's invoice" are indistinguishable from in here, and getting
      // it wrong costs a month either way, so an operator decides.
      await flagUnpaid(
        full ? "no-invoice-overlapping-kept-subscription" : "no-invoice-for-current-period",
        unusedFraction
      );
      return;
    }

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
          // A guessed cutoff still refunds money and still writes
          // `resolved: true` — some of the money did go back, and reopening
          // every one of these would bury the queue. What it must not do is
          // look identical to a computed refund, which is what let a
          // $24-of-$72 refund read as settled.
          ...(full ? { overlapCutoffGuessed } : {}),
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

    // Tell the person whose money it is.
    //
    // Every refund in here is one Elovox decided on by itself — a superseded
    // subscription, an early cancellation — so nobody is expecting it, and an
    // unexplained credit on a card statement reads as a billing error, not as
    // the app doing the right thing. Stripe's own receipt says "refund" and
    // nothing about why.
    //
    // Best-effort, after the durable alert is written, and it cannot throw:
    // this whole module's contract is that a refund never fails the caller.
    await notifyRefund(db, opts.uid, amount, invoice.currency ?? "usd").catch(
      () => {}
    );
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
          ...(full ? { overlapCutoffGuessed } : {}),
          error: message,
          resolved: false,
          at: Date.now(),
        },
        { merge: true }
      )
      .catch(() => {});
  }
}

/**
 * Does this invoice bill the period that starts at `start`?
 *
 * Both spellings are accepted because Stripe fills them differently: the line
 * item's `period.start` is the service window being billed (what
 * `current_period_start` is comparable to), while the invoice's own
 * `period_start` is the window in which items could be attached — on a
 * subscription renewal those coincide, on an invoice carrying a proration they
 * do not. Matching either is what keeps a legitimate current-period invoice
 * from being read as "no invoice for this period" and flagged instead of
 * refunded.
 */
function coversPeriodStart(invoice: Stripe.Invoice, start: number): boolean {
  if (invoice.period_start === start) return true;
  return (invoice.lines?.data ?? []).some((line) => line.period?.start === start);
}

/**
 * The last moment this invoice paid for anything, used to decide whether it
 * overlaps a later subscription. The line period is the real answer; the
 * invoice period and then `created` are fallbacks for invoices that carry
 * neither (and `created` is always present). The latest of the three, so a
 * borderline invoice is kept and refunded rather than silently dropped.
 */
function invoiceServiceEnd(invoice: Stripe.Invoice): number {
  const lineEnd = (invoice.lines?.data ?? []).reduce(
    (max, line) => Math.max(max, line.period?.end ?? 0),
    0
  );
  return Math.max(lineEnd, invoice.period_end ?? 0, invoice.created ?? 0);
}

/**
 * Stripe's zero-decimal currencies: the amount is already in whole units, not
 * hundredths. https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

/**
 * The "money is on its way back" email.
 *
 * Separate from the refund itself so the refund path stays readable and so
 * this can never affect it: every failure here is swallowed, including the
 * account having been deleted between the refund and this call — which is the
 * normal case for the deletion path, where there is deliberately nobody left
 * to email.
 *
 * Category "billing": non-optional, no unsubscribe link. A refund notice is
 * not marketing and a user cannot have opted out of being told about their
 * own money.
 */
async function notifyRefund(
  db: Firestore,
  uid: string | null,
  amountMinor: number,
  currency: string
): Promise<void> {
  if (!uid || amountMinor <= 0) return;
  const { isMailConfigured } = await import("./email/config");
  if (!isMailConfigured()) return;

  const { getAdminApp } = await import("./firebaseAdmin");
  const app = getAdminApp();
  if (!app) return;

  const { getAuth } = await import("firebase-admin/auth");
  let email: string | null = null;
  try {
    const user = await getAuth(app).getUser(uid);
    // Unverified addresses are never mailed. See the same rule in the Stripe
    // webhook and in lib/email/campaigns.ts.
    if (user.emailVerified && user.email) email = user.email;
  } catch {
    // Account gone — the account-deletion path refunds on the way out, so
    // this is expected, not an error.
    return;
  }
  if (!email) return;

  // Stripe amounts to a formatted amount. Intl knows how many decimal places
  // each currency PRINTS; it does not know how Stripe SENT the number, and the
  // old comment here claimed the /100 was conditional while the code applied
  // it to everything. A ¥1,000 refund was mailed out as "¥10" — the card got
  // the right money, the email told the user it was a hundredth of it.
  const code = currency.toUpperCase();
  const amount = ZERO_DECIMAL_CURRENCIES.has(code) ? amountMinor : amountMinor / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
  }).format(amount);

  const { send } = await import("./email/send");
  const { refundIssued } = await import("./email/messages");
  await send(db, refundIssued(email, uid, formatted));
}
