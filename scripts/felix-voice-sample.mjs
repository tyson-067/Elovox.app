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

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { synthesize, fishAudioModel, fishAudioVoiceId, FELIX_SPEED } from "../lib/fishAudio.ts";
import {
  hasFfmpeg,
  medianF0,
  pcm,
  splitByText,
  pitchRatio,
  TAKE_SEPARATOR,
  PITCH_TOLERANCE,
} from "../lib/voicePitch.ts";

import { FELIX_SAMPLE_TAKE, FELIX_SAMPLE_NOTE } from "../lib/felixSample.ts";
import { fingerprint, voiceFingerprint } from "../lib/felixSampleStamp.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The two static samples. Each carries its own stamp recording which voice,
// model and words went into it — read by next.config.ts on every build and by
// tests/unit/felix-sample-stamp.test.ts on every run (lib/felixSampleStamp.ts).
//
// The hero's is a real Felix take, the shape every report gets: one thing that
// worked, the one thing to fix, one instruction for the next attempt. The
// report's is a single note off the card beside it. Both sets of words live in
// lib/felixSample.ts, beside which the landing page prints them, so the audio
// and the caption can't drift apart.
const SAMPLES = [
  {
    label: "hero",
    text: FELIX_SAMPLE_TAKE,
    out: join(ROOT, "public", "felix-hello.mp3"),
    stamp: join(ROOT, "lib", "felixSample.stamp.json"),
  },
  {
    label: "report note",
    text: FELIX_SAMPLE_NOTE,
    out: join(ROOT, "public", "felix-note.mp3"),
    stamp: join(ROOT, "lib", "felixSampleNote.stamp.json"),
  },
];

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

// ONE REQUEST, ONE VOICE.
//
// The account has no Fish Audio API credit, so the only model that answers is
// s2.1-pro-free, and that model ignores `reference_id` entirely — verified with
// the voice id on and off, the results overlap and are random. Every call comes
// back in a different generic voice. Two calls are therefore two different
// foxes, and nothing done afterwards fixes that: pitch correction moves
// formants along with the pitch, and pushing one clip onto another's pitch
// produced something nobody would call the same person.
//
// So both takes are synthesised in a SINGLE request, separated by
// TAKE_SEPARATOR, and cut apart at the pause it creates. One render is one
// voice by construction. Not matched, not corrected — the same.
//
// If the cut cannot be found the script falls back to separate requests and
// says so loudly, because a mis-cut clip is one with half a sentence in it,
// which is worse than two voices.
const joined = SAMPLES.map((s) => s.text).join(TAKE_SEPARATOR);
let clips = null;

if (hasFfmpeg()) {
  // One render, then CHECK IT. "One render is one voice" turned out to be a
  // probability rather than a guarantee: the long separator pause is exactly
  // the place the model feels free to reset, and one run produced a 129 Hz
  // half next to a 200 Hz one from a single request. Both halves had sane
  // speech rates, so the cut was right and the voice genuinely changed
  // mid-render.
  //
  // So the render is measured after splitting and thrown away if the halves
  // do not match, up to ATTEMPTS times. The bar is the same PITCH_TOLERANCE
  // the committed-file test enforces, so this script cannot produce something
  // that test would reject.
  const ATTEMPTS = 5;
  for (let n = 1; n <= ATTEMPTS; n++) {
    console.log(`  one render for all ${SAMPLES.length} takes (attempt ${n}/${ATTEMPTS})…`);
    const whole = Buffer.from(
      await synthesize(key, {
        text: joined,
        voiceId: fishAudioVoiceId(),
        model: fishAudioModel(),
        speed: FELIX_SPEED,
        timeoutMs: 90_000,
      })
    );
    const tmp = join(ROOT, "public", ".felix-joined.tmp.mp3");
    writeFileSync(tmp, whole);
    const cut = splitByText(tmp, SAMPLES.map((s) => s.text));
    rmSync(tmp, { force: true });
    if (!cut) {
      console.warn("    could not place the cut; re-rendering.");
      continue;
    }
    const f0 = cut.map((c) => medianF0(pcm(c)));
    if (f0.some((f) => f === null)) {
      console.warn("    a clip had no measurable pitch; re-rendering.");
      continue;
    }
    const worst = Math.max(
      ...f0.flatMap((a, i) => f0.slice(i + 1).map((b) => pitchRatio(a, b)))
    );
    console.log(`    ${f0.map((f) => `${f.toFixed(0)} Hz`).join(", ")} (spread x${worst.toFixed(2)})`);
    if (worst <= PITCH_TOLERANCE) {
      clips = cut;
      break;
    }
    console.warn(`    the model changed voice mid-render (x${worst.toFixed(2)} > x${PITCH_TOLERANCE}); re-rendering.`);
  }
  if (!clips) {
    console.warn("  no attempt produced one voice across every take. Run it again.");
  }
} else {
  console.warn("  ffmpeg not found — falling back to one call per take, so the voices may differ.");
}

for (const [i, sample] of SAMPLES.entries()) {
  const bytes = clips
    ? Buffer.from(clips[i])
    : Buffer.from(
        await synthesize(key, {
          text: sample.text,
          voiceId: fishAudioVoiceId(),
          model: fishAudioModel(),
          speed: FELIX_SPEED,
          timeoutMs: 45_000,
        })
      );

  if (hasFfmpeg()) {
    const f0 = medianF0(pcm(bytes));
    console.log(`  ${sample.label}: ${f0?.toFixed(0) ?? "?"} Hz`);
  }

  writeFileSync(sample.out, bytes);
  writeFileSync(
    sample.stamp,
    JSON.stringify(
      {
        voice: voiceFingerprint(fishAudioVoiceId()),
        model: fishAudioModel(),
        text: fingerprint(sample.text),
        bytes: bytes.byteLength,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    `  ${sample.label}: wrote ${sample.out} (${(bytes.byteLength / 1024).toFixed(1)} KB) and its stamp.`
  );
}
// The pitch the runtime anchors report clips to, measured from the clip that
// was actually written rather than typed into a constant by hand. Re-cutting
// therefore keeps lib/pitchShift.ts pointed at the voice on the front door.
if (hasFfmpeg()) {
  const heroPitch = medianF0(pcm(readFileSync(SAMPLES[0].out)));
  if (heroPitch) {
    writeFileSync(
      join(ROOT, "lib", "felixVoiceProfile.json"),
      JSON.stringify({ anchorHz: Math.round(heroPitch * 10) / 10, from: "public/felix-hello.mp3", generatedAt: new Date().toISOString() }, null, 2) + "\n"
    );
    console.log(`  wrote lib/felixVoiceProfile.json (anchor ${heroPitch.toFixed(1)} Hz).`);
  }
}

console.log("Commit the MP3s, their stamps, and the voice profile.");
