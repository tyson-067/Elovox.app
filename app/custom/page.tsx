"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { Felix } from "@/components/FoxLogo";
import { NvButton } from "@/components/native/ui";
import { useIsNative } from "@/lib/native";
import { usePlan } from "@/lib/plan";
import {
  requestCustomSpeech,
  stashGeneratedSpeech,
  type GeneratedSpeech,
} from "@/lib/generated";

// Premium: Felix writes a speech to order. The user describes the real
// thing they have to say, a toast, a pitch, a resignation, and gets back
// a script written for their situation, which they then practice like any
// other speech.

// Keep the top of this range in step with the clamp in /api/speech, which
// rounds anything longer down rather than refusing it.
const LENGTHS = [
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "2 minutes", value: 120 },
  { label: "3 minutes", value: 180 },
  { label: "5 minutes", value: 300 },
];

const TONES = [
  "Warm",
  "Serious",
  "Funny",
  "Inspiring",
  "Plain and direct",
  "Grateful",
];

function CustomScreen() {
  const router = useRouter();
  const { plan, isPremium } = usePlan();
  // Presentation switch only: in the app the form area wears cards and the
  // native buttons; in a browser every class string below is byte-for-byte
  // what it was. Generation logic is untouched.
  const native = useIsNative();

  const [need, setNeed] = useState("");
  const [audience, setAudience] = useState("");
  const [occasion, setOccasion] = useState("");
  const [tone, setTone] = useState("");
  const [durationSec, setDurationSec] = useState(60);

  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [speech, setSpeech] = useState<GeneratedSpeech | null>(null);

  // Held rather than rendered free-then-premium, so the paywall never flashes
  // at a subscriber. Held with something on screen, though: a blank tab is
  // how "it didn't load" starts.
  if (plan === null) {
    return (
      <div className="py-16 flex flex-col items-center gap-4 text-center">
        <Felix mood="coach" className="felix-idle h-16 w-16" />
        <p className="text-lg text-on-surface-variant" role="status">
          One moment…
        </p>
      </div>
    );
  }

  if (!isPremium) {
    return (
      <div className="py-16 max-w-[620px] mx-auto">
        <Felix mood="coach" className="mb-4 h-24 w-24" />
        {/* native-hide: the nav bar already titles this screen in the app. */}
        <h1 className="native-hide text-title font-headline font-semibold text-primary">
          Felix writes it for you
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          Custom speeches are part of Premium. Tell Felix the situation and
          he&apos;ll write the script, then coach you through delivering it.
        </p>
        <Link
          href="/dashboard"
          className="btn rounded-lg mt-8 inline-block bg-accent-strong text-white font-semibold px-7 py-3.5"
        >
          Back to practice
        </Link>
      </div>
    );
  }

  async function write(e: React.FormEvent) {
    e.preventDefault();
    if (!need.trim()) return;
    setWorking(true);
    setError("");
    try {
      setSpeech(
        await requestCustomSpeech({ need, audience, occasion, tone, durationSec })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't write that one.");
    } finally {
      setWorking(false);
    }
  }

  if (speech) {
    return (
      <div className="py-[var(--space-page-y)]">
        <Reveal>
          <div className="flex items-start gap-3">
            <Felix className="h-12 w-12 shrink-0" />
            <div>
              {/* native-hide: double-titles under the app's nav bar. */}
              <h1 className="native-hide font-headline text-3xl font-semibold text-primary">
                {speech.title}
              </h1>
              <p className="mt-1 text-base leading-6 text-on-surface-variant">
                {speech.scenario}
              </p>
            </div>
          </div>

          <GlowCard className="card mt-6 p-6">
            {/* The hidden h1 above carried the title; in the app it heads
                the script card instead, at card scale. */}
            {native && <h2 className="nv-headline mb-2">{speech.title}</h2>}
            <p className="text-lg leading-8 text-on-surface whitespace-pre-line">
              {speech.text}
            </p>
          </GlowCard>

          {native ? (
            <div className="mt-6 flex flex-col gap-3">
              <NvButton
                onClick={() =>
                  router.push(`/practice?gen=${stashGeneratedSpeech(speech)}`)
                }
              >
                Practice this now
              </NvButton>
              <NvButton variant="secondary" onClick={() => setSpeech(null)}>
                Write me a different one
              </NvButton>
            </div>
          ) : (
            <div className="mt-8 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => router.push(`/practice?gen=${stashGeneratedSpeech(speech)}`)}
                className="btn rounded-lg bg-accent-strong text-white font-semibold px-7 py-3.5"
              >
                Practice this now
              </button>
              <button
                type="button"
                onClick={() => setSpeech(null)}
                className="pill rounded-[0.375rem] border border-primary/20 text-primary font-semibold px-7 py-3.5 hover:border-primary/40"
              >
                Write me a different one
              </button>
            </div>
          )}
        </Reveal>
      </div>
    );
  }

  return (
    <div className="py-[var(--space-page-y)]">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <Felix mood="coach" animate className="h-14 w-14 shrink-0" />
          {/* native-hide: the nav bar already titles this screen in the app. */}
          <h1 className="native-hide text-title font-headline font-semibold text-primary">
            <WordReveal text="What do you need to say?" delay={80} step={60} />
          </h1>
        </div>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[54ch]">
          Tell Felix the real situation. The more specific you are, names,
          stakes, what you&apos;re afraid of getting wrong, the better the
          speech comes back.
        </p>
      </Reveal>

      <form
        onSubmit={write}
        className={native ? "mt-2 space-y-3" : "mt-8 space-y-6"}
      >
        <div className={native ? "card p-4" : undefined}>
          <label
            htmlFor="need"
            className="text-kicker uppercase text-on-surface-variant"
          >
            The situation
          </label>
          <textarea
            id="need"
            required
            rows={5}
            maxLength={600}
            value={need}
            onChange={(e) => setNeed(e.target.value)}
            placeholder="I'm best man at my brother's wedding in three weeks. We didn't speak for two years and I want to say something true about that without making it heavy."
            className={`mt-2 w-full rounded-lg border border-primary/20${native ? "" : " bg-white"} p-4 text-base leading-7 text-on-surface outline-none focus:border-accent`}
            style={native ? { background: "var(--nv-tint-soft)" } : undefined}
          />
          <p
            className={`mt-1 text-caption text-on-surface-variant${native ? " nv-num" : ""}`}
          >
            {need.length} / 600
          </p>
        </div>

        <div
          className={`grid grid-cols-1 md:grid-cols-2 gap-4${native ? " card p-4" : ""}`}
        >
          <div>
            <label
              htmlFor="audience"
              className="text-kicker uppercase text-on-surface-variant"
            >
              Who&apos;s listening
            </label>
            <input
              id="audience"
              value={audience}
              maxLength={200}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="120 guests, mostly family"
              className={`mt-2 w-full rounded-lg border border-primary/20${native ? "" : " bg-white"} px-4 py-3 text-base text-on-surface outline-none focus:border-accent`}
              style={native ? { background: "var(--nv-tint-soft)" } : undefined}
            />
          </div>
          <div>
            <label
              htmlFor="occasion"
              className="text-kicker uppercase text-on-surface-variant"
            >
              Occasion
            </label>
            <input
              id="occasion"
              value={occasion}
              maxLength={200}
              onChange={(e) => setOccasion(e.target.value)}
              placeholder="Wedding reception, after dinner"
              className={`mt-2 w-full rounded-lg border border-primary/20${native ? "" : " bg-white"} px-4 py-3 text-base text-on-surface outline-none focus:border-accent`}
              style={native ? { background: "var(--nv-tint-soft)" } : undefined}
            />
          </div>
        </div>

        <div className={native ? "card p-4" : undefined}>
          <span className="text-kicker uppercase text-on-surface-variant">
            Tone
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tone === t}
                data-selected={native && tone === t ? true : undefined}
                onClick={() => setTone(tone === t ? "" : t)}
                className={
                  native
                    ? "nv-chip"
                    : `pill rounded-full border px-3.5 py-1.5 text-label font-semibold tracking-wide ${
                        tone === t
                          ? "border-accent bg-accent-strong text-white"
                          : "border-primary/20 text-primary hover:border-accent/60"
                      }`
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className={native ? "card p-4" : undefined}>
          <span className="text-kicker uppercase text-on-surface-variant">
            How long
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {LENGTHS.map((l) => (
              <button
                key={l.value}
                type="button"
                aria-pressed={durationSec === l.value}
                data-selected={native && durationSec === l.value ? true : undefined}
                onClick={() => setDurationSec(l.value)}
                className={
                  native
                    ? "nv-chip"
                    : `pill rounded-full border px-3.5 py-1.5 text-label font-semibold tracking-wide ${
                        durationSec === l.value
                          ? "border-violet bg-violet text-white"
                          : "border-primary/20 text-primary hover:border-violet/60"
                      }`
                }
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p role="alert" className="text-base text-amber">{error}</p>}

        {native ? (
          <NvButton type="submit" disabled={working || !need.trim()}>
            {working ? "Felix is writing…" : "Write my speech"}
          </NvButton>
        ) : (
          <button
            type="submit"
            disabled={working || !need.trim()}
            className="btn rounded-lg bg-accent-strong text-white font-semibold px-8 py-3.5 disabled:opacity-50"
          >
            {working ? "Felix is writing…" : "Write my speech"}
          </button>
        )}
      </form>
    </div>
  );
}

export default function CustomPage() {
  return (
    <RequireAuth>
      <CustomScreen />
    </RequireAuth>
  );
}
