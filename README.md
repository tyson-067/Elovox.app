# Elovox

**Speak with Impact.**

A speaking practice partner. Record yourself answering an interview question, running a pitch, or rehearsing a speech — get specific, coach-style feedback on pace, filler words, pauses, clarity, and impact.

## Architecture

- **Frontend:** Next.js (App Router) + Tailwind v4, mobile-first. Screens: landing (`/`) → sign up / log in (`/signup`, `/login`) → setup (`/dashboard`) → recording (live waveform via Web Audio) → feedback report → progress dashboard.
- **Auth:** Firebase Authentication with **email/password and Google sign-in**. App pages (`/dashboard`, `/practice`, `/progress`, `/report`) require an account when Firebase is configured.
- **Persistence:** Firestore under `users/{uid}/sessions`. Falls back to localStorage (and skips the auth gate) when Firebase env vars are absent.
- **Analysis pipeline:** `app/api/analyze/route.ts` (runs on Vercel, keys server-side): AssemblyAI transcription (word timestamps, disfluencies) → pace/filler/pause metrics → Claude writes the coaching report as structured JSON. Falls back to a labeled sample analysis when keys are absent or the pipeline fails.

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
- `ANTHROPIC_API_KEY` — [platform.claude.com](https://platform.claude.com).

Add both to `.env.local`. Restart the dev server after env changes.

## Deploy (Vercel)

1. Push the repo to GitHub, import it in Vercel.
2. Add **all** the env vars from `.env.local` in Vercel → Project → Settings → Environment Variables.
3. In Firebase **Authentication → Settings → Authorized domains**, add your `*.vercel.app` domain (and any custom domain).

The `/api/analyze` route sets `maxDuration = 120` for transcription polling; on the Vercel Hobby plan enable Fluid Compute (default on new projects) so the function isn't cut off early.

## Roadmap (not built yet — keep in mind when changing code)

- **AI coaching key:** `ANTHROPIC_API_KEY` is intentionally not set yet; the analyze route falls back to labeled sample feedback until it is. (AssemblyAI can be enabled independently.)
- **Freemium via Stripe:** the platform will become freemium. **Free tier: 3 pre-prepared practice speeches per day, each designed to run ~30 seconds.** Paid tier (Stripe) unlocks unlimited sessions. Nothing enforces limits yet — the landing page's pricing section describes this plan.
