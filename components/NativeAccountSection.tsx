"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme, useIsNative, type Theme } from "@/lib/native";
import { LEGAL } from "@/lib/legal";
import {
  readSettings,
  subscribeSettings,
  serverSettings,
  reconcilePermission,
  setEnabled,
  setTime,
} from "@/lib/reminders";

/**
 * The two things Account has to absorb once the app stops being a website:
 * the appearance choice (dark mode is native-only) and the legal links the
 * footer used to carry. iOS users look for both here and nowhere else.
 *
 * Renders nothing in a browser — the web keeps its footer.
 */

/* Each option is its own miniature of the app: bar, card, record node. Picking
   a theme from two words is a guess; picking it from two pictures isn't. */
function ThemeSwatch({ theme }: { theme: Theme }) {
  const dark = theme === "dark";
  return (
    <span
      aria-hidden="true"
      className="block h-16 w-full overflow-hidden rounded-lg border"
      style={{
        background: dark ? "#0d0a20" : "#f4f7fc",
        borderColor: dark ? "rgba(203,216,255,0.16)" : "rgba(0,78,137,0.14)",
      }}
    >
      <span
        className="mt-2.5 ml-2.5 block h-1.5 w-10 rounded-full"
        style={{ background: dark ? "#cbd8ff" : "#004e89" }}
      />
      <span
        className="mt-2 ml-2.5 block h-6 w-[70%] rounded-md"
        style={{
          background: dark ? "#171331" : "#ffffff",
          border: `1px solid ${dark ? "rgba(203,216,255,0.12)" : "rgba(0,78,137,0.13)"}`,
        }}
      />
      <span
        className="-mt-4 ml-auto mr-2.5 block h-5 w-5 rounded-full"
        style={{ background: "#ff6b35" }}
      />
    </span>
  );
}

function AppearanceCard() {
  const [theme, setThemeState] = useTheme();

  const option = (value: Theme, label: string) => {
    const selected = theme === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setThemeState(value)}
        aria-pressed={selected}
        className={`flex-1 rounded-xl border p-2 text-left transition-colors ${
          selected
            ? "border-accent bg-accent/8"
            : "border-outline-variant/60 bg-transparent"
        }`}
      >
        <ThemeSwatch theme={value} />
        <span className="mt-2 flex items-center gap-1.5 px-0.5 text-[13px] font-semibold text-primary">
          {label}
          {selected && <span className="text-accent-strong">✓</span>}
        </span>
      </button>
    );
  };

  return (
    <section className="card p-5">
      <h2 className="font-headline text-lg font-semibold text-primary">
        Appearance
      </h2>
      <p className="mt-1 text-sm text-on-surface-variant">
        Dark is easier on the eyes when you practice at night.
      </p>
      <div className="mt-4 flex gap-3">
        {option("light", "Light")}
        {option("dark", "Dark")}
      </div>
    </section>
  );
}

/* An iOS switch. A checkbox styled as a track and a knob, so it keeps the
   real control's keyboard behaviour and its role for VoiceOver. */
function Switch({
  checked,
  busy,
  onChange,
  label,
}: {
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={busy}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`block h-[31px] w-[51px] rounded-full transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 ${
          checked ? "bg-accent" : "bg-on-surface-variant/30"
        } ${busy ? "opacity-60" : ""}`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </label>
  );
}

function ReminderCard() {
  // Read through the store rather than into local state: the settings live in
  // localStorage, which cannot be touched during render, and the schedule is
  // also rewritten from outside this component (on resume, and after a rep).
  const settings = useSyncExternalStore(
    subscribeSettings,
    readSettings,
    serverSettings
  );
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  // Correcting the saved switch against the real permission is an
  // external-system sync, so it belongs in an effect — and it writes to the
  // store, which repaints this through the subscription above.
  useEffect(() => {
    void reconcilePermission();
  }, []);

  const onToggle = async (next: boolean) => {
    setBusy(true);
    const applied = await setEnabled(next);
    setRefused(next && !applied.enabled);
    setBusy(false);
  };

  const enabled = settings.enabled;

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-headline text-lg font-semibold text-primary">
            Daily reminder
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            A nudge when today&rsquo;s speech is ready. Nothing on days
            you&rsquo;ve already practiced.
          </p>
        </div>
        <Switch
          checked={enabled}
          busy={busy}
          onChange={onToggle}
          label="Daily reminder"
        />
      </div>

      {enabled && (
        <label className="mt-4 flex items-center justify-between border-t border-outline-variant/40 pt-4">
          <span className="text-base text-on-surface">Remind me at</span>
          {/* A real time input, so iOS raises its own wheel rather than us
              rebuilding one badly. */}
          <input
            type="time"
            value={settings.time}
            onChange={(e) => void setTime(e.target.value)}
            className="rounded-lg border border-outline-variant/60 bg-transparent px-3 py-1.5 font-mono text-base text-on-surface"
          />
        </label>
      )}

      {refused && (
        <p className="mt-3 text-sm text-on-surface-variant">
          Notifications are off for Elovox. Turn them on in Settings &rsaquo;
          Notifications &rsaquo; Elovox, then flip this back on.
        </p>
      )}
    </section>
  );
}

/* A grouped list, the way settings are grouped on iOS: hairline separators
   inside one card, chevrons on anything that navigates. */
function Row({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const inner = (
    <>
      <span className="text-base text-on-surface">{children}</span>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="text-on-surface-variant/60"
      >
        <path d="m9.5 5 7 7-7 7" />
      </svg>
    </>
  );
  const className =
    "flex items-center justify-between px-5 py-3.5 border-t border-outline-variant/40 first:border-t-0 active:bg-surface-container/60 transition-colors";

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}

export function NativeAccountSection() {
  const native = useIsNative();
  if (!native) return null;

  return (
    <>
      <ReminderCard />
      <AppearanceCard />

      <section className="card overflow-hidden">
        <h2 className="px-5 pt-5 pb-3 font-headline text-lg font-semibold text-primary">
          About Elovox
        </h2>
        <Row href="/about">Who makes this</Row>
        <Row href={`mailto:${LEGAL.contactEmail}`} external>
          Contact support
        </Row>
        <Row href={LEGAL.instagramUrl} external>
          Instagram
        </Row>
        <Row href="/terms">Terms of service</Row>
        <Row href="/privacy">Privacy policy</Row>
      </section>

      <p className="px-1 text-center text-xs leading-5 text-on-surface-variant">
        © {new Date().getFullYear()} {LEGAL.serviceName}
        <br />
        Coaching feedback is generated by AI and can be wrong. Treat it as
        practice, not advice.
      </p>
    </>
  );
}
