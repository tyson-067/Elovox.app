"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { usePlan } from "@/lib/plan";

// Second row of the header: one tab per feature, so the app isn't a single
// scrolling page any more. A persistent row rather than a dropdown — these
// are the six things you can do, and hiding them behind a menu is how
// people miss half of them.
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
  { href: "/custom", label: "Felix writes it", premium: true },
  { href: "/own", label: "My material", premium: true },
  { href: "/progress", label: "Progress" },
];

/** Routes that are part of the app shell (everything else is marketing/auth). */
const APP_ROUTES = [
  "/dashboard",
  "/library",
  "/interviews",
  "/custom",
  "/own",
  "/progress",
  "/practice",
  "/report",
  "/account",
];

export function SubNav() {
  const pathname = usePathname();
  const { user, loading, configured } = useAuth();
  const { isPremium } = usePlan();

  const inApp = APP_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );
  if (!inApp) return null;
  // Don't flash the app chrome at someone RequireAuth is about to bounce.
  if (configured && (loading || !user)) return null;

  return (
    <div className="border-t border-primary/8 bg-white/70">
      <nav
        aria-label="Practice sections"
        className="w-full px-4 md:px-10 xl:px-16 2xl:px-24"
      >
        {/* Horizontal scroll rather than wrapping: keeps the header one row
            tall on a phone, and the active tab is scrolled into view. */}
        <ul className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const locked = item.premium && !isPremium;
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold tracking-wide transition-colors ${
                    active
                      ? "text-primary"
                      : "text-primary/55 hover:text-primary"
                  }`}
                >
                  {item.label}
                  {locked && (
                    <span
                      aria-label="Premium"
                      title="Premium"
                      className="h-1.5 w-1.5 rounded-full bg-violet"
                    />
                  )}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
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
