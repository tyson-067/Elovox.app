# Stripe go-live checklist

Test mode is fully wired and verified (checkout → webhook → Firestore entitlement,
7-day trial, Customer Portal plan-switching). Live mode is **prepped but not active**
because live Stripe webhooks require the app deployed to a public HTTPS URL. Work
through this the day you deploy.

## Already done (live side)

- [x] 3 live products + recurring prices, all named "Elovox Premium (…)":
  - Weekly  `price_1TwOqb45NLVJmbsaB2uCZ68V`  $4.99/week
  - Monthly `price_1TwOpM45NLVJmbsaXVEbnAoF`  $11.99/month
  - Yearly  `price_1TwOr945NLVJmbsaJsOY4YSL`  $79.99/year
- [x] Live Customer Portal configured (plan switching on, cancel on, proration
      `always_invoice`).
- [x] `sk_live_…` key and the three live price IDs saved as comments in `.env.local`
      for the swap.

## Deploy-gated steps (do these on launch day)

### 1. Deploy to Vercel
- Import `github.com/tyson-067/Elovox.app` in Vercel.
- Point `elovox.app` DNS at the Vercel project (it currently doesn't resolve).
- Confirm `https://elovox.app` loads before continuing.

### 2. Set env vars in Vercel → Settings → Environment Variables
Copy every var from `.env.local`, but with the **live** values:
- `STRIPE_SECRET_KEY` → the `sk_live_…` (better: a restricted live key, see step 6)
- `STRIPE_PRICE_WEEKLY / _MONTHLY / _ANNUAL` → the three live `price_…` above
- `FIREBASE_SERVICE_ACCOUNT` → same base64 blob (Firebase isn't per-mode)
- `ASSEMBLYAI_API_KEY`, `GEMINI_API_KEY`, all `NEXT_PUBLIC_FIREBASE_*`
- `NEXT_PUBLIC_APP_URL=https://elovox.app`
- `STRIPE_WEBHOOK_SECRET` → filled in step 3

### 3. Create the live webhook endpoint
- Stripe (Live mode) → Developers → Webhooks → **Add endpoint**
- URL: `https://elovox.app/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`
- Copy its signing secret (`whsec_…`, **different** from the CLI one) into the
  Vercel `STRIPE_WEBHOOK_SECRET`. Redeploy so it takes effect.

### 4. Firebase authorized domains
- Firebase → Authentication → Settings → Authorized domains → add `elovox.app`
  (and the `*.vercel.app` domain) so sign-in works in production.

### 5. Smoke test with a real card
- Sign in on the live site → /pricing → subscribe. The 7-day trial means $0 is
  charged up front (card only authorized).
- Confirm: redirect to `/account?checkout=success`, the webhook shows 200 in the
  Stripe dashboard, and Firestore `users/{uid}/profile/plan` flips to `premium`.
- Cancel before day 7 (or refund) so no real money moves during the test.

### 6. Swap the full key for a restricted key (security)
- The `sk_live_…` currently saved is a full-access key. Before real traffic,
  create a **restricted** live key (Write: Customers, Checkout Sessions, Customer
  portal, Subscriptions; Read: Invoices) and use that in Vercel instead. Then
  roll the full `sk_live_` key.

## Notes
- The trial (weekly none, monthly/annual 7 days) comes from `lib/pricing.ts`, not
  from the Stripe prices. Don't add a trial in the dashboard or they'll fight.
- Tax: Stripe Tax is enabled account-wide, so cards are charged price + sales tax
  for the customer's address. The pricing page already shows "+ tax".
