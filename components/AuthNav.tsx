"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { signOutUser } from "@/lib/auth";

// Header navigation that adapts to auth state: app links + sign out when
// logged in, log in / get started when logged out. Without Firebase config
// (local dev) the app links show unconditionally.

export function AuthNav() {
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  if (loading) return null;

  // Just the way in. Once inside the app, SubNav carries the per-feature
  // tabs, so repeating them up here would only split attention.
  const appLinks = (
    <Link href="/dashboard" className="nav-link hover:text-primary">
      Practice
    </Link>
  );

  const pricingLink = (
    <Link href="/pricing" className="nav-link hover:text-primary">
      Pricing
    </Link>
  );

  if (!configured) {
    return (
      <>
        {pricingLink}
        {appLinks}
      </>
    );
  }

  if (!user) {
    return (
      <>
        {pricingLink}
        <Link href="/login" className="nav-link hover:text-primary">
          Log in
        </Link>
        <Link
          href="/signup"
          className="btn rounded-full bg-primary text-on-primary px-4 py-1.5"
        >
          Get started
        </Link>
      </>
    );
  }

  // The account affordance: an avatar chip, not a bare name sitting inline
  // with the nav links (which reads like a stray tab). The initial comes from
  // the display name or email so it's always something sensible.
  const label = user.displayName || user.email || "Account";
  const initial = label.trim().charAt(0).toUpperCase() || "A";

  return (
    <>
      {pricingLink}
      {appLinks}
      <Link
        href="/account"
        title="Account settings"
        aria-label={`Account: ${label}`}
        className="hidden sm:flex items-center gap-2 rounded-full border border-primary/15 py-1 pl-1 pr-3 hover:border-primary/35"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-on-primary">
          {initial}
        </span>
        <span className="max-w-[14ch] truncate text-primary/70">{label}</span>
      </Link>
      <button
        onClick={async () => {
          await signOutUser();
          router.push("/");
        }}
        className="rounded border border-primary/20 px-2.5 py-1 hover:text-primary hover:border-primary/40"
      >
        Sign out
      </button>
    </>
  );
}
