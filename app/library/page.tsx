"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { PremiumBadge } from "@/components/PremiumBadge";
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
// have outgrown can be replaced by a fresh one from Felix — similar topic
// to keep drilling the same muscle, or a different one to move on.

function SpeechCard({
  slotId,
  speech,
  replacement,
  isPremium,
}: {
  slotId: string;
  speech: { title: string; scenario: string; topic: string };
  /** Set once Felix has rewritten this slot — practice routes to it instead. */
  replacement?: GeneratedSpeech;
  isPremium: boolean;
}) {
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function replace(relation: "similar" | "different") {
    setWorking(true);
    setError("");
    try {
      const fresh = await regenerateSpeech({
        previousTitle: speech.title,
        previousTopic: speech.topic,
        relation,
      });
      // The store notifies this page; no local state to sync.
      saveReplacement(slotId, fresh);
      setChoosing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write a new one.");
    } finally {
      setWorking(false);
    }
  }

  if (!isPremium) {
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

  return (
    <GlowCard className="card h-full p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <span className="font-headline text-xl font-medium text-primary block">
          {speech.title}
        </span>
        {replacement && (
          <span
            className="rounded-full bg-accent/12 text-accent text-[11px] font-semibold tracking-[0.06em] uppercase px-2.5 py-1"
            title="Felix wrote this one for you"
          >
            New
          </span>
        )}
      </div>
      <span className="mt-1.5 block text-base leading-6 text-on-surface-variant grow">
        {speech.scenario}
      </span>

      {choosing ? (
        <div className="mt-3">
          <p className="text-[13px] font-semibold text-on-surface-variant">
            {working ? "Felix is writing…" : "Replace it with something…"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => replace("similar")}
              className="pill rounded-full border border-accent text-accent px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            >
              Similar topic
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => replace("different")}
              className="pill rounded-full border border-violet text-violet px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            >
              Different topic
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => setChoosing(false)}
              className="text-[13px] font-semibold text-on-surface-variant underline underline-offset-4 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {error && <p className="mt-2 text-[13px] text-amber">{error}</p>}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() =>
              router.push(
                replacement
                  ? `/practice?gen=${stashGeneratedSpeech(replacement)}`
                  : `/practice?speech=${slotId}`
              )
            }
            className="text-[13px] font-semibold text-accent"
          >
            Practice this →
          </button>
          <button
            type="button"
            onClick={() => setChoosing(true)}
            className="text-[13px] font-semibold text-on-surface-variant underline underline-offset-4 hover:text-violet"
          >
            Done with it — replace
          </button>
        </div>
      )}
    </GlowCard>
  );
}

function LibraryScreen() {
  const { plan, isPremium } = usePlan();
  const replacements = useSyncExternalStore(
    subscribeReplacements,
    replacementsSnapshot,
    replacementsServerSnapshot
  );

  return (
    <div className="py-10 md:py-16">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title font-headline font-semibold text-primary">
            <WordReveal text="The speech library" delay={80} step={60} />
          </h1>
          {!isPremium && <PremiumBadge />}
        </div>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[58ch]">
          {isPremium
            ? "Eight prepared speeches, about thirty seconds each. Practice any of them as many times as you like — and when one stops teaching you anything, have Felix write you a replacement."
            : "Eight prepared speeches, about thirty seconds each, with unlimited reps. Felix rewrites any of them once you've outgrown it. Part of Premium."}
        </p>
      </Reveal>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {SPEECHES.map((s, i) => {
          const replacement = replacements[s.id];
          return (
            <Reveal key={s.id} delay={i * 70} className="h-full">
              <SpeechCard
                slotId={s.id}
                speech={replacement ?? s}
                replacement={replacement}
                isPremium={isPremium}
              />
            </Reveal>
          );
        })}
      </div>

      {plan === "free" && (
        <Reveal>
          <div className="card mt-10 p-6 navy-gradient border-none! text-white">
            <h2 className="font-headline text-2xl font-semibold">
              Free practice never stops
            </h2>
            <p className="mt-2 text-base leading-6 text-white/85 max-w-[56ch]">
              The daily challenge is yours either way — a new one-minute
              speech every day, three attempts, levels and streaks included.
            </p>
            <Link
              href="/dashboard"
              className="btn rounded-lg mt-5 inline-block bg-accent text-white font-semibold px-7 py-3.5"
            >
              Go to today&apos;s challenge
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
