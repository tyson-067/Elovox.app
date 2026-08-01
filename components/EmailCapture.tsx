"use client";

import { useState, type FormEvent } from "react";

// The low-commitment way in: leave an email, get occasional speaking tips,
// no account. Sits on the landing page for the visitor who scrolled the
// whole way and still isn't ready to sign up — the alternative was losing
// them entirely. POSTs to /api/leads, which stores the address server-side
// (no mail provider is wired yet; the list is the asset).
//
// The `company` input is a honeypot: visually hidden, tab-skipped, and
// ignored by people. Bots fill it and the API quietly drops those.

export function EmailCapture() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === "busy") return;
    setError("");
    setState("busy");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, company }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't save that. Try again in a moment.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Couldn't save that. Try again in a moment.");
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <p role="status" className="text-base font-medium text-primary">
        You&apos;re on the list. Tips land in your inbox now and then, and
        that&apos;s all we&apos;ll ever send.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-wrap gap-2.5">
      <label htmlFor="tips-email" className="sr-only">
        Email address
      </label>
      <input
        id="tips-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        className="input-glow min-w-0 flex-1 rounded-lg border border-primary/20 bg-surface-lowest px-4 py-2.5 text-base text-on-surface placeholder:text-on-surface-variant/60"
      />
      {/* Honeypot: hidden from people, filled by bots. */}
      <input
        type="text"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <button
        type="submit"
        disabled={state === "busy"}
        className="btn rounded-lg bg-primary px-6 py-2.5 font-semibold text-on-primary disabled:opacity-60"
      >
        {state === "busy" ? "Saving…" : "Send me tips"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-error">
          {error}
        </p>
      )}
    </form>
  );
}
