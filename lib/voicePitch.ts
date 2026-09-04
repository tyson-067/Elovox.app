// Audio helpers for Felix's committed samples: measuring what came back,
// and cutting one render into several clips.
//
// Fish Audio's s2.1-pro-free does not render a reference voice consistently.
// Measured, three calls with identical text, voice id, model and speed:
//
//     228.6 Hz, 200.0 Hz, 238.8 Hz
//
// and on one occasion a clip an octave down at 141.6 Hz against a sibling at
// 228.6 Hz — two obviously different speakers, both produced from the same
// request in the same run. Nothing that inspects configuration can see this:
// the request was correct every time.
//
// So the samples are measured after synthesis, and the script re-rolls until
// the pair actually matches (scripts/felix-voice-sample.mjs). This module is
// the measurement, shared by that script and by the test that guards the
// committed files (tests/unit/felix-voice-match.test.ts) so the number the
// script accepts and the number the test checks are the same number.
//
// Import-free beyond node: builtins — the script runs it under Node's type
// stripping, exactly as it does lib/fishAudio.ts.

import { execFileSync, spawnSync } from "node:child_process";
import { medianF0 as medianF0Float } from "./pitchShift.ts";

/** Is ffmpeg on this machine? Without it there is no measurement, and callers
 *  skip rather than guess. */
export function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Decode to 16 kHz mono PCM. Felix's pitch lives well under 350 Hz, so 16 kHz
 *  is plenty and keeps the autocorrelation cheap. Accepts a file path or the
 *  MP3 bytes themselves, so the script can measure before it writes. */
export function pcm(source: string | Uint8Array): Int16Array {
  const args = ["-v", "error", "-i", typeof source === "string" ? source : "pipe:0",
    "-ac", "1", "-ar", "16000", "-f", "s16le", "-"];
  const raw = execFileSync("ffmpeg", args, {
    input: typeof source === "string" ? undefined : Buffer.from(source),
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
}

/**
 * Median fundamental frequency, in Hz.
 *
 * The maths lives in lib/pitchShift.ts — the browser needs the same function
 * and cannot import anything from node:, so that module owns it and this one
 * only decodes. It was written twice, briefly, and the two copies drifted on
 * their voicing threshold alone: build-time read 210 Hz where the runtime read
 * 188 Hz on the same file, which would have had every report clip corrected
 * toward a pitch the landing page was not at.
 */
export function medianF0(x: Int16Array, sr = 16000): number | null {
  const f = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) f[i] = x[i] / 32768;
  return medianF0Float(f, sr);
}

/** Convenience: measure a file. */
export function pitchOf(path: string): number | null {
  return medianF0(pcm(path));
}

/**
 * How far apart two clips are, as a ratio of the higher to the lower.
 * 1 is identical; the model's own run-to-run noise on an identical request
 * measured about 1.19 at its worst.
 */
export function pitchRatio(a: number, b: number): number {
  return Math.max(a, b) / Math.min(a, b);
}

/**
 * The band a usable render lands in.
 *
 * s2.1-pro-free returns a different generic voice every call — measured across
 * runs it ranges roughly 175-245 Hz, with the occasional outlier an octave
 * down. Anything outside this band is one of those outliers and gets re-rolled
 * rather than used as the reference the other clips are matched to.
 */
export const FELIX_PITCH_BAND: [number, number] = [150, 265];

/**
 * How far two clips may sit apart in median pitch.
 *
 * Loosened from 1.06, deliberately, because the guarantee moved. When the
 * clips came from separate calls this number WAS the mechanism — it had to be
 * tight enough to catch two different voices. They now come from one render
 * (see TAKE_SEPARATOR and splitOnSilence), so identical voice is structural
 * and this is a smoke test behind it.
 *
 * What it still has to tolerate is one speaker's own prosody: the current pair
 * measures 198 Hz and 176 Hz — a ratio of 1.13 — from the same render, because
 * one take opens on "Nice work" and the other on a diagnosis. A 1.06 ceiling
 * would fail on that and be right about nothing. 1.25 still catches the
 * failures worth catching: the octave-down outlier (1.62) and a botched
 * correction.
 */
export const PITCH_TOLERANCE = 1.25;

export function normalizeToPitch(
  bytes: Uint8Array,
  targetHz: number
): { bytes: Uint8Array; from: number | null; to: number | null; ratio: number } {
  const from = medianF0(pcm(bytes));
  if (from === null) return { bytes, from: null, to: null, ratio: 1 };

  const ratio = targetHz / from;
  if (Math.abs(ratio - 1) < 0.01) return { bytes, from, to: from, ratio: 1 };

  const SR = 44100;
  // atempo is only defined over 0.5-2.0; chain it if a correction ever needs
  // more than that. Real corrections here are ~1.2, so one stage is enough.
  const stages: string[] = [];
  let remaining = 1 / ratio;
  while (remaining > 2 || remaining < 0.5) {
    const step = remaining > 2 ? 2 : 0.5;
    stages.push(`atempo=${step}`);
    remaining /= step;
  }
  stages.push(`atempo=${remaining}`);

  const shifted = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", "pipe:0",
      "-af", `asetrate=${SR}*${ratio},aresample=${SR},${stages.join(",")}`,
      "-b:a", "64k", "-f", "mp3", "-"],
    { input: Buffer.from(bytes), maxBuffer: 64 * 1024 * 1024 }
  );
  const out = new Uint8Array(shifted);
  return { bytes: out, from, to: medianF0(pcm(out)), ratio };
}

/**
 * The separator that goes between takes inside a single synthesis request, and
 * the gap it produces is how they are cut apart again.
 *
 * Why one request at all: the free Fish Audio model ignores `reference_id` and
 * returns a different generic voice on EVERY call, so two calls are two
 * different foxes and no amount of pitch correction makes them one person —
 * correcting pitch moves formants too, and the last attempt at it made Felix a
 * chipmunk. One request is one render is one voice. That is the only guarantee
 * available without API credit, and it is exact rather than approximate.
 *
 * Forty ". " pairs, measured against the alternatives: it yields a 0.98s pause
 * where the longest natural sentence break in the same clip is 0.51s. Blank
 * lines produced nothing (0.35s, indistinguishable from a comma) and em dashes
 * only 0.60s. The margin is what makes "longest silence" a safe way to find it.
 */
export const TAKE_SEPARATOR = "\n\n" + ". ".repeat(40) + "\n\n";

interface Gap {
  start: number;
  end: number;
}

/** Every silence in a clip, longest first.
 *
 *  spawnSync, not execFileSync: silencedetect reports on STDERR, and
 *  execFileSync only hands back stdout when the process succeeds. Reading the
 *  wrong stream is why this silently found no gaps and fell back to one call
 *  per take — the split was never being attempted. */
function silences(path: string, noiseDb = -40, minSec = 0.3): Gap[] {
  const res = spawnSync(
    "ffmpeg",
    ["-v", "info", "-i", path, "-af", `silencedetect=noise=${noiseDb}dB:d=${minSec}`, "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  const log = `${res.stderr ?? ""}${res.stdout ?? ""}`;
  const out: Gap[] = [];
  let start: number | null = null;
  for (const line of log.split("\n")) {
    const a = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (a) start = Math.max(0, Number(a[1]));
    const b = line.match(/silence_end:\s*([\d.]+)/);
    if (b && start !== null) {
      out.push({ start, end: Number(b[1]) });
      start = null;
    }
  }
  return out.sort((x, y) => y.end - y.start - (x.end - x.start));
}

/**
 * Cut one render into clips, one per text, at the pauses between them.
 *
 * The boundary is PREDICTED from the texts' own lengths and then snapped to
 * the nearest real silence. It used to be "the count-1 longest silences",
 * which is wrong and was only ever right by accident: a long take's internal
 * sentence pauses are as long as the separator's, so on a 26-word anchor
 * followed by an 11-word line that rule cut at 3.6s and 8.9s, implying speech
 * rates of 7.2 and 1.2 words per second. Nobody talks like that. Predicting by
 * length and snapping put the same three renders at 3.3/3.4, 2.8/2.7 and
 * 3.4/2.6 words per second, which is one person talking.
 *
 * Returns null when there is no usable silence, or when the snap lands
 * implausibly far from the prediction — the caller then falls back to separate
 * requests, because a mis-cut clip holds half a sentence and that is worse
 * than two voices.
 */
export function splitByText(path: string, texts: string[]): Uint8Array[] | null {
  if (texts.length < 2) return null;

  const duration = Number(
    spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", path], { encoding: "utf8" }).stdout
  );
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const EDGE = 0.4;
  const gaps = silences(path, -40, 0.25)
    .filter((g) => g.start > EDGE && g.end < duration - EDGE)
    .sort((a, b) => a.start - b.start);
  if (gaps.length < texts.length - 1) return null;

  // Characters, not words: it tracks speaking time more closely, because a
  // long word takes longer to say than a short one.
  const lens = texts.map((t) => t.length);
  const total = lens.reduce((a, b) => a + b, 0);

  const bounds: Gap[] = [];
  let acc = 0;
  for (let i = 0; i < texts.length - 1; i++) {
    acc += lens[i];
    const want = (acc / total) * duration;
    let best = gaps[0];
    let bestDist = Infinity;
    for (const g of gaps) {
      const d = Math.abs((g.start + g.end) / 2 - want);
      if (d < bestDist) { bestDist = d; best = g; }
    }
    // A snap this far from the prediction means the pause we wanted was never
    // detected, and we are about to cut mid-sentence.
    if (bestDist > Math.max(1.5, duration * 0.18)) return null;
    bounds.push(best);
  }

  const clips: Uint8Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    const from = i === 0 ? 0 : bounds[i - 1].end;
    const to = i === texts.length - 1 ? null : bounds[i].start;
    if (to !== null && to - from < 0.5) return null;
    const args = ["-v", "error", "-i", path, "-ss", String(from)];
    if (to !== null) args.push("-to", String(to));
    args.push("-b:a", "64k", "-f", "mp3", "-");
    const res = spawnSync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0 || !res.stdout?.length) return null;
    clips.push(new Uint8Array(res.stdout));
  }
  return clips;
}
