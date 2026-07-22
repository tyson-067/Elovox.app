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
    import("firebase/auth").then(({ onAuthStateChanged }) => {
      unsubscribe = onAuthStateChanged(getAuthInstance(), (u) => {
        setUser(u);
        setLoading(false);
      });
    });
    return () => unsubscribe?.();
  }, [configured]);

  return (
    <AuthContext.Provider value={{ user, loading, configured }}>
      {children}
    </AuthContext.Provider>
  );
}
