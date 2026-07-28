"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

// The footer's About link, which exists for one reason: on mobile the header
// can't fit a fourth nav item, so without this there is no route to /about
// from any page except the landing page. The footer renders on every route at
// every width, which is exactly the gap.
//
// It has to be a client component because it can't render for signed-in
// users. /about sends them to /dashboard (RedirectIfAuthed), so a link they
// can see but not follow is worse than no link: they'd click it and get
// yanked out of the app. The rest of the footer stays server-rendered; only
// this one link needs auth state.
//
// Mirrors AuthNav's rule deliberately, including the `!configured` case
// (local dev without Firebase env vars, where nobody can be signed in).
export function FooterAboutLink({ className }: { className?: string }) {
  const { user, configured } = useAuth();

  // Deliberately renders while auth is still loading, rather than waiting the
  // way AuthNav does. That's what puts the link in the server-rendered HTML:
  // /about is otherwise linked only from client-rendered nav, so without this
  // the site would ship no crawlable internal link to the page at all, and a
  // page reachable solely from the sitemap is a page search engines treat as
  // an orphan. The cost is that a signed-in user sees "About" in the footer
  // for the moment before auth resolves, which is below the fold and cheap.
  if (configured && user) return null;

  return (
    <Link href="/about" className={className}>
      About
    </Link>
  );
}
