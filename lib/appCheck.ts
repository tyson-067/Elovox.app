import type { FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// Firebase App Check, attests that a request to Firestore or Auth came from
// THIS app, not from a script someone wrote against our public config.
//
// Why it matters here: NEXT_PUBLIC_FIREBASE_* is, by design, visible to
// anyone who opens devtools. firestore.rules stop a stranger from reading
// another user's data, but they don't stop a signed-in user from talking to
// Firestore directly with their own token, bypassing every rate limit in
// lib/verify.ts, since those only run on our API routes. App Check closes
// that gap: with enforcement on, Firestore rejects any request without a
// valid attestation token, and only a real browser running our origin can
// mint one.
//
// It is NOT a replacement for firestore.rules. Rules decide who may touch
// what; App Check decides which *clients* get to ask at all. Both, always.

// Imported statically rather than with the dynamic import() this codebase
// uses elsewhere (see lib/auth.ts). App Check has to be initialized BEFORE
// the first Firestore/Auth call or that call goes out with no token, which,
// once enforcement is on, means an intermittent failure on page load that is
// miserable to reproduce. Paying ~10KB up front buys that ordering guarantee.

const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

/** Whether an App Check site key is configured. */
export function isAppCheckConfigured(): boolean {
  return Boolean(siteKey);
}

let started = false;

/**
 * Initialize App Check, if it's configured. Safe to call more than once.
 *
 * Deliberately a no-op when NEXT_PUBLIC_RECAPTCHA_SITE_KEY is unset, so the
 * app keeps working locally and in any environment where App Check hasn't
 * been set up, same posture as isFirebaseConfigured() in lib/firebase.ts.
 * That also means turning this on is a two-step rollout: ship the key, watch
 * the App Check dashboard's "unverified requests" count fall to ~zero, and
 * only THEN flip enforcement on in the Firebase console. Enforcing first
 * locks out every session still running an older bundle.
 */
export function startAppCheck(app: FirebaseApp): void {
  // Server-side rendering has no reCAPTCHA and no document to attach it to.
  if (typeof window === "undefined") return;
  if (!siteKey || started) return;
  started = true;

  // Local development can't pass reCAPTCHA against a production site key, so
  // Firebase supports a debug token instead: set NEXT_PUBLIC_APPCHECK_DEBUG to
  // "true" and the SDK prints a token to the console, which you register under
  // App Check → Manage debug tokens. Never set this in production, a
  // registered debug token bypasses attestation entirely.
  // `if (debug)` alone was a bug: the string "false" is truthy, so setting
  // NEXT_PUBLIC_APPCHECK_DEBUG="false" — which .env.local.example invites by
  // asking for "true" — assigned the literal string "false" as the debug
  // TOKEN. Firebase then sent an unregistered token, App Check rejected it,
  // and with enforcement on every Firestore and Auth call from that build
  // failed with permission-denied.
  const debug = process.env.NEXT_PUBLIC_APPCHECK_DEBUG;
  if (debug && debug !== "false" && debug !== "0") {
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debug === "true" ? true : debug;
  }

  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      // Refresh the attestation token in the background so a long practice
      // session doesn't start failing Firestore writes when the first one
      // expires (they're short-lived).
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // A failure here must never take the app down: without App Check the
    // client still works, it just shows up as unverified traffic. Loud in
    // the console so a misconfigured key doesn't pass silently.
    console.error("[app-check] initialization failed", err);
  }
}
