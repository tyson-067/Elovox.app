"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

// Client-side gate for app pages (dashboard, practice, progress, report).
// When Firebase is configured, visitors without an account are sent to
// /login. Without Firebase config the app stays open (localStorage mode).
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

  const unverified = Boolean(configured && user && !user.emailVerified);

  useEffect(() => {
    if (loading) return;
    if (configured && !user) {
      router.replace("/login");
      return;
    }
    if (unverified) router.replace("/verify-email");
  }, [configured, loading, user, unverified, router]);

  if (configured && (loading || !user)) return null;
  if (unverified) return null;
  return <>{children}</>;
}
