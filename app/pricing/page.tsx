"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/Parallax";
import { GlowCard } from "@/components/GlowCard";
import { useAuth } from "@/components/AuthProvider";
import { startCheckout } from "@/lib/checkout";
import {
  PLANS,
  TRIAL_DAYS,
  planFor,
  savingsVsWeekly,
  perMonth,
  formatUSD,
  type BillingCycle,
} from "@/lib/pricing";

// Public pricing page. Freemium: Free forever on the left, Premium on the
// right with a billing-cycle toggle. Every Premium cycle opens with a
// 7-day free trial, so the CTA is a trial start, not a charge.
//
// Stripe isn't wired yet (see lib/pricing.ts), so the CTA routes through
// /signup for now — you need an account before you can start a trial. When
// checkout exists, point the button at it and pass the selected cycle.

const FREE_FEATURES = [
  "The daily 1-minute speech — new every day, written by Felix",
  "3 attempts a day to beat your own best score",
  "Full Felix feedback report on every attempt",
  "Levels, XP, and streaks",
  "Coaching goals and progress tracking",
];

const PREMIUM_FEATURES = [
  "Everything in Free, unlimited — no daily attempt cap",
  "Camera coaching: posture, gestures, eye contact, expression",
  "The full ~30-second speech library, unlimited reps",
  "Interview practice: jobs, college, scholarships, grad school",
  "Coaching on your own material — pitches, talks, presentations",
  "Custom speeches Felix writes for your actual situation",
];

const FAQ = [
  {
    q: `How does the ${TRIAL_DAYS}-day free trial work?`,
    a: `You get full Premium access for ${TRIAL_DAYS} days, free. We only charge when the trial ends, and you can cancel any time before then and pay nothing.`,
  },
  {
    q: "Why is the annual plan so much cheaper per week?",
    a: "Committing for longer lets us plan ahead, so we pass the saving back to you. Weekly is the flexible rate; annual is the best value — the same Premium, at a fraction of the weekly price.",
  },
  {
    q: "Can I switch or cancel later?",
    a: "Any time. Switch between weekly, monthly, and annual whenever you like, and cancel in a couple of clicks — no email, no phone call.",
  },
  {
    q: "Is the Free plan really free forever?",
    a: "Yes. The daily speech, three attempts, and your full feedback report stay free for as long as you want them. Premium just removes the limits and adds the coaching modes.",
  },
];

export default function PricingPage() {
  const router = useRouter();
  const { user, configured } = useAuth();
  const [cycle, setCycle] = useState<BillingCycle>("annual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = planFor(cycle);
  const saved = savingsVsWeekly(plan);

  // Signed-in visitors go straight to Stripe Checkout for the chosen cycle;
  // signed-out (or no Firebase) visitors sign up first, carrying the intent
  // so AuthForm can resume Checkout right after the account is created.
  const goPremium = async () => {
    if (!configured || !user) {
      router.push(`/signup?plan=premium&cycle=${cycle}`);
      return;
    }
    setError("");
    setBusy(true);
    try {
      await startCheckout(cycle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(false);
    }
  };

  return (
    <div className="pb-24">
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
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-[0.08em] uppercase text-violet">
            {TRIAL_DAYS} days free, then choose your pace
          </span>
          <h1 className="text-title font-headline font-bold text-primary mt-4">
            Start free. Speak with{" "}
            <span className="slogan-serif text-gradient">impact.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[54ch] text-lg leading-8 text-on-surface-variant">
            Try every Premium feature free for {TRIAL_DAYS} days. Keep the free
            plan forever, or unlock unlimited reps and coaching — the longer you
            commit, the less you pay each week.
          </p>
        </Reveal>
      </section>

      {/* Billing cycle toggle */}
      <section className="mt-10 flex flex-col items-center">
        <Reveal>
          <div
            role="tablist"
            aria-label="Billing cycle"
            className="card inline-flex items-center gap-1 p-1"
          >
            {PLANS.map((p) => {
              const active = p.cycle === cycle;
              return (
                <button
                  key={p.cycle}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCycle(p.cycle)}
                  className={`btn relative rounded-lg px-4 md:px-5 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? "bg-accent text-white"
                      : "text-primary/60 hover:text-primary"
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

            <div className="mt-4 rounded-lg bg-white/10 px-3.5 py-2.5 text-sm font-medium text-white">
              <span className="font-semibold">{plan.trialDays}-day free trial</span>
              {" — you’re only charged when it ends. Cancel anytime."}
            </div>

            <ul className="mt-5 space-y-2.5 text-base leading-6 text-white/90">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check className="text-amber" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={goPremium}
              disabled={busy}
              className="btn mt-7 inline-block w-full rounded-lg bg-accent px-6 py-3 text-center font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Starting…" : `Start ${plan.trialDays}-day free trial`}
            </button>
            {error && (
              <p role="alert" className="mt-2 text-center text-[13px] text-amber">
                {error}
              </p>
            )}
            <p className="mt-2.5 text-center text-[13px] text-white/70">
              Then {formatUSD(plan.price)}/{plan.unit}. Cancel before day{" "}
              {plan.trialDays} and pay nothing.
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
                    {p.highlight && (
                      <span className="rounded-full bg-violet/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet">
                        Best value
                      </span>
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
                  <p className="mt-3 text-[13px] font-semibold text-accent">
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
          <h2 className="text-display-sm font-headline font-bold text-primary">
            Your first week&apos;s on us.
          </h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-lg leading-7 text-on-surface-variant">
            Start the free trial, keep the free plan, or go Premium — you can
            change your mind any time.
          </p>
          <button
            onClick={goPremium}
            disabled={busy}
            className="btn mt-8 inline-block rounded-lg bg-accent px-8 py-3.5 font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Starting…" : `Start ${plan.trialDays}-day free trial`}
          </button>
        </Reveal>
      </section>
    </div>
  );
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
