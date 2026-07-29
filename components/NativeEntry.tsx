"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isNativeApp } from "@/lib/native";

/**
 * The app must never open on the marketing site.
 *
 * Launching used to land on `/` — hero, tagline, feature pitch, plans, footer.
 * That is not an app screen that happens to look webby; it is literally the
 * website's front door, and it's the first thing an App Review reviewer sees.
 * Under Guideline 4.2 an app whose first screen is a marketing page is a
 * repackaged website.
 *
 * So on native, `/` is not a destination — it's a router. Signed in, you go to
 * Today; signed out, to the login screen. The landing markup is hidden by CSS
 * meanwhile (`html[data-native] .native-hide`), so there's no flash of a
 * headline before the replace lands.
 *
 * Sits alongside RedirectIfAuthed rather than inside it: that one is about
 * auth state on the web, this one is about which client is asking.
 */
export function NativeEntry() {
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    // Without Firebase configured there's no auth answer coming, so send
    // people into the app and let RequireAuth deal with it.
    if (configured && loading) return;
    router.replace(configured && !user ? "/login" : "/dashboard");
  }, [user, loading, configured, router]);

  return null;
}
