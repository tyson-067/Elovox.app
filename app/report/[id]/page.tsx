"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { GlowCard } from "@/components/GlowCard";
import { getSession } from "@/lib/store";
import { getCategory } from "@/lib/categories";
import { Felix } from "@/components/FoxLogo";
import { usePlan } from "@/lib/plan";
import type { Session } from "@/lib/types";
import { barClass } from "@/lib/scoring";

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <RequireAuth>
      <ReportScreen params={params} />
    </RequireAuth>
  );
}

function ReportScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { plan } = usePlan();
  // A failed READ is not the same as a session that isn't there. Collapsing
  // the two told a user whose network blipped that the take they recorded
  // thirty seconds ago doesn't exist and was probably on another device — and
  // offered no way to try again. Same split /progress already makes.
  //
  // Carried in this union rather than a sibling boolean so switching reports
  // resets it for free, with no setState in the effect body.
  const [session, setSession] = useState<Session | null | undefined | "error">(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    getSession(id)
      .then((s) => !cancelled && setSession(s ?? null))
      .catch(() => !cancelled && setSession("error"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (session === "error") {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-center">
        <Felix mood="coach" className="h-16 w-16" />
        <p className="text-lg text-on-surface-variant" role="alert">
          Couldn&apos;t load that report just now.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  // Arriving here is not a choice — analysis finishes and pushes you straight
  // in — so this screen has to account for itself while it fetches. It used to
  // render `null`, which is indistinguishable from a page that failed to load,
  // and that is exactly what a slow read looked like: a blank screen after a
  // take you just spent a minute on, with a reload as the only way forward.
  if (session === undefined) {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-center">
        <Felix mood="coach" className="felix-idle h-16 w-16" />
        <p className="text-lg text-on-surface-variant" role="status">
          Fetching your report…
        </p>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="py-16">
        <p className="text-lg text-on-surface-variant">
          Couldn&apos;t find that session. It may have been recorded on another
          device.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block font-semibold text-primary underline">
          Start a new practice
        </Link>
      </div>
    );
  }

  const { analysis } = session;
  const cat = getCategory(session.category);

  return (
    <div className="py-8 md:py-12">
      {/* Score: one large confident element, not a card among equals */}
      <div className="stagger-in flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          {/* The score IS this page's title, so it's the h1. There was no h1
              at all before, and the first heading was an <h2> halfway down. */}
          <h1 className="flex items-baseline gap-2">
            <span className="sr-only">
              Report: scored {analysis.overall} out of 100
            </span>
            <span
              aria-hidden="true"
              className="text-gradient font-headline font-semibold text-[88px] leading-none tracking-[-0.01em] md:text-[120px]"
            >
              {analysis.overall}
            </span>
            <span aria-hidden="true" className="font-data text-sm text-on-surface-variant">
              / 100
            </span>
          </h1>
          <div className="mt-3 flex items-start gap-3 max-w-[52ch]">
            {/* Felix reacts to the actual result rather than sitting in the
                same neutral pose whatever happened. 87 is the floor of GOOD
                in the scoring rubric (see SYSTEM_PROMPT in
                app/api/analyze/route.ts), so it's the honest place for him to
                celebrate; below it he's the coach, not a cheerleader.
                Deliberately only ONE reacting Felix on the page — the
                summary's — so the report doesn't turn into a parade. */}
            <Felix
              mood={analysis.overall >= 87 ? "cheer" : "coach"}
              className={`h-10 w-10 shrink-0 mt-0.5 ${
                analysis.overall >= 87 ? "felix-cheer" : ""
              }`}
            />
            <p className="text-lg leading-7 text-on-surface">
              {analysis.summary}
            </p>
          </div>
        </div>
        <div className="pb-2 text-[13px] font-semibold tracking-wide text-on-surface-variant">
          <span className="text-violet">
            {session.speechTitle ?? cat.name}
          </span>
          {session.goal && (
            <>
              <span className="mx-2">·</span>
              <span className="text-accent-strong">{session.goal}</span>
            </>
          )}
          {session.attempt && (
            <>
              <span className="mx-2">·</span>
              <span>Attempt {session.attempt} of 3</span>
            </>
          )}
          <span className="mx-2">·</span>
          {formatDate(session.createdAt)}
          <span className="mx-2">·</span>
          <span className="font-data font-medium">
            {Math.floor(session.durationSec / 60)}:
            {String(session.durationSec % 60).padStart(2, "0")}
          </span>
          {session.xpEarned ? (
            <>
              <span className="mx-2">·</span>
              <span className="font-data font-medium text-accent-strong">
                +{session.xpEarned} XP
              </span>
            </>
          ) : null}
        </div>
      </div>

      {analysis.isSample && (
        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-surface-container px-3 py-1.5 text-[13px] font-semibold tracking-wide text-on-surface-variant">
          Sample feedback, Felix&apos;s real voice analysis arrives when the
          backend is connected
        </div>
      )}

      {/* Asymmetric: narrow skill column, wide transcript column */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10">
        <section className="md:col-span-5">
          <Reveal>
            <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
              How it broke down
              <span className="grow-line" aria-hidden="true" />
            </h2>
          </Reveal>
          <ul className="mt-4 space-y-5">
            {analysis.skills.map((s, i) => (
              <li
                key={s.skill}
                className="stagger-in"
                style={{ animationDelay: `${150 + i * 100}ms` }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-base font-medium text-primary">{s.skill}</span>
                  <span className="font-data text-sm text-primary">{s.score}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className={`bar-grow h-full rounded-full ${barClass(s.score, "bg-accent")}`}
                    style={{
                      width: `${s.score}%`,
                      animationDelay: `${250 + i * 100}ms`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-sm leading-5 text-on-surface-variant">{s.note}</p>
              </li>
            ))}
          </ul>

          <Reveal delay={200}>
            <GlowCard className="card mt-8 p-4 grid grid-cols-3 gap-2 text-center">
              {[
                [String(analysis.paceWpm), "words / min"],
                [String(analysis.fillerWords), "filler words"],
                [String(analysis.pauses), "long pauses"],
              ].map(([n, label]) => (
                <div key={label}>
                  <div className="font-data text-lg text-primary">{n}</div>
                  <div className="text-[12px] text-on-surface-variant">{label}</div>
                </div>
              ))}
            </GlowCard>
          </Reveal>
        </section>

        <section className="md:col-span-7">
          <Reveal>
            <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
              What you said
              <span className="grow-line" aria-hidden="true" />
            </h2>
            {/* Felix's marks sweep across the words once the transcript
                is in view, one after another */}
            <div className="mt-4 text-lg leading-8 text-on-surface">
              {analysis.transcript.map((seg, i) =>
                seg.mark ? (
                  <span
                    key={i}
                    className={`sweep ${seg.mark === "strong" ? "sweep-strong" : "sweep-flag"}`}
                    style={{ transitionDelay: `${400 + i * 180}ms` }}
                  >
                    {seg.text}
                  </span>
                ) : (
                  <span key={i}>{seg.text}</span>
                )
              )}
            </div>
          </Reveal>
          <ul className="mt-6 space-y-3">
            {analysis.transcript
              .filter((s) => s.note)
              .map((s, i) => (
                <li
                  key={i}
                  className="stagger-in flex gap-3 text-base leading-6"
                  style={{ animationDelay: `${300 + i * 120}ms` }}
                >
                  {/* Orange dot = keep, amber dot = cut. That distinction is
                      the product, and it was carried by hue alone — two warm
                      oranges, indistinguishable to most people with a colour
                      vision deficiency and invisible to a screen reader. */}
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      s.mark === "strong" ? "bg-accent" : "bg-amber"
                    }`}
                  >
                    <span className="sr-only">
                      {s.mark === "strong" ? "Strong moment: " : "Worth cutting: "}
                    </span>
                  </span>
                  <span>
                    {s.time && (
                      <span className="font-data text-sm text-on-surface-variant mr-2">
                        {s.time}
                      </span>
                    )}
                    {s.note}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      </div>

      {/* The camera pass (Premium). Only present when they recorded with
          video on, the body half of the delivery. */}
      {analysis.stage && (
        <section className="mt-12">
          <Reveal>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="font-headline text-[28px] leading-9 font-medium text-primary">
                How you looked
              </h2>
              <span className="font-data text-lg text-violet">
                {analysis.stage.overall} / 100 presence
              </span>
            </div>
            <p className="mt-3 text-lg leading-7 text-on-surface max-w-[68ch]">
              {analysis.stage.summary}
            </p>
          </Reveal>

          <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
            {analysis.stage.metrics.map((m, i) => (
              <li
                key={m.metric}
                className="stagger-in"
                style={{ animationDelay: `${150 + i * 90}ms` }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-base font-medium text-primary">{m.metric}</span>
                  <span className="font-data text-sm text-primary">{m.score}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className={`bar-grow h-full rounded-full ${barClass(m.score, "bg-violet")}`}
                    style={{ width: `${m.score}%`, animationDelay: `${250 + i * 90}ms` }}
                  />
                </div>
                <p className="mt-1.5 text-sm leading-5 text-on-surface-variant">{m.note}</p>
              </li>
            ))}
          </ul>

          {analysis.stage.tips.length > 0 && (
            <ol className="mt-6 space-y-3">
              {analysis.stage.tips.map((tip, i) => (
                <li
                  key={i}
                  className="stagger-in flex gap-4"
                  style={{ animationDelay: `${300 + i * 120}ms` }}
                >
                  <span className="font-data text-sm text-violet mt-1">{i + 1}</span>
                  <span className="text-base leading-7">{tip}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {analysis.strengths && analysis.strengths.length > 0 && (
        <section className="mt-12">
          <Reveal>
            <h2 className="font-headline text-[28px] leading-9 font-medium text-primary">
              What worked
            </h2>
          </Reveal>
          <ul className="mt-4 space-y-3">
            {analysis.strengths.map((s, i) => (
              <li
                key={i}
                className="stagger-in flex gap-3 text-lg leading-7"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis.audienceImpact && (
        <section className="mt-12">
          <Reveal>
            <h2 className="font-headline text-[28px] leading-9 font-medium text-primary">
              How the audience heard it
            </h2>
            <p className="mt-3 text-lg leading-7 text-on-surface">
              {analysis.audienceImpact}
            </p>
          </Reveal>
        </section>
      )}

      <section className="mt-12">
        <Reveal>
          <h2 className="font-headline text-[28px] leading-9 font-medium text-primary">
            Try this next time
          </h2>
        </Reveal>
        <ol className="mt-4 space-y-4">
          {analysis.tips.map((tip, i) => (
            <li
              key={i}
              className="stagger-in flex gap-4"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <span className="font-data text-sm text-violet mt-1">{i + 1}</span>
              <span className="text-lg leading-7">{tip}</span>
            </li>
          ))}
        </ol>
      </section>

      {analysis.drills && analysis.drills.length > 0 && (
        <section className="mt-12">
          <Reveal>
            <h2 className="font-headline text-[28px] leading-9 font-medium text-primary">
              Drills to run
            </h2>
            <p className="mt-2 text-base leading-6 text-on-surface-variant">
              Short, targeted exercises for exactly what this take needs.
            </p>
          </Reveal>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {analysis.drills.map((d, i) => (
              <GlowCard
                key={i}
                className="card stagger-in p-5"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <h3 className="font-headline text-xl font-medium text-primary">
                  {d.title}
                </h3>
                <p className="mt-2 text-base leading-6 text-on-surface-variant">
                  {d.how}
                </p>
              </GlowCard>
            ))}
          </div>
        </section>
      )}

      {/* Free reports get the honest core; Premium adds strengths, drills, a
          deeper breakdown, and camera coaching. Show free users what's behind
          the wall, right where they can feel the difference. */}
      {plan === "free" && !analysis.isSample && (
        <section className="mt-12">
          <div className="card navy-gradient border-none! p-6 md:p-7 text-white">
            <h2 className="font-headline text-2xl font-semibold">
              Go deeper with Premium
            </h2>
            <p className="mt-2 text-base leading-6 text-white/85 max-w-[60ch]">
              Premium turns this report into Felix&apos;s full breakdown: what
              you did well and should keep, targeted drills for your weak spots,
              a line-by-line read, more tips, and camera coaching on posture,
              gestures and eye contact.
            </p>
            <Link
              href="/pricing"
              className="btn mt-4 inline-block rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-semibold text-white web-only"
            >
              See Premium
            </Link>
          </div>
        </section>
      )}

      <div className="mt-12 mb-8 flex flex-wrap gap-4">
        <Link
          href={
            session.mode === "daily"
              ? "/practice?daily=1"
              : session.interviewType
                ? `/practice?interview=${session.interviewType}`
                : session.socialSkillId
                  ? `/practice?social=${session.socialSkillId}`
                  : session.speechId
                    ? `/practice?speech=${session.speechId}`
                    : session.mode === "custom"
                      ? // The one-shot sessionStorage gen-key is long gone, so
                        // the exact script can't be replayed; send them back to
                        // the custom flow rather than a random prepared prompt.
                        "/custom"
                      : `/practice?category=${session.category}`
          }
          className="btn rounded-lg bg-accent-strong text-white font-semibold px-7 py-3"
        >
          {session.mode === "daily" && (session.attempt ?? 0) < 3
            ? "Try again, beat this score"
            : "Run it again"}
        </Link>
        <Link
          href="/progress"
          className="pill rounded-[0.375rem] border border-primary/20 text-primary font-semibold px-7 py-3 hover:border-primary/40"
        >
          See your progress
        </Link>
      </div>
    </div>
  );
}
