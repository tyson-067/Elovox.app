import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, type Auth, type User } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Firebase is optional at runtime: when the NEXT_PUBLIC_FIREBASE_* env vars
// are absent (local dev before setup), the app falls back to localStorage
// and the auth pages explain that accounts aren't available.

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function ensureApp(): FirebaseApp {
  if (!app) {
    app = getApps()[0] ?? initializeApp(config);
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
 * Resolves with the signed-in user, or null if nobody is signed in (or
 * Firebase isn't configured). Waits for the initial auth state to load.
 */
export function getUser(): Promise<User | null> {
  if (!isFirebaseConfigured()) return Promise.resolve(null);
  ensureApp();
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth!, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}
