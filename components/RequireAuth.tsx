"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isDemoMode } from "@/lib/firebase";

// Client-side gate for app pages (dashboard, practice, progress, report).
// Visitors without an account are sent to /login.
//
// It FAILS CLOSED. This used to read "without Firebase config the app stays
// open (localStorage mode)", and that is exactly what it did: no config meant
// no gate, so anyone could reach /practice. Reported from a preview build
// where the Firebase vars were blanked, and the same shape would have opened
// the whole product in production the day an env var went missing. Absence of
// auth is not permission. Open access now needs an explicit demo session
// (see isDemoMode in lib/firebase.ts), never merely a missing key.
//
// Unverified email/password accounts are held at /verify-email until they
// click the link. Google accounts pass straight through, Google has already
// verified the address, so `emailVerified` is true from the first sign-in.
//
// There used to be a third gate here: a run of onboarding questions every
// new account had to answer before it could reach the dashboard. It's gone.
// Nothing in the product ever read the answers, so it was a wall of forms
// between signing up and the first thing anyone came here to do, which is
// speak into a microphone. What Felix needs to know he learns from the
// recordings.

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, configured } = useAuth();
  const router = useRouter();
  const demo = isDemoMode();

  const unverified = Boolean(configured && user && !user.emailVerified);
  // No signed-in user and no explicit demo session: locked, whatever the
  // reason there is no user — signed out, or Firebase never initialised.
  const locked = !demo && !user;

  useEffect(() => {
    if (loading) return;
    if (locked) {
      router.replace("/login");
      return;
    }
    if (unverified) router.replace("/verify-email");
  }, [loading, locked, unverified, router]);

  // `loading` is only ever true when Firebase IS configured (see
  // AuthProvider), so an unconfigured build resolves to locked immediately
  // rather than hanging on a null render.
  if (loading) return null;
  if (locked || unverified) return null;
  return <>{children}</>;
}
