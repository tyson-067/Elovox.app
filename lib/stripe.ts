import Stripe from "stripe";

// Server-side Stripe client. The secret key never reaches the browser; every
// call here runs inside an /api/stripe route handler.
//
// We pin nothing on apiVersion, the installed SDK (stripe@22) already targets
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
 * Base URL for Stripe return links (Checkout success/cancel, Portal return).
 *
 * These end up as `success_url`/`return_url`, which Stripe sends the browser
 * to verbatim, so the value must not be attacker-controlled. The previous
 * version fell back to the request's `Origin` header before its own URL,
 * meaning a request carrying `Origin: https://evil.example` produced a
 * Checkout session that redirected there afterwards. The blast radius was
 * small (the caller is authenticated, so it only redirects the attacker's own
 * session) but it is a header-controlled redirect target for free, and the
 * fix costs nothing.
 *
 * Configured value wins; otherwise fall back to the request's own origin,
 * which the platform derives from the request rather than a spoofable header.
 */
export function appBaseUrl(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

/**
 * Bound on how long a `past_due` subscription keeps Premium after its period
 * ends. Covers Stripe's typical Smart Retries dunning window (~2 weeks) and
 * then expires, so access can't outlive a genuinely dead card.
 */
const PAST_DUE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Maps a Stripe subscription to our single entitlement bit. Trialing and active
 * both grant Premium. `past_due` keeps access during Stripe's retry window so a
 * transient card failure doesn't instantly lock someone out — but only for a
 * BOUNDED grace period past the period end. Without that bound, an account
 * whose card permanently fails, on a Stripe account whose dunning is configured
 * to leave subscriptions `past_due` (rather than cancel or mark unpaid), would
 * keep Premium forever, for free. If we don't know the period end we can't
 * bound it, so we deny rather than grant indefinitely.
 *
 * @param currentPeriodEndSec Stripe's `current_period_end` in epoch SECONDS.
 */
export function isEntitled(
  status: Stripe.Subscription.Status,
  currentPeriodEndSec?: number
): boolean {
  if (status === "trialing" || status === "active") return true;
  if (status === "past_due") {
    if (typeof currentPeriodEndSec !== "number") return false;
    return Date.now() < currentPeriodEndSec * 1000 + PAST_DUE_GRACE_MS;
  }
  return false;
}
