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
    const timer = setTimeout(() => {
      setUser(getAuthInstance().currentUser ?? null);
      stopLoading();
    }, 6000);
    import("firebase/auth").then(({ onAuthStateChanged }) => {
      unsubscribe = onAuthStateChanged(
        getAuthInstance(),
        (u) => {
          setUser(u);
          stopLoading();
        },
        () => {
          // Listener errored (rare init failure): fall back to whatever the
          // SDK currently has and let the app render.
          setUser(getAuthInstance().currentUser ?? null);
          stopLoading();
        }
      );
    });
    return () => {
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
