import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEntitled } from "@/lib/stripe";
import { PAST_DUE_GRACE_MS, hasComp, pastDueLapsed } from "@/lib/plan";
import { cycleForPriceId } from "@/lib/pricing";

/* ---------------------------------------------------------------------------
   Entitlement is the answer to "is this person paid up", and it is computed in
   two places that must agree: lib/stripe.ts decides what the webhook WRITES,
   lib/plan.ts decides what the client TRUSTS when it reads the doc back. A
   drift between them either strands a paying subscriber on the free tier or
   leaves a dead card holding Premium.
   --------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000; // fixed; Date.now() is stubbed below

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("isEntitled — what the webhook writes", () => {
  it("grants on the two live statuses", () => {
    expect(isEntitled("active")).toBe(true);
    expect(isEntitled("trialing")).toBe(true);
  });

  it("denies every terminal status, period end or not", () => {
    const future = (NOW + 30 * DAY) / 1000;
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"] as const) {
      expect(isEntitled(status), status).toBe(false);
      expect(isEntitled(status, future), `${status} with a future period end`).toBe(false);
    }
  });

  it("keeps past_due alive through the grace window and not past it", () => {
    const endedYesterday = (NOW - DAY) / 1000;
    expect(isEntitled("past_due", endedYesterday)).toBe(true);

    const endedLongAgo = (NOW - (PAST_DUE_GRACE_MS + DAY)) / 1000;
    expect(isEntitled("past_due", endedLongAgo)).toBe(false);
  });

  it("denies past_due with no period end rather than granting indefinitely", () => {
    // Nothing bounds the grace window without it, so the safe answer is no.
    expect(isEntitled("past_due")).toBe(false);
    expect(isEntitled("past_due", undefined)).toBe(false);
  });

  it("takes SECONDS — passing milliseconds grants access for 50,000 years", () => {
    // The webhook receives Stripe epoch seconds; lib/plan.ts's twin takes
    // MILLISECONDS. Two functions answering the same question in different
    // units is a real trap, and this is the assertion that documents it.
    const endedLongAgo = NOW - (PAST_DUE_GRACE_MS + DAY);
    expect(isEntitled("past_due", endedLongAgo / 1000)).toBe(false);
    expect(isEntitled("past_due", endedLongAgo)).toBe(true); // ms misread as s
  });
});

describe("pastDueLapsed — what the client trusts on read", () => {
  it("is false for a healthy record", () => {
    expect(pastDueLapsed({ status: "active", currentPeriodEnd: NOW + DAY })).toBe(false);
    expect(pastDueLapsed(undefined)).toBe(false);
    expect(pastDueLapsed({})).toBe(false);
  });

  it("is false inside the grace window, true past it", () => {
    expect(pastDueLapsed({ status: "past_due", currentPeriodEnd: NOW - DAY })).toBe(false);
    expect(
      pastDueLapsed({ status: "past_due", currentPeriodEnd: NOW - (PAST_DUE_GRACE_MS + DAY) })
    ).toBe(true);
  });

  it("cannot lapse without a period end — an unbounded past_due stays trusted", () => {
    // Deliberate: with no end date there is nothing to measure the grace
    // window from, and revoking on a missing field would strip Premium from
    // anyone whose record predates the field.
    expect(pastDueLapsed({ status: "past_due" })).toBe(false);
  });

  it("agrees with isEntitled everywhere except the boundary instant", () => {
    // The two grace bounds are documented as twins. If one constant moves and
    // the other does not, a subscriber is entitled by the writer and stale to
    // the reader — which shows up as Premium flickering on reload.
    //
    // 14 is excluded on purpose, not because it is awkward: see the test
    // below. Everything either side of it must agree exactly.
    for (const daysAgo of [0, 1, 7, 13, 13.9, 14.1, 15, 30]) {
      const endMs = NOW - daysAgo * DAY;
      const writerSaysEntitled = isEntitled("past_due", endMs / 1000);
      const readerSaysStale = pastDueLapsed({ status: "past_due", currentPeriodEnd: endMs });
      expect(writerSaysEntitled, `${daysAgo}d ago`).toBe(!readerSaysStale);
    }
  });

  it("both use a strict <, so the exact boundary instant is neither", () => {
    // At precisely end + PAST_DUE_GRACE_MS:
    //   isEntitled     asks  now < end + GRACE   -> false, do not grant
    //   pastDueLapsed  asks  end + GRACE < now   -> false, not yet stale
    //
    // So for one millisecond the reader still trusts a stored "premium" the
    // writer would no longer grant. Documented rather than "fixed": the window
    // is 1ms wide, the reader is the FORGIVING side of it (a subscriber keeps
    // access a moment longer, nobody gains it), and making the comparisons
    // agree would mean touching the entitlement rule to buy nothing.
    const endMs = NOW - PAST_DUE_GRACE_MS;
    expect(isEntitled("past_due", endMs / 1000)).toBe(false);
    expect(pastDueLapsed({ status: "past_due", currentPeriodEnd: endMs })).toBe(false);
  });
});

describe("hasComp", () => {
  it("is open only while premiumUntil is still ahead", () => {
    expect(hasComp({ premiumUntil: NOW + DAY } as never)).toBe(true);
    expect(hasComp({ premiumUntil: NOW - 1 } as never)).toBe(false);
    expect(hasComp({} as never)).toBe(false);
    expect(hasComp(null)).toBe(false);
  });
});

describe("cycleForPriceId", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
  });

  it("maps each configured price to its cycle", () => {
    process.env.STRIPE_PRICE_WEEKLY = "price_w";
    process.env.STRIPE_PRICE_MONTHLY = "price_m";
    process.env.STRIPE_PRICE_ANNUAL = "price_a";
    expect(cycleForPriceId("price_w")).toBe("weekly");
    expect(cycleForPriceId("price_m")).toBe("monthly");
    expect(cycleForPriceId("price_a")).toBe("annual");
  });

  it("returns undefined for an unknown price rather than guessing a cycle", () => {
    process.env.STRIPE_PRICE_WEEKLY = "price_w";
    expect(cycleForPriceId("price_from_another_product")).toBeUndefined();
  });

  it("does not match an UNSET price env against an empty id", () => {
    // If all three are unset, `priceId === undefined` would be true for an
    // empty string and every subscription would come back "weekly".
    delete process.env.STRIPE_PRICE_WEEKLY;
    delete process.env.STRIPE_PRICE_MONTHLY;
    delete process.env.STRIPE_PRICE_ANNUAL;
    expect(cycleForPriceId("")).toBeUndefined();
  });
});
