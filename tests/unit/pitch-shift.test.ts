import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  anchorToFelix,
  medianF0,
  shiftPitch,
  timeStretch,
  FELIX_ANCHOR_HZ,
  MAX_SHIFT,
} from "@/lib/pitchShift";

/* ---------------------------------------------------------------------------
   The browser-side pitch anchor.

   The report's Felix is synthesised per take, and the free Fish Audio model
   returns a different generic voice every call, so each recording came back in
   a different fox. Vercel's Node runtime has no ffmpeg, so the build-time
   correction is not available there; lib/pitchShift.ts does it in the browser
   on the decoded buffer instead.

   It is written as pure functions over Float32Array precisely so it can be
   tested HERE, in Node, against real audio and against signals whose answer is
   known in advance — rather than in a browser this session cannot listen to.
   --------------------------------------------------------------------------- */

const SR = 16000;

/** A rough voiced sound: a buzz at `hz` with a few harmonics, so the pitch
 *  detector has something with real structure to find rather than a sine. */
function vowel(hz: number, seconds = 1.2, sr = SR): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] =
      0.6 * Math.sin(2 * Math.PI * hz * t) +
      0.3 * Math.sin(2 * Math.PI * hz * 2 * t) +
      0.15 * Math.sin(2 * Math.PI * hz * 3 * t) +
      0.08 * Math.sin(2 * Math.PI * hz * 4 * t);
  }
  return out;
}

function hasFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

/** Decode a committed MP3 to mono float samples. */
function decode(path: string, sr = SR): Float32Array {
  const res = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const buf = res.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

describe("medianF0", () => {
  it("finds the fundamental of a known tone", () => {
    expect(medianF0(vowel(150), SR)!).toBeCloseTo(150, -1);
    expect(medianF0(vowel(220), SR)!).toBeCloseTo(220, -1);
  });

  it("does NOT report the octave above — the bug that started all this", () => {
    // A 120 Hz buzz with strong harmonics is exactly what a plain
    // autocorrelation reads as 240 Hz. Reading it that way once got every
    // Felix clip shifted an octave in the wrong direction.
    const f = medianF0(vowel(120), SR)!;
    expect(f).toBeGreaterThan(110);
    expect(f).toBeLessThan(135);
  });

  it("returns null on silence rather than guessing", () => {
    expect(medianF0(new Float32Array(SR), SR)).toBeNull();
  });
});

describe("timeStretch", () => {
  it("changes the length by the factor and leaves the pitch alone", () => {
    const x = vowel(180, 2);
    for (const factor of [0.85, 1.15]) {
      const y = timeStretch(x, SR, factor);
      expect(y.length / x.length).toBeCloseTo(factor, 1);
      // The point of stretching: duration moves, pitch does not.
      expect(medianF0(y, SR)!).toBeCloseTo(180, -1);
    }
  });
});

describe("shiftPitch", () => {
  it("multiplies the pitch by the ratio and keeps the duration", () => {
    const x = vowel(170, 2);
    for (const ratio of [0.9, 1.12]) {
      const y = shiftPitch(x, SR, ratio);
      expect(medianF0(y, SR)! / 170).toBeCloseTo(ratio, 1);
      // Duration within a frame or so of the original.
      expect(Math.abs(y.length - x.length) / x.length).toBeLessThan(0.06);
    }
  });
});

describe("anchorToFelix", () => {
  it("pulls an off-pitch clip onto the anchor", () => {
    // Inside MAX_SHIFT of the anchor: this is the case the anchor exists for,
    // a render that came back a little low and can be pulled up without the
    // correction becoming audible.
    const off = vowel(190, 2);
    const { samples, from, ratio } = anchorToFelix(off, SR);
    expect(from!).toBeCloseTo(190, -1);
    expect(ratio).toBeGreaterThan(1);
    expect(medianF0(samples, SR)!).toBeCloseTo(FELIX_ANCHOR_HZ, -1);
  });

  it("leaves a clip that is already close entirely alone", () => {
    const near = vowel(FELIX_ANCHOR_HZ, 2);
    const { samples, ratio } = anchorToFelix(near, SR);
    expect(ratio).toBe(1);
    expect(samples).toBe(near); // the same object, not a re-encoded copy
  });

  it("refuses a correction too large to survive the technique", () => {
    // An octave-down outlier. Correcting it would move formants so far that
    // the result stops sounding like a person — a consistent-but-wrong voice
    // is worse than an inconsistent human one, so it is left as it came.
    const wayOff = vowel(FELIX_ANCHOR_HZ / (MAX_SHIFT * 1.4), 2);
    const { ratio } = anchorToFelix(wayOff, SR);
    expect(ratio).toBe(1);
  });

  it("passes silence through untouched", () => {
    const quiet = new Float32Array(SR);
    const { ratio, from } = anchorToFelix(quiet, SR);
    expect(from).toBeNull();
    expect(ratio).toBe(1);
  });
});

(hasFfmpeg() ? describe : describe.skip)("against the real committed clip", () => {
  it("the landing clip is at the anchor the runtime aims for", () => {
    // If public/felix-hello.mp3 drifts away from FELIX_ANCHOR_HZ, the report's
    // Felix is being corrected toward a voice the landing page no longer uses.
    const f = medianF0(decode("public/felix-hello.mp3"), SR);
    expect(f, "no voiced frames in the landing clip").not.toBeNull();
    const ratio = Math.max(f!, FELIX_ANCHOR_HZ) / Math.min(f!, FELIX_ANCHOR_HZ);
    expect(
      ratio,
      `\npublic/felix-hello.mp3 is ${f!.toFixed(1)} Hz but FELIX_ANCHOR_HZ is ` +
        `${FELIX_ANCHOR_HZ} Hz.\nUpdate the anchor in lib/pitchShift.ts to match ` +
        "the committed clip, or re-cut until it lands near the anchor.\n"
    ).toBeLessThan(1.05);
  });

  it("shifting real speech moves its pitch by the ratio asked for", () => {
    const x = decode("public/felix-hello.mp3");
    const before = medianF0(x, SR)!;
    const y = shiftPitch(x, SR, 1.12);
    expect(medianF0(y, SR)! / before).toBeCloseTo(1.12, 1);
  });
});
