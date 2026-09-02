import { NextRequest, NextResponse } from "next/server";
import { getStripe, appBaseUrl } from "@/lib/stripe";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { verifyVerifiedUser, logRejectedInput } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { getOpsFlags } from "@/lib/opsMetrics";
import { PLANS, stripePriceIdFor, type BillingCycle } from "@/lib/pricing";
import { readJsonObject } from "@/lib/requestBody";

// Starts a Stripe Checkout session for a signed-in user. Subscription mode
// with card-up-front, so the trial captures a payment method and converts
// automatically. Payment methods themselves (cards, Apple/Google Pay, Link)
// are whatever the Stripe dashboard has enabled, we don't hardcode them.
//
// Returns { url } for the browser to redirect to. Nothing here writes the
// entitlement; that only happens later, in the webhook, once payment setup
// succeeds, so a user who bails at Checkout never gets Premium.

export const runtime = "nodejs";

const CYCLES: BillingCycle[] = ["weekly", "monthly", "annual"];

// Dashboard label for this Checkout flow (Stripe API 2026-03-25.dahlia+).
const CHECKOUT_INTEGRATION_ID = "elovox-premium-hqvbztkm";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const db = getAdminDb();
  if (!stripe || !db) {
    // Names the missing credential in the server log, "Billing is not
    // configured" alone can't distinguish a missing Stripe key from a
    // missing/truncated service account, which is the usual deploy slip.
    console.error(
      `[stripe] billing unconfigured, STRIPE_SECRET_KEY:${stripe ? "ok" : "MISSING"} FIREBASE_SERVICE_ACCOUNT:${db ? "ok" : "MISSING"}`
    );
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const uid = await verifyVerifiedUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  // A subscription on an unconfirmed address is a support problem waiting to
  // happen: receipts and password resets go to an inbox nobody owns.
  if (uid === "unverified") {
    return NextResponse.json(
      { error: "Please confirm your email address before subscribing." },
      { status: 403 }
    );
  }
  if (await limited(getAdminDb(), "stripe-checkout", uid)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429 }
    );
  }

  // Operator kill switch for NEW purchases (ops/flags.pauseCheckout, set from
  // /admin → Ops): a pricing mistake or a Stripe incident shouldn't keep
  // selling while it's being fixed. Existing subscribers are untouched.
  //
  // FAILS CLOSED, unlike the analyze brake. Both used to fail open on the
  // argument that "a Firestore blip can never stop revenue by itself" — right
  // for analyze, and backwards here. Half of what this switch is for is a
  // PRICING MISTAKE, and failing open means a database blip resumes selling at
  // the wrong price, for a full cache window, with nobody watching. The cost
  // of the two failures is not symmetric: a paused checkout during an outage
  // is minutes of lost sales, an unpaused one is charges we have to unwind.
  const opsFlags = await getOpsFlags(db);
  if (opsFlags.pauseCheckout || opsFlags.unavailable) {
    return NextResponse.json(
      { error: "Purchases are briefly paused for maintenance. Try again soon." },
      { status: 503 }
    );
  }

  const parsed = await readJsonObject(req);
  if (!parsed.ok) {
    logRejectedInput("stripe/checkout", parsed.reason);
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const cycle = parsed.body.cycle as BillingCycle;
  const skipTrial: unknown = parsed.body.skipTrial;
  if (!CYCLES.includes(cycle)) {
    logRejectedInput("stripe/checkout", "unknown-cycle");
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }

  const priceId = stripePriceIdFor(cycle);
  if (!priceId) {
    return NextResponse.json({ error: "That plan isn't available yet." }, { status: 503 });
  }
  const plan = PLANS.find((p) => p.cycle === cycle)!;

  // Reuse an existing Stripe customer if this user already has one, so we
  // never create duplicates across repeat checkouts. The customer id lives
  // on the (admin-written) plan doc.
  const planRef = db.doc(`users/${uid}/profile/plan`);
  const planSnap = await planRef.get();
  let customerId = planSnap.exists ? (planSnap.data()?.stripeCustomerId as string | undefined) : undefined;

  // Pull the account email so the receipt/portal is addressed correctly.
  let email: string | undefined;
  try {
    const { getAdminApp } = await import("@/lib/firebaseAdmin");
    const app = getAdminApp();
    if (app) {
      const { getAuth } = await import("firebase-admin/auth");
      const user = await getAuth(app).getUser(uid);
      email = user.email ?? undefined;
    }
  } catch {
    // email is a nicety, not required
  }

  // Everything below talks to Stripe, so a misconfiguration (a test Price ID
  // paired with a live key, an unsupported parameter) surfaces as a thrown
  // StripeError. Uncaught, that becomes a bare 500 with no JSON body, and the
  // browser can only say "Something went wrong", which hides the one detail
  // that would explain it. The detail goes to the server log; the browser gets
  // a sentence a customer can act on (see the catch at the bottom).
  try {
    if (!customerId) {
      // Before minting a new customer, look for one already on this email.
      //
      // Deleting an account recursively deletes users/{uid}, which takes the
      // plan doc and the stripeCustomerId with it, but the Stripe customer
      // survives, and so does its trial history. Without this lookup, the
      // delete → sign up again → trial again loop is free and repeatable.
      // The address is safe to match on: this route requires a verified
      // email, and Firebase Auth keeps it unique across accounts.
      // A customer we already stamped with THIS uid is unambiguously ours,
      // whatever the address says. Checked first and separately from the
      // email match below, because it is the only lookup that is safe on its
      // own — search is eventually consistent, so a miss here is not proof.
      try {
        const owned = await stripe.customers.search({
          query: `metadata["firebaseUid"]:"${uid}"`,
          limit: 1,
        });
        if (owned.data[0] && !owned.data[0].deleted) customerId = owned.data[0].id;
      } catch {
        // Search is a convenience; the email path below still covers us.
      }

      if (!customerId && email) {
        const found = await stripe.customers.list({ email, limit: 100 });

        // Adopting a customer by email alone was handing over someone else's
        // billing. Firebase keeps addresses unique among LIVE accounts, but a
        // Stripe customer's email is written once at creation and never
        // updated — so after the original owner changes their address (or
        // deletes their account and the address is later recycled), that
        // stale customer still matches. Whoever matched it inherited the
        // previous owner's invoices, their billing portal, and their card.
        //
        // So only adopt a customer that nobody else still owns:
        //  - no firebaseUid at all (a comp created by hand in the dashboard),
        //  - or a firebaseUid whose Firebase account no longer exists.
        // Anything else gets a fresh customer. The trial-history reuse this
        // lookup exists for still works in every case it was written for,
        // because a deleted account's uid stops resolving.
        const claimable: typeof found.data = [];
        for (const c of found.data) {
          if (c.deleted) continue;
          const owner = c.metadata?.firebaseUid;
          if (!owner || owner === uid) {
            claimable.push(c);
            continue;
          }
          let ownerStillExists = true;
          try {
            const { getAdminApp } = await import("@/lib/firebaseAdmin");
            const app = getAdminApp();
            if (app) {
              const { getAuth } = await import("firebase-admin/auth");
              await getAuth(app).getUser(owner);
            }
          } catch (err) {
            // Only a definitive "this Firebase account no longer exists" makes
            // someone else's customer adoptable. A transient failure (a network
            // blip, an admin-auth quota error) must NOT be read as absence:
            // otherwise an attacker who verifies an address equal to the stale
            // email on a victim's Stripe customer could adopt that customer —
            // and with it the saved cards, billing address, and invoice
            // history — simply by retrying checkout until one getUser() call
            // happens to fail. Mirror the webhook (auth/user-not-found only);
            // on any other error leave the owner presumed present.
            if ((err as { code?: string }).code === "auth/user-not-found") {
              ownerStillExists = false;
            }
          }
          if (!ownerStillExists) claimable.push(c);
        }

        // Never adopt one that is still paying — that subscription belongs to
        // somebody, and inheriting it also permanently 409s this account out
        // of ever subscribing.
        const match =
          claimable.find((c) => c.metadata?.firebaseUid) ?? claimable[0];
        if (match) {
          const holds = await stripe.subscriptions.list({
            customer: match.id,
            status: "all",
            limit: 100,
          });
          const stillLive = holds.data.some((s) =>
            ["trialing", "active", "past_due", "unpaid"].includes(s.status)
          );
          if (!stillLive) {
            customerId = match.id;
            // Point the customer at the account that now owns it, so the next
            // checkout, the webhook, and the dashboard all agree on the uid.
            if (match.metadata?.firebaseUid !== uid) {
              await stripe.customers.update(customerId, {
                metadata: { firebaseUid: uid },
              });
            }
          }
        }
      }

      if (!customerId) {
        // Idempotency-keyed on the uid so two concurrent checkouts (a
        // double-click before the button disables, two tabs, or the
        // verify-email resume racing a manual click) resolve to ONE customer.
        // Both requests previously saw no stored id and no email match, both
        // created a customer, and the loser was orphaned: it kept billing
        // forever, the Portal and invoice list only ever showed the winner,
        // and account deletion — which cancels subscriptions on the single
        // stored id — could not reach it.
        const customer = await stripe.customers.create(
          {
            email,
            metadata: { firebaseUid: uid },
          },
          { idempotencyKey: `customer:${uid}` }
        );
        customerId = customer.id;
      }
      // Persist immediately so a retried checkout reuses it even before the
      // webhook writes the full record.
      await planRef.set({ stripeCustomerId: customerId }, { merge: true });
    }

    // What has this customer done before? Two things matter, and Stripe is the
    // source of truth for both, a Firestore flag would drift the moment a
    // subscription was changed from the dashboard.
    //
    //  - Already subscribed? Sending them through Checkout again bills them a
    //    second time for the same product. (Seen in the wild: one tester ended
    //    up with simultaneous monthly AND annual trials.) Send them to the
    //    Portal to switch plans instead.
    //  - Ever had a trial? The free week is once per customer, not once per
    //    price. Otherwise: trial monthly, cancel, trial annual, repeat —
    //    Premium indefinitely for nothing.
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });

    const live = existing.data.find((s) =>
      ["trialing", "active", "past_due", "unpaid"].includes(s.status)
    );
    if (live) {
      return NextResponse.json(
        {
          error:
            "You already have a subscription. Manage or switch your plan from your account page.",
          code: "already_subscribed",
        },
        { status: 409 }
      );
    }

    // trial_start is set by Stripe on any subscription that opened with a
    // trial, and it survives cancellation, which is exactly the history we
    // need. A returning customer subscribes at full price from day one.
    // `skipTrial` is the user's own opt-out from the pricing page: they'd
    // rather be billed today than remember a conversion date.
    const hadTrial = existing.data.some((s) => s.trial_start != null);
    const grantTrial = plan.trialDays > 0 && !hadTrial && skipTrial !== true;

    // The one place client-side honesty can't reach: delete account → sign up
    // again. The fresh users/{uid} doc has no trialEnd, so the pricing page
    // promises "Start 7-day free trial" while this route, having found the
    // surviving Stripe customer above, will grant no trial. Stripe's own
    // Checkout page does show the real terms before any card entry, but the
    // button still lied. Write the history the customer lookup just proved
    // back into the plan doc, so every later render of /pricing goes through
    // its existing trialUsed branch and the CTA reads "Get Premium" instead.
    // Metadata only — the entitlement bit stays webhook-written. Best-effort:
    // a failed write must never block a checkout.
    if (hadTrial && plan.trialDays > 0) {
      try {
        const ends = existing.data
          .map((s) => s.trial_end)
          .filter((t): t is number => t != null);
        if (ends.length) {
          await db.doc(`users/${uid}/profile/plan`).set(
            { trialEnd: Math.max(...ends) * 1000, stripeCustomerId: customerId },
            { merge: true }
          );
        }
      } catch (err) {
        console.error(`[stripe] couldn't record spent trial for ${uid}`, err);
      }
    }

    // "No trial" is expressed by omitting trial_period_days below, because
    // Stripe rejects a zero-day trial. That is only correct while the Price
    // itself carries no trial — otherwise Checkout inherits the Price's one
    // in exactly the two cases we omit the parameter: the user who chose to
    // pay today, and the returning customer whose free week is already spent.
    // Both would fail silently and neither is visible from our side, so check
    // the assumption instead of trusting it. Non-fatal: refusing the checkout
    // outright would be worse for the user than a week we didn't intend.
    if (!grantTrial) {
      try {
        const price = await stripe.prices.retrieve(priceId);
        const priceTrial = price.recurring?.trial_period_days;
        if (priceTrial) {
          console.error(
            `[stripe] price ${priceId} carries recurring.trial_period_days=${priceTrial}; ` +
              `this account will get a trial we did not intend (skipTrial=${skipTrial === true}, hadTrial=${hadTrial}). ` +
              `Recreate the Price with no trial — see .env.local.example.`
          );
        }
      } catch {
        // A failed read must never block a checkout.
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Labels this flow in the Stripe dashboard so Checkout performance can be
      // compared across integrations. Static on purpose, it identifies the
      // flow, not the session.
      integration_identifier: CHECKOUT_INTEGRATION_ID,
      customer: customerId,
      client_reference_id: uid,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        // Omitted entirely for the weekly plan, and for anyone who has already
        // used their trial, Stripe rejects a zero-day trial, so "no trial"
        // has to mean "no parameter".
        ...(grantTrial ? { trial_period_days: plan.trialDays } : {}),
        metadata: { firebaseUid: uid },
      },
      allow_promotion_codes: true,
      // No automatic_tax here on purpose, and it is NOT the same as no tax.
      // Stripe Tax is switched on account-wide in the dashboard, so sessions
      // created here inherit it: live invoices come back with
      // automatic_tax.enabled true and a tax line added on top (11.99 ->
      // 12.80 on a US address). The prices are tax-EXCLUSIVE, which is why
      // /pricing says "plus sales tax" rather than quoting a final figure.
      //
      // Two consequences worth knowing before touching this call:
      //   - Tax collection depends on a dashboard toggle, not on this file.
      //     An older subscription on this account predates it and still bills
      //     with automatic_tax false, so the setting has already been
      //     inconsistent once.
      //   - Setting automatic_tax explicitly here would make it durable, but
      //     Stripe then also wants customer_update.address = "auto" alongside
      //     an existing `customer`, and getting that wrong fails checkout
      //     outright. Do it deliberately against a test key, not in passing.
      // The webhook is the source of truth; these just route the browser back.
      success_url: `${appBaseUrl(req)}/account?checkout=success`,
      cancel_url: `${appBaseUrl(req)}/pricing?checkout=canceled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Stripe's own message is written for whoever holds the API key, not for a
    // customer: it names price ids, customer ids and account configuration
    // ("No such price: price_1Ab…", "your account cannot currently make live
    // charges"). Echoing it into the browser handed an unauthenticated-ish
    // reader a map of the billing setup, and told the one person who could act
    // on it nothing they could act on. The detail stays in the server log,
    // where the uid, cycle and price id are already alongside it.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[stripe] checkout failed for ${uid} (${cycle}, ${priceId}): ${message}`,
      err
    );
    return NextResponse.json(
      { error: "Checkout couldn't start. Please try again in a moment." },
      { status: 502 }
    );
  }
}
