"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AUDIENCES } from "@/lib/audiences";

/**
 * The "Explore" dropdown in the header, for signed-out visitors.
 *
 * The header deliberately runs a very short link list — the note in
 * AuthNav.tsx measures the 375px budget and shows a fourth top-level item
 * wraps onto the wordmark. So depth goes UNDER one control instead of beside
 * it: the per-audience pages in particular had exactly one route in (a card
 * partway down the homepage) despite being real, indexed landing pages.
 *
 * It used to be desktop-only, and the reasoning ("on mobile the footer and the
 * homepage carry these links") did not survive checking. Diffing what is
 * actually reachable at 1280px against an iPhone 13 found SEVEN destinations a
 * phone could not get to from an inner page — every /for/* audience landing
 * page, the homepage's own sections, and the pricing FAQ. The footer carries
 * legal and company links, not product ones, so from /terms on a phone the
 * audience pages had no route in at all.
 *
 * So it renders at every width now, in the shape each one can afford:
 *
 *   below md — an icon-only trigger and a full-width single-column panel. The
 *   icon is ~24px against the ~70px "Explore ⌄" costs, which is what buys the
 *   room; AuthNav also drops Pricing to `md` and up and the panel carries it
 *   instead, so the mobile header spends LESS width than before, not more.
 *   That matters: the 375px budget measured in AuthNav.tsx is real, and a
 *   fourth top-level item there wraps onto the wordmark.
 *
 *   md and up — unchanged. Text trigger, two-column panel.
 *
 * Behaves like a real menu: aria-expanded/aria-controls, Escape closes and
 * returns focus to the trigger, a click outside closes, and the items are
 * ordinary links so they open in a new tab / get copied like any other.
 */

const SECTIONS: { href: string; label: string; hint: string }[] = [
  {
    href: "/#how",
    label: "How it works",
    hint: "A minute of practice, then a scored report",
  },
  {
    href: "/#report",
    label: "What you get back",
    hint: "Six scores, your words marked up, the numbers",
  },
  {
    href: "/#modes",
    label: "Ways to practice",
    hint: "Daily Minute, interviews, social skills, your own material",
  },
  {
    href: "/pricing#faq",
    label: "Questions",
    hint: "What Premium does and doesn't change",
  },
];

export function NavMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Focus has to come back to the trigger, or Escape drops a keyboard
      // user at the top of the document.
      triggerRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // `focusin` rather than blur: tabbing past the last item should close it,
    // and blur fires before the next element has focus.
    const onFocusIn = (e: FocusEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        // The accessible name has to survive the label disappearing below md,
        // or the control becomes an unlabelled button on exactly the platform
        // where it is the ONLY way to reach half the site.
        aria-label="Explore Elovox"
        className="nav-link -m-2 flex items-center gap-1 p-2 hover:text-primary"
      >
        <span className="hidden md:inline">Explore</span>
        {/* Two glyphs, one control. The chevron reads as "more under this" next
            to a word; on its own at 12px it reads as nothing at all, so below
            md the trigger is a proper menu glyph at a real tap size. */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          aria-hidden="true"
          className="md:hidden"
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </>
          )}
        </svg>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`hidden md:block transition-transform duration-[var(--dur-base)] ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          // Two anchorings, and the mobile one is not a nicety.
          //
          // `absolute right-0` hangs the panel off the TRIGGER's right edge,
          // which works at md because the trigger sits far enough right that a
          // 30rem panel still lands on screen. Below md the trigger is the
          // first item in the row, so the same rule pushed a 358px panel most
          // of the way off the left of the viewport — it rendered, it was
          // clickable, and it was unreadable.
          //
          // So below md it anchors to the VIEWPORT instead: fixed, gutter to
          // gutter, under the 57px header. Fixed rather than absolute because
          // the header is sticky and creates its own containing block.
          className="nav-menu fixed inset-x-4 top-[4.25rem] z-50 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-xl border border-outline-variant bg-surface-lowest p-2 shadow-xl md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-3 md:max-h-[calc(100dvh-5rem)] md:w-[min(30rem,calc(100vw-2rem))]"
        >
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            <div>
              <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                The product
              </p>
              {SECTIONS.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 transition-colors hover:bg-surface-container"
                >
                  <span className="block text-body-sm font-semibold text-primary">
                    {s.label}
                  </span>
                  <span className="block text-caption leading-4 text-on-surface-variant">
                    {s.hint}
                  </span>
                </Link>
              ))}
            </div>

            <div>
              <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                Who it&apos;s for
              </p>
              {AUDIENCES.map((a) => (
                <Link
                  key={a.slug}
                  href={`/for/${a.slug}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 transition-colors hover:bg-surface-container"
                >
                  <span className="block text-body-sm font-semibold text-primary">
                    {a.who}
                  </span>
                  <span className="block text-caption leading-4 text-on-surface-variant">
                    {a.payoff}
                  </span>
                </Link>
              ))}
            </div>

            {/* Below md these two are not in the header — Pricing moves here to
                pay for the trigger's width, and About has always been hidden
                under `sm` because a fourth top-level item wraps onto the
                wordmark at 375px. Without this group a phone could reach
                neither from an inner page.

                web-only rides along with Pricing exactly as it does in the
                header. The iOS shell renders this same markup, and a pricing
                route reachable inside it is an App Store rejection. */}
            <div className="md:hidden">
              <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                Elovox
              </p>
              <Link
                href="/pricing"
                onClick={() => setOpen(false)}
                className="web-only block rounded-lg px-3 py-2 transition-colors hover:bg-surface-container"
              >
                <span className="block text-body-sm font-semibold text-primary">
                  Pricing
                </span>
                <span className="block text-caption leading-4 text-on-surface-variant">
                  What Free covers, and what Premium adds
                </span>
              </Link>
              <Link
                href="/about"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 transition-colors hover:bg-surface-container"
              >
                <span className="block text-body-sm font-semibold text-primary">
                  About
                </span>
                <span className="block text-caption leading-4 text-on-surface-variant">
                  Why Elovox exists, and who builds it
                </span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
