"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";
import { isFirebaseConfigured, getAuthInstance } from "@/lib/firebase";

interface AuthState {
  /** Signed-in Firebase user, or null. */
  user: User | null;
  /** True until the initial auth state has loaded. */
  loading: boolean;
  /** False when NEXT_PUBLIC_FIREBASE_* env vars are absent (local dev). */
  configured: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  configured: false,
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);
  // Incremented on every token change so a User mutated in place (a changed
  // email, a newly verified address) still re-renders consumers. See the note
  // on onIdTokenChanged below.
  const [, setAuthNonce] = useState(0);

  useEffect(() => {
    if (!configured) return;
    let unsubscribe: (() => void) | undefined;
    let resolved = false;
    // Stop showing the loading gate exactly once. Without this, if the initial
    // onAuthStateChanged callback never fires — auth init wedged, e.g.
    // IndexedDB unavailable in some private-browsing modes — `loading` would
    // stay true forever and RequireAuth would render a permanent blank screen.
    // getUser() in lib/firebase guards the data layer the same way; this guards
    // the render gate.
    const stopLoading = () => {
      if (resolved) return;
      resolved = true;
      setLoading(false);
    };
    // The effect can tear down before the dynamic import resolves, in which
    // case the cleanup below runs against an `unsubscribe` that doesn't exist
    // yet and the listener registered a tick later is never removed.
    let cancelled = false;

    const timer = setTimeout(() => {
      setUser(getAuthInstance().currentUser ?? null);
      stopLoading();
    }, 6000);
    import("firebase/auth").then(({ onIdTokenChanged }) => {
      // onIdTokenChanged, not onAuthStateChanged: it fires for sign-in and
      // sign-out AND for every token refresh, which is what surfaces a
      // changed email or a newly verified address. With the state-only
      // listener, a user who changed their email kept seeing the OLD address
      // in the header and on /account indefinitely, and then — up to an hour
      // later, when the revoked refresh token first failed — got dumped to
      // /login mid-session with no explanation.
      //
      // Firebase mutates the User object IN PLACE, so `setUser(u)` with the
      // same reference is a no-op React bails out of — the email would change
      // underneath us and nothing would re-render. Bumping a nonce forces the
      // render, which rebuilds the context value, and consumers re-read the
      // (now updated) fields off the same object. Cloning the User instead
      // would be worse: its methods depend on internal own-properties, and a
      // copy would drift from the instance the SDK keeps mutating.
      const subscription = onIdTokenChanged(
        getAuthInstance(),
        (u) => {
          setUser(u);
          setAuthNonce((n) => n + 1);
          stopLoading();
        },
        () => {
          // Listener errored (rare init failure): fall back to whatever the
          // SDK currently has and let the app render.
          setUser(getAuthInstance().currentUser ?? null);
          stopLoading();
        }
      );
      if (cancelled) subscription();
      else unsubscribe = subscription;
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [configured]);

  return (
    <AuthContext.Provider value={{ user, loading, configured }}>
      {children}
    </AuthContext.Provider>
  );
}
