import { describe, expect, it } from "vitest";
import { analyseFrame, REST_STATE, type FelixFrame, type LipState } from "@/lib/lipSync";

/* ---------------------------------------------------------------------------
   The face is drawn from lib/lipSync.ts, which reads a byte spectrum the
   way a mouth would: energy opens the jaw, spectral tilt picks the shape.
   Nothing here needs an AudioContext, which is the point: a browser pane
   with no frame loop can't exercise it, but synthetic spectra can, and they
   pin the two things that make it read as speech rather than a flap: an
   "ah" and an "ee" come out as different mouths, and the jaw snaps open
   faster than it eases shut.
   --------------------------------------------------------------------------- */

const BIN_HZ = 44100 / 1024;
const BINS = 512;

/** A spectrum from a level-per-hertz function, clamped to the byte range. */
function spectrum(level: (hz: number) => number): Uint8Array {
  const f = new Uint8Array(BINS);
  for (let i = 0; i < BINS; i++) {
    f[i] = Math.max(0, Math.min(255, Math.round(level(i * BIN_HZ))));
  }
  return f;
}

/** Four bands, by level: below 900, 900–1600, 1600–4200, 4200–4500 Hz. */
const shaped = (a: number, b: number, c: number, d: number) =>
  spectrum((hz) =>
    hz < 90 ? 0 : hz <= 900 ? a : hz <= 1600 ? b : hz <= 4200 ? c : hz <= 4500 ? d : 0
  );

const SILENCE = spectrum(() => 0);
const HISS = spectrum(() => 15); // real, and under the floor
// Levels in the range the calibration note in lib/lipSync.ts records. A back
// vowel: the low band a hundred units over the high one.
const AH = shaped(220, 170, 115, 100);
// A front vowel: the 1.6–4.2 kHz band nearly level with the low one.
const EE = shaped(150, 120, 140, 90);

/** Feed frames 16ms apart, from `start`, with a fixed die. */
function run(
  frames: Uint8Array[],
  start: LipState = REST_STATE,
  random: () => number = () => 0.9,
  t0 = 1000
): { state: LipState; frames: FelixFrame[] } {
  let state = start;
  const out: FelixFrame[] = [];
  frames.forEach((f, i) => {
    const r = analyseFrame(f, BIN_HZ, state, t0 + i * 16, random);
    state = r.state;
    out.push(r.frame);
  });
  return { state, frames: out };
}

const times = (f: Uint8Array, n: number) => Array.from({ length: n }, () => f);

describe("lipSync — the jaw", () => {
  it("stays shut on silence and on hiss under the floor", () => {
    for (const f of [SILENCE, HISS]) {
      const { frames } = run(times(f, 30));
      expect(frames.every((x) => x.open === 0)).toBe(true);
      expect(frames.every((x) => x.energy === 0)).toBe(true);
    }
  });

  it("opens on a vowel within a few frames", () => {
    const { frames } = run(times(AH, 6));
    expect(frames[0].energy).toBe(1);
    expect(frames[0].open).toBeGreaterThan(0.4);
    expect(frames[5].open).toBeGreaterThan(0.9);
  });

  it("reports the raw level and the smoothed jaw separately", () => {
    const { frames } = run([AH]);
    expect(frames[0].energy).toBe(1);
    expect(frames[0].open).toBeLessThan(1);
  });

  it("snaps open faster than it eases shut", () => {
    const rise = run(times(AH, 3)).state.open;
    const opened = run(times(AH, 40)).state;
    const fall = opened.open - run(times(SILENCE, 3), opened).state.open;
    expect(rise).toBeGreaterThan(fall);
    // ...but does close: a long silence ends with the mouth shut.
    expect(run(times(SILENCE, 60), opened).state.open).toBeLessThan(0.01);
  });
});

describe("lipSync — the shape", () => {
  it("rounds the mouth on 'ah' and spreads it on 'ee'", () => {
    expect(run(times(AH, 20)).state.wide).toBeLessThan(0.2);
    expect(run(times(EE, 20)).state.wide).toBeGreaterThan(0.8);
  });

  it("relaxes toward neutral in the gaps rather than holding the last vowel", () => {
    const spread = run(times(EE, 20)).state;
    const after = run(times(SILENCE, 40), spread).state;
    expect(Math.abs(after.wide - 0.5)).toBeLessThan(0.05);
  });
});

describe("lipSync — the nod", () => {
  it("nods on a syllable onset and settles again in the silence after", () => {
    const onset = run(times(AH, 4));
    expect(onset.state.lastOnset).toBe(1000);
    expect(onset.state.tiltTarget).toBeGreaterThan(0); // die of 0.9 → positive
    expect(onset.frames[3].tilt).toBeGreaterThan(0);

    const later = run(times(SILENCE, 90), onset.state);
    expect(Math.abs(later.state.tilt)).toBeLessThan(0.05);
  });

  it("does not re-trigger inside the onset gap", () => {
    // Onset at t=1000, a dip, then energy again at t=1048: one syllable.
    const { state } = run([AH, SILENCE, SILENCE, AH], REST_STATE, () => 0.1);
    expect(state.lastOnset).toBe(1000);
  });

  it("does trigger again once the gap has passed", () => {
    const first = run(times(AH, 2), REST_STATE, () => 0.9);
    const dip = run(times(SILENCE, 12), first.state); // 192ms of quiet
    const second = analyseFrame(AH, BIN_HZ, dip.state, 1000 + 14 * 16, () => 0.1);
    expect(second.state.lastOnset).toBe(1000 + 14 * 16);
    expect(second.state.tiltTarget).toBeLessThan(0); // die of 0.1 → negative
  });
});
