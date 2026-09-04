import { describe, expect, it } from "vitest";
import {
  hasFfmpeg,
  pitchOf,
  pitchRatio,
  FELIX_PITCH_BAND,
  PITCH_TOLERANCE,
} from "@/lib/voicePitch";

/* ---------------------------------------------------------------------------
   Do the committed samples actually sound like the same fox?

   They are cut from ONE synthesis request now, split at the pause between the
   takes (TAKE_SEPARATOR / splitOnSilence). One render is one voice, so this is
   structural rather than checked-for — the free Fish Audio model ignores
   `reference_id` and returns a different generic voice per CALL, so the fix
   was to stop making two calls.

   What is left for a test is the failure that survives that: a file committed
   some other way. Two calls, a fallback path, a hand-edit, an over-eager pitch
   correction. Each clip has to sit in the band a real render lands in, and the
   two have to sit near each other — loosely, because one speaker's median
   pitch moves with what the sentence is doing.
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

  it("and every clip is at the same pitch as the others", () => {
    const [a, b] = pitches;
    const ratio = pitchRatio(a.f0!, b.f0!);
    expect(
      ratio,
      `\n${a.path} ${a.f0!.toFixed(1)} Hz\n${b.path} ${b.f0!.toFixed(1)} Hz\n` +
        `ratio ${ratio.toFixed(3)}, ceiling ${PITCH_TOLERANCE} — not the same fox.\n` +
        "Fix: npm run felix:voice, then run this test before committing.\n"
    ).toBeLessThan(PITCH_TOLERANCE);
  });
});
