"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Felix } from "@/components/FoxLogo";
import {
  ONBOARDING_QUESTIONS,
  saveOnboarding,
  type OnboardingAnswers,
} from "@/lib/onboarding";

// Quick tap-through questions between signup and the dashboard (the set
// lives in lib/onboarding). Single-select questions advance on click;
// multi-select ones have an explicit Continue. RequireAuth
// (gateOnboarding=false) keeps strangers out without redirect-looping this
// page into itself.

function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [saving, setSaving] = useState(false);

  const q = ONBOARDING_QUESTIONS[step];
  const total = ONBOARDING_QUESTIONS.length;
  const isLast = step === total - 1;
  const selected = answers[q.id];
  const multiSelected: string[] = Array.isArray(selected) ? selected : [];

  const finish = async (finalAnswers: OnboardingAnswers) => {
    setSaving(true);
    try {
      await saveOnboarding(finalAnswers);
    } finally {
      router.replace("/dashboard");
    }
  };

  const pickSingle = (option: string) => {
    if (saving) return;
    const next = { ...answers, [q.id]: option };
    setAnswers(next);
    if (isLast) void finish(next);
    else setStep(step + 1);
  };

  const toggleMulti = (option: string) => {
    if (saving) return;
    const has = multiSelected.includes(option);
    const next = has
      ? multiSelected.filter((o) => o !== option)
      : [...multiSelected, option];
    setAnswers({ ...answers, [q.id]: next });
  };

  const continueMulti = () => {
    if (saving || multiSelected.length === 0) return;
    if (isLast) void finish(answers);
    else setStep(step + 1);
  };

  return (
    <div className="py-12 md:py-16 max-w-[640px] mx-auto">
      <div className="stagger-in flex items-center gap-4">
        <Felix className="h-16 w-16 shrink-0" />
        <div>
          <h1 className="font-headline font-bold text-primary text-2xl tracking-tight">
            Before your first rep
          </h1>
          <p className="mt-0.5 text-base leading-6 text-on-surface-variant">
            A quick hello, so Felix knows exactly who he&apos;s coaching.
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Question {step + 1} of {total}
          </span>
          {step > 0 && !saving && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="text-[13px] font-semibold text-primary/60 transition-colors hover:text-primary"
            >
              ← Back
            </button>
          )}
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-surface-container overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-violet transition-all duration-500 ease-out"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Question — keyed so each step re-runs the entrance animation
          (CSS animation, so it replays on every remount) */}
      <div key={q.id} className="mt-8 stagger-in">
        <h2 className="font-headline text-[26px] leading-8 font-semibold text-primary">
          {q.question}
        </h2>
        {q.hint && (
          <p className="mt-1 text-sm text-on-surface-variant">{q.hint}</p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-2.5">
          {q.options.map((option, i) => {
            const active = q.multi
              ? multiSelected.includes(option)
              : selected === option;
            return (
              <button
                key={option}
                type="button"
                disabled={saving}
                onClick={() =>
                  q.multi ? toggleMulti(option) : pickSingle(option)
                }
                aria-pressed={active}
                style={{ animationDelay: `${80 + i * 60}ms` }}
                className={`card stagger-in text-left px-5 py-3.5 text-base font-medium transition-all duration-150 disabled:opacity-50 ${
                  active
                    ? "border-accent! bg-accent/8 text-primary"
                    : "text-on-surface hover:border-accent/50 hover:-translate-y-0.5"
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  {option}
                  {active && (
                    <span className="text-accent font-semibold" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {q.multi && (
          <button
            type="button"
            onClick={continueMulti}
            disabled={saving || multiSelected.length === 0}
            className="btn rounded-lg mt-6 bg-accent text-white font-semibold px-8 py-3.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLast ? "Finish" : "Continue"}
          </button>
        )}

        {saving && (
          <p className="mt-6 text-base text-on-surface-variant animate-pulse">
            Setting up your practice room…
          </p>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <RequireAuth gateOnboarding={false}>
      <OnboardingScreen />
    </RequireAuth>
  );
}
