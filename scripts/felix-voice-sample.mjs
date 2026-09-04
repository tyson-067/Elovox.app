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
//
// Every take it writes comes out at FELIX_TARGET_HZ (lib/voicePitch.ts), the
// landing hero's pitch. A draw the model returns too far from that is thrown
// away and re-rendered rather than committed, so re-cutting a LINE cannot
// quietly change the VOICE.

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
  normalizeToPitch,
  TAKE_SEPARATOR,
  PITCH_TOLERANCE,
  FELIX_PITCH_BAND,
  FELIX_TARGET_HZ,
  FELIX_MATCH_TOLERANCE,
  FELIX_REROLL_RATIO,
} from "../lib/voicePitch.ts";

import { FELIX_SAMPLE_TAKE, FELIX_SAMPLE_NOTE } from "../lib/felixSample.ts";
import { fingerprint, voiceFingerprint } from "../lib/felixSampleStamp.ts";
import { transcribeClip, startsRight } from "../lib/verifyCut.ts";

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

// Optional, and the script says so rather than refusing: without it the cut
// cannot be checked, which is exactly how a clip that opened mid-sentence got
// committed. Present in .env.local for the report pipeline anyway.
const aaiKey = process.env.ASSEMBLYAI_API_KEY;
if (!aaiKey) {
  console.warn("ASSEMBLYAI_API_KEY is not set — cuts will not be verified. Listen to both MP3s before committing.");
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
  //
  // Then MATCH IT TO FELIX. One render is one voice, but it is a voice the
  // model picked at random, and "whoever answered today" is not a character.
  // The landing hero's pitch is declared canonical as FELIX_TARGET_HZ, so a
  // draw too far from it is thrown away, and what remains is corrected the
  // rest of the way — the same normalisation the browser applies to runtime
  // report clips (anchorToFelix in lib/pitchShift.ts). Every clip Elovox ever
  // plays therefore comes out at one pitch: this one.
  const ATTEMPTS = 6;
  const [BAND_LO, BAND_HI] = FELIX_PITCH_BAND;
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

    // WHERE THE CUT GOES, CHECKED RATHER THAN ASSUMED.
    //
    // splitByText can only GUESS the boundary from the takes' character
    // counts, and it guessed wrong once in a way every other check passed:
    // the model pauses after the bare "um" that opens the report take, and
    // that hesitation beat the separator on both distance and length. The
    // committed sample opened on "and basically" for a day.
    //
    // So each candidate boundary is tried in turn and the clips are
    // TRANSCRIBED, and the first cut whose halves actually begin with the
    // words they were cut for is the one used. Nothing else can tell a clean
    // cut from a fluent-sounding broken one.
    let cut = null;
    for (let rank = 0; rank < 4; rank++) {
      const candidate = splitByText(tmp, SAMPLES.map((s) => s.text), rank);
      if (!candidate) break;
      if (!aaiKey) {
        console.warn("    ASSEMBLYAI_API_KEY not set — taking the first cut UNVERIFIED.");
        cut = candidate;
        break;
      }
      const heard = [];
      for (const clip of candidate) heard.push(await transcribeClip(clip, aaiKey));
      const checks = SAMPLES.map((sample, i) => startsRight(heard[i], sample.text));
      const bad = checks.findIndex((c) => !c.ok);
      if (bad === -1) {
        console.log(`    cut ${rank} verified: every clip opens on its own words.`);
        cut = candidate;
        break;
      }
      console.warn(
        `    cut ${rank} is wrong — ${SAMPLES[bad].label} opens "${checks[bad].got}", ` +
          `should be "${checks[bad].want}"; trying the next boundary.`
      );
    }
    rmSync(tmp, { force: true });
    if (!cut) {
      console.warn("    no boundary produced clips that say the right words; re-rendering.");
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
    console.log(
      `    ${f0.map((f) => `${f.toFixed(0)} Hz`).join(", ")} ` +
        `(spread x${worst.toFixed(2)}, hero x${pitchRatio(f0[0], FELIX_TARGET_HZ).toFixed(2)} off Felix)`
    );
    if (worst > PITCH_TOLERANCE) {
      console.warn(`    the model changed voice mid-render (x${worst.toFixed(2)} > x${PITCH_TOLERANCE}); re-rendering.`);
      continue;
    }
    if (f0.some((f) => f < BAND_LO || f > BAND_HI)) {
      console.warn(`    a clip is outside ${BAND_LO}-${BAND_HI} Hz, the band a real render lands in; re-rendering.`);
      continue;
    }
    // The hero is the one measured against Felix himself: it is the clip the
    // others are cut beside and the one the profile is written from.
    const off = pitchRatio(f0[0], FELIX_TARGET_HZ);
    if (off > FELIX_REROLL_RATIO) {
      console.warn(
        `    this draw is x${off.toFixed(2)} from Felix (${FELIX_TARGET_HZ} Hz), ` +
          `further than x${FELIX_REROLL_RATIO} is worth correcting; re-rendering.`
      );
      continue;
    }

    // Every take onto Felix's pitch, hero included.
    const tuned = cut.map((c) => normalizeToPitch(c, FELIX_TARGET_HZ));
    const after = tuned.map((t) => t.to ?? medianF0(pcm(t.bytes)));
    console.log(
      `    tuned to ${FELIX_TARGET_HZ} Hz: ` +
        tuned.map((t, i) => `x${t.ratio.toFixed(3)} -> ${after[i]?.toFixed(0) ?? "?"} Hz`).join(", ")
    );
    const missed = after.some(
      (f) => f === null || pitchRatio(f, FELIX_TARGET_HZ) > FELIX_MATCH_TOLERANCE
    );
    if (missed) {
      console.warn(`    a clip would not sit within x${FELIX_MATCH_TOLERANCE} of Felix; re-rendering.`);
      continue;
    }
    clips = tuned.map((t) => t.bytes);
    break;
  }
  if (!clips) {
    console.warn("  no attempt produced Felix's voice across every take. Run it again.");
  }
} else {
  console.warn("  ffmpeg not found — falling back to one call per take, so the voices may differ.");
}

for (const [i, sample] of SAMPLES.entries()) {
  let bytes = clips
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

  // The fallback path renders each take on its own, so nothing above has put
  // it on Felix's pitch. Do it here rather than commit a clip that is not him
  // — separate calls are still separate VOICES, which one number cannot fix,
  // but a clip at the right pitch is the closest this path can get and it is
  // strictly better than leaving the draw where it landed.
  if (!clips && hasFfmpeg()) {
    const tuned = normalizeToPitch(bytes, FELIX_TARGET_HZ);
    if (tuned.ratio !== 1) {
      console.warn(
        `  ${sample.label}: fallback render tuned x${tuned.ratio.toFixed(3)} ` +
          `(${tuned.from?.toFixed(0)} -> ${tuned.to?.toFixed(0)} Hz). Timbre may still differ; re-run.`
      );
      bytes = Buffer.from(tuned.bytes);
    }
  }

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
// The pitch the runtime anchors report clips to.
//
// This is FELIX_TARGET_HZ, not the measurement — the takes above were tuned
// ONTO that number, so it is what the landing page is, and re-measuring only
// re-introduces the correction's own residual (the median moves a percent or
// two when the re-encode changes which frames pass the voicing gate). Anchoring
// the browser to a wobble would mean every re-cut nudged the runtime voice for
// no reason. `heroHz` records what the committed clip actually measured, so a
// drift between the two is visible here rather than inferred.
if (hasFfmpeg()) {
  const heroPitch = medianF0(pcm(readFileSync(SAMPLES[0].out)));
  writeFileSync(
    join(ROOT, "lib", "felixVoiceProfile.json"),
    JSON.stringify(
      {
        anchorHz: FELIX_TARGET_HZ,
        heroHz: heroPitch ? Math.round(heroPitch * 10) / 10 : null,
        from: "public/felix-hello.mp3",
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    `  wrote lib/felixVoiceProfile.json (anchor ${FELIX_TARGET_HZ} Hz, ` +
      `hero measured ${heroPitch?.toFixed(1) ?? "?"} Hz).`
  );
}

console.log("Commit the MP3s, their stamps, and the voice profile.");
