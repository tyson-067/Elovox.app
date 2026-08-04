"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { InfoTip } from "@/components/InfoTip";
import { PremiumBadge } from "@/components/PremiumBadge";
import { Felix } from "@/components/FoxLogo";
import { NativeLibraryList } from "@/components/native/NativeLibraryList";
import { SPEECHES } from "@/lib/speeches";
import { usePlan } from "@/lib/plan";
import {
  regenerateSpeech,
  replacementsSnapshot,
  replacementsServerSnapshot,
  saveReplacement,
  stashGeneratedSpeech,
  subscribeReplacements,
  type GeneratedSpeech,
} from "@/lib/generated";

// The ~30 second speech bank (Premium): unlimited reps, and any speech you
// have outgrown can be replaced by a fresh one from Felix, similar topic
// to keep drilling the same muscle, or a different one to move on.

function SpeechCard({
  slotId,
  speech,
  replacement,
  locked,
}: {
  slotId: string;
  speech: { title: string; scenario: string; topic: string };
  /** Set once Felix has rewritten this slot, practice routes to it instead. */
  replacement?: GeneratedSpeech;
  /** true = free (locked), false = premium (interactive), null = plan still
   *  loading (render neutral, so a subscriber never sees a paywall flash). */
  locked: boolean | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function replace() {
    setWorking(true);
    setError("");
    try {
      const fresh = await regenerateSpeech({
        previousTitle: speech.title,
        previousTopic: speech.topic,
        relation: "different",
      });
      // The store notifies this page; no local state to sync.
      saveReplacement(slotId, fresh);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write a new one.");
    } finally {
      setWorking(false);
    }
  }

  function open() {
    router.push(
      replacement
        ? `/practice?gen=${stashGeneratedSpeech(replacement)}`
        : `/practice?speech=${slotId}`
    );
  }

  if (locked === true) {
    return (
      <div className="card h-full p-5 opacity-70">
        <div className="flex items-start justify-between gap-2">
          <span className="font-headline text-xl font-medium text-primary block">
            {speech.title}
          </span>
          <PremiumBadge />
        </div>
        <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
          {speech.scenario}
        </span>
        <span className="mt-3 inline-block text-[13px] font-semibold text-on-surface-variant">
          Unlocks with Premium
        </span>
      </div>
    );
  }

  if (locked === null) {
    // Plan still loading: neutral card, no lock and no badge, so a premium
    // subscriber never sees a flash of the paywalled state.
    return (
      <div className="card h-full p-5">
        <span className="font-headline text-xl font-medium text-primary block">
          {speech.title}
        </span>
        <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
          {speech.scenario}
        </span>
      </div>
    );
  }

  return (
    <GlowCard className="card relative h-full">
      {/* The whole card is the button. The X sits above it in the corner. */}
      <button
        type="button"
        onClick={open}
        className="block h-full w-full p-5 pr-12 text-left"
      >
        <span className="font-headline text-xl font-medium text-primary block">
          {speech.title}
        </span>
        <span className="mt-1.5 block text-base leading-6 text-on-surface-variant">
          {speech.scenario}
        </span>
        {replacement && (
          <span className="mt-3 inline-block rounded-full bg-accent/12 text-accent-strong text-[11px] font-semibold tracking-[0.06em] uppercase px-2.5 py-1">
            New
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Remove ${speech.title}`}
        title="Swap this one out"
        className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full text-on-surface-variant/70 hover:bg-on-surface-variant/10 hover:text-on-surface-variant"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
          <path
            d="M3.5 3.5l9 9m0-9l-9 9"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {confirming && (
        <div className="absolute inset-0 grid place-items-center rounded-[inherit] bg-surface/95 p-5 text-center backdrop-blur-sm">
          <div>
            <p className="text-base leading-6 text-on-surface-variant">
              {working
                ? "Felix is writing a new one…"
                : "Swap this out for a new scenario?"}
            </p>
            {error && <p role="alert" className="mt-2 text-[13px] text-amber">{error}</p>}
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={working}
                onClick={replace}
                className="pill rounded-full bg-accent-strong px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                Yes, swap it
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  setConfirming(false);
                  setError("");
                }}
                className="pill rounded-full border border-on-surface-variant/30 px-5 py-2 text-[13px] font-semibold text-on-surface-variant disabled:opacity-50"
              >
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </GlowCard>
  );
}

function LibraryScreen() {
  const router = useRouter();
  const { plan } = usePlan();
  const replacements = useSyncExternalStore(
    subscribeReplacements,
    replacementsSnapshot,
    replacementsServerSnapshot
  );

  return (
    <div className="py-10 md:py-16">
      {/* App shape: one calm grouped list — same slots, same replacements,
          same lock rule as the cards below. Renders nothing in a browser. */}
      <NativeLibraryList
        intro={
          plan === "free"
            ? "Nine speeches, about thirty seconds each. Practice them as much as you like, and swap any of them out. Part of Premium."
            : "Nine speeches, about thirty seconds each. Run any of them as often as you want, and swap out the ones you're bored of."
        }
        sections={[
          {
            items: SPEECHES.map((s) => {
              const replacement = replacements[s.id];
              const speech = replacement ?? s;
              return {
                title: speech.title,
                blurb: speech.scenario,
                locked: plan === "free",
                href:
                  plan === "premium" && !replacement
                    ? `/practice?speech=${s.id}`
                    : undefined,
                onClick:
                  plan === "premium" && replacement
                    ? () =>
                        router.push(
                          `/practice?gen=${stashGeneratedSpeech(replacement)}`
                        )
                    : undefined,
              };
            }),
          },
        ]}
      />

      <Reveal className="native-hide">
        <div className="flex flex-wrap items-center gap-3">
          <Felix mood="idle" className="h-14 w-14 shrink-0" />
          <h1 className="native-hide text-title font-headline font-semibold text-primary">
            <WordReveal text="The speech library" delay={80} step={60} />
          </h1>
          {plan === "free" && <PremiumBadge />}
          <InfoTip label="How does the speech library work?">
            Nine short speeches you can run as many times as you like. Tap a
            card to start. The X in its corner swaps that one out for a fresh
            scenario Felix writes.
          </InfoTip>
        </div>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[58ch]">
          {plan === "free"
            ? "Nine speeches, about thirty seconds each. Practice them as much as you like, and swap any of them out. Part of Premium."
            : "Nine speeches, about thirty seconds each. Run any of them as often as you want, and swap out the ones you're bored of."}
        </p>
      </Reveal>

      <div className="native-hide mt-8 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {SPEECHES.map((s, i) => {
          const replacement = replacements[s.id];
          return (
            <Reveal key={s.id} delay={i * 70} className="h-full">
              <SpeechCard
                slotId={s.id}
                speech={replacement ?? s}
                replacement={replacement}
                locked={plan === null ? null : plan === "free"}
              />
            </Reveal>
          );
        })}
      </div>

      {plan === "free" && (
        <Reveal className="native-hide">
          <div className="card mt-10 p-6 navy-gradient border-none! text-white">
            <h2 className="font-headline text-2xl font-semibold">
              Free practice never stops
            </h2>
            <p className="mt-2 text-base leading-6 text-white/85 max-w-[56ch]">
              The Daily Minute is yours either way, a new one-minute
              speech every day, three attempts, levels and streaks included.
            </p>
            <Link
              href="/dashboard"
              className="btn rounded-lg mt-5 inline-block bg-accent-strong text-white font-semibold px-7 py-3.5"
            >
              Go to the Daily Minute
            </Link>
          </div>
        </Reveal>
      )}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <RequireAuth>
      <LibraryScreen />
    </RequireAuth>
  );
}
