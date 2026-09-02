// The arithmetic of a talking face: a byte spectrum in, a mouth out.
//
// Pure and import-free, so lib/felixVoice.ts can call it sixty times a
// second from a rAF loop and tests/unit/lip-sync.test.ts can drive it with
// synthetic spectra and no browser at all. Everything about HOW the numbers
// are found lives here; everything about WHERE the audio comes from lives in
// the engine.
//
// Two ideas. Overall energy says how far the jaw is open. The balance of
// high-band to low-band energy (spectral tilt) says what shape the mouth is
// making: "ee", "s" and "sh" live above 1.6 kHz, "oo" and "ah" below 900 Hz.
// It's the trick games use, and because it reads the sound that is actually
// playing it cannot drift out of sync.

/** One frame of face. All 0..1 except tilt, which is degrees. */
export interface FelixFrame {
  open: number; // jaw
  wide: number; // 0 round ("oo"), 1 spread ("ee")
  tilt: number; // head nod, ±2.5deg on stressed syllables
  energy: number; // the raw, unsmoothed level, for anything that wants a meter
}

/** What the smoothing carries from one frame to the next. */
export interface LipState {
  open: number;
  wide: number;
  tilt: number;
  tiltTarget: number;
  prevEnergy: number;
  lastOnset: number; // ms, in whatever clock the caller passes as `now`
}

export const REST_STATE: LipState = {
  open: 0,
  wide: 0.5,
  tilt: 0,
  tiltTarget: 0,
  prevEnergy: 0,
  lastOnset: -Infinity,
};

export const REST_FRAME: FelixFrame = { open: 0, wide: 0.5, tilt: 0, energy: 0 };

/**
 * Tuning, on the 0..255 scale getByteFrequencyData uses, calibrated on a
 * rendered clip of speech through this exact analyser (fftSize 1024,
 * smoothing 0.45): quiet frames sat under 20; voiced frames ran 40 to 165
 * with a median of 110. So FLOOR is the hiss that must not open the mouth,
 * and CEIL puts the median syllable at three-quarters open with only the
 * stressed ones at full, which is what reads as speech rather than a flap.
 * Attack is fast (mouths snap open) and release slower (they ease shut), or
 * the face flickers on every consonant.
 *
 * The shape is the byte-unit DIFFERENCE between the high and low bands, not
 * their ratio: the byte scale is dB-linear, so on the same clip the ratio
 * barely moved (0.3 to 0.4) while the difference ran from -97 at the tenth
 * percentile to -27 at the ninetieth.
 */
const FLOOR = 20;
const CEIL = 140;
const ATTACK = 0.5;
const RELEASE = 0.22;
const WIDE_ROUND = -95; // high minus low at which a mouth is fully round
const WIDE_SPREAD = -25; // ...and at which it is fully spread
const ONSET_LEVEL = 0.45; // crossing this upward is a syllable
const ONSET_GAP_MS = 140; // a syllable is not shorter than this
const NOD_DEG = 5; // peak-to-peak

/** Mean level of the bins covering [lo, hi] Hz. */
function band(freq: Uint8Array, binHz: number, lo: number, hi: number): number {
  const a = Math.max(0, Math.ceil(lo / binHz));
  const b = Math.min(freq.length - 1, Math.floor(hi / binHz));
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) sum += freq[i];
  return sum / (b - a + 1);
}

function clamp(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * One frame. `freq` is the analyser's byte spectrum, `binHz` the width of
 * one bin (sampleRate / fftSize), `now` the caller's clock in ms. `random`
 * is injectable so the nod's direction is testable.
 */
export function analyseFrame(
  freq: Uint8Array,
  binHz: number,
  prev: LipState,
  now: number,
  random: () => number = Math.random
): { state: LipState; frame: FelixFrame } {
  const low = band(freq, binHz, 90, 900);
  const high = band(freq, binHz, 1600, 4200);
  const all = band(freq, binHz, 90, 4500);

  // Jaw: energy above the noise floor, snapped open and eased shut.
  const energy = clamp((all - FLOOR) / (CEIL - FLOOR));
  const open = prev.open + (energy - prev.open) * (energy > prev.open ? ATTACK : RELEASE);

  // Shape: spectral tilt. Only meaningful while there is sound; in the gaps
  // it relaxes toward neutral so the next word starts from rest.
  let wide = prev.wide;
  if (energy > 0.05) {
    const slope = high - low;
    const wideRaw = clamp((slope - WIDE_ROUND) / (WIDE_SPREAD - WIDE_ROUND));
    wide += (wideRaw - wide) * 0.28;
  } else {
    wide += (0.5 - wide) * 0.1;
  }

  // A nod on each syllable onset: a new small head angle, held, then
  // drifting back. Random sign so he doesn't metronome.
  let tiltTarget = prev.tiltTarget;
  let lastOnset = prev.lastOnset;
  if (
    energy > ONSET_LEVEL &&
    prev.prevEnergy <= ONSET_LEVEL &&
    now - prev.lastOnset > ONSET_GAP_MS
  ) {
    lastOnset = now;
    tiltTarget = (random() - 0.5) * NOD_DEG * Math.min(1, energy + 0.3);
  } else if (now - prev.lastOnset > 600) {
    tiltTarget *= 0.9;
  }
  const tilt = prev.tilt + (tiltTarget - prev.tilt) * 0.12;

  return {
    state: { open, wide, tilt, tiltTarget, prevEnergy: energy, lastOnset },
    frame: { open, wide, tilt, energy },
  };
}
