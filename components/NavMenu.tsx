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
 * Desktop only (`md` and up) for the same space reason. On mobile the footer
 * and the homepage carry these links, which is where people look on a phone.
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
    <div ref={wrapRef} className="relative hidden md:block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="nav-link flex items-center gap-1 hover:text-primary"
      >
        Explore
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
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          className="nav-menu absolute right-0 top-full z-50 mt-3 w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-outline-variant bg-surface-lowest p-2 shadow-xl"
        >
          <div className="grid grid-cols-2 gap-1">
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
                  <span className="block text-[14px] font-semibold text-primary">
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
                  <span className="block text-[14px] font-semibold text-primary">
                    {a.who}
                  </span>
                  <span className="block text-caption leading-4 text-on-surface-variant">
                    {a.payoff}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
