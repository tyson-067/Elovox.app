import Stripe from "stripe";

// Server-side Stripe client. The secret key never reaches the browser; every
// call here runs inside an /api/stripe route handler.
//
// We pin nothing on apiVersion — the installed SDK (stripe@22) already targets
// a fixed API version, and letting it own that avoids type drift on upgrades.

let cached: Stripe | null = null;

/** The Stripe client, or null when STRIPE_SECRET_KEY isn't configured. */
export function getStripe(): Stripe | null {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  cached = new Stripe(key);
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Maps a Stripe subscription status to our single entitlement bit. Trialing
 * and active both grant Premium; `past_due` keeps access during Stripe's
 * retry window (a short grace period) so a transient card failure doesn't
 * instantly lock someone out. Everything else is unentitled.
 */
export function isEntitled(status: Stripe.Subscription.Status): boolean {
  return status === "trialing" || status === "active" || status === "past_due";
}
