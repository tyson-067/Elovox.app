"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Felix } from "@/components/FoxLogo";
import { useAuth } from "@/components/AuthProvider";
import {
  resendVerificationEmail,
  refreshVerifiedStatus,
  signOutUser,
  accountErrorMessage,
  verificationSendFailure,
  clearVerificationSendFailed,
} from "@/lib/auth";
import { startCheckout, peekCheckoutIntent, clearCheckoutIntent } from "@/lib/checkout";

// The waiting room for an unverified email/password account. RequireAuth sends
// people here and won't let them into the app until Firebase reports the
// address as verified.
//
// Google accounts never see this page, Google has already verified the
// address, so `emailVerified` is true from the first sign-in.
//
// Firebase caches `emailVerified` on the ID token, so clicking the link in the
// email does NOT update the open tab on its own. Hence the explicit refresh
// below, plus a poll while the tab is focused, so someone who verifies in
// another tab gets let in without having to work out what to press.

const POLL_MS = 4000;

export function VerifyEmailScreen() {
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Whether signup's automatic send actually failed. Read once, lazily, so it
  // is settled before first paint — the whole point is to not tell someone to
  // go and check an inbox nothing was sent to.
  const [autoSendFailed, setAutoSendFailed] = useState(() =>
    typeof window === "undefined" ? false : verificationSendFailure() !== null
  );

  // Now that the address is verified, resume a checkout the user started at
  // signup (stashed by AuthForm when the checkout route rejected the still
  // unverified account), otherwise carry on to the dashboard.
  //
  // The intent is read but NOT consumed until the checkout call succeeds. It
  // used to be cleared first, so a single blip — a network hiccup, or the ID
  // token being briefly rejected right after reload() — silently dropped the
  // purchase: the user landed on a free dashboard with no error and nothing
  // left to retry, and this effect re-ran on every later visit with an empty
  // slot. Now the failure is visible and the intent survives for another go.
  /** Resolves false when a stashed checkout could not be resumed. */
  const proceed = useCallback(async (): Promise<boolean> => {
    const intent = peekCheckoutIntent();
    if (intent) {
      try {
        await startCheckout(intent.cycle, { skipTrial: intent.skipTrial });
        clearCheckoutIntent();
        return true; // browser is navigating to Stripe
      } catch {
        // Intent deliberately left in place, so a retry can still use it.
        return false;
      }
    }
    router.replace("/dashboard");
    return true;
  }, [router]);

  // Nobody signed in (or Firebase isn't configured), nothing to verify.
  useEffect(() => {
    if (loading) return;
    if (configured && !user) {
      router.replace("/login");
      return;
    }
    if (!user?.emailVerified) return;
    let cancelled = false;
    void proceed().then((ok) => {
      if (!ok && !cancelled) {
        setError(
          "You're verified, but we couldn't open checkout just now. Try Go Premium again from your account."
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, loading, configured, router, proceed]);

  // Quietly re-check while the tab is visible. Covers the common flow: the
  // user opens the link on their phone, comes back to this tab, and expects
  // to already be through.
  useEffect(() => {
    if (!configured || !user || user.emailVerified) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const ok = await refreshVerifiedStatus().catch(() => false);
      if (ok) void proceed();
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [configured, user, router, proceed]);

  const resend = async () => {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await resendVerificationEmail();
      clearVerificationSendFailed();
      setAutoSendFailed(false);
      setMessage("Sent. Check your inbox, and your spam folder.");
    } catch (err) {
      setError(accountErrorMessage(err) || "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setError("");
    setMessage("");
    setChecking(true);
    try {
      const ok = await refreshVerifiedStatus();
      if (ok) await proceed();
      else setError("Not verified yet. Click the link in the email, then try again.");
    } catch {
      setError("Couldn't check just now. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  };

  const leave = async () => {
    await signOutUser().catch(() => {});
    router.replace("/login");
  };

  // Never a blank page. `return null` for all three of these was the same
  // fault app/report/[id]/page.tsx already documents: a white screen is
  // indistinguishable from a page that failed to load, and this is a route
  // people arrive at from an EMAIL — the one context where "nothing happened"
  // reads as "the link is broken".
  //
  // Two of the three states resolve themselves a beat later (the effect above
  // redirects a signed-out visitor to /login and a verified one onward), so
  // this only ever shows for as long as that takes. The third — Firebase
  // unconfigured, so there is no auth to wait for — would otherwise sit blank
  // forever, and gets a way out.
  if (loading || (!user && configured) || user?.emailVerified) {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-center" role="status">
        <Felix mood="coach" className="felix-idle h-16 w-16" />
        <p className="text-lg text-on-surface-variant">Checking your account…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-center">
        <Felix mood="sleepy" className="h-16 w-16" />
        <h1 className="font-headline text-2xl font-semibold text-primary">
          Nothing to confirm
        </h1>
        <p className="max-w-[46ch] text-lg text-on-surface-variant">
          You&apos;re not signed in, so there&apos;s no address waiting on you
          here.
        </p>
        <Link
          href="/login"
          className="btn mt-2 rounded-lg bg-accent-strong px-6 py-3 font-semibold text-white"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-16">
      <div className="card p-6 md:p-8">
        <h1 className="font-headline text-2xl font-semibold">
          Confirm your email
        </h1>
        {/* Two different situations, and telling them apart is the point. The
            screen used to claim an email had been sent either way, so a signup
            whose send had failed sat here waiting on a message that was never
            coming, with the button that would have fixed it looking like a
            spare. */}
        {autoSendFailed ? (
          <>
            <p className="mt-2 text-on-surface-variant">
              We couldn&rsquo;t send the link to{" "}
              <span className="font-semibold">{user.email}</span> just now.
            </p>
            <p className="mt-3 text-sm text-on-surface-variant">
              Your account is fine — press Resend email below and it should go
              through.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-on-surface-variant">
              We sent a link to{" "}
              <span className="font-semibold">{user.email}</span>. Click it to
              activate your account. It only takes a second.
            </p>
            <p className="mt-3 text-sm text-on-surface-variant">
              Not there? Check your spam folder. The message comes from Firebase
              on behalf of Elovox.
            </p>
          </>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={check}
            disabled={checking}
            className="btn rounded-lg bg-accent-strong px-5 py-2.5 font-semibold text-white disabled:opacity-60"
          >
            {checking ? "Checking…" : "I've verified, continue"}
          </button>
          <button
            type="button"
            onClick={resend}
            disabled={busy}
            className="btn rounded-lg border border-outline-variant px-5 py-2.5 font-semibold disabled:opacity-60"
          >
            {busy ? "Sending…" : "Resend email"}
          </button>
        </div>

        {message && (
          <p role="status" className="mt-3 text-sm text-on-surface-variant">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        )}

        <p className="mt-6 text-sm text-on-surface-variant">
          Wrong address, or want to use a different account?{" "}
          <button
            type="button"
            onClick={leave}
            className="font-semibold underline underline-offset-2"
          >
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
