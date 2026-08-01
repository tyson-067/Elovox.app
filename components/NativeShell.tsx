"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { usePlan } from "@/lib/plan";
import { useIsNative } from "@/lib/native";

/**
 * The whole native interface: a title bar and a dock, replacing the website's
 * header, sub-nav, and footer (which are marked `native-hide` in the layout).
 *
 * Renders nothing at all in a browser. Nothing in here is a second copy of a
 * screen — every page still renders exactly the same component tree in both
 * clients, and only the chrome around it changes.
 */

/* --- Icons ---------------------------------------------------------------
   Hand-drawn rather than pulled from a library, so all five share one stroke
   weight and one corner treatment. 1.7px on a 22px box reads as a hairline at
   3x without disappearing at 2x. */

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function TodayIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
      <path d="M9.5 20.5v-6h5v6" />
    </svg>
  );
}

function ProgressIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 19.5V4.5" />
      <path d="M4 19.5h16" />
      <path d="m7.5 15 3.5-4 3 2.5L20 7" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 4.5h4.5A2.5 2.5 0 0 1 12 7v12a2 2 0 0 0-2-2H5z" />
      <path d="M19 4.5h-4.5A2.5 2.5 0 0 0 12 7v12a2 2 0 0 1 2-2h5z" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

/* The record node's mark: a microphone, filled-in white on the orange blob. */
function MicIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function BackChevron() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m14.5 5-7 7 7 7" />
    </svg>
  );
}

/* --- Routes ---------------------------------------------------------------
   One table, so the title bar and the dock can never disagree about where you
   are. Titles are the section's own name, not the page's <h1> — the bar says
   where you are, the page says what to do. */

const TITLES: Record<string, string> = {
  "/dashboard": "Today",
  "/progress": "Progress",
  "/library": "Speech library",
  "/interviews": "Interviews",
  "/social": "Social skills",
  "/custom": "Felix writes it",
  "/own": "My material",
  "/account": "Account",
  "/practice": "Practice",
  "/terms": "Terms",
  "/privacy": "Privacy",
  "/about": "About",
  "/login": "Log in",
  "/signup": "Create account",
  "/verify-email": "Verify your email",
  "/admin": "Admin",
  // Both are linked from the dashboard and from /progress with no `web-only`
  // marker, so they are reachable inside the app from a docked root screen.
  // Missing here, titleFor fell through to the bare "Elovox" default.
  "/shop": "Felix's shop",
  "/leaderboard": "Leaderboard",
};

/** Destinations you can reach from the dock — these never show a back arrow. */
const ROOTS = new Set([
  "/dashboard",
  "/progress",
  "/library",
  "/interviews",
  "/social",
  "/custom",
  "/own",
  "/account",
]);

/** Auth screens. These already open with their own hero ("Welcome back"), so
    a large title above it would be the same screen introducing itself twice.
    They get a bare bar — status-bar inset and nothing else. */
const BARE = new Set(["/login", "/signup", "/verify-email"]);

/** Screens that get the dock. Auth and marketing don't; nor does /practice,
    which is a recording session and has its own single job on screen. */
const DOCKED = new Set([
  "/dashboard",
  "/progress",
  "/library",
  "/interviews",
  "/social",
  "/custom",
  "/own",
  "/account",
  "/report",
  // Pushed screens, so they keep their back chevron (deliberately NOT in
  // ROOTS) — but they still need the tab bar. Without it, tapping Felix's
  // shop from Today dropped the user onto a screen with no dock and a title
  // reading "Elovox", which is the exact "this is a webview" tell the rest of
  // this file exists to remove.
  "/shop",
  "/leaderboard",
]);

function sectionOf(pathname: string): string {
  const seg = `/${pathname.split("/").filter(Boolean)[0] ?? ""}`;
  return seg;
}

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const section = sectionOf(pathname);
  if (section === "/report") return "Your report";
  return TITLES[section] ?? "Elovox";
}

/* --- Title bar ------------------------------------------------------------ */

function NativeTitleBar({ pathname }: { pathname: string }) {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  // The large title collapses into the 44px row once the page moves. 12px,
  // not 0, so a one-pixel scroll jitter doesn't flicker the bar.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  const title = titleFor(pathname);
  const bare = BARE.has(pathname);
  // /login is where the app opens when you're signed out — there is nothing
  // behind it to go back to.
  const canGoBack = !ROOTS.has(pathname) && pathname !== "/" && pathname !== "/login";

  return (
    <div className={`native-bar ${scrolled && !bare ? "native-bar-scrolled" : ""}`}>
      <div className="native-bar-row">
        {canGoBack ? (
          <button
            type="button"
            onClick={() => router.back()}
            className="native-bar-btn -ml-1"
            aria-label="Back"
          >
            <BackChevron />
          </button>
        ) : (
          <span className="w-2" />
        )}
        {/* The collapsed title is centred over the whole row, the way iOS
            centres it, which is why it's absolutely placed rather than
            sitting between the two controls. */}
        {!bare && (
          <span className="pointer-events-none absolute inset-x-0 flex justify-center">
            <span className="native-title-sm">{title}</span>
          </span>
        )}
      </div>
      {!bare && <h1 className="native-title-lg">{title}</h1>}
    </div>
  );
}

/* --- Dock ----------------------------------------------------------------- */

interface Tab {
  href: string;
  label: string;
  icon: () => React.ReactElement;
  premium?: boolean;
}

// Four destinations. The premium sections that used to be peer tabs on the
// web (Interviews, Social skills, Felix writes it, My material) are cards
// inside Today now —
// a free user shouldn't spend a third of the dock on things they can't open.
const TABS: Tab[] = [
  { href: "/dashboard", label: "Today", icon: TodayIcon },
  { href: "/progress", label: "Progress", icon: ProgressIcon },
  { href: "/library", label: "Library", icon: LibraryIcon, premium: true },
  { href: "/account", label: "Account", icon: AccountIcon },
];

function NativeDock({ pathname }: { pathname: string }) {
  const { isPremium } = usePlan();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const tab = (t: Tab) => {
    const Icon = t.icon;
    const active = isActive(t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        className="native-tab"
        aria-current={active ? "page" : undefined}
      >
        <Icon />
        <span>{t.label}</span>
        {t.premium && !isPremium && (
          // A bare <span> is role=generic, where ARIA 1.2 prohibits
          // aria-label — AT drops it, leaving the lock glyph as the only
          // signal. Real hidden text instead.
          <span className="native-tab-lock">
            <span className="sr-only">Premium</span>
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav className="native-dock" aria-label="Main">
      <div className="native-dock-row">
        {TABS.slice(0, 2).map(tab)}
        {/* The one action, between the two pairs of destinations. It goes
            straight into today's drill — the same place the dashboard's
            primary button goes — so the app is always one tap from speaking. */}
        <Link
          href="/practice?daily=1"
          className="native-record"
          aria-label="Start today's practice"
        >
          <span className="native-record-blob">
            <MicIcon />
          </span>
        </Link>
        {TABS.slice(2).map(tab)}
      </div>
    </nav>
  );
}

/* --- Shell ---------------------------------------------------------------- */

export function NativeShell() {
  const native = useIsNative();
  const pathname = usePathname();
  const { user, loading, configured } = useAuth();

  if (!native) return null;

  const section = sectionOf(pathname);
  // Don't show a dock to someone RequireAuth is about to bounce to /login —
  // the same guard the web sub-nav uses.
  const signedIn = !configured || (!loading && !!user);
  const showDock = signedIn && DOCKED.has(section);

  return (
    <>
      <NativeTitleBar pathname={pathname} />
      {showDock && <NativeDock pathname={pathname} />}
    </>
  );
}
