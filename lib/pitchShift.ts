// Pulling a runtime Felix clip onto the landing page's pitch, in the browser.
//
// WHY THIS EXISTS
//
// The free Fish Audio model ignores `reference_id` and returns a different
// generic voice on every CALL. The landing page dodges that by synthesising
// both of its takes in one request (see TAKE_SEPARATOR in lib/voicePitch.ts) —
// one render is one voice. The report cannot: its text is written from the
// recording the user just made, so every take is a fresh call and a fresh
// voice. Measured, same text three times: 228.6, 200.0, 238.8 Hz.
//
// Vercel's Node runtime has no ffmpeg, so the correction that build-time uses
// is not available server-side. It happens here instead, on the decoded buffer,
// before the clip is played.
//
// WHAT IT IS AND IS NOT
//
// A PITCH match. Formants move with the pitch, so this makes Felix consistent,
// not correct — it cannot conjure the chosen voice out of a render that never
// contained it. Corrections are around ±12%, which is the size that survives
// the technique; a 20% push once produced something nobody would call a fox.
// API credit is what actually fixes this, and it deletes this whole file.
//
// Pure functions over Float32Array on purpose: no AudioContext, no DOM. That
// is what makes it testable in Node against real audio rather than guessed at
// in a browser that cannot be listened to from here.

/** The landing page's pitch, which every runtime clip is pulled toward.
 *
 *  Measured from public/felix-hello.mp3, not chosen. Re-cutting the samples can
 *  move it, so tests/unit/pitch-shift.test.ts fails when the committed clip and
 *  this number drift apart — otherwise the report's Felix would be corrected
 *  toward a voice the landing page had stopped using. */
export const FELIX_ANCHOR_HZ = 208;

/** Beyond this the correction stops being inaudible and starts being an
 *  effect. A render this far out is left alone: a consistent-but-wrong voice
 *  is worse than an inconsistent one that at least sounds human. */
export const MAX_SHIFT = 1.18;

/**
 * Median fundamental frequency of a mono signal.
 *
 * The same normalised-autocorrelation-with-octave-correction used at build
 * time (lib/voicePitch.ts). The octave check is the part that matters: a plain
 * autocorrelation peak sits just as happily at half the true period, and
 * acting on that reading is how every Felix clip once got shifted an octave
 * the wrong way.
 */
export function medianF0(x: Float32Array, sr: number): number | null {
  const win = Math.round(0.045 * sr);
  const hop = Math.round(0.02 * sr);
  const lo = Math.floor(sr / 400);
  const hi = Math.floor(sr / 60);
  if (x.length < win + hop) return null;
  const out: number[] = [];

  for (let s = 0; s + win < x.length; s += hop) {
    let energy = 0;
    for (let i = 0; i < win; i++) energy += x[s + i] * x[s + i];
    // Voicing gate. 1.8e-3 on unit-scale floats is the same energy as the
    // 2e6 this used on int16 samples — stated as one number in one place,
    // because the two copies of this loop drifted on exactly this constant and
    // silently disagreed about a file's pitch by 12%.
    if (energy / win < 1.8e-3) continue;

    let mean = 0;
    for (let i = 0; i < win; i++) mean += x[s + i];
    mean /= win;

    const corr = new Float64Array(hi + 1);
    for (let lag = lo; lag <= hi; lag++) {
      let c = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i + lag < win; i++) {
        const a = x[s + i] - mean;
        const b = x[s + i + lag] - mean;
        c += a * b;
        na += a * a;
        nb += b * b;
      }
      corr[lag] = na && nb ? c / Math.sqrt(na * nb) : 0;
    }

    let bestLag = 0;
    let best = 0;
    for (let lag = lo; lag <= hi; lag++) {
      if (corr[lag] > best) {
        best = corr[lag];
        bestLag = lag;
      }
    }
    if (!bestLag || best < 0.3) continue;

    // OCTAVE CORRECTION, and the reason this is not simply argmax.
    //
    // A periodic signal correlates just as strongly at 2T and 3T as at T, so
    // the global maximum is free to land on any multiple of the period —
    // reading a 150 Hz voice as 75 Hz. Preferring the LONGEST good lag (tried,
    // briefly) makes that certain rather than merely possible.
    //
    // The period is the SHORTEST lag that already correlates within a hair of
    // the best. Scanning up from the floor and taking the first local peak
    // above 0.9 of the maximum finds T and steps over 2T and 3T entirely.
    const floor = best * 0.9;
    for (let lag = lo + 1; lag < bestLag; lag++) {
      if (
        corr[lag] >= floor &&
        corr[lag] >= corr[lag - 1] &&
        corr[lag] >= corr[lag + 1]
      ) {
        bestLag = lag;
        break;
      }
    }
    out.push(sr / bestLag);
  }
  if (!out.length) return null;
  out.sort((a, b) => a - b);
  return out[Math.floor(out.length / 2)];
}

/**
 * Time-stretch by `factor` without touching pitch, by WSOLA.
 *
 * Overlap-add with a Hann window, and each frame's copy point nudged within a
 * small search window to wherever it best correlates with what has already
 * been written. That alignment step is the difference between "slightly soft"
 * and the metallic warble plain OLA produces on a voice — it costs a short
 * cross-correlation per frame and is what makes this usable on speech.
 */
export function timeStretch(x: Float32Array, sr: number, factor: number): Float32Array {
  if (Math.abs(factor - 1) < 1e-3) return x;

  const frame = Math.round(0.05 * sr); // 50 ms
  const synHop = Math.round(frame / 4);
  const anaHop = Math.round(synHop / factor);
  const search = Math.round(0.005 * sr); // ±5 ms of alignment freedom

  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1));

  const outLen = Math.max(frame, Math.ceil(x.length * factor) + frame);
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);

  let ana = 0;
  let syn = 0;
  while (ana + frame + search < x.length && syn + frame < outLen) {
    let at = ana;
    if (syn > 0 && search > 0) {
      // Align this frame to the tail already written, so the overlap adds
      // constructively instead of smearing.
      let bestScore = -Infinity;
      let bestOff = 0;
      const probe = Math.min(synHop, frame);
      for (let off = -search; off <= search; off++) {
        const from = ana + off;
        if (from < 0 || from + probe >= x.length) continue;
        let dot = 0;
        for (let i = 0; i < probe; i += 2) dot += out[syn + i] * x[from + i];
        if (dot > bestScore) {
          bestScore = dot;
          bestOff = off;
        }
      }
      at = ana + bestOff;
    }
    for (let i = 0; i < frame; i++) {
      const v = x[at + i];
      if (v === undefined) break;
      out[syn + i] += v * win[i];
      norm[syn + i] += win[i];
    }
    ana += anaHop;
    syn += synHop;
  }

  const end = Math.min(outLen, syn + frame);
  const result = new Float32Array(end);
  for (let i = 0; i < end; i++) result[i] = norm[i] > 1e-6 ? out[i] / norm[i] : out[i];
  return result;
}

/** Linear resample. Used to trade the stretch back for pitch. */
export function resample(x: Float32Array, factor: number): Float32Array {
  if (Math.abs(factor - 1) < 1e-3) return x;
  const outLen = Math.max(1, Math.floor(x.length / factor));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * factor;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = x[i0] ?? 0;
    const b = x[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * Multiply the pitch by `ratio`, keeping the duration.
 *
 * Stretch by `ratio`, then resample by `ratio`: the stretch makes it longer at
 * the same pitch, the resample puts the length back and takes the pitch up
 * with it. Same identity ffmpeg's `asetrate`+`atempo` uses at build time, so
 * the runtime clip is processed the way the committed ones were.
 */
export function shiftPitch(x: Float32Array, sr: number, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-3) return x;
  return resample(timeStretch(x, sr, ratio), ratio);
}

/**
 * The whole decision for one clip: measure it, and shift it onto the anchor if
 * that is both needed and safe.
 *
 * Returns the ratio applied (1 when nothing was done) alongside the audio, so
 * callers can log or test what happened rather than infer it.
 */
export function anchorToFelix(
  channel: Float32Array,
  sr: number,
  anchorHz = FELIX_ANCHOR_HZ
): { samples: Float32Array; from: number | null; ratio: number } {
  const from = medianF0(channel, sr);
  if (from === null) return { samples: channel, from, ratio: 1 };

  const ratio = anchorHz / from;
  // Already close enough to hear as the same voice, or so far out that
  // correcting it would do more damage than the mismatch.
  if (Math.abs(ratio - 1) < 0.02) return { samples: channel, from, ratio: 1 };
  if (ratio > MAX_SHIFT || ratio < 1 / MAX_SHIFT) return { samples: channel, from, ratio: 1 };

  return { samples: shiftPitch(channel, sr, ratio), from, ratio };
}
