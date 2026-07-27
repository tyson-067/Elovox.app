# Elovox

**Speak with Impact.**

A speaking practice partner. Record yourself answering an interview question, running a pitch, or rehearsing a speech — get specific, coach-style feedback on pace, filler words, pauses, clarity, and impact.

## Architecture

- **Frontend:** Next.js (App Router) + Tailwind v4, mobile-first. Screens: landing (`/`) → sign up / log in (`/signup`, `/login`) → setup (`/dashboard`) → recording (live waveform via Web Audio) → feedback report → progress dashboard.
- **Auth:** Firebase Authentication with **email/password and Google sign-in**. App pages (`/dashboard`, `/practice`, `/progress`, `/report`) require an account when Firebase is configured.
- **Persistence:** Firestore under `users/{uid}/sessions`. Falls back to localStorage (and skips the auth gate) when Firebase env vars are absent.
- **Analysis pipeline:** `app/api/analyze/route.ts` (runs on Vercel, keys server-side): AssemblyAI transcription (word timestamps, disfluencies) → pace/filler/pause metrics → Gemini writes the coaching report as structured JSON (`lib/gemini.ts`). Falls back to a labeled sample analysis when keys are absent or the pipeline fails.

## Local development

```bash
npm install
npm run dev
```

The app works with zero configuration (localStorage + sample feedback). To enable the real backend:

### 1. Firebase (persistence)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Analytics optional).
2. **Build → Authentication → Get started → Sign-in method** → enable **Email/Password** and **Google**.
3. **Build → Firestore Database → Create database** (production mode, any region).
4. In the Firestore **Rules** tab, paste the contents of [`firestore.rules`](firestore.rules) and publish. (Or `firebase deploy --only firestore:rules` with the Firebase CLI.)
5. **Project settings → General → Your apps → Web app (</>)** → register → copy the config values.
6. `cp .env.local.example .env.local` and fill in the `NEXT_PUBLIC_FIREBASE_*` values.

### 2. Analysis keys (real feedback)

- `ASSEMBLYAI_API_KEY` — [assemblyai.com](https://www.assemblyai.com) (free tier includes $50 credit, no card).
- `GEMINI_API_KEY` — [aistudio.google.com](https://aistudio.google.com) → Get API key.

Add both to `.env.local`. Restart the dev server after env changes.

### 3. App Check (abuse protection — production)

The client code is already wired ([`lib/appCheck.ts`](lib/appCheck.ts)) and stays
inert until `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` is set. Without it, a signed-in user
can talk to Firestore directly with their own token and skip every rate limit in
`lib/verify.ts`, which only guard the API routes.

1. [reCAPTCHA admin](https://www.google.com/recaptcha/admin) → register a **v3**
   site for `elovox.app` → copy the **site key** (the secret key isn't used here).
2. Firebase console → **Build → App Check → Apps → Web app → reCAPTCHA v3** →
   paste the site key.
3. Set `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` in Vercel and **redeploy** —
   `NEXT_PUBLIC_*` bakes in at build time.
4. Watch **App Check → APIs → Firestore** until unverified requests fall to
   roughly zero, *then* click **Enforce**. Enforcing before that logs out every
   session still running an older bundle.

For local development, set `NEXT_PUBLIC_APPCHECK_DEBUG=true`, copy the token the
SDK prints to the console, and register it under **App Check → Apps → ⋯ → Manage
debug tokens**. Never set that variable in production.

## Deploy (Vercel)

1. Push the repo to GitHub, import it in Vercel.
2. Add **all** the env vars from `.env.local` in Vercel → Project → Settings → Environment Variables.
3. In Firebase **Authentication → Settings → Authorized domains**, add your `*.vercel.app` domain (and any custom domain).

The `/api/analyze` route sets `maxDuration = 120` for transcription polling; on the Vercel Hobby plan enable Fluid Compute (default on new projects) so the function isn't cut off early.

## Plans and metering

Freemium, enforced server-side — the browser decides what to *draw*, never what the server will *do*.

- **Free:** the daily challenge only, capped at 3 analyses per day. The counter lives at `users/{uid}/usage/{date}` and is written solely through the Admin SDK; `firestore.rules` denies every client write to it, so it can't be forged. See `lib/quota.ts`.
- **Premium:** unlimited practice, the speech library, custom speeches, interview practice, and camera coaching. Entitlement is a single bit at `users/{uid}/profile/plan`, written only by the Stripe webhook (`app/api/stripe/webhook/route.ts`) and read-only to the user.

Every paid route re-checks entitlement server-side via `isPremiumServer` in `lib/verify.ts`. Billing cycles and trial lengths come from `lib/pricing.ts`, not from the Stripe dashboard.

## License

All rights reserved. Elovox is a commercial product; the source is published to be read, not reused. See [LICENSE](LICENSE).

Live at **[elovox.app](https://elovox.app)**.
