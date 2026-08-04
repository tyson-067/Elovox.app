"use client";

import { useEffect, type ReactNode, type ButtonHTMLAttributes } from "react";
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
      <Link href={href} className={cls} data-noicon={noicon} aria-label={ariaLabel}>
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
        aria-label={ariaLabel}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-noicon={noicon}>
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
      <p className="nv-subhead max-w-[30ch]">{line}</p>
      {action}
    </div>
  );
}

/* --- Sheet: detent-style bottom sheet with a grabber -------------------------
   Escape and backdrop both close. Body scroll locks while open — the sheet
   is the screen for as long as it's up. */
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

  if (!open) return null;
  return (
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
    </>
  );
}
