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
import { startCheckout, stashCheckoutIntent } from "@/lib/checkout";
import { useReturnReset } from "@/lib/useReturnReset";
import { stashReferral } from "@/lib/invite";
import { DobPicker, dobPartsToIso, type DobParts } from "@/components/DobPicker";
import type { BillingCycle } from "@/lib/pricing";
import {
  AGE_BLOCK_MESSAGE,
  MINIMUM_AGE,
  MINOR_NOTICE,
  ageFromDob,
  rememberAgeBlock,
  useAgeBlocked,
} from "@/lib/age";

// If the visitor arrived from a pricing CTA (/signup?plan=premium&cycle=…),
// resume Stripe Checkout the moment the account exists. Read from the URL
// directly (not useSearchParams) to avoid a Suspense boundary requirement.
// `skipTrial=1` carries the pricing page's "pay today" choice through
// signup, so the checkout they resume is the one they configured.
function checkoutIntent(): { cycle: BillingCycle; skipTrial: boolean } | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  if (p.get("plan") !== "premium") return null;
  const c = p.get("cycle");
  if (c !== "weekly" && c !== "monthly" && c !== "annual") return null;
  return { cycle: c, skipTrial: p.get("skipTrial") === "1" };
}

// Shared onboarding form for /login and /signup: email + password, plus
// Google. Already-signed-in visitors are bounced straight to the dashboard.

/**
 * "1994-05-20" → "20 May 1994". The confirmation screen is asking someone to
 * check a date, so it has to read like a date and not like the ISO string the
 * input happens to hold. Parsed as local noon, not midnight UTC, or a browser
 * behind UTC renders the day before — the one mistake that would make an
 * accurate date look wrong on the screen asking you to confirm it.
 */
function formatDob(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Shown when the date of birth is missing or unreadable at submit time. */
const DOB_PROMPT = "Please enter your date of birth.";

const inputClass =
  "card input-glow w-full px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { user, loading, configured } = useAuth();
  const finishedRef = useRef(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Signup only. A typo in a password you cannot see is the classic way to
  // lock yourself out of an account on the very first screen, so we ask
  // twice AND let people look at what they typed.
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Signup only. Holds the sign-in method whose details are filled in and
  // validated but not yet acted on, because the age confirmation screen is
  // standing in front of it. Null means no account creation is pending.
  const [pending, setPending] = useState<null | "email" | "google">(null);

  // The query string is carried across the login/signup cross-links so a
  // checkout intent (?plan=premium&cycle=…) survives switching forms. Read
  // after mount: window isn't available during SSR, and reading it in an
  // effect keeps this SSR-safe with no useSearchParams/Suspense requirement.
  // The one-shot setState after mount is exactly the "sync a browser-only
  // value once" case the lint rule over-flags — it runs once, never loops.
  const [search, setSearch] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(window.location.search);
  }, []);

  // Under COOP the opener can't observe the Google popup closing, so when
  // someone dismisses it `signInWithPopup` never settles: there is no
  // rejection to catch, and the buttons stay disabled for good. When focus
  // comes back to this window with still nobody signed in, let them retry.
  // `user` is the honest test, and it stays null right up until an auth
  // actually lands, so a successful sign-in mid-redirect is never undone.
  useReturnReset(busy, () => {
    if (!user) setBusy(false);
  });

  const isSignup = mode === "signup";

  // An invite link is /signup?ref=CODE. Hold the code now, because the query
  // string does not survive what comes next: Google sign-in leaves the page
  // and returns, and email signup routes through email verification. It's
  // redeemed on the dashboard, once there's a uid to attach it to.
  useEffect(() => {
    stashReferral();
  }, []);

  // --- Age gate (signup only) ---------------------------------------------
  // Asked before an account can be created by ANY route, including Google —
  // otherwise the provider button would be a way around the check. The date
  // itself is never sent anywhere; see lib/age.ts.
  // Held as three wheel selections and only assembled into a date once all
  // three are set — see components/DobPicker.tsx. `dob` is "" until then, so
  // a partly-filled picker is indistinguishable from an empty one and can't
  // be read as an age.
  const [dobParts, setDobParts] = useState<DobParts>({
    day: "",
    month: "",
    year: "",
  });
  const dob = dobPartsToIso(dobParts);

  const age = isSignup && dob ? ageFromDob(dob) : null;
  // Enough to submit with: a date we can actually read. Whether it clears the
  // floor is decided at submit, NOT here — see below.
  const ageOk = !isSignup || age !== null;

  // Only the persisted flag blocks. A half-finished date must never do it:
  // on iOS the date field reports every intermediate value as the wheels
  // move, so someone spinning towards 1994 passes through today's date and
  // a run of recent years on the way. Judging the field as it changes read
  // those fly-past values as real answers and locked out adults mid-scroll,
  // permanently, before they had finished typing their own birthday.
  const wasBlocked = useAgeBlocked();
  const blocked = isSignup && wasBlocked;

  // Stores the selection and nothing else. No validation, no navigation — the
  // date isn't an answer until it's submitted and then confirmed.
  const onDobChange = (next: DobParts) => setDobParts(next);
  // Straight into the app, new account or returning. Signing up used to
  // detour through a run of onboarding questions; there is nothing between
  // making an account and the Daily Minute any more.
  const destination = "/dashboard";

  // After a successful auth, either resume Checkout (if the user came from a
  // pricing CTA) or route on into the app. Checkout redirects away entirely;
  // if it fails (e.g. billing not configured) we fall through to the app.
  // Guarded so the submit handler and the signed-in effect can't both fire it.
  const finishAuth = async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const intent = checkoutIntent();
    if (intent) {
      try {
        await startCheckout(intent.cycle, { skipTrial: intent.skipTrial });
        return; // browser is navigating to Stripe
      } catch {
        // The most common reason this throws is a brand-new email signup: the
        // account exists but isn't verified yet, and the checkout route
        // rejects unverified users (403). Stash the intent so the verify-email
        // screen can resume it the moment the address is confirmed, instead of
        // silently dropping a purchase the user asked for.
        stashCheckoutIntent(intent);
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
          and log-in are unavailable. You can still practice, sessions stay in
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
          {AGE_BLOCK_MESSAGE} Thanks for being honest about your age, come
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

  // Naming a mismatch is safe here in a way that login errors are not: this
  // is a password the visitor is CREATING, so there is no account to
  // enumerate and nothing an attacker learns. Being vague would just leave
  // someone stuck on a form that won't say why.
  const mismatch = isSignup && confirm.length > 0 && confirm !== password;

  // The one place an account actually gets created or entered. Everything
  // else either validates first or waits behind the confirmation screen.
  const runAuth = async (method: "email" | "google") => {
    // Belt and braces. Nothing should be able to reach here under-age — the
    // confirmation screen doesn't offer the path — but this is the function
    // that creates accounts, so it checks for itself rather than trusting
    // every caller to have checked.
    if (isSignup && age !== null && age < MINIMUM_AGE) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (method === "google") {
        await signInWithGoogle();
      } else if (isSignup) {
        await signUpWithEmail(name, email, password);
      } else {
        await signInWithEmail(email, password);
      }
      await finishAuth();
    } catch (err) {
      // Stay on whichever screen they're on — the confirmation screen shows
      // the same error and has its own way back to the form. Throwing them
      // out of it meant a canceled Google sheet silently lost the step they
      // had already completed and made them submit the form again.
      setError(authErrorMessage(err, mode));
      setBusy(false);
    }
  };

  // True once the date on screen reads as under-age. A description of the
  // field, nothing more — it decides what the confirmation screen says, and
  // deliberately does NOT record anything or close any door. Recording is
  // what `confirmAge` does, one deliberate tap later.
  //
  // Submitting used to record the block itself, which put it a full step
  // ahead of the screen built to catch exactly this: someone who typed 2016
  // for 1916 was locked out permanently at the moment they were one tap from
  // fixing it, and the confirmation screen they never reached was the thing
  // that would have shown them the mistake. See lib/age.ts.
  const underAge = isSignup && age !== null && age < MINIMUM_AGE;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    // A date the browser accepted but we can't read as an age (a future date,
    // a typo'd century). Say so rather than returning in silence.
    if (!ageOk) {
      setError(DOB_PROMPT);
      return;
    }
    if (isSignup && password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    // Details are in and valid. Signing up stops here for an explicit age
    // confirmation; logging in has nothing to confirm and goes straight on.
    if (isSignup) {
      setPending("email");
      return;
    }
    await runAuth("email");
  };

  const withProvider = () => async () => {
    setError("");
    setNotice("");
    // Google clears the same gate. This button isn't a submit, so there's no
    // native validation to lean on — an empty date has to be named here or
    // the button appears to do nothing at all.
    if (!ageOk) {
      setError(DOB_PROMPT);
      return;
    }
    if (isSignup) {
      setPending("google");
      return;
    }
    await runAuth("google");
  };

  // Password reset always shows the same neutral notice, whether or not the
  // address is registered, so it can't be used to discover which emails exist.
  const forgotPassword = async () => {
    setError("");
    setNotice("");
    // With the field empty this used to answer "if that email is registered,
    // you will receive a reset link" — a promise about an address nobody
    // gave us, and people then sat waiting for a mail that was never sent.
    // Asking for the address is not an enumeration leak: it says nothing
    // about which addresses exist.
    if (!email.trim()) {
      setError("Enter your email address first, then tap Forgot password.");
      return;
    }
    await sendPasswordReset(email);
    setNotice(PASSWORD_RESET_NOTICE);
  };

  // Details are entered and the date of birth clears the floor, but nothing
  // has been created yet: the age answer gets said back to the visitor and
  // has to be confirmed on purpose. Going back returns them to a form that
  // still has everything they typed, since none of it was cleared.
  if (pending) {
    return (
      <div className="stagger-in py-12 md:py-16 max-w-[420px] mx-auto">
        <h1 className="text-title font-headline font-semibold text-primary">
          Confirm your age
        </h1>
        <p className="mt-3 text-base leading-6 text-on-surface-variant">
          You told us you were born on{" "}
          <span className="font-semibold text-on-surface">
            {formatDob(dob)}
          </span>
          , which makes you{" "}
          <span className="font-semibold text-on-surface">{age}</span>.{" "}
          {underAge
            ? // Said plainly, and before anything is recorded. The visitor who
              // meant this reads a true statement about what happens next; the
              // one who fat-fingered a year sees their mistake spelled out in
              // words while the way back is still open.
              `That's under ${MINIMUM_AGE}, so we can't create an account. If that date isn't right, go back and fix it.`
            : "Please confirm that's right before we create your account."}
        </p>
        {!underAge && (
          <p className="mt-3 text-base leading-6 text-on-surface-variant">
            You need to be at least {MINIMUM_AGE} to use Elovox.
          </p>
        )}
        {!underAge && age !== null && age < 18 && (
          <p className="mt-3 text-[13px] leading-5 text-on-surface-variant">
            {MINOR_NOTICE}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm leading-5 text-error">
            {error}
          </p>
        )}

        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={() => {
              // The only place an age block is ever written. It takes a
              // confirmed answer to a date the visitor has just been shown
              // back to them, which is the whole reason this screen exists.
              if (underAge) {
                rememberAgeBlock();
                return;
              }
              void runAuth(pending);
            }}
            disabled={busy}
            className="btn rounded-lg w-full bg-accent text-white font-semibold text-base px-8 py-3.5 disabled:opacity-50"
          >
            {busy
              ? "One moment…"
              : underAge
                ? `Yes, I'm ${age}`
                : pending === "google"
                  ? `Yes, I'm ${age} — continue with Google`
                  : `Yes, I'm ${age} — create my account`}
          </button>
          <button
            type="button"
            onClick={() => {
              setError("");
              setPending(null);
            }}
            disabled={busy}
            className="card pill w-full px-4 py-3 text-base font-semibold text-primary hover:border-primary/30 disabled:opacity-50"
          >
            Go back and edit
          </button>
        </div>
      </div>
    );
  }

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
            {/* A group label, not a `for=` on one field: the control below is
                three wheels and there's no single input for this to point at.
                Each wheel carries its own hidden label. */}
            <span
              id="dob-label"
              className="block text-sm font-medium text-on-surface-variant"
            >
              Date of birth
            </span>
            <div role="group" aria-labelledby="dob-label">
              {/* Deliberately no upper bound on the wheels. Refusing under-age
                  dates in the control itself hands the exact cutoff to anyone
                  who wants to type around it, and stops the form ever reaching
                  our own gate. The confirmation screen owns this answer. */}
              <DobPicker
                value={dobParts}
                onChange={onDobChange}
                describedBy="dob-note"
              />
            </div>
            <p
              id="dob-note"
              className="mt-1.5 text-[13px] leading-5 text-on-surface-variant"
            >
              We use this once to check your age, and don&apos;t store it.
            </p>
            {/* The under-18 notice used to sit here, keyed off the field as
                it changed — on iOS it flickered in and out while the picker
                wheels moved through the teens. It lives on the confirmation
                screen now, where the date has actually been settled on. */}
          </div>
        )}
        {/* The reveal toggle sits inside the field rather than under it, so
            it's reachable one-handed on a phone without the layout shifting.
            It flips BOTH boxes at once: checking that two passwords match by
            eye only works if you can see both of them. */}
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            minLength={isSignup ? 8 : undefined}
            maxLength={128}
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder={isSignup ? "Password (8+ characters)" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 px-4 text-[13px] font-semibold text-primary/60 transition-colors hover:text-primary"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        {isSignup && (
          <div>
            <input
              type={showPassword ? "text" : "password"}
              required
              maxLength={128}
              autoComplete="new-password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch}
              className={`${inputClass} ${mismatch ? "border-error!" : ""}`}
            />
            {mismatch && (
              <p className="mt-1.5 text-[13px] leading-5 text-error">
                Those passwords don&apos;t match.
              </p>
            )}
          </div>
        )}

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

        {/* Only `busy` disables this. Greying it out for a missing date of
            birth or a password mismatch left people pressing a dead button
            with nothing telling them why — the field is `required`, so
            letting the press through gets them the browser's own "please
            fill this in", pointed at the field that needs it. */}
        <button
          type="submit"
          disabled={busy}
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
          onClick={withProvider()}
          disabled={busy}
          className="card pill w-full px-4 py-3 text-base font-semibold text-primary hover:border-primary/30 disabled:opacity-50"
        >
          Continue with Google
        </button>
      </div>

      <p className="mt-6 text-sm text-on-surface-variant">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href={`/login${search}`} className="font-semibold text-primary underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to Elovox?{" "}
            <Link href={`/signup${search}`} className="font-semibold text-primary underline">
              Sign up free
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
