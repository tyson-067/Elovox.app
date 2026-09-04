import { describe, expect, it } from "vitest";
import {
  hasFfmpeg,
  pitchOf,
  pitchRatio,
  FELIX_PITCH_BAND,
  FELIX_TARGET_HZ,
  FELIX_MATCH_TOLERANCE,
} from "@/lib/voicePitch";
import profile from "@/lib/felixVoiceProfile.json";

/* ---------------------------------------------------------------------------
   Do the committed samples actually sound like the same fox?

   They are cut from ONE synthesis request now, split at the pause between the
   takes (TAKE_SEPARATOR / splitOnSilence). One render is one voice, so this is
   structural rather than checked-for — the free Fish Audio model ignores
   `reference_id` and returns a different generic voice per CALL, so the fix
   was to stop making two calls.

   That is not enough on its own, and the reason this file got stricter: one
   render is one voice, but it is a voice the model picked at random. A re-cut
   of the report LINE came back at 178 Hz beside a 193 Hz hero — a ratio of
   1.08, comfortably inside the old ceiling of 1.25, and audibly not the same
   fox to anyone who pressed both buttons on the landing page.

   So the bar is no longer "near each other". Every committed clip has to be at
   FELIX_TARGET_HZ, the pitch the landing hero has always had, which
   scripts/felix-voice-sample.mjs now tunes each take onto. Near each other is
   implied by that and is no longer the thing being asked.
   --------------------------------------------------------------------------- */

const SAMPLES = ["public/felix-hello.mp3", "public/felix-note.mp3"];

// No ffmpeg, no measurement. CI without it skips rather than failing for a
// missing tool, exactly as the script warns rather than refusing to cut.
const run = hasFfmpeg() ? describe : describe.skip;

run("the committed Felix samples are the same voice", () => {
  const pitches = SAMPLES.map((path) => ({ path, f0: pitchOf(path) }));

  for (const { path, f0 } of pitches) {
    it(`${path} has audible speech to measure`, () => {
      expect(f0, `${path} produced no voiced frames — is it silence?`).not.toBeNull();
      // Well outside any human speaking fundamental, in either direction.
      expect(f0!).toBeGreaterThan(70);
      expect(f0!).toBeLessThan(350);
    });
  }

  it("every clip is in the range a real render lands in", () => {
    // Catches the model's octave-down outlier, and catches an over-aggressive
    // correction — the previous version of this pushed clips to 242 Hz and
    // made Felix a chipmunk, which no ratio-to-each-other check would notice
    // because both clips were wrong together.
    const [lo, hi] = FELIX_PITCH_BAND;
    for (const { path, f0 } of pitches) {
      expect(f0!, `${path} is ${f0!.toFixed(1)} Hz, outside ${lo}-${hi} Hz`).toBeGreaterThan(lo);
      expect(f0!, `${path} is ${f0!.toFixed(1)} Hz, outside ${lo}-${hi} Hz`).toBeLessThan(hi);
    }
  });

  it("and every clip is Felix, not merely near the clip beside it", () => {
    // THE test. Each file measured against the character, not against its
    // neighbour: two clips can agree with each other and both be a stranger.
    for (const { path, f0 } of pitches) {
      const off = pitchRatio(f0!, FELIX_TARGET_HZ);
      expect(
        off,
        `\n${path} is ${f0!.toFixed(1)} Hz, x${off.toFixed(3)} from Felix ` +
          `(${FELIX_TARGET_HZ} Hz, ceiling x${FELIX_MATCH_TOLERANCE}).\n` +
          "Fix: npm run felix:voice, then run this test before committing.\n"
      ).toBeLessThan(FELIX_MATCH_TOLERANCE);
    }
  });

  it("and the runtime is pulling report clips toward that same voice", () => {
    // lib/pitchShift.ts anchors every browser-side clip to profile.anchorHz.
    // If the profile drifts from FELIX_TARGET_HZ, the static samples and the
    // live ones are two different foxes and nothing else here would notice.
    const off = pitchRatio(profile.anchorHz, FELIX_TARGET_HZ);
    expect(
      off,
      `\nlib/felixVoiceProfile.json anchors runtime clips to ${profile.anchorHz} Hz, ` +
        `x${off.toFixed(3)} from Felix (${FELIX_TARGET_HZ} Hz).\n` +
        "Fix: npm run felix:voice, which rewrites the profile from the clip it cut.\n"
    ).toBeLessThan(FELIX_MATCH_TOLERANCE);
  });
});
