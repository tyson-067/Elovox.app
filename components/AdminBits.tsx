"use client";

import { useEffect, useRef, useState } from "react";

// Small shared pieces for the /admin console screens, in the exact visual
// language the original stats/users screens established (card tiles, quiet
// uppercase section labels, pill buttons). Kept here so six screens don't
// grow six slightly different copies.

export function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
        {label}
      </p>
      <p className="font-data mt-1 text-3xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

/** Inline outcome line for an action group: quiet, honest, dismissed by the
 *  next action. */
export function ActionMsg({
  msg,
}: {
  msg: { ok: boolean; text: string } | null;
}) {
  if (!msg) return null;
  return (
    <p
      role="status"
      className={`mt-2 text-sm ${msg.ok ? "text-on-surface-variant" : "font-semibold text-accent-strong"}`}
    >
      {msg.text}
    </p>
  );
}

/**
 * A button whose click ARMS it and whose second click acts — the console's
 * standard guard for anything that changes an account. No browser dialogs
 * (they read as errors and don't survive the native shell), and the armed
 * state names what is about to happen. Disarms itself after a few seconds.
 */
export function TwoStepButton({
  label,
  confirmLabel,
  onConfirm,
  busy = false,
  disabled = false,
  danger = false,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const arm = () => {
    setArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), 6000);
  };

  if (!armed) {
    return (
      <button
        type="button"
        onClick={arm}
        disabled={disabled || busy}
        className={`pill rounded-full border px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-40 ${
          danger
            ? "border-accent-strong/40 text-accent-strong hover:border-accent-strong"
            : "border-primary/20 text-primary hover:border-accent/60"
        }`}
      >
        {busy ? "Working…" : label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        disabled={busy}
        className={`pill rounded-full border px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40 ${
          danger
            ? "border-accent-strong bg-accent-strong"
            : "border-accent bg-accent-strong"
        }`}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="pill rounded-full border border-primary/20 px-3 py-1.5 text-[13px] font-semibold text-primary"
      >
        Cancel
      </button>
    </span>
  );
}

/** The console's table shell — same skeleton as the original users table. */
export function AdminTable({
  headers,
  children,
  minWidth = 640,
}: {
  headers: string[];
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="card mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-primary/10 text-[13px] uppercase tracking-[0.04em] text-on-surface-variant">
            {headers.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-on-surface-variant">
        {text}
      </td>
    </tr>
  );
}
