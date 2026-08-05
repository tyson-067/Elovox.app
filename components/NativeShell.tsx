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
  // The five-bar voice mark, from Felix's chest and the app icon — the one
  // sanctioned static use of the Tape's grammar in the chrome (the binding
  // rule lives with .voxline in globals.css). Filled, not stroked: at 2.5px
  // wide a stroke outline would just read as noise.
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden
    >
      <rect x="2.75" y="8.5" width="2.5" height="7" rx="1.25" />
      <rect x="7.25" y="5.5" width="2.5" height="13" rx="1.25" />
      <rect x="11.75" y="2.5" width="2.5" height="19" rx="1.25" />
      <rect x="16.25" y="5.5" width="2.5" height="13" rx="1.25" />
      <rect x="20.75" y="8.5" width="2.5" height="7" rx="1.25" />
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
  "/dashboard": "Ladder",
  "/progress": "Progress",
  "/library": "Speech library",
  "/interviews": "Interviews",
  "/social": "Social skills",
  "/custom": "Felix writes it",
  "/own": "My material",
  // The Den: the same settings screen, entered through what you've earned.
  "/account": "Den",
  "/practice": "Practice",
  "/terms": "Terms",
  "/privacy": "Privacy",
  // Every legal page you can walk to from inside the app needs a name here,
  // or `titleFor` falls through to the bare "Elovox" default and the screen
  // announces the company instead of itself. /cookies is one tap from Privacy,
  // which is one tap from the Den — three screens deep, all of them titled
  // "Elovox" until now. The rest are here so the same thing can't happen the
  // moment one of them gains a link.
  // Linked from every report's "AI-generated" byline, so it is one tap from
  // the busiest screen in the app.
  "/ai": "How Felix works",
  "/cookies": "Cookies",
  "/legal": "Legal",
  "/refunds": "Refunds",
  "/accessibility": "Accessibility",
  "/dmca": "Copyright",
  "/biometrics": "Biometric data",
  "/children": "Children",
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

/** Screens that supply their own header, so the shell contributes no bar at
    all — not even the inset row, which would otherwise be counted twice.

    The Ladder is the only one: its sticky HUD (Felix, the level bar, the
    streak) IS the header, and those three are the only things on that screen
    that stay true however far you scroll. A 34pt "Ladder" floating above the
    climb was a label on a thing that already says its own name. */
const HEADLESS = new Set(["/dashboard"]);

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
            sitting between the two controls.

            MOUNTED ONLY WHILE COLLAPSED, and that is a device fix, not tidying.
            It used to render always and hide with `opacity: 0; visibility:
            hidden`, which — with a transition on both properties — gives it a
            composited layer of its own. On the simulator that layer went stale:
            a Den scrolled down and back sat at the top of its page showing the
            collapsed title AND the large title at once, with the same words
            twice. A live debug readout pinned to the app proved the DOM was
            right at that moment (bar not scrolled, this span at opacity 0,
            visibility hidden) — WebKit was painting a layer that no longer
            existed in any computed style. A span React has removed cannot be
            painted by anybody. */}
        {!bare && scrolled && (
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

// Four destinations and NO action.
//
// The dock used to carry a fifth node — a record button between the two pairs
// — from back when home was a wall of cards and the one thing to do could get
// lost in it. On the Ladder it cannot: the rung is the biggest object on the
// home screen, it is orange, it pulses, and it is one tab away from anywhere.
// A record node beside it was a second door onto the same room, and it cost
// the dock a fifth of its width to say something the screen was already
// shouting.
//
// The premium sections that used to be peer tabs on the web (Interviews,
// Social skills, Felix writes it, My material) live in the rail at the foot of
// the climb — a free user shouldn't spend the dock on things they can't open.
const TABS: Tab[] = [
  { href: "/dashboard", label: "Ladder", icon: TodayIcon },
  { href: "/progress", label: "Progress", icon: ProgressIcon },
  { href: "/library", label: "Library", icon: LibraryIcon, premium: true },
  { href: "/account", label: "Den", icon: AccountIcon },
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
      <div className="native-dock-row">{TABS.map(tab)}</div>
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
      {!HEADLESS.has(pathname) && <NativeTitleBar pathname={pathname} />}
      {showDock && <NativeDock pathname={pathname} />}
    </>
  );
}
