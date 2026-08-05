import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isAdmin, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { getStripe } from "@/lib/stripe";
import {
  grossVolume,
  recurringRevenue,
  isRevenuePeriod,
  periodRange,
  PERIOD_LABELS,
  type RevenuePeriod,
} from "@/lib/stripeMetrics";

/**
 * The real money, straight from Stripe.
 *
 * /api/admin/stats reports a list-price ESTIMATE of MRR built from our own
 * Firestore plan docs. That number is useful as a cross-check and is wrong the
 * moment a coupon, a proration, a failed card, a refund or a non-USD customer
 * exists — and it cannot answer "how much came in last month" at all, because
 * Firestore has no record of cash. This route asks Stripe instead.
 *
 * Kept OUT of /api/admin/stats on purpose. That route reads only Firestore and
 * always answers; folding a third-party call into it would mean a Stripe
 * outage, a bad key, or a rate limit took the whole Overview tab down with it.
 * Here, the volume tiles can fail while everything else still renders.
 *
 * Access is the ADMIN_EMAILS allow-list, with the same flat 404 as its
 * siblings so the route's existence isn't advertised.
 */

export const runtime = "nodejs";
// Stripe accounts with real history need to page; the default 10s is not
// enough for a 12-month window.
export const maxDuration = 60;

const rateLimited = makeRateLimiter(30);

/**
 * A small server-side cache, because each call can page through thousands of
 * balance transactions and Stripe's rate limit is per-account, not per-admin.
 * Two minutes: long enough that flipping between periods and back is free,
 * short enough that "refresh after a sale landed" behaves. `?refresh=1`
 * bypasses it.
 */
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  // isAdmin first, before any branch that could distinguish this route from a
  // 404 — same ordering rule as /api/admin/stats.
  if (!(await isAdmin(req))) {
    await recordAdminDenied(getAdminDb(), "admin/revenue", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe isn't configured in this environment." },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const raw = url.searchParams.get("period");
  const period: RevenuePeriod = isRevenuePeriod(raw) ? raw : "30d";
  const refresh = url.searchParams.get("refresh") === "1";

  const key = period;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json(hit.body, {
      headers: { "cache-control": "private, no-store" },
    });
  }

  // WHICH STRIPE ACCOUNT AND WHICH MODE. A test key returns test data that
  // looks exactly like revenue, and an operator reading "$4,182 gross volume"
  // has no way to tell from the number itself. The screen refuses to present
  // test numbers as money without saying so, so the mode has to come back with
  // the figures rather than be assumed.
  const livemode = !(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test");

  const range = periodRange(period);

  try {
    // Sequential, not Promise.all: both walks page hard, and firing them
    // together doubles the burst against Stripe's rate limit for no wall-clock
    // win worth the 429.
    const volume = await grossVolume(stripe, period);
    const recurring = await recurringRevenue(stripe);

    const body = {
      generatedAt: Date.now(),
      livemode,
      period,
      periodLabel: PERIOD_LABELS[period],
      from: range.fromMs,
      to: range.toMs,
      volume,
      recurring,
    };
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (err) {
    // Report the failure rather than serving zeros. A revenue screen showing
    // $0.00 because a call failed is worse than one saying it couldn't ask:
    // the first is a number an operator might act on.
    const message =
      (err as { message?: string })?.message ?? "Stripe wouldn't answer.";
    console.error("[admin] revenue read failed", err);
    return NextResponse.json(
      { error: `Couldn't read Stripe: ${message}` },
      { status: 502 }
    );
  }
}
