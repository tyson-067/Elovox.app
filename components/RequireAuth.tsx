"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { hasCompletedOnboarding } from "@/lib/onboarding";

// Client-side gate for app pages (dashboard, practice, progress, report).
// When Firebase is configured, visitors without an account are sent to
// /login. Signed-in users who haven't answered the onboarding questions
// are sent to /onboarding first (the onboarding page itself opts out via
// gateOnboarding={false}). Without Firebase config the app stays open
// (localStorage mode), but the onboarding gate still applies.

export function RequireAuth({
  children,
  gateOnboarding = true,
}: {
  children: ReactNode;
  gateOnboarding?: boolean;
}) {
  const { user, loading, configured } = useAuth();
  const router = useRouter();
  const [onboarded, setOnboarded] = useState(!gateOnboarding);

  useEffect(() => {
    if (loading) return;
    if (configured && !user) {
      router.replace("/login");
      return;
    }
    if (!gateOnboarding) return;

    let cancelled = false;
    hasCompletedOnboarding().then((done) => {
      if (cancelled) return;
      if (done) setOnboarded(true);
      else router.replace("/onboarding");
    });
    return () => {
      cancelled = true;
    };
  }, [configured, loading, user, gateOnboarding, router]);

  if (configured && (loading || !user)) return null;
  if (!onboarded) return null;
  return <>{children}</>;
}
