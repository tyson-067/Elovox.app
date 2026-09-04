import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, type Auth, type User } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { startAppCheck } from "./appCheck";

// Firebase is optional at runtime: when the NEXT_PUBLIC_FIREBASE_* env vars
// are absent (local dev before setup), the app falls back to localStorage
// and the auth pages explain that accounts aren't available.

// The domain users SEE during sign-in (the Google popup's address bar) and
// the domain email action links point at. The env value spent months stuck
// on the legacy sonoria-212c1.firebaseapp.com — a project codename users
// were never meant to meet — so the legacy value (or an unset one) upgrades
// to elovox.app, whose /__/auth/* is proxied to the Firebase handler in
// next.config.ts. A DIFFERENT explicit env value (a future auth.elovox.app
// with real Firebase Hosting) still wins, so the escape hatch stays open.
const envAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const authDomain =
  !envAuthDomain || envAuthDomain === "sonoria-212c1.firebaseapp.com"
    ? "elovox.app"
    : envAuthDomain;

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Is this an EXPLICIT demo session?
 *
 * This exists because "Firebase is not configured" used to be a way into the
 * app. RequireAuth read `configured === false` as "no auth to enforce" and let
 * anyone through to /practice, /dashboard, /progress and the rest, and AuthNav
 * put a "Practice" link in the header for them. That is fine as a deliberate
 * dev affordance and dangerous as a default: a production deploy that lost its
 * NEXT_PUBLIC_FIREBASE_* vars would not fail closed, it would silently publish
 * every signed-in screen in the product.
 *
 * So the two ideas are separated. Missing config now means LOCKED. Open access
 * requires someone to ask for it, either way round:
 *
 *   - `?demo=1`, stamped into sessionStorage by the inline script in
 *     app/layout.tsx (dev only), which is how UI work on the signed-in surface
 *     gets done without an account.
 *   - NEXT_PUBLIC_DEMO_MODE=1, which the Playwright suite sets on its own
 *     server so the recording specs can reach /practice.
 *
 * Both are deliberate acts. Neither can happen by a variable going missing.
 */
export function isDemoMode(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") return true;
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    try {
      return Boolean(sessionStorage.getItem("elovox.devDemo"));
    } catch {
      /* private mode; not a demo */
    }
  }
  return false;
}

export function isFirebaseConfigured(): boolean {
  // Dev-only demo mode: `?demo=1` (stamped into sessionStorage by the inline
  // script in app/layout.tsx, same mechanism as `?native=1`) makes the client
  // behave as if Firebase were absent, which sends every feature down its
  // localStorage fallback. That is the only way to see the signed-in surface
  // — dashboard, practice, progress, account — without an account, which is
  // exactly what UI work on the native shell needs. The check is compiled out
  // of production builds entirely.
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    try {
      if (sessionStorage.getItem("elovox.devDemo")) return false;
    } catch {
      /* private mode; fall through to the real answer */
    }
  }
  return Boolean(config.apiKey && config.projectId && config.appId);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function ensureApp(): FirebaseApp {
  if (!app) {
    app = getApps()[0] ?? initializeApp(config);
    // Before getAuth/getFirestore, so the first request out already carries
    // an attestation token. See lib/appCheck.ts, no-op unless configured.
    startAppCheck(app);
    auth = getAuth(app);
    db = getFirestore(app);
  }
  return app;
}

export function getDb(): Firestore {
  ensureApp();
  return db!;
}

export function getAuthInstance(): Auth {
  ensureApp();
  return auth!;
}

/**
 * How long to wait for Firebase to report an initial auth state before
 * answering with whatever it already has.
 *
 * This promise sits under nearly everything the app loads — getSession,
 * saveSession, listSessions, getPlan, and the auth header on the analyze
 * call all await it — and it had no way to end other than Firebase deciding
 * to speak. `onAuthStateChanged` delivers its first callback behind the SDK's
 * internal `_initializationPromise`, so if that never settles (IndexedDB
 * unavailable in some private-browsing modes, persistence wedged, the auth
 * endpoint unreachable) the callback never fires, this never resolves, and
 * every caller waits forever. The screens above it render `null` while they
 * wait, which is how a page ends up permanently blank with a reload as the
 * only way out.
 *
 * Six seconds is far longer than a healthy resolve (milliseconds, from cache)
 * and short enough that nobody sits looking at nothing.
 */
const AUTH_READY_TIMEOUT_MS = 6000;

/**
 * Resolves with the signed-in user, or null if nobody is signed in (or
 * Firebase isn't configured). Waits for the initial auth state to load, but
 * not indefinitely — see {@link AUTH_READY_TIMEOUT_MS}.
 */
export function getUser(): Promise<User | null> {
  if (!isFirebaseConfigured()) return Promise.resolve(null);
  ensureApp();
  return new Promise((resolve) => {
    let settled = false;
    // Assigned by the listener registration below. Declared first because the
    // callback closes over it and must not touch it before it exists.
    let unsubscribe: (() => void) | undefined = undefined;

    const finish = (user: User | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(user);
    };

    // `auth.currentUser` is the SDK's own last known answer. After a restored
    // session it is already correct; before one it is null, which is the same
    // thing a signed-out visitor gets. Either way it beats hanging.
    const timer = setTimeout(() => {
      console.warn("[firebase] auth state timed out; using currentUser");
      finish(auth?.currentUser ?? null);
    }, AUTH_READY_TIMEOUT_MS);

    unsubscribe = onAuthStateChanged(
      auth!,
      (user) => finish(user),
      // An error on the listener is an answer too: without this the promise
      // outlived the subscription that was supposed to settle it.
      () => finish(auth?.currentUser ?? null)
    );
    // Registration itself can resolve the promise synchronously in the error
    // path above, in which case the listener is already redundant.
    if (settled) unsubscribe();
  });
}
