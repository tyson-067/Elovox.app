"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

// Dropped onto the marketing home so a signed-in visitor is taken straight
// into the app instead of the landing page. Renders nothing — the page stays
// server-rendered for signed-out visitors (and search engines); this only
// redirects once auth resolves to a logged-in user.
export function RedirectIfAuthed() {
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && configured && user) router.replace("/dashboard");
  }, [loading, configured, user, router]);

  return null;
}
