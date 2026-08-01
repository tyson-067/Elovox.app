"use client";

import { useEffect, useState } from "react";
import { isFirebaseConfigured, getUser } from "./firebase";

// Browser half of invites. Like lib/leaderboard.ts, this decides only WHEN to
// ask; whether a code is real, whether an account may redeem it, and what it
// is worth are all settled server-side in lib/referral.ts. Nothing here can
// grant anything, so a tampered localStorage value buys a rejected request.

const PENDING_KEY = "elovox.invite.pending";

/**
 * Capture ?ref= off the current URL and hold it until there's an account to
 * attach it to. It has to survive a page load: the Google sign-in flow leaves
 * and comes back, and email signup goes via a verification screen, so the
 * query string is long gone by the time a uid exists.
 *
 * Read from window.location directly rather than useSearchParams, matching
 * components/AuthForm.tsx, so no caller needs a Suspense boundary.
 */
export function stashReferral(): void {
  if (typeof window === "undefined") return;
  const code = new URLSearchParams(window.location.search).get("ref");
  if (!code) return;
  try {
    window.localStorage.setItem(PENDING_KEY, code.trim().toUpperCase());
  } catch {
    // Storage blocked. The invite is lost, which costs a bonus, not an account.
  }
}

function pendingCode(): string | null {
  try {
    return window.localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // nothing to do
  }
}

/**
 * Redeem a stashed invite once an account exists. Runs on the dashboard,
 * which is where signup lands, so this fires before the new user has had a
 * chance to record anything — the server refuses a code for an account that
 * has already scored a session.
 *
 * The code is cleared whatever the answer is. Every failure mode (already
 * redeemed, own link, not a new account, bad code) is permanent, so retrying
 * it on every mount would just be noise.
 */
export function useRedeemReferral(): void {
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const code = pendingCode();
    if (!code) return;

    let cancelled = false;
    (async () => {
      const user = await getUser();
      if (!user || cancelled) return;
      try {
        await fetch("/api/leaderboard/referral", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${await user.getIdToken()}`,
          },
          body: JSON.stringify({ code }),
        });
        clearPending();
      } catch {
        // Offline. Leave the code stashed and try again next mount — this is
        // the one failure that isn't permanent.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}

export function inviteUrl(code: string): string {
  const origin =
    typeof window === "undefined" ? "https://elovox.app" : window.location.origin;
  return `${origin}/signup?ref=${encodeURIComponent(code)}`;
}

/** This account's invite code, minting one on first ask. */
export function useInviteCode(): { code: string | null; error: string } {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    let cancelled = false;
    (async () => {
      const user = await getUser();
      if (!user || cancelled) return;
      try {
        const res = await fetch("/api/leaderboard/invite", {
          method: "POST",
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? "Couldn't make a link.");
          return;
        }
        setCode(data.code as string);
      } catch {
        if (!cancelled) setError("Couldn't make a link.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { code, error };
}

export type ShareOutcome = "shared" | "copied" | "failed";

/**
 * Hand the link to the OS share sheet where there is one, fall back to the
 * clipboard where there isn't. A canceled share sheet throws AbortError,
 * which is not a failure and must not be reported as one.
 */
export async function shareInvite(url: string): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title: "Elovox",
        text: "Practice speaking with me on Elovox.",
        url,
      });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "shared";
      // Share sheet refused (some desktop browsers advertise it and then
      // reject). Fall through to the clipboard rather than giving up.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
