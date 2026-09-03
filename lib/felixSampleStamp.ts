// What voice the landing page's sample was cut in.
//
// Felix speaks from three places, and only two of them heal themselves when
// FISH_AUDIO_VOICE_ID changes:
//
//   the report, web + native   /api/voice re-synthesizes on the spot, and the
//                              Firestore clip cache stamps voiceId + model on
//                              every write, so an old clip misses and is
//                              replaced (app/api/voice/route.ts).
//   the landing page           a committed binary, public/felix-hello.mp3,
//                              that changes only when a human re-runs
//                              `npm run felix:voice`.
//
// So a voice change lands everywhere signed-in and nowhere on the front
// door — the one page where a stranger decides whether they like him. That
// is invisible in a diff and inaudible to whoever made the change, because
// their browser has the old file cached.
//
// scripts/felix-voice-sample.mjs writes lib/felixSample.stamp.json beside the
// MP3 recording WHICH voice, model and words went into it; next.config.ts
// shouts on every build where the two disagree, and tests/unit checks the
// words half (which needs no key) on every run.
//
// Fingerprints, not values: the voice id is marked Sensitive in Vercel and
// this file is committed. Sixteen hex characters of SHA-256 is plenty to
// tell "same" from "different" and tells a reader nothing else.
//
// Import-free on purpose — scripts/felix-voice-sample.mjs runs it under
// Node's type stripping, exactly as it does lib/fishAudio.ts.

import { createHash } from "node:crypto";

export interface FelixSampleStamp {
  /** fingerprint(FISH_AUDIO_VOICE_ID) — or "stock" when none was set. */
  voice: string;
  /** The Fish Audio model, in the clear; it is not a secret. */
  model: string;
  /** fingerprint(FELIX_SAMPLE_TAKE): the words the landing page prints. */
  text: string;
  /** Bytes written, so a truncated or half-written MP3 is visible too. */
  bytes: number;
  generatedAt: string;
}

export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** The voice half of a stamp, from an environment. "stock" when unset. */
export function voiceFingerprint(voiceId: string | undefined): string {
  return voiceId ? fingerprint(voiceId) : "stock";
}

/**
 * What is out of date, in words, or [] when the sample matches. `expected`
 * is the environment the site will actually speak in; `stamp` is what the
 * committed MP3 was cut with, or null when it has never been stamped.
 */
export function sampleDrift(
  stamp: FelixSampleStamp | null,
  expected: { voice: string; model: string; text: string }
): string[] {
  if (!stamp) return ["public/felix-hello.mp3 has never been stamped"];
  const drift: string[] = [];
  if (stamp.voice !== expected.voice) {
    drift.push(
      `the voice changed (sample cut in ${stamp.voice}, FISH_AUDIO_VOICE_ID is now ${expected.voice})`
    );
  }
  if (stamp.model !== expected.model) {
    drift.push(`the model changed (sample cut on ${stamp.model}, now ${expected.model})`);
  }
  if (stamp.text !== expected.text) {
    drift.push("FELIX_SAMPLE_TAKE changed, so the audio and its caption no longer agree");
  }
  return drift;
}
