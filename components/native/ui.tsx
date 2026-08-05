"use client";

import { useEffect, type ReactNode, type ButtonHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

/**
 * The native primitive set. Every native screen is composed from these —
 * a screen that reaches past them for a hand-rolled div with its own hex
 * color is regressing the redesign. All styling lives in the .nv-* classes
 * (app/native-theme.css); these components only arrange semantics.
 *
 * None of this renders differently on the web because none of it is USED
 * on the web: only the Native* screen components import from here, and
 * those mount behind useIsNative().
 */

/* --- Section header: uppercase footnote above a group ---------------------- */
export function NvSectionHeader({ children }: { children: ReactNode }) {
  // mt-10: the pause between sections is most of what "uncluttered" means —
  // a section header is a place to stop, not a line to pass.
  return <h2 className="nv-caption mt-10 mb-3 px-1">{children}</h2>;
}

/* --- Inset grouped list ---------------------------------------------------- */
export function NvGroup({ children }: { children: ReactNode }) {
  return <div className="nv-group">{children}</div>;
}

export function NvChevron() {
  return (
    <svg
      className="nv-chevron"
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m1.5 1.5 5 5.5-5 5.5" />
    </svg>
  );
}

/**
 * One row of an inset grouped list. Give it `href` to push, `onClick` to
 * act, neither to display. The leading icon is any mono-stroke glyph; it
 * lands in the small tinted square. `value` is the trailing detail
 * ("On", the email address, a count). Destructive rows go red and lose
 * the chevron, the way Settings does it.
 */
export function NvRow({
  icon,
  label,
  sub,
  value,
  href,
  onClick,
  destructive,
  accent,
  pop,
  chevron,
  disabled,
  ariaLabel,
}: {
  icon?: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
  accent?: boolean;
  /**
   * Pin this row's icon tint instead of taking one from the palette cycle.
   *
   * The cycle is keyed on nth-child, which is right for a fixed list and
   * wrong the moment a group can gain or lose a row: the Practice group grows
   * a "Remind me at" row when the reminder is switched on, and every row after
   * it changed colour as the switch flipped. A row that can move says what
   * colour it is.
   */
  pop?: string;
  chevron?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const showChevron = chevron ?? Boolean(href);
  const body = (
    <>
      {icon && (
        <span className={`nv-icon-square${accent ? " nv-icon-square-accent" : ""}`} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate${destructive ? "" : ""}`}>{label}</span>
        {sub && <span className="nv-footnote block truncate">{sub}</span>}
      </span>
      {value !== undefined && <span className="nv-row-value">{value}</span>}
      {showChevron && <NvChevron />}
    </>
  );
  const cls = `nv-row${destructive ? " nv-row-destructive" : ""}`;
  // Icon-less rows divide from the text edge (the divider inset is keyed on
  // this attribute in native-theme.css).
  const noicon = icon ? undefined : "";
  if (href && !disabled) {
    return (
      <Link
        href={href}
        className={cls}
        data-noicon={noicon}
        data-pop={pop}
        aria-label={ariaLabel}
      >
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cls}
        data-noicon={noicon}
        data-pop={pop}
        aria-label={ariaLabel}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-noicon={noicon} data-pop={pop}>
      {body}
    </div>
  );
}

/* --- Buttons ---------------------------------------------------------------- */
export function NvButton({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "plain";
}) {
  return (
    <button
      type="button"
      {...props}
      className={`nv-btn nv-btn-${variant} disabled:opacity-50 ${className}`}
    />
  );
}

/* --- Chip ------------------------------------------------------------------- */
export function NvChip({
  selected,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      data-selected={selected || undefined}
      aria-pressed={selected}
      className={`nv-chip ${className}`}
    />
  );
}

/* --- Stat: big tabular numeral over a quiet label --------------------------- */
export function NvStat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5">
      <span className="nv-stat-value nv-num">{value}</span>
      <span className="nv-stat-label">{label}</span>
    </div>
  );
}

/* --- Empty state: glyph, one line, one action -------------------------------- */
export function NvEmpty({
  icon,
  line,
  action,
}: {
  icon?: ReactNode;
  line: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="nv-empty">
      {icon}
      {/* A <div>, not a <p>. `line` is a ReactNode and two callers already
          pass a <FelixBubble>, which is a div — and a div inside a p is
          invalid HTML that the parser hoists OUT of the paragraph, so the
          server's markup and React's tree disagree and hydration FAILS. On
          native a hydration failure is not cosmetic: React discards the server
          DOM and re-renders <html>'s attributes from JSX, which wipes the
          pre-paint `data-native` stamp — so the shell's CSS stops applying
          until the dev script re-asserts it, and the app briefly wears the
          website's chrome. Progress's empty state was doing this on every
          load. */}
      <div className="nv-subhead max-w-[30ch]">{line}</div>
      {action}
    </div>
  );
}

/* --- Sheet: detent-style bottom sheet with a grabber -------------------------
   Escape and backdrop both close. Body scroll locks while open — the sheet
   is the screen for as long as it's up.

   RENDERED INTO <body>, NOT WHERE IT IS WRITTEN. `position: fixed` resolves
   against the nearest ancestor carrying a transform, filter or containment,
   not against the viewport, and a sheet is written deep inside a screen. That
   is not a hypothetical: the screen-transition rule in globals.css used to end
   in `forwards`, which left every screen root holding an animated identity
   transform forever, and so every sheet in this app opened thousands of pixels
   down the document where nobody could see it. That rule is fixed, but the
   fix is one CSS property away from being undone by any future card that wants
   a `filter` on a wrapper. A modal that covers the screen belongs at the top of
   the document; then no ancestor can ever capture it again. */
export function NvSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // A portal needs a DOM target, which prerendering has none of. There is no
  // hydration risk in reading `document` here rather than gating on a mounted
  // flag: `open` only ever becomes true from a tap, which is necessarily after
  // hydration, so the server and the first client paint both render null.
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close"
        className="nv-sheet-backdrop"
        onClick={onClose}
      />
      <div role="dialog" aria-modal="true" className="nv-sheet">
        <div className="nv-grabber" aria-hidden="true" />
        {title && <h2 className="nv-headline mb-3 text-center">{title}</h2>}
        {children}
      </div>
    </>,
    document.body
  );
}
