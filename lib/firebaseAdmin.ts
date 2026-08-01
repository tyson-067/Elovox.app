import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Server-side Firebase, initialized from a service account. This is the ONLY
// thing allowed to write users/{uid}/profile/plan, firestore.rules makes
// that doc read-only to the user, and the Admin SDK bypasses rules. The
// Stripe webhook is the sole caller; nothing here ever runs in the browser.
//
// The credential is a service-account JSON in FIREBASE_SERVICE_ACCOUNT,
// accepted either as raw JSON or base64-encoded JSON (base64 avoids newline
// escaping headaches when pasting the private key into a host's env UI).

function loadServiceAccount(): Record<string, string> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  // A truncated paste or a stray quote is the usual way this value goes wrong,
  // and JSON.parse throwing here used to propagate all the way out of
  // getAdminDb(), so every caller's "is billing configured?" null check was
  // skipped and the route died as a bare 500 with no JSON body. Callers already
  // handle null by returning a 503 that names the missing credential; a
  // malformed value should take that same path.
  try {
    const json = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    // Private keys often arrive with literal "\n" sequences instead of real
    // newlines once they've been through an env var, normalize them.
    if (typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch (err) {
    console.error(
      "[firebase-admin] FIREBASE_SERVICE_ACCOUNT is set but unparseable, expected service-account JSON, or base64 of it",
      err
    );
    return null;
  }
}

let cached: App | null = null;
// A failed init is remembered, so a broken credential isn't re-attempted (and
// re-logged) on every single request for the life of the instance.
let initFailed = false;

/** The Admin app, or null when no service account is configured. */
export function getAdminApp(): App | null {
  if (cached) return cached;
  if (initFailed) return null;
  if (getApps().length) {
    cached = getApps()[0];
    return cached;
  }
  const svc = loadServiceAccount();
  if (!svc) return null;

  // cert() throws — on a malformed key, a missing private_key, and notably on
  // a private key whose newlines were flattened, which is exactly the case the
  // \n normalization in loadServiceAccount exists to repair and can't always.
  // loadServiceAccount is carefully guarded; this call was not, so every route
  // that reaches for the Admin SDK answered a bare 500 with no JSON body
  // instead of the 503 that names the missing credential.
  try {
    cached = initializeApp({
      credential: cert(svc as Parameters<typeof cert>[0]),
      projectId: svc.project_id,
    });
    return cached;
  } catch (err) {
    initFailed = true;
    console.error(
      "[firebase-admin] initialization failed; FIREBASE_SERVICE_ACCOUNT is set but unusable",
      err
    );
    return null;
  }
}

/** Admin Firestore, or null when the service account isn't set. */
export function getAdminDb(): Firestore | null {
  const app = getAdminApp();
  return app ? getFirestore(app) : null;
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
}
