"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isNativeApp } from "@/lib/native";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { GlowCard } from "@/components/GlowCard";
import { useAuth } from "@/components/AuthProvider";
import { startCheckout, openBillingPortal } from "@/lib/checkout";
import { usePlanRecord } from "@/lib/plan";
import { useReturnReset } from "@/lib/useReturnReset";
import {
  PLANS,
  TRIAL_DAYS,
  hasTrial,
  planFor,
  savingsVsWeekly,
  perMonth,
  formatUSD,
  type BillingCycle,
} from "@/lib/pricing";
import { FAQ } from "@/lib/faq";

// Public pricing page. Freemium: Free forever on the left, Premium on the
// right with a billing-cycle toggle. Monthly and annual open with a 7-day
// free trial, so their CTA is a trial start; weekly is charged immediately,
// so its CTA has to say so rather than promising a free run.
//
// Signed-out visitors route through /signup carrying the chosen cycle, so
// checkout resumes as soon as the account exists.
//
// Existing subscribers see the same comparison, but every buy CTA becomes a
// Customer Portal link. /api/stripe/checkout already refuses a second
// subscription with a 409, so this isn't the guard, it's so a subscriber
// isn't offered a purchase that can only fail, and lands on switch/cancel
// instead. The account page links here as "Compare plans", so the cycle
// toggle and the comparison grid stay live for them.

const FREE_FEATURES = [
  "The Daily Minute, a new topic every day, set by Felix",
  "3 attempts a day to beat your own best score",
  "Full Felix feedback report on every attempt",
  "Levels, XP, and streaks",
  "Coaching goals and progress tracking",
];

const PREMIUM_FEATURES = [
  // This line used to read "Everything in Free, unlimited: no daily attempt
  // cap", which was not true and is not the product. The Daily Minute is
  // three attempts a day on EVERY plan, deliberately: it's one shared topic
  // the whole userbase is scored on. What Premium actually removes is the
  // three-a-day lock on the OTHER modes. It is not literally uncapped: a
  // generous fair-use ceiling (PREMIUM_ANALYSES_PER_DAY in the analyze route)
  // stops scripted abuse, so the copy says "as much as you need", not
  // "unlimited", which would be false. See the FAQ entry, which is explicit.
  "Everything in Free, plus as much practice as you need beyond the Daily Minute",
  "Camera coaching: posture, gestures, eye contact, expression",
  "The full speech library, about thirty seconds each, practice them as much as you like",
  "Interview practice: jobs, college, scholarships, grad school",
  "Social skills practice: small talk, boundaries, apologies",
  "Coaching on your own material: pitches, talks, presentations",
  "Custom speeches Felix writes for your actual situation",
];

// FAQ content moved to lib/faq.ts so this accordion and the FAQPage schema in
// app/pricing/layout.tsx read from one source and can't drift apart.

export default function PricingPage() {
  const router = useRouter();
  // Nothing in the native build links here (every route to it carries
  // `web-only`), but the route still exists and a deep link or a stale
  // in-app history entry could land on it. A price grid inside the app is
  // the one thing Guideline 3.1.1 cannot tolerate, so bounce rather than
  // rely on there being no way in. See lib/native.ts and CAPACITOR.md.
  const native = isNativeApp();
  useEffect(() => {
    if (native) router.replace("/dashboard");
  }, [native, router]);

  const { user, configured } = useAuth();
  const { record } = usePlanRecord();
  const [cycle, setCycle] = useState<BillingCycle>("annual");
  // The user's opt-out from the free trial: bill today instead. From user
  // feedback — some people would rather pay now than remember a conversion
  // date. Server-side, checkout simply omits trial_period_days.
  const [skipTrial, setSkipTrial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = planFor(cycle);
  const saved = savingsVsWeekly(plan);

  // Both CTAs below hand the page over to Stripe. Coming back (Back button,
  // or bfcache restoring this very page) used to return a permanently
  // greyed-out button, because nothing ever cleared `busy`.
  useReturnReset(busy, () => setBusy(false));

  // Whether a real Stripe subscription backs this account. NOT
  // `record?.plan === "premium"`: getPlanRecord ORs the entitlement with the
  // 21-day-streak comp week (premiumUntil), and a comp-only user has no
  // stripeCustomerId — treating them as "subscribed" would hide the buy CTA
  // and offer a "Manage" button whose portal call 404s, stranding someone in
  // their earned free week with no way to actually subscribe. "unpaid" counts
  // too: dunning is exhausted but the invoice is recoverable from the portal,
  // so route it to Manage rather than a checkout that only 409s. Same Stripe-
  // status predicate as app/account/page.tsx.
  const subscribed =
    record?.status === "trialing" ||
    record?.status === "active" ||
    record?.status === "past_due" ||
    record?.status === "unpaid";

  // Only a signed-in user can be a subscriber, so a visitor never waits on
  // this, but for someone signed in we don't yet know, and rendering "Start
  // free trial" and then swapping it for "Manage plan" is worse than a beat
  // of disabled button.
  const planPending = configured && !!user && record === null;

  // A returning ex-subscriber has already spent their one free trial: Stripe
  // records trialEnd from the first go and the checkout route denies a second
  // (hadTrial). Promising them a trial the server will silently refuse is the
  // dishonest path, so treat the trial as available only for someone who has
  // never had one.
  const trialUsed = !subscribed && record?.trialEnd != null;
  // Whether this plan can offer a trial to THIS visitor at all (weekly can't,
  // a returning customer already spent theirs). Used for the marketing close,
  // which describes availability rather than the current selection.
  const offersTrial = hasTrial(plan) && !trialUsed;
  // Weekly has no trial, a skipped trial is a charge today, and a used trial
  // won't be granted, so the CTA promises exactly what the click does.
  const trialOn = offersTrial && !skipTrial;
  const ctaLabel = trialOn
    ? `Start ${plan.trialDays}-day free trial`
    : `Get Premium ${plan.label.toLowerCase()}`;
  const buyLabel = planPending
    ? "Checking your plan…"
    : busy
      ? "Starting…"
      : ctaLabel;

  // Short current-plan line. The account page owns the full billing copy —
  // this is only enough context to explain why the buy button is gone.
  const ending = record?.cancelAtPeriodEnd || record?.cancelAt != null;
  // trialEnd is only a valid "ends on" while actually trialing. Stripe keeps
  // trial_end set (in the past) after a trial converts, so folding it into the
  // fallback would show a canceled active subscriber a date weeks ago. Mirrors
  // app/account/page.tsx.
  const endsOn = fmtDate(
    record?.cancelAt ??
      (record?.status === "trialing" ? record?.trialEnd : undefined) ??
      record?.currentPeriodEnd
  );
  const currentPlan = record?.cycle ? planFor(record.cycle) : null;
  let subscribedLine = "You're on Premium.";
  if (record?.status === "unpaid") {
    subscribedLine =
      "Payment failed and Premium is paused. Open Manage to pay the open invoice.";
  } else if (record?.status === "past_due") {
    subscribedLine = "Payment failed. Update your card to keep Premium.";
  } else if (ending && endsOn) {
    subscribedLine = `Premium, canceled. Access continues until ${endsOn}.`;
  } else if (record?.status === "trialing") {
    subscribedLine = `You're on the Premium free trial${
      endsOn ? ` until ${endsOn}` : ""
    }.`;
  } else if (currentPlan) {
    subscribedLine = `You're on Premium, billed ${currentPlan.label.toLowerCase()}.`;
  }

  // Signed-in visitors go straight to Stripe Checkout for the chosen cycle;
  // signed-out (or no Firebase) visitors sign up first, carrying the intent
  // so AuthForm can resume Checkout right after the account is created.
  const goPremium = async () => {
    if (!configured || !user) {
      router.push(
        `/signup?plan=premium&cycle=${cycle}${skipTrial ? "&skipTrial=1" : ""}`
      );
      return;
    }
    setError("");
    setBusy(true);
    try {
      await startCheckout(cycle, { skipTrial });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(false);
    }
  };

  // Same Customer Portal the account page opens, switching cycles and
  // canceling are both configured there, so there's no second code path.
  const manageBilling = async () => {
    setError("");
    setBusy(true);
    try {
      await openBillingPortal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open billing.");
      setBusy(false);
    }
  };

  return (
    // web-only as well as the redirect above: this route is prerendered, so
    // the price grid exists in the HTML the webview receives and would be
    // painted for the frame or two before hydration runs the replace(). The
    // CSS rule is already in effect at first paint, the effect is not.
    <div className="pb-24 web-only">
      {/* Hero */}
      <section className="relative pt-16 md:pt-24 text-center">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="dot-grid absolute -inset-x-10 -top-16 bottom-0" />
          <Parallax speed={0.24} className="absolute -top-6 right-[14%]">
            <div className="orb-float h-36 w-36 rounded-full bg-violet/15 blur-xl" />
          </Parallax>
          <Parallax speed={-0.16} className="absolute top-24 left-[8%]">
            <div className="orb-float-slow h-48 w-48 rounded-full bg-slate/15 blur-xl" />
          </Parallax>
        </div>
        <Reveal>
          {/* Says WHICH plans the free week applies to. Unqualified, this sat
              directly above a cycle toggle whose Weekly option has no trial
              at all and bills from day one. */}
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] uppercase text-violet">
            {TRIAL_DAYS} days free on monthly and annual
          </span>
          <h1 className="text-title font-headline font-bold text-primary mt-4">
            Start free. Speak with{" "}
            <span className="slogan-serif text-gradient">impact.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[54ch] text-lg leading-8 text-on-surface-variant">
            Try every Premium feature free for {TRIAL_DAYS} days on the monthly
            and annual plans. Keep the free plan forever, or unlock all the
            coaching modes with no three-a-day limit. The longer you commit,
            the less you pay each week.
          </p>
        </Reveal>
      </section>

      {/* Billing cycle toggle */}
      <section className="mt-10 flex flex-col items-center">
        <Reveal>
          {/* A group of toggle buttons, NOT a tablist. `role="tablist"` makes
              assistive tech announce "tab 1 of 3" and promises arrow-key
              navigation, a roving tabindex and a matching `role="tabpanel"` —
              none of which exist here (there is no tabpanel anywhere in the
              app). aria-pressed describes what these actually are, and is the
              pattern /custom and /practice already use. */}
          <div
            role="group"
            aria-label="Billing cycle"
            className="card inline-flex flex-wrap items-center justify-center gap-1 p-1"
          >
            {PLANS.map((p) => {
              const active = p.cycle === cycle;
              return (
                <button
                  key={p.cycle}
                  aria-pressed={active}
                  onClick={() => setCycle(p.cycle)}
                  className={`btn relative rounded-lg px-4 md:px-5 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? "bg-accent-strong text-white"
                      : // /60 measured 3.21:1 on the card, under the 4.5:1 AA
                        // floor for 14px semibold. /75 clears it.
                        "text-primary/75 hover:text-primary"
                  }`}
                >
                  {p.label}
                  {p.cycle === "annual" && (
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide align-middle ${
                        active ? "bg-white/25 text-white" : "bg-violet/12 text-violet"
                      }`}
                    >
                      -{savingsVsWeekly(p)}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Reveal>
      </section>

      {/* Plan cards */}
      <section className="mx-auto mt-8 grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
        {/* Free */}
        <Reveal className="h-full">
          <GlowCard className="card h-full p-6 md:p-7 flex flex-col">
            <h2 className="font-headline text-2xl font-semibold text-primary">
              Free
            </h2>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-headline text-4xl font-bold text-primary">
                $0
              </span>
              <span className="font-data text-sm text-on-surface-variant">
                / forever
              </span>
            </p>
            <p className="mt-2 text-sm text-on-surface-variant">
              The daily habit, on the house. No card required.
            </p>
            <ul className="mt-5 space-y-2.5 text-base leading-6 text-on-surface">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check className="text-slate" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="btn mt-7 inline-block rounded-lg card px-6 py-3 text-center font-semibold text-primary"
            >
              Start free
            </Link>
          </GlowCard>
        </Reveal>

        {/* Premium */}
        <Reveal delay={120} className="h-full">
          <GlowCard className="card card-glow-light navy-gradient border-none! h-full p-6 md:p-7 text-white flex flex-col">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-headline text-2xl font-semibold">Premium</h2>
              {plan.badge && (
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-white">
                  {plan.badge}
                </span>
              )}
            </div>

            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-headline text-4xl font-bold">
                {formatUSD(plan.price)}
              </span>
              <span className="font-data text-sm text-white/70">
                / {plan.unit}
              </span>
            </p>

            {/* The apples-to-apples per-week rate, plus the saving that makes
                the longer plans the obvious pick. */}
            <p className="mt-2 text-sm text-white/80">
              {formatUSD(Number(plan.perWeek.toFixed(2)))}/week
              {saved > 0 ? (
                <>
                  {" "}
                  · <span className="font-semibold text-amber">save {saved}%</span> vs
                  weekly
                </>
              ) : (
                <> · billed weekly, cancel anytime</>
              )}
              {plan.cycle === "annual" && (
                <> · just {formatUSD(Number(perMonth(plan).toFixed(2)))}/month</>
              )}
            </p>

            {/* A subscriber must not be promised a free trial they've already
                used, the `hadTrial` check in /api/stripe/checkout would give
                them full price from day one anyway. Show what they hold. */}
            <div className="mt-4 rounded-lg bg-white/10 px-3.5 py-2.5 text-sm font-medium text-white">
              {subscribed ? (
                <>
                  <span className="font-semibold">Your current plan</span>
                  {`, ${subscribedLine}`}
                </>
              ) : trialOn ? (
                <>
                  <span className="font-semibold">
                    {plan.trialDays}-day free trial
                  </span>
                  {", you’re only charged when it ends. Cancel anytime."}
                </>
              ) : trialUsed ? (
                <>
                  <span className="font-semibold">
                    You&apos;ve used your free trial
                  </span>
                  {`, billed today, then every ${plan.unit}. Cancel anytime.`}
                </>
              ) : hasTrial(plan) ? (
                <>
                  <span className="font-semibold">Trial skipped</span>
                  {`, billed today, then every ${plan.unit}. Cancel anytime.`}
                </>
              ) : (
                <>
                  <span className="font-semibold">No trial on weekly</span>
                  {", billed today, then every week. Cancel anytime."}
                </>
              )}
            </div>

            {/* The trial is the default; this is the opt-out for people who'd
                rather pay now than remember a conversion date. Only shown
                where a trial exists to skip: not weekly, and not a returning
                customer who has already used theirs. */}
            {!subscribed && hasTrial(plan) && !trialUsed && (
              <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={skipTrial}
                  onChange={(e) => setSkipTrial(e.target.checked)}
                  className="h-4 w-4 accent-[#ff6b35]"
                />
                Skip the trial and pay today
              </label>
            )}

            <ul className="mt-5 space-y-2.5 text-base leading-6 text-white/90">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check className="text-amber" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={subscribed ? manageBilling : goPremium}
              disabled={busy || planPending}
              className="btn mt-7 inline-block w-full rounded-lg bg-accent-strong px-6 py-3 text-center font-semibold text-white disabled:opacity-60"
            >
              {subscribed
                ? busy
                  ? "Opening…"
                  : "Manage your subscription"
                : buyLabel}
            </button>
            {error && (
              <p role="alert" className="mt-2 text-center text-[13px] text-amber">
                {error}
              </p>
            )}
            <p className="mt-2.5 text-center text-[13px] text-white/70">
              {subscribed ? (
                <>Switch plans or cancel any time, no email, no phone call.</>
              ) : trialOn ? (
                <>
                  Then {formatUSD(plan.price)}/{plan.unit}. Cancel before
                  day {plan.trialDays} and pay nothing.
                </>
              ) : (
                <>
                  {formatUSD(plan.price)} charged today, then every{" "}
                  {plan.unit}. Cancel anytime.
                </>
              )}
            </p>
            {/* Renewal + refund terms, discoverable at the point of purchase.
                Subscriptions auto-renew, so say so plainly and link the policy
                that spells out how to stop it. */}
            <p className="mt-2 text-center text-[12px] text-white/50">
              Auto-renews until you cancel ·{" "}
              <Link href="/refunds" className="underline hover:text-white/80">
                Refunds &amp; cancellation
              </Link>{" "}
              ·{" "}
              <Link href="/terms" className="underline hover:text-white/80">
                Terms
              </Link>
            </p>
          </GlowCard>
        </Reveal>
      </section>

      {/* Plan comparison at a glance */}
      <section className="mx-auto mt-14 max-w-4xl">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Every Premium plan compared
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PLANS.map((p, i) => {
            const s = savingsVsWeekly(p);
            const active = p.cycle === cycle;
            return (
              <Reveal key={p.cycle} delay={i * 100} className="h-full">
                <button
                  onClick={() => setCycle(p.cycle)}
                  className={`card h-full w-full p-5 text-left transition-colors ${
                    active
                      ? "border-accent! ring-2 ring-accent/25"
                      : "hover:border-violet/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-headline text-lg font-semibold text-primary">
                      {p.label}
                    </span>
                    {subscribed && record?.cycle === p.cycle ? (
                      <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-strong">
                        Current plan
                      </span>
                    ) : (
                      p.highlight && (
                        <span className="rounded-full bg-violet/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet">
                          Best value
                        </span>
                      )
                    )}
                  </div>
                  <p className="mt-2 font-headline text-2xl font-bold text-primary">
                    {formatUSD(p.price)}
                    <span className="font-data text-sm font-normal text-on-surface-variant">
                      {" "}
                      / {p.unit}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    {formatUSD(Number(p.perWeek.toFixed(2)))} per week
                  </p>
                  <p className="mt-3 text-[13px] font-semibold text-accent-strong">
                    {s > 0 ? `Save ${s}% vs weekly` : "Pay as you go"}
                  </p>
                </button>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto mt-16 max-w-3xl">
        <Reveal>
          <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Questions
            <span className="grow-line" aria-hidden="true" />
          </h2>
        </Reveal>
        <div className="mt-5 space-y-3">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delay={i * 80}>
              <details className="card group p-5">
                <summary className="cursor-pointer list-none font-headline text-lg font-semibold text-primary marker:content-none flex items-center justify-between gap-4">
                  {item.q}
                  <span className="text-violet transition-transform group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-2 text-base leading-7 text-on-surface-variant">
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto mt-16 max-w-2xl text-center">
        <Reveal>
          {/* This headline used to say "Your first week's on us" to every
              non-subscriber, including with the Weekly cycle selected. Weekly
              has NO trial (trialDays: 0) and bills from day one, so the page
              was promising a free week directly above a button that charges
              $4.99 immediately. The buy button itself was already correct via
              hasTrial(); the headline and the line under it were not, and
              they are the larger type. Both now follow the same check. */}
          <h2 className="text-display-sm font-headline font-bold text-primary">
            {subscribed
              ? "You're all set."
              : offersTrial
                ? "Your first week's on us."
                : "Practice like it counts."}
          </h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-lg leading-7 text-on-surface-variant">
            {subscribed
              ? "Every Premium feature is unlocked. Switch cycles or cancel whenever you like. Changes take effect from the billing portal."
              : offersTrial
                ? "Start the free trial, keep the free plan, or go Premium. You can change your mind any time."
                : "Keep the free plan, or go Premium and cancel whenever you like. You're billed from day one."}
          </p>
          <button
            onClick={subscribed ? manageBilling : goPremium}
            disabled={busy || planPending}
            className="btn mt-8 inline-block rounded-lg bg-accent-strong px-8 py-3.5 font-semibold text-white disabled:opacity-60"
          >
            {subscribed
              ? busy
                ? "Opening…"
                : "Manage your subscription"
              : buyLabel}
          </button>
        </Reveal>
      </section>
    </div>
  );
}

// Matches the account page's date formatting so a subscriber sees the same
// "access until…" date on both screens.
function fmtDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Check({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`mt-1 h-4 w-4 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}
