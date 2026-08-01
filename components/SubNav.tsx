"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { usePlan } from "@/lib/plan";

// Second row of the header: one tab per feature, so the app isn't a single
// scrolling page any more. A persistent row rather than a dropdown, these
// are the things you can do, and hiding them behind a menu is how people
// miss half of them.
//
// Only renders inside the app. Marketing and auth screens keep the plain
// header, so nothing here leaks to signed-out visitors.

interface NavItem {
  href: string;
  label: string;
  premium?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Today" },
  { href: "/library", label: "Speech library", premium: true },
  { href: "/interviews", label: "Interviews", premium: true },
  { href: "/social", label: "Social skills", premium: true },
  { href: "/custom", label: "Felix writes it", premium: true },
  { href: "/own", label: "My material", premium: true },
  { href: "/progress", label: "Progress" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/shop", label: "Shop" },
];

/** Routes that are part of the app shell (everything else is marketing/auth). */
const APP_ROUTES = [
  "/dashboard",
  "/library",
  "/interviews",
  "/social",
  "/custom",
  "/own",
  "/progress",
  "/leaderboard",
  "/shop",
  "/practice",
  "/report",
  "/account",
];

export function SubNav() {
  const pathname = usePathname();
  const { user, loading, configured } = useAuth();
  const { plan } = usePlan();

  // Bring the active tab into view when it lands off-screen in the scroll
  // strip (with 9 tabs only 3-4 fit at 375px, so a right-side section like
  // /shop or /own would otherwise show no visible active tab). block:nearest
  // so it never scrolls the whole page vertically.
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [pathname]);

  const inApp = APP_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );
  if (!inApp) return null;
  // Don't flash the app chrome at someone RequireAuth is about to bounce.
  if (configured && (loading || !user)) return null;

  return (
    <div className="border-t border-primary/8 bg-surface/55">
      <nav
        aria-label="Practice sections"
        className="w-full px-4 md:px-10 xl:px-16 2xl:px-24"
      >
        {/* Horizontal scroll rather than wrapping: keeps the header one row
            tall on a phone, and the active tab is scrolled into view (effect
            above). pb-0.5 gives the active-tab underline room: overflow-x:auto
            forces overflow-y:auto too, so a 1px-below indicator would be
            clipped by the vertical overflow. */}
        <ul className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
          {ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            // plan===null (loading) → not locked, so a subscriber never sees a
            // flash of Premium dots before the plan resolves.
            const locked = item.premium && plan === "free";
            return (
              <li key={item.href} ref={active ? activeRef : undefined} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold tracking-wide transition-colors ${
                    active
                      ? "text-primary"
                      : // /55 measured 2.82:1 on the surface, well under the
                        // 4.5:1 AA floor for 13px text. /75 clears it while
                        // keeping the active tab clearly the darker one.
                        "text-primary/75 hover:text-primary"
                  }`}
                >
                  {item.label}
                  {locked && (
                    // A bare <span> is role=generic, where ARIA 1.2 PROHIBITS
                    // aria-label — assistive tech drops it, leaving a 6px
                    // violet dot as the only signal that a mode is Premium
                    // (colour and shape alone). Real hidden text instead.
                    <span
                      title="Premium"
                      className="h-1.5 w-1.5 rounded-full bg-violet"
                    >
                      <span className="sr-only">Premium</span>
                    </span>
                  )}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
