"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { usePlan } from "@/lib/plan";
import { signOutUser } from "@/lib/auth";

// Header navigation that adapts to auth state: app links + sign out when
// logged in, log in / get started when logged out. Without Firebase config
// (local dev) the app links show unconditionally.

export function AuthNav() {
  const { user, loading, configured } = useAuth();
  const { plan } = usePlan();
  const router = useRouter();

  if (loading) return null;

  // Just the way in. Once inside the app, SubNav carries the per-feature
  // tabs, so repeating them up here would only split attention.
  const appLinks = (
    <Link href="/dashboard" className="nav-link hover:text-primary">
      Practice
    </Link>
  );

  // Pricing is a link for people deciding whether to pay. Once someone IS
  // paying it is noise in the one row of chrome they see on every screen,
  // and worse, it points at a page whose whole job is to sell them something
  // they already own. Subscribers manage billing from /account, which still
  // links through to /pricing as "Compare plans" for the rare case they want
  // to see the grid.
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
  // An unverified address is the one account state worth interrupting for:
  // until it's confirmed, RequireAuth holds the user out of the app entirely,
  // so the dot is the only clue as to why.
  const needsAttention = !user.emailVerified;

  return (
    <>
      {/* Only for people who could still buy something. `plan` is null while
          it loads, so a subscriber never watches a Pricing link appear and
          then vanish on every page load. */}
      {plan === "free" && pricingLink}
      {appLinks}
      {/* Shown at every width. It used to be hidden below the `sm` breakpoint,
          which on a mobile-first app meant most users had no route to their
          account, verification state, or billing at all. The name is what
          collapses on small screens now, not the whole control. */}
      <Link
        href="/account"
        title="Account settings"
        aria-label={
          needsAttention
            ? `Account: ${label}, email not verified`
            : `Account: ${label}`
        }
        className="relative flex items-center gap-2 rounded-full border border-primary/15 py-1 pl-1 pr-1 sm:pr-3 hover:border-primary/35"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-on-primary">
          {initial}
        </span>
        <span className="hidden sm:block max-w-[14ch] truncate text-primary/70">
          {label}
        </span>
        {needsAttention && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber ring-2 ring-surface"
          />
        )}
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
