"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  spring,
  project,
  rubberband,
  VelocityTracker,
  prefersReducedMotion,
  type SpringHandle,
} from "@/lib/spring";
import { tapLight, selection } from "@/lib/haptics";

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
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const springRef = useRef<SpringHandle | null>(null);
  const tracker = useRef(new VelocityTracker()).current;
  const drag = useRef<{ id: number; startY: number; startOffset: number; active: boolean } | null>(null);
  const titleId = useId();

  // `open` is the caller's intent; `mounted` is ours. They differ for exactly
  // as long as the exit animation lasts, which is the entire reason this state
  // exists: the old sheet did `if (!open) return null`, so every dismissal was
  // a hard cut. A sheet that slides up and then vanishes is not a sheet.
  //
  // Opening is synced DURING RENDER, not in an effect. React's rule against
  // setState-in-effect is not a style preference here — an effect would paint
  // one frame with the sheet absent before mounting it, which is a flash on
  // every open. This is the documented "adjusting state when a prop changes"
  // pattern; React re-renders immediately and nothing else sees the stale value.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const height = () => sheetRef.current?.offsetHeight ?? 400;

  /** Paint a drag offset. 0 = fully open, height = fully dismissed. */
  const paint = useCallback((y: number) => {
    const el = sheetRef.current;
    if (el) el.style.transform = `translate3d(0, ${y}px, 0)`;
    const bd = backdropRef.current;
    // The scrim tracks the drag rather than fading on a timer, so the room
    // behind the sheet lightens exactly as fast as you pull it away.
    if (bd) bd.style.opacity = String(Math.max(0, 1 - y / Math.max(height(), 1)));
  }, []);

  const settle = useCallback(
    (to: number, velocity: number, then?: () => void) => {
      springRef.current?.stop();
      const from = currentOffset(sheetRef.current);
      springRef.current = spring({
        from,
        to,
        velocity,
        // 0.8/0.3 is Apple's own drawer pairing. The slight overshoot only
        // ever shows on a release the user put speed into, which is the one
        // place a bounce reads as physics rather than decoration.
        damping: 0.8,
        response: 0.3,
        onFrame: paint,
        onRest: then,
      });
    },
    [paint]
  );

  // Only ever called from an event handler (gesture, backdrop tap, Escape),
  // never from an effect. It animates out and then tells the parent, which
  // flips `open` and lets the effect above no-op.
  const dismiss = useCallback(
    (velocity = 0) => {
      if (prefersReducedMotion()) {
        setMounted(false);
        onClose();
        return;
      }
      settle(height(), velocity, () => {
        setMounted(false);
        onClose();
      });
    },
    [onClose, settle]
  );

  /* --- closing from the outside ------------------------------------------- */
  // A save handler that flips `open` to false still deserves the exit
  // animation. No setState in this effect body: the spring owns the unmount,
  // and it happens in a rAF callback once the sheet has actually left.
  useEffect(() => {
    if (open || !mounted) return;
    if (prefersReducedMotion()) {
      // Unmount on the next frame rather than synchronously here. Same visible
      // result — reduced motion pins transform to none in CSS, so there is
      // nothing to travel — but it keeps the state change out of the effect
      // body, which is what React 19 is asking for.
      const id = requestAnimationFrame(() => setMounted(false));
      return () => cancelAnimationFrame(id);
    }
    springRef.current?.stop();
    const h = spring({
      from: currentOffset(sheetRef.current),
      to: sheetRef.current?.offsetHeight ?? 400,
      damping: 0.9,
      response: 0.3,
      onFrame: paint,
      onRest: () => setMounted(false),
    });
    springRef.current = h;
    return () => {
      h.stop();
    };
  }, [open, mounted, paint]);

  // Entrance. Deliberately NOT a CSS keyframe: the same spring that runs the
  // entrance is the one a finger can interrupt 80ms in, and a keyframe cannot
  // be grabbed.
  useEffect(() => {
    if (!mounted) return;
    const el = sheetRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      paint(0);
      return;
    }
    paint(el.offsetHeight);
    const h = spring({
      from: el.offsetHeight,
      to: 0,
      damping: 1, // arriving under its own power: no overshoot
      response: 0.4,
      onFrame: paint,
    });
    springRef.current = h;
    return () => {
      h.stop();
    };
  }, [mounted, paint]);

  /* --- escape, scroll lock, focus trap ------------------------------------ */
  useEffect(() => {
    if (!mounted) return;
    const sheet = sheetRef.current;
    const prevFocus = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismiss(0);
        return;
      }
      // Without this, Tab walks straight out of a dialog marked aria-modal
      // and starts operating the screen behind it, which for the delete-account
      // sheet means tabbing from a confirmation into the thing it confirms.
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus in, but to the sheet itself rather than the first control:
    // landing on "Delete" the instant a destructive sheet opens is how a
    // keyboard user confirms something they never read.
    const t = window.setTimeout(() => sheet?.focus({ preventScroll: true }), 0);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(t);
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [mounted, dismiss]);

  /* --- the gesture --------------------------------------------------------- */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = sheetRef.current;
    if (!el) return;
    // Content that is scrolled down owns the gesture — dragging the sheet from
    // the middle of a scrolled list is how you lose your place in it. Only a
    // list already at the top hands the drag up to the sheet.
    const fromGrabber = (e.target as HTMLElement)?.closest?.(".nv-grabber, .nv-sheet-head");
    if (!fromGrabber && el.scrollTop > 0) return;

    // Interrupt whatever is in flight and inherit its position, so grabbing a
    // closing sheet catches it exactly where it is rather than snapping.
    const live = springRef.current?.stop();
    const startOffset = live ? live.value : currentOffset(el);

    drag.current = { id: e.pointerId, startY: e.clientY, startOffset, active: false };
    tracker.reset();
    tracker.add(e.clientY);
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;

    // ~10px of hysteresis before we commit to "this is a drag", so a tap that
    // wobbles two pixels still reads as a tap.
    if (!d.active) {
      if (Math.abs(dy) < 10) return;
      d.active = true;
      selection();
    }
    tracker.add(e.clientY);

    let next = d.startOffset + dy;
    // Upward past the open position resists instead of stopping dead.
    if (next < 0) next = -rubberband(-next, height());
    paint(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    sheetRef.current?.releasePointerCapture?.(e.pointerId);
    if (!d.active) return;

    const v = tracker.velocity;
    const offset = currentOffset(sheetRef.current);
    // Decide on where the flick was HEADING, not where the finger stopped.
    // A fast short flick dismisses; a slow long drag that stalled does not.
    const projected = offset + project(v);
    if (projected > height() * 0.4) {
      tapLight();
      dismiss(v);
    } else {
      settle(0, v);
    }
  };

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        ref={backdropRef}
        className="nv-sheet-backdrop"
        onClick={() => dismiss(0)}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Sheet"}
        tabIndex={-1}
        className="nv-sheet"
        data-gesture="1"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="nv-sheet-head">
          <div className="nv-grabber" aria-hidden="true" />
          {title && (
            <h2 id={titleId} className="nv-headline mb-3 text-center">
              {title}
            </h2>
          )}
        </div>
        {children}
      </div>
    </>,
    document.body
  );
}

/** Read the offset actually on screen right now, not the one we last set. */
function currentOffset(el: HTMLElement | null): number {
  if (!el) return 0;
  const t = el.style.transform;
  const m = /translate3d\(0(?:px)?,\s*(-?[\d.]+)px/.exec(t);
  return m ? parseFloat(m[1]) : 0;
}

/* --- Pull to refresh indicator --------------------------------------------
   Sits behind the screen, revealed by the translate the gesture applies to
   #main. Not a spinner until it IS one: below the commit point it is an arc
   that fills with the pull, which is the only honest signal — a spinner that
   spins before you have committed says work is happening when none is. */
export function NvRefresh({
  progress,
  refreshing,
}: {
  progress: number;
  refreshing: boolean;
}) {
  const C = 2 * Math.PI * 9;
  return (
    <div className="nv-ptr" aria-hidden={!refreshing}>
      <svg width="22" height="22" viewBox="0 0 22 22" className={refreshing ? "nv-ptr-spin" : ""}>
        <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.16" />
        <circle
          cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeDasharray={C}
          strokeDashoffset={refreshing ? C * 0.7 : C * (1 - progress)}
          transform="rotate(-90 11 11)"
        />
      </svg>
      {/* Screen readers get the state, not the arc. */}
      <span className="sr-only" role="status">
        {refreshing ? "Refreshing" : ""}
      </span>
    </div>
  );
}
