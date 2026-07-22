"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/components/AuthProvider";
import { usePlanRecord, refreshPlan, type PlanRecord } from "@/lib/plan";
import { openBillingPortal } from "@/lib/checkout";
import { planFor, formatUSD } from "@/lib/pricing";
import {
  accountErrorMessage,
  changeEmail,
  changePassword,
  hasPasswordProvider,
  refreshVerifiedStatus,
  resendVerificationEmail,
  EMAIL_CHANGE_NOTICE,
} from "@/lib/auth";

// Signed-in account settings: verify email, change email, change password.
// Every sensitive change re-authenticates first (see lib/auth), and email
// changes are confirmed at the NEW address before they take effect.

const inputClass =
  "card input-glow w-full px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none";
const btnClass =
  "btn rounded-lg bg-accent text-white font-semibold px-6 py-3 disabled:opacity-50";
const cardClass = "card p-5 md:p-6";

function fmtDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Subscription state + the one button that manages it (Stripe Customer
// Portal). Reads users/{uid}/profile/plan via usePlanRecord; after returning
// from Checkout (?checkout=success) it refreshes, retrying a couple of times
// because the confirming webhook can land a beat after the redirect.
function BillingSection() {
  const { record, reload } = usePlanRecord();
  // Read the return flag once, from the URL, so we don't setState in an effect.
  const [justSubscribed] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("checkout") === "success"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!justSubscribed) return;
    // Clear the query param so a refresh doesn't re-trigger the banner.
    window.history.replaceState({}, "", "/account");
    // The confirming webhook can land a beat after the redirect — refresh a
    // few times so Premium shows up without the user reloading.
    let tries = 0;
    const tick = async () => {
      await refreshPlan();
      reload();
      if (++tries < 4) setTimeout(tick, 2500);
    };
    void tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manage = async () => {
    setError("");
    setBusy(true);
    try {
      await openBillingPortal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open billing.");
      setBusy(false);
    }
  };

  const r: PlanRecord | null = record;
  const isPremium = r?.plan === "premium";
  const cyclePlan = r?.cycle ? planFor(r.cycle) : null;
  const price = cyclePlan ? `${formatUSD(cyclePlan.price)}/${cyclePlan.unit}` : "";

  let statusLine = "You're on the Free plan.";
  if (r?.status === "trialing") {
    statusLine = `Premium trial — free until ${fmtDate(r.trialEnd)}, then ${price}.`;
  } else if (r?.status === "active" && r?.cancelAtPeriodEnd) {
    statusLine = `Premium — cancels ${fmtDate(r.currentPeriodEnd)}. Access continues until then.`;
  } else if (r?.status === "active") {
    statusLine = `Premium (${r.cycle}) — renews ${fmtDate(r.currentPeriodEnd)} at ${price}.`;
  } else if (r?.status === "past_due") {
    statusLine = "Payment failed — update your card to keep Premium.";
  } else if (r?.status === "canceled") {
    statusLine = "Your Premium subscription has ended.";
  }

  return (
    <section className={cardClass}>
      <h2 className="font-headline text-lg font-semibold text-primary">
        Plan &amp; billing
      </h2>

      {justSubscribed && (
        <p className="mt-3 rounded-lg bg-accent/10 px-3.5 py-2.5 text-sm font-medium text-accent">
          Welcome to Premium! Your trial has started — everything is unlocked.
        </p>
      )}

      {r === null ? (
        <p className="mt-2 text-sm text-on-surface-variant">Loading your plan…</p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold ${
                isPremium ? "bg-violet/12 text-violet" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {isPremium ? "Premium" : "Free"}
            </span>
            {r.status === "past_due" && (
              <span className="inline-flex items-center rounded-full bg-error/10 px-2.5 py-1 text-[13px] font-semibold text-error">
                Action needed
              </span>
            )}
          </div>
          <p className="mt-3 text-base text-on-surface">{statusLine}</p>

          <div className="mt-4 flex flex-wrap gap-3">
            {r.stripeCustomerId ? (
              <button
                type="button"
                onClick={manage}
                disabled={busy}
                className="btn rounded-lg bg-accent px-6 py-3 font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Opening…" : "Manage billing"}
              </button>
            ) : (
              <Link
                href="/pricing"
                className="btn rounded-lg bg-accent px-6 py-3 font-semibold text-white"
              >
                See Premium plans
              </Link>
            )}
            {isPremium && (
              <Link
                href="/pricing"
                className="btn rounded-lg card px-6 py-3 font-semibold text-primary"
              >
                Compare plans
              </Link>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-error">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function AccountScreen() {
  const { user } = useAuth();
  const hasPassword = user ? hasPasswordProvider(user) : false;

  // Verification -----------------------------------------------------------
  const [verified, setVerified] = useState(user?.emailVerified ?? false);
  const [verifyMsg, setVerifyMsg] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);

  const resend = async () => {
    setVerifyMsg("");
    setVerifyBusy(true);
    try {
      await resendVerificationEmail();
      setVerifyMsg("Verification email sent — check your inbox.");
    } catch (err) {
      setVerifyMsg(accountErrorMessage(err) || "Couldn't send that. Try again.");
    } finally {
      setVerifyBusy(false);
    }
  };

  const refresh = async () => {
    setVerifyMsg("");
    setVerifyBusy(true);
    try {
      const ok = await refreshVerifiedStatus();
      setVerified(ok);
      setVerifyMsg(ok ? "" : "Not verified yet — click the link in your email first.");
    } finally {
      setVerifyBusy(false);
    }
  };

  // Change email -----------------------------------------------------------
  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setEmailMsg("");
    setEmailErr("");
    setEmailBusy(true);
    try {
      await changeEmail(newEmail, hasPassword ? emailPw : undefined);
      setEmailMsg(EMAIL_CHANGE_NOTICE);
      setNewEmail("");
      setEmailPw("");
    } catch (err) {
      setEmailErr(accountErrorMessage(err));
    } finally {
      setEmailBusy(false);
    }
  };

  // Change password --------------------------------------------------------
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg("");
    setPwErr("");
    setPwBusy(true);
    try {
      await changePassword(curPw, newPw);
      setPwMsg("Password updated.");
      setCurPw("");
      setNewPw("");
    } catch (err) {
      setPwErr(accountErrorMessage(err));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="stagger-in py-12 md:py-16 max-w-[560px] mx-auto space-y-6">
      <div>
        <h1 className="text-title font-headline font-semibold text-primary">
          Account
        </h1>
        <p className="mt-2 text-base leading-6 text-on-surface-variant">
          Manage your plan, email, password, and verification.
        </p>
      </div>

      <BillingSection />

      {/* Email + verification */}
      <section className={cardClass}>
        <h2 className="font-headline text-lg font-semibold text-primary">
          Your email
        </h2>
        <p className="mt-1 text-base text-on-surface break-all">{user?.email}</p>
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold ${
              verified
                ? "bg-accent/10 text-accent"
                : "bg-error/10 text-error"
            }`}
          >
            {verified ? "✓ Verified" : "Not verified"}
          </span>
        </div>

        {!verified && (
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={resend}
              disabled={verifyBusy}
              className={btnClass}
            >
              {verifyBusy ? "One moment…" : "Send verification email"}
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={verifyBusy}
              className="btn rounded-lg card px-6 py-3 font-semibold text-primary disabled:opacity-50"
            >
              I&apos;ve verified — refresh
            </button>
          </div>
        )}
        {verifyMsg && (
          <p role="status" className="mt-3 text-sm text-on-surface-variant">
            {verifyMsg}
          </p>
        )}
      </section>

      {/* Change email */}
      <section className={cardClass}>
        <h2 className="font-headline text-lg font-semibold text-primary">
          Change email
        </h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          We&apos;ll send a confirmation link to the new address. Your login
          only changes once you click it.
        </p>
        <form onSubmit={submitEmail} className="mt-4 space-y-3">
          <input
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="New email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className={inputClass}
          />
          {hasPassword && (
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Current password"
              value={emailPw}
              onChange={(e) => setEmailPw(e.target.value)}
              className={inputClass}
            />
          )}
          {emailErr && (
            <p role="alert" className="text-sm text-error">
              {emailErr}
            </p>
          )}
          {emailMsg && (
            <p role="status" className="text-sm text-on-surface-variant">
              {emailMsg}
            </p>
          )}
          <button type="submit" disabled={emailBusy} className={btnClass}>
            {emailBusy ? "Sending…" : "Update email"}
          </button>
          {!hasPassword && (
            <p className="text-sm text-on-surface-variant">
              You&apos;ll confirm this change in a quick Google popup.
            </p>
          )}
        </form>
      </section>

      {/* Change password */}
      <section className={cardClass}>
        <h2 className="font-headline text-lg font-semibold text-primary">
          Change password
        </h2>
        {hasPassword ? (
          <form onSubmit={submitPassword} className="mt-4 space-y-3">
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Current password"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              placeholder="New password (8+ characters)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className={inputClass}
            />
            {pwErr && (
              <p role="alert" className="text-sm text-error">
                {pwErr}
              </p>
            )}
            {pwMsg && (
              <p role="status" className="text-sm text-on-surface-variant">
                {pwMsg}
              </p>
            )}
            <button type="submit" disabled={pwBusy} className={btnClass}>
              {pwBusy ? "Updating…" : "Update password"}
            </button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-on-surface-variant">
            This account signs in with Google, so Google manages the password.
          </p>
        )}
      </section>
    </div>
  );
}

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountScreen />
    </RequireAuth>
  );
}
