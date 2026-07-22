"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/RequireAuth";
import { Reveal } from "@/components/Reveal";
import { WordReveal } from "@/components/WordReveal";
import { GlowCard } from "@/components/GlowCard";
import { Felix } from "@/components/FoxLogo";
import { usePlan } from "@/lib/plan";
import {
  requestCustomSpeech,
  stashGeneratedSpeech,
  type GeneratedSpeech,
} from "@/lib/generated";

// Premium: Felix writes a speech to order. The user describes the real
// thing they have to say — a toast, a pitch, a resignation — and gets back
// a script written for their situation, which they then practice like any
// other speech.

const LENGTHS = [
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "2 minutes", value: 120 },
  { label: "3 minutes", value: 180 },
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

  const [need, setNeed] = useState("");
  const [audience, setAudience] = useState("");
  const [occasion, setOccasion] = useState("");
  const [tone, setTone] = useState("");
  const [durationSec, setDurationSec] = useState(60);

  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [speech, setSpeech] = useState<GeneratedSpeech | null>(null);

  if (plan === null) return null;

  if (!isPremium) {
    return (
      <div className="py-16 max-w-[620px] mx-auto">
        <h1 className="text-title font-headline font-semibold text-primary">
          Felix writes it for you
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant">
          Custom speeches are part of Premium. Tell Felix the situation and
          he&apos;ll write the script — then coach you through delivering it.
        </p>
        <Link
          href="/dashboard"
          className="btn rounded-lg mt-8 inline-block bg-accent text-white font-semibold px-7 py-3.5"
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
      <div className="py-10 md:py-16">
        <Reveal>
          <div className="flex items-start gap-3">
            <Felix className="h-12 w-12 shrink-0" />
            <div>
              <h1 className="font-headline text-3xl font-semibold text-primary">
                {speech.title}
              </h1>
              <p className="mt-1 text-base leading-6 text-on-surface-variant">
                {speech.scenario}
              </p>
            </div>
          </div>

          <GlowCard className="card mt-6 p-6">
            <p className="text-lg leading-8 text-on-surface whitespace-pre-line">
              {speech.text}
            </p>
          </GlowCard>

          <div className="mt-8 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => router.push(`/practice?gen=${stashGeneratedSpeech(speech)}`)}
              className="btn rounded-lg bg-accent text-white font-semibold px-7 py-3.5"
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
        </Reveal>
      </div>
    );
  }

  return (
    <div className="py-10 md:py-16">
      <Reveal>
        <h1 className="text-title font-headline font-semibold text-primary">
          <WordReveal text="What do you need to say?" delay={80} step={60} />
        </h1>
        <p className="mt-3 text-lg leading-7 text-on-surface-variant max-w-[54ch]">
          Tell Felix the real situation. The more specific you are — names,
          stakes, what you&apos;re afraid of getting wrong — the better the
          speech comes back.
        </p>
      </Reveal>

      <form onSubmit={write} className="mt-8 space-y-6">
        <div>
          <label
            htmlFor="need"
            className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant"
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
            className="mt-2 w-full rounded-lg border border-primary/20 bg-white p-4 text-base leading-7 text-on-surface outline-none focus:border-accent"
          />
          <p className="mt-1 text-[12px] text-on-surface-variant">
            {need.length} / 600
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="audience"
              className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant"
            >
              Who&apos;s listening
            </label>
            <input
              id="audience"
              value={audience}
              maxLength={200}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="120 guests, mostly family"
              className="mt-2 w-full rounded-lg border border-primary/20 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor="occasion"
              className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant"
            >
              Occasion
            </label>
            <input
              id="occasion"
              value={occasion}
              maxLength={200}
              onChange={(e) => setOccasion(e.target.value)}
              placeholder="Wedding reception, after dinner"
              className="mt-2 w-full rounded-lg border border-primary/20 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-accent"
            />
          </div>
        </div>

        <div>
          <span className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            Tone
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tone === t}
                onClick={() => setTone(tone === t ? "" : t)}
                className={`pill rounded-full border px-3.5 py-1.5 text-[13px] font-semibold tracking-wide ${
                  tone === t
                    ? "border-accent bg-accent text-white"
                    : "border-primary/20 text-primary hover:border-accent/60"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
            How long
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {LENGTHS.map((l) => (
              <button
                key={l.value}
                type="button"
                aria-pressed={durationSec === l.value}
                onClick={() => setDurationSec(l.value)}
                className={`pill rounded-full border px-3.5 py-1.5 text-[13px] font-semibold tracking-wide ${
                  durationSec === l.value
                    ? "border-violet bg-violet text-white"
                    : "border-primary/20 text-primary hover:border-violet/60"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-base text-amber">{error}</p>}

        <button
          type="submit"
          disabled={working || !need.trim()}
          className="btn rounded-lg bg-accent text-white font-semibold px-8 py-3.5 disabled:opacity-50"
        >
          {working ? "Felix is writing…" : "Write my speech"}
        </button>
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
