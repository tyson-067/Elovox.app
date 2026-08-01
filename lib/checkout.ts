"use client";

import { isFirebaseConfigured, getUser } from "./firebase";
import type { BillingCycle } from "./pricing";

// Browser helpers that call the Stripe API routes with the user's Firebase
// ID token and redirect to the returned Stripe-hosted page. Kept tiny so the
// pricing page and account page share one implementation.

async function authHeader(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured()) return {};
  const user = await getUser();
  if (!user) return {};
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

async function postForUrl(path: string, body?: unknown): Promise<string> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data.url as string;
}

/**
 * Begins Checkout for a cycle and redirects to Stripe. `skipTrial` is the
 * user's own choice to pay from day one instead of opening with the free
 * trial (some people would rather not hold a conversion date in their head).
 */
export async function startCheckout(
  cycle: BillingCycle,
  opts?: { skipTrial?: boolean }
): Promise<void> {
  const url = await postForUrl("/api/stripe/checkout", {
    cycle,
    skipTrial: !!opts?.skipTrial,
  });
  window.location.href = url;
}

// A checkout intent that couldn't be started yet because the account is still
// unverified (the checkout route rejects unverified users). Stashed at signup
// and resumed from the verify-email screen once the address is confirmed, so a
// "buy Premium" click that went through email signup isn't silently dropped.
const INTENT_KEY = "elovox:checkout-intent";

export interface CheckoutIntent {
  cycle: BillingCycle;
  skipTrial: boolean;
}

export function stashCheckoutIntent(intent: CheckoutIntent): void {
  try {
    window.sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // sessionStorage blocked (private mode / storage full): the intent is lost
    // and the user lands on the dashboard, same as before this existed.
  }
}

/** Read and clear a stashed intent. Returns null if there's nothing valid. */
export function takeCheckoutIntent(): CheckoutIntent | null {
  try {
    const raw = window.sessionStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(INTENT_KEY);
    const parsed = JSON.parse(raw) as Partial<CheckoutIntent>;
    const c = parsed.cycle;
    if (c !== "weekly" && c !== "monthly" && c !== "annual") return null;
    return { cycle: c, skipTrial: !!parsed.skipTrial };
  } catch {
    return null;
  }
}

export type { InvoiceRow } from "@/app/api/stripe/invoices/route";

/**
 * Billing history (Stripe invoices) for the signed-in user. Returns an empty
 * list for anyone who never subscribed; throws only on a real failure, so the
 * caller can tell "no invoices" from "couldn't load".
 */
export async function fetchInvoices(): Promise<
  import("@/app/api/stripe/invoices/route").InvoiceRow[]
> {
  const res = await fetch("/api/stripe/invoices", { headers: await authHeader() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't load billing history.");
  return data.invoices ?? [];
}

/**
 * The signed-in user's full data export, as a downloadable blob. Kept here
 * beside the other authenticated fetches so there's one place that knows how
 * to attach the ID token.
 */
export async function fetchDataExport(): Promise<Blob> {
  const res = await fetch("/api/account/export", { headers: await authHeader() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Couldn't prepare your download.");
  }
  return res.blob();
}

/** Opens the Stripe Customer Portal and redirects to it. */
export async function openBillingPortal(): Promise<void> {
  const url = await postForUrl("/api/stripe/portal");
  window.location.href = url;
}
