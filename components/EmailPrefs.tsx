"use client";

import { useEffect, useState } from "react";
import { getUser, isFirebaseConfigured } from "@/lib/firebase";

/**
 * The four email switches.
 *
 * Reads and writes the same store the unsubscribe link in every email footer
 * does — see lib/email/prefs.ts — so a link clicked on a phone and a toggle
 * flipped here can never disagree.
 *
 * Two things it deliberately does NOT offer a switch for: account security and
 * billing. Those aren't marketing, a user can't have opted out of being told
 * their card failed, and a switch implying otherwise would be a lie. The
 * sentence under the switches says so rather than leaving people to wonder
 * which emails the page is actually about.
 *
 * Renders nothing at all when the request comes back unavailable (no service
 * account, unverified address): an empty card that never loads is worse than
 * no card.
 */

type PrefKey = "progress" | "streak" | "product" | "tips";

interface Payload {
  paused?: boolean;
  pausedNote?: string;
  prefs: Record<PrefKey, boolean>;
  blocked: "hard-bounce" | "complaint" | null;
  labels: Record<PrefKey, { title: string; blurb: string }>;
  order: PrefKey[];
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!isFirebaseConfigured()) return {};
  const user = await getUser();
  if (!user) return {};
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

export function EmailPrefs({ className = "" }: { className?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "hidden">("loading");
  const [busy, setBusy] = useState<PrefKey | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/email-prefs", {
          headers: await authHeaders(),
        });
        if (cancelled) return;
        if (!res.ok) {
          setState("hidden");
          return;
        }
        setData((await res.json()) as Payload);
        setState("ok");
      } catch {
        if (!cancelled) setState("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state !== "ok" || !data) return null;

  const toggle = async (key: PrefKey) => {
    if (data.blocked) return;
    setBusy(key);
    setError("");
    // Optimistic, then reconciled against what the server says is actually in
    // force — which can differ, since a bounced address can't switch anything
    // back on.
    const wanted = !data.prefs[key];
    setData({ ...data, prefs: { ...data.prefs, [key]: wanted } });
    try {
      const res = await fetch("/api/account/email-prefs", {
        method: "POST",
        headers: { ...(await authHeaders()), "content-type": "application/json" },
        body: JSON.stringify({ prefs: { [key]: wanted } }),
      });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Payload);
    } catch {
      setData((d) => (d ? { ...d, prefs: { ...d.prefs, [key]: !wanted } } : d));
      setError("Couldn't save that. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={className}>
      <h2 className="font-headline text-lg font-semibold text-primary">Email</h2>
      <p className="mt-1 text-sm text-on-surface-variant">
        Which optional emails you get. Account and billing emails always come
        through. You&apos;d want the one about a failed sign-in.
      </p>

      {/* Said plainly because the switches below are all on categories
          lib/email/send.ts is currently holding, so "which optional emails
          you get" describes something that is not happening. Shown above the
          bounce/complaint notice, which is about this address; this is about
          all of them. The switches stay usable — the preference is real and
          applies the moment sending resumes. */}
      {data.paused && !data.blocked && (
        <p className="mt-3 rounded-lg bg-surface-container p-3 text-sm text-on-surface-variant">
          {data.pausedNote}
        </p>
      )}

      {data.blocked && (
        <p className="mt-3 rounded-lg bg-surface-container p-3 text-sm text-on-surface-variant">
          {data.blocked === "complaint"
            ? "You marked an Elovox email as spam, so we've stopped sending. Reply to any of our emails and we'll turn it back on."
            : "Email to this address bounced, so we've stopped sending. Check the address above, or reply to us and we'll look."}
        </p>
      )}

      <ul className="mt-4 space-y-1">
        {data.order.map((key) => {
          const on = data.prefs[key] && !data.blocked;
          return (
            <li key={key}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => void toggle(key)}
                disabled={Boolean(data.blocked) || busy === key}
                className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-surface-container disabled:opacity-60"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    on ? "bg-accent-strong" : "bg-outline-variant"
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full bg-white transition-transform ${
                      on ? "translate-x-4" : ""
                    }`}
                  />
                </span>
                <span>
                  <span className="block text-sm font-semibold">
                    {data.labels[key].title}
                  </span>
                  <span className="block text-sm text-on-surface-variant">
                    {data.labels[key].blurb}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}
