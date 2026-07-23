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

/** Begins Checkout for a cycle and redirects to Stripe. */
export async function startCheckout(cycle: BillingCycle): Promise<void> {
  const url = await postForUrl("/api/stripe/checkout", { cycle });
  window.location.href = url;
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

/** Opens the Stripe Customer Portal and redirects to it. */
export async function openBillingPortal(): Promise<void> {
  const url = await postForUrl("/api/stripe/portal");
  window.location.href = url;
}
