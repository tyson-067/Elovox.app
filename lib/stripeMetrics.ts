import type Stripe from "stripe";

/**
 * Real revenue, read from Stripe.
 *
 * The admin Overview has always shown an ESTIMATE: list price × the count of
 * active subscriptions in our own Firestore. That number answers "roughly what
 * should the subscriber base bill" and it is wrong the moment anything real
 * happens to it — a coupon, a proration, a failed card, a refund, tax, a
 * currency that isn't USD, or a subscription Stripe knows about and our webhook
 * missed. Stripe is the book of record for money; this module asks it.
 *
 * Two different questions, deliberately kept apart:
 *
 *   GROSS VOLUME is cash that moved, over a window. It comes from BALANCE
 *   TRANSACTIONS rather than charges, because balance transactions are what the
 *   Stripe dashboard's own "Gross volume" is built from: they are denominated
 *   in the settlement currency, they carry the fee and the net, and refunds
 *   appear as their own rows so "gross" and "net of refunds" are both honest
 *   rather than one being inferred.
 *
 *   MRR is a rate, not a window: what the currently-live subscriptions bill per
 *   month, normalised across weekly/monthly/annual. ARR is MRR × 12 — the
 *   convention, and it is a projection, not money received.
 *
 * Everything is returned in MINOR UNITS (cents) exactly as Stripe stores it,
 * and bucketed BY CURRENCY. No cross-currency addition happens anywhere in
 * here: summing 100 usd and 100 eur into "200" is the one arithmetic error a
 * revenue dashboard must never make, and Stripe accounts can and do settle in
 * more than one.
 */

/* --- Periods ---------------------------------------------------------------
   Windows an operator actually asks for. `mtd` is calendar month-to-date,
   which is the one that lines up with the Stripe dashboard's default view. */
export const REVENUE_PERIODS = ["7d", "30d", "mtd", "90d", "12m"] as const;
export type RevenuePeriod = (typeof REVENUE_PERIODS)[number];

export function isRevenuePeriod(v: unknown): v is RevenuePeriod {
  return (
    typeof v === "string" && (REVENUE_PERIODS as readonly string[]).includes(v)
  );
}

export const PERIOD_LABELS: Record<RevenuePeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  mtd: "Month to date",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
};

const DAY_MS = 86_400_000;

/** Window bounds in epoch SECONDS, which is what Stripe's `created` filter wants. */
export function periodRange(
  period: RevenuePeriod,
  now = Date.now()
): { fromSec: number; toSec: number; fromMs: number; toMs: number } {
  const toMs = now;
  let fromMs: number;
  switch (period) {
    case "7d":
      fromMs = now - 7 * DAY_MS;
      break;
    case "30d":
      fromMs = now - 30 * DAY_MS;
      break;
    case "mtd": {
      // Calendar month in the SERVER's zone (UTC on Vercel). Named "month to
      // date" rather than "this month" because that distinction is the whole
      // reason it can disagree with a dashboard set to a local timezone.
      const d = new Date(now);
      fromMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      break;
    }
    case "90d":
      fromMs = now - 90 * DAY_MS;
      break;
    case "12m": {
      const d = new Date(now);
      fromMs = Date.UTC(
        d.getUTCFullYear() - 1,
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes()
      );
      break;
    }
  }
  return {
    fromMs,
    toMs,
    fromSec: Math.floor(fromMs / 1000),
    toSec: Math.floor(toMs / 1000),
  };
}

/* --- Volume ---------------------------------------------------------------- */

export interface VolumeByCurrency {
  currency: string;
  /** Successful payments in the window, before refunds and before fees. */
  gross: number;
  /** Money returned in the window, as a POSITIVE number. */
  refunds: number;
  /** gross − refunds. What the customer base actually paid, net of returns. */
  netOfRefunds: number;
  /** Stripe's cut on everything in the window, as a positive number. */
  fees: number;
  /** What actually landed in the balance: gross − refunds − fees. */
  net: number;
  charges: number;
  refundCount: number;
}

export interface VolumeResult {
  byCurrency: VolumeByCurrency[];
  /** True when the transaction cap was hit and these totals undercount. */
  truncated: boolean;
  scanned: number;
}

/**
 * Which balance-transaction types are a customer payment, and which are money
 * going back. Everything else in the (very long) type union — payouts,
 * transfers, topups, issuing, climate orders — is the money moving around our
 * own account rather than arriving from or returning to a customer, and adding
 * any of it to "gross volume" would double-count.
 */
const PAYMENT_TYPES = new Set<Stripe.BalanceTransaction.Type>([
  "charge",
  "payment",
]);
const REFUND_TYPES = new Set<Stripe.BalanceTransaction.Type>([
  "refund",
  "payment_refund",
  "payment_reversal",
  "payment_failure_refund",
]);

/** A hard ceiling, so one call can never page through a huge account forever. */
const MAX_TXNS = 10_000;

export async function grossVolume(
  stripe: Stripe,
  period: RevenuePeriod,
  now = Date.now()
): Promise<VolumeResult> {
  const { fromSec, toSec } = periodRange(period, now);
  const buckets = new Map<string, VolumeByCurrency>();
  const bucket = (currency: string): VolumeByCurrency => {
    let b = buckets.get(currency);
    if (!b) {
      b = {
        currency,
        gross: 0,
        refunds: 0,
        netOfRefunds: 0,
        fees: 0,
        net: 0,
        charges: 0,
        refundCount: 0,
      };
      buckets.set(currency, b);
    }
    return b;
  };

  let scanned = 0;
  let truncated = false;

  // autoPagingEach handles the cursor; the counter is what bounds it. Returning
  // false stops the iteration without throwing.
  await stripe.balanceTransactions
    .list({ created: { gte: fromSec, lte: toSec }, limit: 100 })
    .autoPagingEach((txn) => {
      scanned++;
      if (scanned > MAX_TXNS) {
        truncated = true;
        return false;
      }
      const isPayment = PAYMENT_TYPES.has(txn.type);
      const isRefund = REFUND_TYPES.has(txn.type);
      if (!isPayment && !isRefund) return;

      const b = bucket(txn.currency);
      // Stripe signs these for us: a charge is positive, a refund negative.
      // Take the magnitude for `refunds` so the tile can read "$X returned"
      // rather than a negative number the reader has to interpret.
      if (isPayment) {
        b.gross += txn.amount;
        b.charges++;
      } else {
        b.refunds += Math.abs(txn.amount);
        b.refundCount++;
      }
      b.fees += txn.fee;
      b.net += txn.net;
    });

  for (const b of buckets.values()) {
    b.netOfRefunds = b.gross - b.refunds;
  }

  return {
    byCurrency: [...buckets.values()].sort((a, b) => b.gross - a.gross),
    truncated,
    scanned,
  };
}

/* --- MRR ------------------------------------------------------------------- */

/**
 * How many months one billing period is worth.
 *
 * Weeks and days do not divide into months, so they are converted through the
 * average month (365.25/12 = 30.4375 days). A weekly plan is therefore ~4.348
 * billings a month, NOT 4 — using 4 would understate every weekly subscriber's
 * MRR by about 8%, and weekly is one of the three plans Elovox actually sells.
 */
const DAYS_PER_MONTH = 365.25 / 12;

function monthsPerPeriod(interval: string, count: number): number | null {
  switch (interval) {
    case "month":
      return count;
    case "year":
      return count * 12;
    case "week":
      return (count * 7) / DAYS_PER_MONTH;
    case "day":
      return count / DAYS_PER_MONTH;
    default:
      return null;
  }
}

export interface RecurringByCurrency {
  currency: string;
  /** Minor units per month, from live subscriptions. */
  mrr: number;
  /** mrr × 12. A projection of the current rate, not money received. */
  arr: number;
  /** What trials would add if every one of them converted at today's price. */
  trialMrr: number;
}

export interface RecurringResult {
  byCurrency: RecurringByCurrency[];
  counts: {
    active: number;
    pastDue: number;
    trialing: number;
    /** Of the counted subscriptions, how many are set to end at period end. */
    cancelingAtPeriodEnd: number;
  };
  /**
   * Subscription items we could not price (metered or tiered prices carry no
   * `unit_amount`). Non-zero means MRR is an undercount and says so.
   */
  unpricedItems: number;
  truncated: boolean;
}

const MAX_SUBS = 5_000;

/** Discounts that keep applying to future invoices. A `once` coupon does not. */
function recurringDiscountFactor(
  sub: Stripe.Subscription,
  now: number
): {
  percentFactor: number;
  amountOff: number;
} {
  let percentFactor = 1;
  let amountOff = 0;
  for (const d of sub.discounts ?? []) {
    // Unexpanded discounts arrive as bare ids, and so does the coupon inside a
    // discount (it hangs off `source.coupon` in this API version, not off the
    // discount directly). Without the coupon object we cannot know the size of
    // the reduction, so we leave the number alone rather than guess — the
    // caller expands `discounts.source.coupon`, so this is a guard, not the
    // normal path.
    if (typeof d === "string") continue;
    // A `repeating` coupon carries the date it stops applying. Past that date
    // it is no longer reducing anything, and counting it would keep MRR
    // permanently depressed by a discount that has already run out.
    if (typeof d.end === "number" && d.end * 1000 <= now) continue;
    const coupon = d.source?.coupon;
    if (!coupon || typeof coupon === "string") continue;
    if (coupon.duration === "once") continue;
    if (typeof coupon.percent_off === "number") {
      percentFactor *= 1 - coupon.percent_off / 100;
    }
    if (typeof coupon.amount_off === "number") {
      amountOff += coupon.amount_off;
    }
  }
  return { percentFactor, amountOff };
}

/**
 * MRR from the subscriptions Stripe currently holds.
 *
 * WHICH SUBSCRIPTIONS COUNT, and why:
 *   active    — yes. This is the definition.
 *   past_due  — yes. The subscription is live and Stripe is still retrying the
 *               card; dropping it would make MRR lurch down and back up over a
 *               dunning cycle that usually recovers.
 *   trialing  — NO, counted separately as `trialMrr`. A trial bills nothing
 *               today, and Elovox opens monthly and annual with seven free
 *               days, so folding trials in would report revenue that does not
 *               exist yet. Reported beside it because "what converts if the
 *               current trials land" is a real question.
 *   everything else (canceled, incomplete, incomplete_expired, unpaid, paused)
 *             — no. None of them will bill.
 */
export async function recurringRevenue(
  stripe: Stripe,
  now = Date.now()
): Promise<RecurringResult> {
  const buckets = new Map<string, RecurringByCurrency>();
  const bucket = (currency: string): RecurringByCurrency => {
    let b = buckets.get(currency);
    if (!b) {
      b = { currency, mrr: 0, arr: 0, trialMrr: 0 };
      buckets.set(currency, b);
    }
    return b;
  };

  const counts = {
    active: 0,
    pastDue: 0,
    trialing: 0,
    cancelingAtPeriodEnd: 0,
  };
  let unpricedItems = 0;
  let scanned = 0;
  let truncated = false;

  // `status: "all"` in one pass rather than three filtered passes: the trial
  // and past-due numbers come from the same walk, and one list call with a
  // cursor is cheaper on the rate limit than three.
  await stripe.subscriptions
    .list({
      status: "all",
      limit: 100,
      // Four levels, which is Stripe's maximum — and the coupon is genuinely
      // four deep (data → discounts → source → coupon). Without it every
      // discounted subscription is silently counted at list price.
      expand: ["data.discounts.source.coupon"],
    })
    .autoPagingEach((sub) => {
      scanned++;
      if (scanned > MAX_SUBS) {
        truncated = true;
        return false;
      }

      const status = sub.status;
      const counted = status === "active" || status === "past_due";
      const isTrial = status === "trialing";
      if (!counted && !isTrial) return;

      if (status === "active") counts.active++;
      if (status === "past_due") counts.pastDue++;
      if (isTrial) counts.trialing++;
      if (sub.cancel_at_period_end) counts.cancelingAtPeriodEnd++;

      const { percentFactor, amountOff } = recurringDiscountFactor(sub, now);

      let subMonthly = 0;
      let currency = sub.currency;
      for (const item of sub.items.data) {
        const price = item.price;
        const recurring = price?.recurring;
        if (!recurring) continue; // a one-off line on a subscription
        if (typeof price.unit_amount !== "number") {
          // Metered or tiered: the amount depends on usage we cannot read from
          // the price alone. Counted so the caller can say the total is a floor.
          unpricedItems++;
          continue;
        }
        const months = monthsPerPeriod(
          recurring.interval,
          recurring.interval_count || 1
        );
        if (!months || months <= 0) continue;
        currency = price.currency || currency;
        subMonthly += (price.unit_amount * (item.quantity ?? 1)) / months;
      }

      if (subMonthly <= 0) return;
      // Percentage first, then the flat amount — the order Stripe applies them
      // in, and it changes the answer whenever both are present.
      subMonthly = Math.max(0, subMonthly * percentFactor - amountOff);

      const b = bucket(currency);
      if (isTrial) b.trialMrr += subMonthly;
      else b.mrr += subMonthly;
    });

  for (const b of buckets.values()) {
    b.mrr = Math.round(b.mrr);
    b.trialMrr = Math.round(b.trialMrr);
    b.arr = b.mrr * 12;
  }

  return {
    byCurrency: [...buckets.values()].sort((a, b) => b.mrr - a.mrr),
    counts,
    unpricedItems,
    truncated,
  };
}

/* --- Formatting ------------------------------------------------------------ */

/**
 * Minor units → a display string in that currency.
 *
 * Zero-decimal currencies (JPY, KRW, …) do NOT have minor units, so dividing
 * them by 100 would report a hundredth of the real figure. Intl knows which is
 * which; ask it rather than assuming two decimals everywhere.
 */
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
  "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

export function minorToMajor(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100;
}

export function formatMoney(amount: number, currency: string): string {
  const major = minorToMajor(amount, currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : 2,
    }).format(major);
  } catch {
    // An unknown code should still print a number rather than throwing.
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}
