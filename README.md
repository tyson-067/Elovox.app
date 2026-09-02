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
- `FISH_AUDIO_API_KEY` — [fish.audio](https://fish.audio) → API keys. Felix's voice: the "Hear Felix's feedback" button on every report and the landing page's sample. The free developer tier is enough. Optional: without it the button says so quietly and the written take stays. Pick a voice from the fish.audio library and put its id in `FISH_AUDIO_VOICE_ID`, then run `npm run felix:voice` once to write `public/felix-hello.mp3`, the landing page's sample, and commit it.

`AI_DAILY_CEILING_USD` caps what all three of those can spend in a day, across every account. It is optional and defaults to $500/day — see [Global spend ceiling](#global-spend-ceiling-ai_daily_ceiling_usd).

Add them to `.env.local`. Restart the dev server after env changes.

#### Felix's take

Every report opens with Felix's take: thirty to sixty words on how the speaker came across, the one thing that worked, the one thing to fix, and what to do next, coached toward the goal they picked. The pieces:

- [`lib/felixTake.ts`](lib/felixTake.ts) — the prompt, the goal focus, the word cap, and the deterministic fallback built from the report when the model can't answer.
- `POST /api/felix` — writes the take with Gemini from the **server's** copy of the session (the client only sends a session id) and merges it onto the session doc as `felix`, so every later open reads it back for free. A fallback take is never stored.
- `POST /api/voice` — with `{ sessionId }`, reads that stored take, synthesizes it with Fish Audio, and caches the MP3 on the session's `felix/voice` subdocument (server-only; no client rule reaches it). Replays cost a Firestore read, never a second synthesis.
- [`components/FelixCoach.tsx`](components/FelixCoach.tsx) — the module (web and app variants), with play / pause / replay, the progress hairline, and the `felix_feedback_*` events on the existing cookieless analytics.

Nothing plays until it is pressed, and the take is always on screen as text.

### 3. App Check (abuse protection — production)

The client code is already wired ([`lib/appCheck.ts`](lib/appCheck.ts)) and stays
inert until `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` is set. Without it, a signed-in user
can talk to Firestore directly with their own token and skip every rate limit in
`lib/verify.ts`, which only guard the API routes.

App Check is enforced in **two places**, set up independently: on **Firestore**
(the console **Enforce** button, steps below) and on the **paid API routes**
`/api/analyze` + `/api/speech` (the client sends an `X-Firebase-AppCheck` header;
the server verifies it in [`lib/verify.ts`](lib/verify.ts), gated by
`APPCHECK_ENFORCE`, step 5). The API half matters because a valid ID token proves
*who* is calling but not that the call came from our client — without it a script
can drive paid AssemblyAI/Gemini spend from curl, up to the per-day quota.

1. [reCAPTCHA admin](https://www.google.com/recaptcha/admin) → register a **v3**
   site for `elovox.app` → copy **both** keys. Both get used, in different
   places: the site key is public and ships in the bundle, the secret key stays
   with Firebase.
2. Firebase console → **Build → App Check → Apps → Web app → reCAPTCHA v3** →
   paste the **secret key** — Firebase's backend is what redeems the token
   against Google, so that's the half it needs. Pick plain **reCAPTCHA v3**,
   not reCAPTCHA Enterprise: Enterprise takes a site key here and requires
   `ReCaptchaEnterpriseProvider` in `lib/appCheck.ts`.
3. Set `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` in Vercel and **redeploy** —
   `NEXT_PUBLIC_*` bakes in at build time.
4. Watch **App Check → APIs → Firestore** until unverified requests fall to
   roughly zero, *then* click **Enforce**. Enforcing before that logs out every
   session still running an older bundle.
5. **API-route enforcement.** With the site key deployed (step 3), the client
   already attaches the attestation header to `/api/analyze` and `/api/speech`,
   and the server verifies it — but only *logs* failures until you opt in, so
   nothing breaks during rollout. Watch the server logs for
   `[app-check] unattested …`; once they fall to ~zero (every live bundle is
   sending the header), set **`APPCHECK_ENFORCE=true`** in Vercel and redeploy
   to start returning `403` for unattested calls. Same ship-then-enforce order
   as Firestore, and for the same reason: flipping it early would 403 real users
   still on a bundle from before the header existed.

For local development, set `NEXT_PUBLIC_APPCHECK_DEBUG=true`, copy the token the
SDK prints to the console, and register it under **App Check → Apps → ⋯ → Manage
debug tokens**. Never set that variable in production — a registered debug token
bypasses attestation for every visitor. A production build now ignores it and
logs an error if it's set, but keep it out of the production environment anyway.

## Deploy (Vercel)

1. Push the repo to GitHub, import it in Vercel.
2. Add **all** the env vars from `.env.local` in Vercel → Project → Settings → Environment Variables.
3. In Firebase **Authentication → Settings → Authorized domains**, add your `*.vercel.app` domain (and any custom domain).

The `/api/analyze` route sets `maxDuration = 120` for transcription polling; on the Vercel Hobby plan enable Fluid Compute (default on new projects) so the function isn't cut off early.

## Plans and metering

Freemium, enforced server-side — the browser decides what to *draw*, never what the server will *do*.

- **Free:** the daily challenge only, capped at 3 analyses per day. The counter lives at `users/{uid}/usage/{date}` and is written solely through the Admin SDK; `firestore.rules` denies every client write to it, so it can't be forged. See `lib/quota.ts`.
- **Premium:** the speech library, custom speeches, interview practice, and camera coaching, with no three-a-day limit on any of them. Not *unlimited*, and the product copy deliberately never says so: the daily challenge stays at 3 attempts on every plan (`MAX_DAILY_ATTEMPTS` — one shared topic, so the scores are only comparable if everyone gets the same number of goes), and a fair-use ceiling of 120 analyses a day guards the paid transcription pipeline (`PREMIUM_ANALYSES_PER_DAY` in `app/api/analyze/route.ts`). Entitlement is a single bit at `users/{uid}/profile/plan`, written only by the Stripe webhook (`app/api/stripe/webhook/route.ts`) and read-only to the user.

Every paid route re-checks entitlement server-side via `isPremiumServer` in `lib/verify.ts`. Billing cycles and trial lengths come from `lib/pricing.ts`, not from the Stripe dashboard.

### Global spend ceiling (`AI_DAILY_CEILING_USD`)

The per-user and per-IP limits above bound one account and one address. `AI_DAILY_CEILING_USD` bounds the **total**: a cap, in whole US dollars of estimated upstream spend per UTC day, across every paid AI call the app makes (`/api/analyze`, `/api/speech`, `/api/felix`). Without it, a set of accounts each politely inside its own limit could run up a bill many times the day's revenue with every limiter reporting green.

- **Default $500/day** when unset — roughly 10,000 analyses, meant to be unreachable on a real day and reachable on a fraudulent one. Deliberately conservative in the safe direction: the per-operation costs in `lib/opsMetrics.ts` are constants rounded **3-5x above** real provider pricing, because a breaker that needs an accurate bill to fire is a breaker that never fires, and over-estimating trips it early.
- **At 75%, a warning** — a `billingAlerts` row that shows up in the admin Billing queue and the daily operator email, while nothing is being refused yet. That is the signal to raise the ceiling as real traffic grows, before anyone is turned away.
- **At 100%, graceful degradation** until UTC midnight: analysis and speech writing answer "try again shortly" (`503`, retryable, the recording is kept), Felix falls back to a take written from the report. The answers never mention money and never distinguish the ceiling from the operator's `pauseAnalyze` switch.
- The running counters (`aiCostCents` and the per-route call counts) are on **/admin → Ops**, so a page at 75% can be read as a trend before deciding whether to raise the number or go find the accounts.

## License

All rights reserved. Elovox is a commercial product; the source is published to be read, not reused. See [LICENSE](LICENSE).

Live at **[elovox.app](https://elovox.app)**.
