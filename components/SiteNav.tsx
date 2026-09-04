"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FelixMark } from "@/components/FoxLogo";
import { AuthNav } from "@/components/AuthNav";
import { ScrollProgress } from "@/components/ScrollProgress";
import { useAuth } from "@/components/AuthProvider";

// The site's header: a floating glass pill rather than a bar welded to the
// top of the window, from the Claude Design project "Elovox.app UI overhaul".
//
// It replaced a sticky bar whose product links lived behind an "Explore"
// dropdown. The dropdown existed to buy width for a fourth and fifth
// top-level item; the pill buys that width by being a pill — it is only as
// wide as it needs to be, it floats clear of the content, and below 980px it
// collapses into a full-screen menu instead of a panel that has to be small
// enough to fit. So the sections are back where they belong: visible, named,
// one click away.
//
// Auth-aware, because this is chrome for the whole site and not just the
// front door: the marketing sections show to visitors, and AuthNav renders
// the right-hand cluster (log in / start free, or the account chip and the
// way out of it). Signed-in visitors navigate the app itself through SubNav,
// which sits below this.

interface NavSection {
  href: string;
  label: string;
  /** Hidden inside the iOS shell — a reachable price is an App Store
   *  rejection (guideline 3.1.1). */
  webOnly?: boolean;
}

// Absolute hrefs with a hash, so these work from /terms and /about too and
// not only from the page that owns the sections.
const SECTIONS: NavSection[] = [
  { href: "/#report", label: "The report" },
  { href: "/#modes", label: "Ways to practice" },
  { href: "/pricing", label: "Pricing", webOnly: true },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  const pathname = usePathname();
  const { user, configured } = useAuth();
  // The menu's open state is stored as the ROUTE it was opened on, so a
  // navigation to a DIFFERENT page closes it without an effect that clears a
  // boolean (which is the render-then-correct pattern
  // react-hooks/set-state-in-effect exists to catch).
  //
  // That alone is not enough, and the gap is not theoretical: three of the
  // the section links are same-page hashes (/#report, /#modes), and
  // usePathname() deliberately excludes the hash. Tapping one from / left
  // pathname unchanged, so the overlay stayed up at full opacity over the
  // section the user had just asked for. Same for Pricing tapped from
  // /pricing. So every link in the overlay also closes it on click.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);
  const close = () => setOpenedOn(null);

  // The marketing row is for people still deciding. Once someone is signed in
  // the same space carries their account, and the app's own tabs live in
  // SubNav directly beneath — repeating the sales links there would only
  // split attention. `configured === false` is local dev with no Firebase,
  // where the links should show unconditionally.
  const marketing = !configured || !user;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // setOpenedOn, not the setOpen helper: the helper closes over
      // `pathname`, which would put it in this effect's dependency list and
      // re-subscribe the listener on every navigation for no reason.
      if (e.key === "Escape") setOpenedOn(null);
    };
    // The overlay covers the viewport; letting the page scroll underneath it
    // means closing the menu can drop you somewhere you never chose to be.
    //
    // On <html>, NOT <body>. The body trick works by overflow propagating
    // from body to the viewport, and that propagation only happens while the
    // root's own overflow is `visible`. globals.css sets `html { overflow-x:
    // clip }` (so the hero's orbs never make a horizontal scrollbar), which
    // takes the propagation away and made the lock silently do nothing —
    // measured: the page still scrolled 600px behind the open overlay.
    // Restoring to "" hands the axis back to the stylesheet's clip.
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header className="site-nav native-hide">
        <div className="site-nav-row">
          <Link href="/" className="site-nav-brand" aria-label="Elovox home">
            {/* Inline vector, not the 46 KB PNG: two instances of this mark
                must emit byte-identical gradient defs or hydration desyncs,
                which is why FoxLogo hard-codes its ids. */}
            <FelixMark className="site-nav-mark" />
            <span className="site-nav-word">Elovox</span>
          </Link>

          {marketing && (
            <nav className="site-nav-links" aria-label="Sections">
              {SECTIONS.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className={`nav-link${s.webOnly ? " web-only" : ""}`}
                >
                  {s.label}
                </Link>
              ))}
            </nav>
          )}

          <div className="site-nav-right">
            <AuthNav />
            <button
              type="button"
              className="site-burger"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen(!open)}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path className="site-burger-top" d="M4 8h16" />
                <path className="site-burger-bot" d="M4 16h16" />
              </svg>
            </button>
          </div>

          {/* Reading progress, drawn as a hairline along the bottom edge of
              the pill. Decorative; it takes itself out under reduced motion. */}
          <ScrollProgress />
        </div>
      </header>

      {/* Reserves the space the fixed pill would otherwise float over. In the
          flow rather than as padding on <main> so SubNav clears it too. */}
      <div className="site-nav-spacer native-hide" aria-hidden="true" />

      {/* The menu below 980px. Rendered always, hidden by the stylesheet, so
          its links are in the document for anything that reads the page
          rather than looks at it — and so the open/close is a class flip and
          not a mount. */}
      <div
        id="site-menu"
        className={`site-menu native-hide${open ? " is-open" : ""}`}
        // Inert to pointers and to the tab order while closed. `hidden`
        // would drop it from the accessibility tree entirely and take the
        // transition with it.
        aria-hidden={!open}
      >
        <nav className="site-menu-list" aria-label="Sections">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              onClick={close}
              tabIndex={open ? undefined : -1}
              className={`site-menu-item${s.webOnly ? " web-only" : ""}`}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="site-menu-foot">
          {marketing ? (
            <>
              <Link href="/login" onClick={close} tabIndex={open ? undefined : -1} className="site-menu-login">
                Log in
              </Link>
              <Link
                href="/signup"
                onClick={close}
                tabIndex={open ? undefined : -1}
                className="site-menu-cta"
              >
                Start free
                <span className="site-cta-chip" aria-hidden="true">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17 17 7" />
                    <path d="M9 7h8v8" />
                  </svg>
                </span>
              </Link>
            </>
          ) : (
            <Link href="/dashboard" onClick={close} tabIndex={open ? undefined : -1} className="site-menu-cta">
              Practice
              <span className="site-cta-chip" aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 17 17 7" />
                  <path d="M9 7h8v8" />
                </svg>
              </span>
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
