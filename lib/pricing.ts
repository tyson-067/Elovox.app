// Elovox Premium pricing — the single source of truth for the pricing page
// and the Stripe checkout call.
//
// Freemium: Free stays free forever (the daily speech + 3 attempts). Premium
// unlocks everything, billed on one of three cycles. Monthly and annual open
// with a 7-day free trial; weekly is charged from day one. The cycles are priced so the effective per-week rate falls
// as the commitment grows — weekly is the impulse rate, annual is the best
// deal — which is what makes the longer plans the obvious value.
//
// Price IDs come from the environment via `stripePriceIdFor` below; the
// checkout button looks the plan up by cycle. The webhook then writes
// `plan: "premium"` on users/{uid}/profile/plan (see lib/plan.ts).

export type BillingCycle = "weekly" | "monthly" | "annual";

export interface PricingPlan {
  cycle: BillingCycle;
  label: string; // "Weekly"
  price: number; // headline charge per billing period, USD
  unit: string; // billed-every noun: "week" | "month" | "year"
  perWeek: number; // effective cost per week — the apples-to-apples rate
  trialDays: number; // free-trial length for THIS cycle (see TRIAL_DAYS note)
  badge?: string; // short marketing tag on the toggle/card
  highlight?: boolean; // the recommended plan
}

/**
 * Default trial length, and the number shown in the marketing copy. Applies
 * to the monthly and annual plans; the weekly plan has no trial at all (a
 * trial on a 7-day billing period is a free week that mostly never converts).
 *
 * This is the ONLY place the trial is defined — verified against the live
 * Prices, which all have `recurring.trial_period_days = null`. Checkout
 * passes the number from here, so changing it here is sufficient; don't add
 * a trial to the Prices in the dashboard or the two will fight.
 */
export const TRIAL_DAYS = 7;

/** Does this plan open with a free trial? Weekly does not. */
export function hasTrial(plan: PricingPlan): boolean {
  return plan.trialDays > 0;
}

/**
 * Stripe Price ID for a cycle, read from the environment (server-side).
 * Price IDs aren't secrets, but they differ between test and live mode, so
 * they live in env rather than in source. Checkout looks the plan up here.
 */
export function stripePriceIdFor(cycle: BillingCycle): string | undefined {
  switch (cycle) {
    case "weekly":
      return process.env.STRIPE_PRICE_WEEKLY;
    case "monthly":
      return process.env.STRIPE_PRICE_MONTHLY;
    case "annual":
      return process.env.STRIPE_PRICE_ANNUAL;
  }
}

/** Reverse lookup: which cycle a Stripe Price ID belongs to. */
export function cycleForPriceId(priceId: string): BillingCycle | undefined {
  if (priceId === process.env.STRIPE_PRICE_WEEKLY) return "weekly";
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_ANNUAL) return "annual";
  return undefined;
}

// Plan switching & proration are handled by the Stripe Customer Portal
// (see /api/stripe/portal), configured in the dashboard as: switching
// allowed between all three prices, "Create prorations" on — so an upgrade
// (e.g. weekly → annual) charges the prorated difference immediately and a
// downgrade credits the unused time forward. We deliberately do NOT run a
// custom proration endpoint; the Portal is the tested path.

// A month isn't four weeks — averaging avoids overstating the monthly plan's
// per-week rate (and thus its discount).
const WEEKS_PER_YEAR = 52;
const WEEKS_PER_MONTH = WEEKS_PER_YEAR / 12; // ≈ 4.333

export const PLANS: PricingPlan[] = [
  {
    cycle: "weekly",
    label: "Weekly",
    price: 4.99,
    unit: "week",
    perWeek: 4.99,
    trialDays: 0, // no trial: a free week on a weekly plan rarely converts
    badge: "Most flexible",
  },
  {
    cycle: "monthly",
    label: "Monthly",
    price: 11.99,
    unit: "month",
    perWeek: 11.99 / WEEKS_PER_MONTH, // ≈ 2.77
    trialDays: TRIAL_DAYS,
    badge: "Most popular",
  },
  {
    cycle: "annual",
    label: "Annual",
    price: 79.99,
    unit: "year",
    perWeek: 79.99 / WEEKS_PER_YEAR, // ≈ 1.54
    trialDays: TRIAL_DAYS,
    badge: "Best value",
    highlight: true,
  },
];

export function planFor(cycle: BillingCycle): PricingPlan {
  return PLANS.find((p) => p.cycle === cycle) ?? PLANS[0];
}

/**
 * How much cheaper this plan is, per week, than paying weekly — the number
 * that makes the longer commitments obviously the better deal. 0 for weekly.
 */
export function savingsVsWeekly(plan: PricingPlan): number {
  const weekly = PLANS[0].perWeek;
  return Math.round((1 - plan.perWeek / weekly) * 100);
}

/** Equivalent monthly spend, for showing the annual plan in familiar terms. */
export function perMonth(plan: PricingPlan): number {
  if (plan.cycle === "monthly") return plan.price;
  if (plan.cycle === "annual") return plan.price / 12;
  return plan.perWeek * (WEEKS_PER_YEAR / 12);
}

/** "$6.99" for cents, "$90" for round dollars. */
export function formatUSD(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
