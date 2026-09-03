#!/usr/bin/env node
// Writes the landing page's "tap Felix to hear him" sample to
// public/felix-hello.mp3, once, so visitors hear his voice without the site
// ever calling Fish Audio on their behalf.
//
//   npm run felix:voice
//
// Reads FISH_AUDIO_API_KEY (and the optional VOICE_ID / MODEL) from
// .env.local, the same way the server does. Re-run whenever the voice or
// the line changes; commit the MP3.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { synthesize, fishAudioModel, fishAudioVoiceId } from "../lib/fishAudio.ts";
import { FELIX_SAMPLE_TAKE } from "../lib/felixSample.ts";
import { fingerprint, voiceFingerprint } from "../lib/felixSampleStamp.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "public", "felix-hello.mp3");
// Which voice went into it. Read by next.config.ts on every build and by
// tests/unit/felix-sample-stamp.test.ts on every run — see lib/felixSampleStamp.ts.
const STAMP = join(ROOT, "lib", "felixSample.stamp.json");

// What he says: a real Felix take, the shape every report gets (one thing
// that worked, the one thing to fix, one instruction for the next attempt),
// so the landing page demonstrates the product rather than a greeting. The
// words live in lib/felixSample.ts, beside which the landing page prints
// them, so the audio and the caption can't drift apart.
const LINE = FELIX_SAMPLE_TAKE;

// A tiny .env.local reader rather than a dependency: KEY=value lines,
// comments and blanks skipped, no expansion.
function loadEnv() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();
const key = process.env.FISH_AUDIO_API_KEY;
if (!key) {
  console.error("FISH_AUDIO_API_KEY is not set. Add it to .env.local (see .env.local.example).");
  process.exit(1);
}

console.log(`Asking Fish Audio (${fishAudioModel()}${fishAudioVoiceId() ? `, voice ${fishAudioVoiceId()}` : ", stock voice"})…`);
const bytes = await synthesize(key, {
  text: LINE,
  voiceId: fishAudioVoiceId(),
  model: fishAudioModel(),
  speed: 1.04,
  timeoutMs: 45_000,
});
writeFileSync(OUT, Buffer.from(bytes));
writeFileSync(
  STAMP,
  JSON.stringify(
    {
      voice: voiceFingerprint(fishAudioVoiceId()),
      model: fishAudioModel(),
      text: fingerprint(FELIX_SAMPLE_TAKE),
      bytes: bytes.byteLength,
      generatedAt: new Date().toISOString(),
    },
    null,
    2
  ) + "\n"
);
console.log(`Wrote ${OUT} (${(bytes.byteLength / 1024).toFixed(1)} KB).`);
console.log(`Wrote ${STAMP}. Commit BOTH.`);
