import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/firestore-fake";

/* ---------------------------------------------------------------------------
   lib/refunds is the only code in the app that moves money BACK, and it is
   called from paths nobody is watching: an account deletion the user has
   already walked away from, and a webhook cleaning up a duplicate
   subscription. Every branch here is one where getting it wrong is a real
   charge on a real card that nobody notices, so the cases pinned below are
   the ones that decide an AMOUNT, not the plumbing around them:

     - prorated mode must refund the CURRENT period's invoice, and refund
       nothing when the current period was never paid for (past_due)
     - full mode must refund the overlap with the kept subscription, not the
       whole invoice history
     - the email must state the amount Stripe actually sent back, which for a
       zero-decimal currency is not amount/100
   --------------------------------------------------------------------------- */

const send = vi.fn().mockResolvedValue({ ok: true });
const getUser = vi.fn().mockResolvedValue({ emailVerified: true, email: "u@example.com" });
let mailConfigured = false;

vi.mock("@/lib/email/send", () => ({ send: (...a: unknown[]) => send(...a) }));
vi.mock("@/lib/email/config", () => ({
  isMailConfigured: () => mailConfigured,
  siteUrl: () => "https://elovox.app",
}));
vi.mock("@/lib/firebaseAdmin", () => ({ getAdminApp: () => ({}) }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: (...a: unknown[]) => getUser(...a) }),
}));

const { refundUnusedPortion } = await import("@/lib/refunds");

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const ALERT = "billingAlerts/unused-refund-sub_1";

/** A paid invoice covering one service period, shaped as Stripe returns it. */
function invoice(
  id: string,
  periodStart: number,
  periodEnd: number,
  over: Record<string, unknown> = {}
) {
  return {
    id,
    amount_paid: 1200,
    currency: "usd",
    created: periodStart,
    // Stripe's invoice-level period is the item-attachment window, which on a
    // renewal is a moment at the start of the period, not the period itself.
    period_start: periodStart,
    period_end: periodStart,
    lines: { data: [{ period: { start: periodStart, end: periodEnd } }] },
    ...over,
  };
}

function subscription(periodStart: number, periodEnd: number, status = "active") {
  return {
    id: "sub_1",
    status,
    customer: "cus_1",
    items: {
      data: [{ current_period_start: periodStart, current_period_end: periodEnd }],
    },
  };
}

/**
 * `fee` opts in to the charge Stripe actually settled. Left off, the payment
 * carries no charge id at all — which is the pre-existing shape every test
 * below was written against, and the path where the fee cannot be read.
 */
function makeStripe(
  invoices: unknown[],
  fee?: { cents: number } | { throws: true }
) {
  let n = 0;
  const hasCharge = fee !== undefined;
  return {
    invoices: { list: vi.fn().mockResolvedValue({ data: invoices }) },
    invoicePayments: {
      list: vi.fn().mockResolvedValue({
        data: [
          {
            payment: {
              payment_intent: "pi_1",
              ...(hasCharge ? { charge: "ch_1" } : {}),
            },
          },
        ],
      }),
    },
    charges: {
      retrieve: vi.fn().mockImplementation(async () => {
        if (fee && "throws" in fee) throw new Error("stripe down");
        return { balance_transaction: { fee: (fee as { cents: number }).cents } };
      }),
    },
    refunds: {
      create: vi.fn().mockImplementation(async () => ({ id: `re_${++n}` })),
    },
  };
}

/** Amounts passed to stripe.refunds.create, in call order. */
function refundedAmounts(stripe: ReturnType<typeof makeStripe>) {
  return stripe.refunds.create.mock.calls.map(
    (call) => (call[0] as { amount: number }).amount
  );
}

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mailConfigured = false;
  db = makeDb();
});

describe("refundUnusedPortion — prorated", () => {
  it("refunds the invoice that bills the current period", async () => {
    const stripe = makeStripe([
      invoice("in_current", NOW - 2 * DAY, NOW + 28 * DAY),
      invoice("in_previous", NOW - 32 * DAY, NOW - 2 * DAY),
    ]);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 2 * DAY, NOW + 28 * DAY) as never,
      { uid: "u1", context: "test" }
    );

    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create.mock.calls[0][0]).toMatchObject({
      metadata: { invoiceId: "in_current" },
    });
    expect(db.data.get(ALERT)).toMatchObject({ resolved: true, invoiceId: "in_current" });
  });

  it("refunds NOTHING when the current period was never paid, and flags it", async () => {
    // The past_due shape: month 1 was paid and consumed, month 2's charge
    // failed, so the newest PAID invoice is a period the user used in full.
    // Refunding a fraction of it handed a defaulting subscriber ~97% of a
    // month they had.
    const stripe = makeStripe([invoice("in_month1", NOW - 32 * DAY, NOW - 2 * DAY)]);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 2 * DAY, NOW + 28 * DAY, "past_due") as never,
      { uid: "u1", context: "account-deletion" }
    );

    expect(stripe.refunds.create).not.toHaveBeenCalled();
    const alert = db.data.get(ALERT);
    expect(alert).toMatchObject({
      error: "no-invoice-for-current-period",
      resolved: false,
      mode: "prorated",
    });
    // The fraction owed is recorded even on the failure path, because that is
    // what an operator's Retry needs after the clock has moved.
    expect(typeof alert?.unusedFraction).toBe("number");
  });

  it("matches the current period on the invoice's own period_start too", async () => {
    // An invoice with no usable line period still identifies its period at the
    // top level; treating that as "no invoice for this period" would flag a
    // refund that is plainly owed.
    const start = NOW - 5 * DAY;
    const stripe = makeStripe([
      { ...invoice("in_flat", start, NOW + 25 * DAY), lines: { data: [] } },
    ]);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(start, NOW + 25 * DAY) as never,
      { uid: "u1", context: "test" }
    );

    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
});

describe("refundUnusedPortion — full", () => {
  it("refunds only the invoices overlapping the kept subscription", async () => {
    const stripe = makeStripe([
      invoice("in_now", NOW - 10 * DAY, NOW + 20 * DAY),
      invoice("in_lastmonth", NOW - 40 * DAY, NOW - 10 * DAY),
      invoice("in_ancient", NOW - 400 * DAY, NOW - 370 * DAY),
    ]);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 10 * DAY, NOW + 20 * DAY) as never,
      {
        uid: "u1",
        context: "superseded-subscription",
        mode: "full",
        // The kept subscription began 20 days ago, so the overlap is the last
        // two invoices; the year-old one was single-billed service.
        supersededAfter: NOW - 20 * DAY,
      }
    );

    expect(stripe.refunds.create).toHaveBeenCalledTimes(2);
    const ids = stripe.refunds.create.mock.calls.map(
      (call) => (call[0] as { metadata: { invoiceId: string } }).metadata.invoiceId
    );
    expect(ids).toEqual(["in_now", "in_lastmonth"]);
    expect(refundedAmounts(stripe)).toEqual([1200, 1200]);
    // Per-invoice idempotency keys, so a retry cannot collapse into the first
    // refund and report the rest as successes.
    expect(stripe.refunds.create.mock.calls.map((call) => call[1])).toEqual([
      { idempotencyKey: "unused-refund-sub_1-in_now" },
      { idempotencyKey: "unused-refund-sub_1-in_lastmonth" },
    ]);
  });

  it("refunds a whole contiguous duplicate history, not just the newest periods", async () => {
    // The incident this mode exists for: six months of monthly double billing
    // found at once. The kept subscription started before any of it, so all
    // six invoices are money we took twice.
    const months = [0, 1, 2, 3, 4, 5].map((m) =>
      invoice(`in_${m}`, NOW - (m + 1) * 30 * DAY + 20 * DAY, NOW - m * 30 * DAY + 20 * DAY)
    );
    const stripe = makeStripe(months);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 10 * DAY, NOW + 20 * DAY) as never,
      {
        uid: "u1",
        context: "superseded-subscription",
        mode: "full",
        supersededAfter: NOW - 170 * DAY,
      }
    );

    expect(refundedAmounts(stripe)).toEqual([1200, 1200, 1200, 1200, 1200, 1200]);
    expect(db.data.get(ALERT)).toMatchObject({
      amount: 7200,
      invoicesRefunded: 6,
      resolved: true,
      overlapCutoffGuessed: false,
    });
  });

  it("falls back to the current period, and says so, when given no overlap start", async () => {
    // The same six months with the cutoff unknown: the fallback refunds only
    // what reaches into the superseded sub's own current period — 2400 of
    // 7200 — which is the right conservative guess and the wrong answer. It
    // must be labelled as a guess, because the alert is otherwise identical
    // to the correct refund above and nobody would ever look at it again.
    const months = [0, 1, 2, 3, 4, 5].map((m) =>
      invoice(`in_${m}`, NOW - (m + 1) * 30 * DAY + 20 * DAY, NOW - m * 30 * DAY + 20 * DAY)
    );
    const stripe = makeStripe(months);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 10 * DAY, NOW + 20 * DAY) as never,
      { uid: "u1", context: "superseded-subscription", mode: "full" }
    );

    expect(refundedAmounts(stripe)).toEqual([1200, 1200]);
    expect(db.data.get(ALERT)).toMatchObject({
      amount: 2400,
      resolved: true,
      overlapCutoffGuessed: true,
    });
  });

  it("records the guess on the failure alert too", async () => {
    // Nothing overlaps the guessed cutoff, so no money moves at all. An
    // operator reading "no invoice overlapping the kept subscription" needs to
    // know we never knew where the kept subscription started.
    const stripe = makeStripe([invoice("in_ancient", NOW - 400 * DAY, NOW - 370 * DAY)]);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 10 * DAY, NOW + 20 * DAY) as never,
      { uid: "u1", context: "superseded-subscription", mode: "full" }
    );

    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(db.data.get(ALERT)).toMatchObject({
      error: "no-invoice-overlapping-kept-subscription",
      resolved: false,
      overlapCutoffGuessed: true,
    });
  });

  it("flags rather than refunding when nothing overlaps", async () => {
    const stripe = makeStripe([invoice("in_ancient", NOW - 400 * DAY, NOW - 370 * DAY)]);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 10 * DAY, NOW + 20 * DAY) as never,
      {
        uid: "u1",
        context: "superseded-subscription",
        mode: "full",
        supersededAfter: NOW - 20 * DAY,
      }
    );

    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(db.data.get(ALERT)).toMatchObject({
      error: "no-invoice-overlapping-kept-subscription",
      resolved: false,
      mode: "full",
      overlapCutoffGuessed: false,
    });
  });
});

describe("the refund email", () => {
  it("states a zero-decimal amount without dividing by 100", async () => {
    mailConfigured = true;
    const stripe = makeStripe([
      invoice("in_current", NOW - 2 * DAY, NOW + 28 * DAY, {
        amount_paid: 1000,
        currency: "jpy",
      }),
    ]);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 2 * DAY, NOW + 28 * DAY) as never,
      // The whole period is unused, so the refund is the whole ¥1,000 — an
      // amount Stripe sends in whole yen, not in hundredths.
      { uid: "u1", context: "test", fractionOverride: 1 }
    );

    expect(refundedAmounts(stripe)).toEqual([1000]);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][1] as { subject: string };
    expect(message.subject).toContain("¥1,000");
    expect(message.subject).not.toContain("¥10 ");
  });

  it("still divides a two-decimal currency", async () => {
    mailConfigured = true;
    const stripe = makeStripe([
      invoice("in_current", NOW - 2 * DAY, NOW + 28 * DAY, { amount_paid: 1200 }),
    ]);

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 2 * DAY, NOW + 28 * DAY) as never,
      { uid: "u1", context: "test", fractionOverride: 1 }
    );

    const message = send.mock.calls[0][1] as { subject: string };
    expect(message.subject).toContain("$12.00");
  });
});

describe("the processing fee Stripe keeps", () => {
  /* The hole this closes: /api/account/delete refunds on deletion with no
     operator in the loop (lib/accountDeletion.ts), and Stripe does not return
     its fee when a charge is refunded. Paying back the full amount_paid
     therefore cost us the fee on top of the service already delivered, so
     buy -> use a day -> delete -> repeat was profitable to run against us.
     Netting the fee makes the loop cost the person running it instead. */

  it("takes the prorated share of what we RECEIVED, not of what was charged", async () => {
    // 1200 charged, 65 kept by Stripe, ~99.4% of the period unused.
    const stripe = makeStripe(
      [invoice("in_current", NOW - 1 * DAY, NOW + 364 * DAY)],
      { cents: 65 }
    );

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 1 * DAY, NOW + 364 * DAY) as never,
      { uid: "u1", context: "test" }
    );

    const { amount } = stripe.refunds.create.mock.calls[0][0] as { amount: number };
    // (1200 - 65) * fraction, never (1200) * fraction.
    expect(amount).toBeLessThanOrEqual(1200 - 65);
    expect(amount).toBeGreaterThan(1100);
    // The whole point: the sale can no longer end up net-negative.
    expect(1200 - amount).toBeGreaterThanOrEqual(65);
  });

  it("does NOT net the fee in full mode, because that charge was our bug", async () => {
    // A duplicate subscription is our error. Making the customer absorb our
    // processing cost for a charge that should never have existed would be
    // less generous than /refunds promises.
    const stripe = makeStripe(
      [invoice("in_dupe", NOW - 10 * DAY, NOW + 20 * DAY)],
      { cents: 65 }
    );

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 10 * DAY, NOW + 20 * DAY) as never,
      { uid: "u1", context: "test", mode: "full", supersededAfter: NOW - 400 * DAY }
    );

    const { amount } = stripe.refunds.create.mock.calls[0][0] as { amount: number };
    expect(amount).toBe(1200);
    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
  });

  it("fails OPEN when the fee cannot be read, so the customer gets more rather than less", async () => {
    // Withholding money on the strength of a number we could not confirm is
    // the wrong direction to be wrong in.
    const stripe = makeStripe(
      [invoice("in_current", NOW - 1 * DAY, NOW + 29 * DAY)],
      { throws: true }
    );

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 1 * DAY, NOW + 29 * DAY) as never,
      { uid: "u1", context: "test" }
    );

    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    const { amount } = stripe.refunds.create.mock.calls[0][0] as { amount: number };
    expect(amount).toBeGreaterThan(1100);
  });

  it("never refunds a negative amount when the fee exceeds what is left", async () => {
    const stripe = makeStripe(
      [invoice("in_current", NOW - 1 * DAY, NOW + 29 * DAY)],
      { cents: 5000 }
    );

    await refundUnusedPortion(
      stripe as never,
      db as never,
      subscription(NOW - 1 * DAY, NOW + 29 * DAY) as never,
      { uid: "u1", context: "test" }
    );

    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
});
