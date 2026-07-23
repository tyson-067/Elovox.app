"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  authErrorMessage,
  sendPasswordReset,
  PASSWORD_RESET_NOTICE,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "@/lib/auth";
import { startCheckout } from "@/lib/checkout";
import type { BillingCycle } from "@/lib/pricing";
import {
  AGE_BLOCK_MESSAGE,
  MINIMUM_AGE,
  MINOR_NOTICE,
  ageFromDob,
  latestAllowedDob,
  rememberAgeBlock,
  useAgeBlocked,
} from "@/lib/age";

// If the visitor arrived from a pricing CTA (/signup?plan=premium&cycle=…),
// resume Stripe Checkout the moment the account exists. Read from the URL
// directly (not useSearchParams) to avoid a Suspense boundary requirement.
function checkoutIntent(): BillingCycle | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  if (p.get("plan") !== "premium") return null;
  const c = p.get("cycle");
  return c === "weekly" || c === "monthly" || c === "annual" ? c : null;
}

// Shared onboarding form for /login and /signup: email + password, plus
// Google. Already-signed-in visitors are bounced straight to the dashboard.

const inputClass =
  "card input-glow w-full px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { user, loading, configured } = useAuth();
  const finishedRef = useRef(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const isSignup = mode === "signup";

  // --- Age gate (signup only) ---------------------------------------------
  // Asked before an account can be created by ANY route, including Google —
  // otherwise the provider button would be a way around the check. The date
  // itself is never sent anywhere; see lib/age.ts.
  const [dob, setDob] = useState("");

  const age = isSignup && dob ? ageFromDob(dob) : null;
  const ageOk = !isSignup || (age !== null && age >= MINIMUM_AGE);

  // Both halves of the gate are derived, not stored: `wasBlocked` reads the
  // persisted flag straight from localStorage, and an under-age date blocks
  // on the spot. Nothing here needs an effect.
  const wasBlocked = useAgeBlocked();
  const tooYoung = age !== null && age < MINIMUM_AGE;
  const blocked = isSignup && (wasBlocked || tooYoung);

  // Under-age answers stop here and stay stopped for this browser. Recorded
  // from the change handler, so it happens once, when the answer is given.
  const onDobChange = (value: string) => {
    setDob(value);
    const next = ageFromDob(value);
    if (next !== null && next < MINIMUM_AGE) rememberAgeBlock();
  };
  // New accounts go through onboarding; the RequireAuth gate would catch
  // them anyway, but routing there directly avoids a redirect bounce.
  // (Provider sign-ins on /signup may be returning users — the gate
  // simply lets them straight through to the dashboard.)
  const destination = isSignup ? "/onboarding" : "/dashboard";

  // After a successful auth, either resume Checkout (if the user came from a
  // pricing CTA) or route on into the app. Checkout redirects away entirely;
  // if it fails (e.g. billing not configured) we fall through to the app.
  // Guarded so the submit handler and the signed-in effect can't both fire it.
  const finishAuth = async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const cycle = checkoutIntent();
    if (cycle) {
      try {
        await startCheckout(cycle);
        return; // browser is navigating to Stripe
      } catch {
        // fall through to the normal destination
      }
    }
    router.replace(destination);
  };

  useEffect(() => {
    // Already signed in and just visiting the form: send them on (or resume
    // an in-flight Checkout intent).
    if (!loading && user) void finishAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  if (!configured) {
    return (
      <div className="py-16 max-w-[480px] mx-auto">
        <h1 className="text-title font-headline font-semibold text-primary">
          Accounts aren&apos;t set up yet
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          This environment is missing the Firebase configuration, so sign-up
          and log-in are unavailable. You can still practice — sessions stay in
          this browser.
        </p>
        <Link
          href="/dashboard"
          className="btn rounded-lg mt-8 inline-block bg-accent text-white font-semibold px-8 py-3.5"
        >
          Continue without an account
        </Link>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="py-16 max-w-[480px] mx-auto">
        <h1 className="text-title font-headline font-semibold text-primary">
          We can&apos;t sign you up
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          {AGE_BLOCK_MESSAGE} Thanks for being honest about your age — come
          back when you&apos;re old enough and we&apos;ll be here.
        </p>
        <Link
          href="/"
          className="btn rounded-lg mt-8 inline-block bg-accent text-white font-semibold px-8 py-3.5"
        >
          Back to home
        </Link>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ageOk) return; // the form's own guard; the button is disabled too
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (isSignup) {
        await signUpWithEmail(name, email, password);
      } else {
        await signInWithEmail(email, password);
      }
      await finishAuth();
    } catch (err) {
      setError(authErrorMessage(err, mode));
      setBusy(false);
    }
  };

  const withProvider = (signIn: () => Promise<void>) => async () => {
    if (!ageOk) return; // signing up with Google clears the same gate
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await signIn();
      await finishAuth();
    } catch (err) {
      setError(authErrorMessage(err, mode));
      setBusy(false);
    }
  };

  // Password reset always shows the same neutral notice, whether or not the
  // address is registered — so it can't be used to discover which emails exist.
  const forgotPassword = async () => {
    setError("");
    setNotice("");
    await sendPasswordReset(email);
    setNotice(PASSWORD_RESET_NOTICE);
  };

  return (
    <div className="stagger-in py-12 md:py-16 max-w-[420px] mx-auto">
      <h1 className="text-title font-headline font-semibold text-primary">
        {isSignup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-3 text-base leading-6 text-on-surface-variant">
        {isSignup
          ? "Three free practice speeches a day, and a coach who hears every one."
          : "Log in to keep building on your practice history."}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        {isSignup && (
          <input
            type="text"
            autoComplete="name"
            maxLength={60}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        )}
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        {isSignup && (
          <div>
            <label
              htmlFor="dob"
              className="block text-sm font-medium text-on-surface-variant"
            >
              Date of birth
            </label>
            <input
              id="dob"
              type="date"
              required
              max={latestAllowedDob()}
              value={dob}
              onChange={(e) => onDobChange(e.target.value)}
              className={`${inputClass} mt-1.5`}
            />
            <p className="mt-1.5 text-[13px] leading-5 text-on-surface-variant">
              We use this once to check your age, and don&apos;t store it.
            </p>
            {age !== null && age >= MINIMUM_AGE && age < 18 && (
              <p className="mt-1.5 text-[13px] leading-5 text-on-surface-variant">
                {MINOR_NOTICE}
              </p>
            )}
          </div>
        )}
        <input
          type="password"
          required
          minLength={isSignup ? 8 : undefined}
          maxLength={128}
          autoComplete={isSignup ? "new-password" : "current-password"}
          placeholder={isSignup ? "Password (8+ characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />

        {error && (
          <p role="alert" className="text-sm leading-5 text-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm leading-5 text-on-surface-variant">
            {notice}
          </p>
        )}

        {!isSignup && (
          <div className="text-right">
            <button
              type="button"
              onClick={forgotPassword}
              disabled={busy}
              className="text-[13px] font-semibold text-primary/70 transition-colors hover:text-primary disabled:opacity-50"
            >
              Forgot password?
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !ageOk}
          className="btn rounded-lg w-full bg-accent text-white font-semibold text-base px-8 py-3.5 disabled:opacity-50"
        >
          {busy ? "One moment…" : isSignup ? "Sign up free" : "Log in"}
        </button>
      </form>

      <div className="mt-4 flex items-center gap-3 text-[13px] font-semibold tracking-wide text-on-surface-variant">
        <span className="h-px flex-1 bg-outline-variant/60" aria-hidden="true" />
        or
        <span className="h-px flex-1 bg-outline-variant/60" aria-hidden="true" />
      </div>

      <div className="mt-4 space-y-3">
        <button
          type="button"
          onClick={withProvider(signInWithGoogle)}
          disabled={busy || !ageOk}
          className="card pill w-full px-4 py-3 text-base font-semibold text-primary hover:border-primary/30 disabled:opacity-50"
        >
          Continue with Google
        </button>
      </div>

      <p className="mt-6 text-sm text-on-surface-variant">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-primary underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to Elovox?{" "}
            <Link href="/signup" className="font-semibold text-primary underline">
              Sign up free
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
