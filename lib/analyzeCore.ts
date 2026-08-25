/**
 * The pure core of the analysis route.
 *
 * These were module-private inside app/api/analyze/route.ts, which made them
 * untestable: Next validates a route file's exports and rejects arbitrary
 * ones, so they could not simply be exported in place. They are moved here
 * VERBATIM — comments included, because in this file the comments are the
 * record of what each one is defending against.
 *
 * Nothing here does I/O. Everything that talks to AssemblyAI, Gemini,
 * Firestore or Stripe stays in the route.
 */

export interface AaiWord {
  text: string;
  start: number; // ms
  end: number; // ms
}

export const FILLERS = /^(um+|uh+|erm+|hmm+|like|so|well|right)[,.!?]?$/i;

export function computeMetrics(words: AaiWord[], durationSec: number) {
  const paceWpm =
    durationSec > 0 ? Math.round(words.length / (durationSec / 60)) : 0;
  const fillerWords = words.filter((w) => FILLERS.test(w.text)).length;
  let pauses = 0;
  const pauseSpots: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const gapMs = words[i].start - words[i - 1].end;
    if (gapMs > 1200) {
      pauses++;
      pauseSpots.push(
        `${formatTime(words[i - 1].end / 1000)} (${(gapMs / 1000).toFixed(1)}s)`
      );
    }
  }
  return { paceWpm, fillerWords, pauses, pauseSpots };
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface Segment {
  text: string; // verbatim, exactly what AssemblyAI heard
  time: string; // m:ss of the first word
}

/**
 * Splits the real word list into readable, verbatim segments, sentence
 * boundaries where we have them, otherwise ~22-word chunks. These are the
 * ACTUAL words the speaker said (never the model's paraphrase): the report
 * displays them as-is, and Felix only chooses which ones to mark. That's
 * the whole point, the transcript on screen must be what was spoken, not a
 * reconstruction the LLM is free to invent.
 */
export function buildSegments(words: AaiWord[]): Segment[] {
  const chunks: AaiWord[][] = [];
  let cur: AaiWord[] = [];
  for (const w of words) {
    cur.push(w);
    const endsSentence = /[.!?]["')\]]?$/.test(w.text);
    if ((endsSentence && cur.length >= 4) || cur.length >= 22) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);

  return chunks.map((chunk) => ({
    // Join verbatim, then tidy the space before attached punctuation so it
    // reads naturally without altering a single spoken word.
    text: chunk
      .map((w) => w.text)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1"),
    time: formatTime(chunk[0].start / 1000),
  }));
}

/** The verbatim segments, numbered, for the model to annotate by index. */
export function numberedSegments(segments: Segment[]): string {
  return segments
    .map((s, i) => `[${i}] (${s.time}) ${s.text}`)
    .join("\n");
}

// The six delivery dimensions Felix scores from the audio. The overall score
// is COMPUTED from these (their mean, plus the encouragement boost) rather
// than invented as a single number, see runGemini. Body language and eye
// contact are the other two dimensions; they can only be judged from video,
// so they live in the camera pass (runStage), never guessed from audio.
/**
 * Make a string safe to put INSIDE the `"""` fence.
 *
 * The system prompt tells the model that delimited text is the speaker's own
 * material and never an instruction — which is the right instruction, and it
 * only holds while the text is still delimited. `sanitizeText` strips tags and
 * angle brackets and leaves quotes alone (correctly: quotes are ordinary
 * punctuation in a speech topic), so a prompt containing its own `"""` CLOSED
 * the fence, and everything after it arrived as top-level prompt text the
 * model had been given no reason to distrust.
 *
 * That is not theoretical here: the score this produces is what
 * xpForChallengeAttempt pays and what the leaderboard ranks.
 *
 * The delimiter is neutralised rather than removed, so a topic that genuinely
 * contains quotation marks still reads as itself.
 */
export function fenced(text: string): string {
  return text.replace(/"{3,}/g, (run) => "'".repeat(run.length));
}

// Round and clamp only. There is deliberately no offset here any more.
//
// This used to carry SCORE_BOOST (+10) and HONESTY_REDUCTION (-13), a net 3
// points shaved off whatever the model said. That was the wrong instrument
// for the job. A flat offset SHIFTS the distribution, it cannot SPREAD it:
// if every score the model produces is bunched between 70 and 85, taking
// three points off each one just moves the same bunch down to 67-82. It can
// never make a genuinely bad delivery score in the 30s, and it drags honest
// high scores down with it, so a speaker who earned a 90 is told 87 for no
// reason connected to their speaking.
//
// Spread is a judgement, so it belongs in the judgement, which is the scale
// and the calibration paragraph in SYSTEM_PROMPT (and STAGE_SYSTEM for the
// camera pass). Those now define three tiers across the full range and press
// the model to commit to one. If scores need to move, move the bands there.
// Reintroducing an offset here would only re-hide the problem.
//
// The clamp stays: the model returns an integer it was asked to keep in
// 0-100 and generally does, but nothing enforces that but this.
//
// The finiteness check is not paranoia. Math.round(NaN) is NaN and BOTH
// Math.max and Math.min pass NaN straight through, so a single dimension
// coming back without a numeric score used to make `overall` NaN — which
// awardXp then added to the durable XP total, and NaN + anything is NaN
// forever. That silently pinned the account to level 1 with no way back.
// A missing score is a 0 for that dimension; it is never a poisoned total.
export function calibrate(raw: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// --- Model-output coercion ---------------------------------------------
// `responseSchema` is best-effort, not a guarantee, and the fallback chain in
// lib/gemini.ts ends at an unpinned `-latest` alias. A response missing
// `tips` used to be persisted as-is, and the report page then did
// `analysis.tips.map(...)` — a TypeError that white-screened that report on
// every future visit, because the bad session was already in Firestore.
// Coerce at the boundary so a malformed field degrades to empty, never to a
// crash on a session the user can't delete their way out of.

export function str(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function strList(v: unknown, max = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max);
}
