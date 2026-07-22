import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Server-side Firebase, initialized from a service account. This is the ONLY
// thing allowed to write users/{uid}/profile/plan — firestore.rules makes
// that doc read-only to the user, and the Admin SDK bypasses rules. The
// Stripe webhook is the sole caller; nothing here ever runs in the browser.
//
// The credential is a service-account JSON in FIREBASE_SERVICE_ACCOUNT,
// accepted either as raw JSON or base64-encoded JSON (base64 avoids newline
// escaping headaches when pasting the private key into a host's env UI).

function loadServiceAccount(): Record<string, string> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const json = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(json);
  // Private keys often arrive with literal "\n" sequences instead of real
  // newlines once they've been through an env var — normalize them.
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
}

let cached: App | null = null;

/** The Admin app, or null when no service account is configured. */
export function getAdminApp(): App | null {
  if (cached) return cached;
  if (getApps().length) {
    cached = getApps()[0];
    return cached;
  }
  const svc = loadServiceAccount();
  if (!svc) return null;
  cached = initializeApp({
    credential: cert(svc as Parameters<typeof cert>[0]),
    projectId: svc.project_id,
  });
  return cached;
}

/** Admin Firestore, or null when the service account isn't set. */
export function getAdminDb(): Firestore | null {
  const app = getAdminApp();
  return app ? getFirestore(app) : null;
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
}
