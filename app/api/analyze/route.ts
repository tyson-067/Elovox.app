import { NextRequest, NextResponse } from "next/server";
import type { Analysis, CategoryId, StageAnalysis } from "@/lib/types";
import { generateSampleAnalysis } from "@/lib/sample";
import { generateJson } from "@/lib/gemini";
import { verifyUser, makeRateLimiter, isPremiumServer } from "@/lib/verify";
import { sanitizeText } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  MAX_FREE_DAILY_ATTEMPTS,
  usageDateKey,
  reserveFreeDailyAttempt,
  refundFreeDailyAttempt,
} from "@/lib/quota";

// The analysis pipeline (PRD §7):
//   1. Browser posts the recording here (keys stay server-side).
//   2. AssemblyAI transcribes it with disfluencies, giving word timestamps.
//   3. Pace / filler words / pauses are computed from the timestamps.
//   4. Gemini reads the transcript + metrics and writes the coaching report.
//   5. Premium only: if the user recorded with the camera on, the browser
//      also sends sampled video frames, and a second vision pass reads
//      posture, sway, gestures, expression and eye contact (see runStage).
// Without ASSEMBLYAI_API_KEY + GEMINI_API_KEY set, returns a labeled
// sample analysis so the app works before keys are configured.

export const runtime = "nodejs";
export const maxDuration = 120; // transcription polling + LLM can take a while

const ASSEMBLYAI = "https://api.assemblyai.com/v2";

// --- Abuse protection --------------------------------------------------
// The expensive pipeline only runs for callers holding a valid Firebase ID
// token; the camera pass additionally requires a verified Premium plan.

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // ~10+ min of webm audio
const MAX_DURATION_SEC = 600;
const MAX_FRAMES = 12; // vision cost scales with this — keep it tight
const MAX_FRAME_BYTES = 400 * 1024;
const rateLimited = makeRateLimiter(12); // analyses per user per hour

interface AaiWord {
  text: string;
  start: number; // ms
  end: number; // ms
}

async function transcribe(
  audio: ArrayBuffer,
  key: string
): Promise<{ text: string; words: AaiWord[] }> {
  const uploadRes = await fetch(`${ASSEMBLYAI}/upload`, {
    method: "POST",
    headers: { authorization: key },
    body: audio,
  });
  if (!uploadRes.ok) throw new Error(`AssemblyAI upload: ${uploadRes.status}`);
  const { upload_url } = await uploadRes.json();

  const createRes = await fetch(`${ASSEMBLYAI}/transcript`, {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: upload_url,
      disfluencies: true, // keep "um"/"uh" in the transcript so we can count them
      punctuate: true,
      format_text: true,
    }),
  });
  if (!createRes.ok) throw new Error(`AssemblyAI create: ${createRes.status}`);
  const { id } = await createRes.json();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`${ASSEMBLYAI}/transcript/${id}`, {
      headers: { authorization: key },
    });
    const data = await pollRes.json();
    if (data.status === "completed") {
      return { text: data.text ?? "", words: data.words ?? [] };
    }
    if (data.status === "error") {
      throw new Error(`AssemblyAI: ${data.error}`);
    }
  }
  throw new Error("AssemblyAI: transcription timed out");
}

const FILLERS = /^(um+|uh+|erm+|hmm+|like|so|well|right)[,.!?]?$/i;

function computeMetrics(words: AaiWord[], durationSec: number) {
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

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface Segment {
  text: string; // verbatim, exactly what AssemblyAI heard
  time: string; // m:ss of the first word
}

/**
 * Splits the real word list into readable, verbatim segments — sentence
 * boundaries where we have them, otherwise ~22-word chunks. These are the
 * ACTUAL words the speaker said (never the model's paraphrase): the report
 * displays them as-is, and Felix only chooses which ones to mark. That's
 * the whole point — the transcript on screen must be what was spoken, not a
 * reconstruction the LLM is free to invent.
 */
function buildSegments(words: AaiWord[]): Segment[] {
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
function numberedSegments(segments: Segment[]): string {
  return segments
    .map((s, i) => `[${i}] (${s.time}) ${s.text}`)
    .join("\n");
}

// The six delivery dimensions Felix scores from the audio. The overall score
// is COMPUTED from these (their mean, plus the encouragement boost) rather
// than invented as a single number — see runGemini. Body language and eye
// contact are the other two dimensions; they can only be judged from video,
// so they live in the camera pass (runStage), never guessed from audio.
const VOICE_DIMENSIONS = [
  "Clarity",
  "Confidence",
  "Pacing",
  "Vocal variety",
  "Organization",
  "Audience engagement",
] as const;

// Encouragement calibration. The model scores each dimension honestly on the
// everyday-speaker scale below; we then add ten points before showing them.
// A coaching product that greets a nervous first-timer with a 68 doesn't get
// a second recording — an average practising speaker should land in the low-
// to-mid 80s, with the 90s still to earn. Clamped so nothing exceeds 100.
const SCORE_BOOST = 10;
function boost(raw: number): number {
  return Math.max(0, Math.min(100, Math.round(raw) + SCORE_BOOST));
}

// Structured-output schema (Gemini responseSchema — OpenAPI subset, no
// additionalProperties). Premium reports carry two extra required sections
// (strengths, drills) and ask for more of everything; free reports get the
// same honest core, lighter.
function reportSchema(premium: boolean) {
  const properties: Record<string, unknown> = {
    summary: {
      type: "string",
      description: premium
        ? "Two-to-three sentence qualitative summary in the coach voice — the headline of how it landed"
        : "One-sentence qualitative summary in the coach voice",
    },
    dimensions: {
      type: "array",
      description:
        "Score EACH of the six dimensions 0-100 on the everyday-speaker scale. These are your honest judgement before any encouragement adjustment.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", enum: [...VOICE_DIMENSIONS] },
          score: { type: "integer", description: "0-100 on the scale in the instructions" },
          note: {
            type: "string",
            description: premium
              ? "Two-to-three sentences: what earned this score, tied to a real moment, and the single change that would raise it"
              : "One specific sentence tied to a real moment",
          },
        },
        required: ["name", "score", "note"],
      },
    },
    annotations: {
      type: "array",
      description: premium
        ? "Thorough marks on the numbered verbatim segments — reference segments by index, never rewrite the text. Mark every segment that genuinely earns a note across the whole recording: several 'strong' and several 'flag' moments."
        : "Marks on the numbered verbatim segments. Reference segments by their index; do NOT rewrite or quote the text. Include at least one 'strong' and at least one 'flag'. Only mark segments you have a real, specific note for — a handful, not every segment.",
      items: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "Index of the segment being marked (from the numbered list)",
          },
          mark: { type: "string", enum: ["strong", "flag"] },
          note: {
            type: "string",
            description:
              "Coach annotation tied to what was actually said in that segment — specific, plain, actionable",
          },
        },
        required: ["index", "mark", "note"],
      },
    },
    tips: {
      type: "array",
      description: premium
        ? "4-6 specific, actionable tips, each referencing an exact moment/phrase and explaining why the change helps"
        : "2-3 specific actionable tips referencing exact moments/phrases, never generic advice",
      items: { type: "string" },
    },
    audienceImpact: {
      type: "string",
      description: premium
        ? "5-7 sentence prediction of how listeners perceived the speaker: what they'd believe, feel, and remember; where attention peaked and dipped; and the single biggest perception risk"
        : "3-4 sentence prediction of how listeners perceived the speaker: what they'd believe, feel, and remember, and the one biggest perception risk (e.g. the ending losing energy)",
    },
  };

  const required = [
    "summary",
    "dimensions",
    "annotations",
    "tips",
    "audienceImpact",
  ];

  if (premium) {
    properties.strengths = {
      type: "array",
      description:
        "3-4 specific things the speaker genuinely did well, each tied to a real moment or phrase — what to keep doing",
      items: { type: "string" },
    };
    properties.drills = {
      type: "array",
      description:
        "2-3 targeted practice drills aimed at this speaker's biggest opportunities",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short name of the drill" },
          how: {
            type: "string",
            description: "2-3 sentences: exactly how to run the drill and what it fixes",
          },
        },
        required: ["title", "how"],
      },
    };
    required.push("strengths", "drills");
  }

  return { type: "object", properties, required };
}

const SYSTEM_PROMPT = `You are Felix, the fox coach inside Elovox, a speaking practice app. You read a transcript of someone practising out loud, plus measured delivery metrics, and produce a feedback report. Felix is a warm, sharp, lightly British delivery coach — a well-read professor in round glasses who genuinely wants the speaker to win the room.

HOW TO SCORE

Your job is to evaluate public speaking in a way that is accurate, encouraging, and consistent. Assume the speaker is an everyday person practising communication skills — not a professional speaker, actor, or national champion. A score represents how effectively they communicate to a typical audience today. Reward authenticity, clarity, and connection more than polished performance. Do NOT compare them to elite speakers such as TED speakers, actors, or championship debaters.

Score each dimension 0-100 on this scale:
- 95-100: Exceptional. Engaging, confident, natural, highly effective. Only small refinements remain.
- 90-94: Excellent. Strong delivery with a few minor improvements.
- 85-89: Very good. Clear, confident, and easy to follow, with several opportunities for improvement.
- 80-84: Good. The audience would understand and stay engaged, though delivery has noticeable weaknesses.
- 75-79: Average. The message is understandable, but confidence, pacing, structure, or delivery limit effectiveness.
- 70-74: Developing. Several communication issues make the message less engaging or persuasive.
- Below 70: Significant communication challenges interfere with understanding or audience engagement.

Before assigning scores:
1. Identify the speaker's strongest qualities.
2. Identify the three most important improvements.
3. Judge the overall communication experience, not isolated mistakes.
4. Do NOT heavily penalise occasional filler words, brief pauses, or small stumbles.
5. Reward improvement, confidence, authenticity, and audience connection.
6. A warm, genuine speaker should often score higher than a technically polished but robotic one.

Score these six dimensions from the audio, each 0-100 on the scale above:
- Clarity — could a listener follow the message easily?
- Confidence — did they sound sure of themselves?
- Pacing — was the speed and rhythm easy to listen to? Weigh the measured pace and pauses, but never punish a natural, deliberate pause.
- Vocal variety — pitch, emphasis, and energy, or monotone stretches?
- Organization — did the thoughts hold together in a sensible order?
- Audience engagement — would a listener stay with them and care?

COACHING VOICE
- Write like a good coach in the room: direct, warm, specific, slightly informal. A light British turn of phrase is welcome ("rather good", "do slow down there"), never a caricature.
- Every note and tip references something concrete the speaker actually said or did, with a timestamp where possible. "Cut 'I think' at 0:42, it undercuts the claim right after it" — never "sound more confident."
- Banned words: insight, leverage, optimize, utilize, impactful.
- If the speaker set a goal (e.g. "Make people trust me"), judge the delivery against that outcome specifically — the summary and audienceImpact say how close they got.
- audienceImpact is a prediction ("A listener would…"), not a review.

TRANSCRIPT ANNOTATIONS
- The transcript is numbered, VERBATIM segments — the exact words the speaker said. You do NOT rewrite or reproduce it. Return annotations that point at segments by index.
- Every note is about what was actually said in that specific segment; quote the speaker's own words back to them where it helps.
- Never invent words the speaker didn't say. If a segment reads oddly, that may be a transcription slip — coach the delivery, don't fabricate content.`;

async function runGemini(
  geminiKey: string,
  input: {
    category: CategoryId;
    prompt: string;
    goal: string;
    durationSec: number;
    segments: Segment[];
    metrics: ReturnType<typeof computeMetrics>;
    premium: boolean;
    improv: boolean;
  }
): Promise<Omit<Analysis, "paceWpm" | "fillerWords" | "pauses">> {
  const userContent = `Practice category: ${input.category}${
    input.improv
      ? "\nThis was IMPROVISED: the speaker was given a topic and three points to hit, with no script. Weigh Organization and thinking on their feet, and don't expect polished wording — reward a clear, connected minute made up on the spot."
      : ""
  }
${input.improv ? "Topic and points they were given" : "Prompt the speaker was responding to"}: "${input.prompt}"${
    input.goal ? `\nThe speaker's goal for this delivery: "${input.goal}"` : ""
  }
Recording length: ${Math.round(input.durationSec)}s

Measured delivery metrics:
- Pace: ${input.metrics.paceWpm} words/min (conversational sweet spot is ~110-150)
- Filler words: ${input.metrics.fillerWords}
- Pauses over 1.2s: ${input.metrics.pauses}${
    input.metrics.pauseSpots.length
      ? ` (at ${input.metrics.pauseSpots.slice(0, 6).join(", ")})`
      : ""
  }

Numbered verbatim transcript (annotate by index — do not rewrite):
${numberedSegments(input.segments)}`;

  // Shares the model fallback chain in lib/gemini with every other route:
  // the flagship 3.x models 503 together under load, and without the
  // lighter rungs below them a capacity spike would fail the whole report.
  const parsed = await generateJson<{
    summary: string;
    dimensions: { name: string; score: number; note: string }[];
    tips: string[];
    audienceImpact: string;
    annotations: { index: number; mark: string; note: string }[];
    strengths?: string[];
    drills?: { title: string; how: string }[];
  }>(geminiKey, {
    system: SYSTEM_PROMPT,
    parts: [{ text: userContent }],
    schema: reportSchema(input.premium),
    maxOutputTokens: input.premium ? 14000 : 8000,
  });

  // The overall is COMPUTED from the dimension scores, not invented: take the
  // model's honest per-dimension scores, add the encouragement boost, and
  // average. Keeps the headline consistent with the bars beneath it, and
  // means the number is always defensible from the breakdown.
  const skills = (parsed.dimensions ?? [])
    .filter((d) => VOICE_DIMENSIONS.includes(d.name as (typeof VOICE_DIMENSIONS)[number]))
    .map((d) => ({ skill: d.name, score: boost(d.score), note: d.note }));
  const overall =
    skills.length > 0
      ? Math.round(skills.reduce((sum, s) => sum + s.score, 0) / skills.length)
      : 80;

  // Build the displayed transcript from the REAL segments, folding in only
  // the marks/notes the model returned. The text on screen is always what
  // the speaker actually said — the model can annotate it but never edit it.
  const marks = new Map<number, { mark: "strong" | "flag"; note: string }>();
  for (const a of parsed.annotations ?? []) {
    if (
      (a.mark === "strong" || a.mark === "flag") &&
      a.index >= 0 &&
      a.index < input.segments.length
    ) {
      marks.set(a.index, { mark: a.mark, note: a.note });
    }
  }

  const transcript = input.segments.map((seg, i) => {
    const m = marks.get(i);
    return {
      text: i < input.segments.length - 1 ? `${seg.text} ` : seg.text,
      ...(m ? { mark: m.mark, time: seg.time, note: m.note || undefined } : {}),
    };
  });

  return {
    overall,
    summary: parsed.summary,
    skills,
    tips: parsed.tips,
    audienceImpact: parsed.audienceImpact,
    transcript,
    // Premium-only depth. Guarded so a stray free-tier value never renders.
    ...(input.premium && parsed.strengths?.length ? { strengths: parsed.strengths } : {}),
    ...(input.premium && parsed.drills?.length ? { drills: parsed.drills } : {}),
  };
}

// --- The camera pass (Premium) -----------------------------------------
// Gemini reads evenly-spaced stills from the recording. Frames rather than
// the whole video: a dozen JPEGs cost a fraction of a minute of video and
// are enough to read posture, gesture, gaze and expression — the things
// that actually change how a room receives you.

const STAGE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Two sentences on how they carried themselves, in the coach voice",
    },
    metrics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: [
              "Posture",
              "Eye contact",
              "Hand gestures",
              "Facial expression",
              "Stillness",
              "Pacing & pauses",
            ],
          },
          score: { type: "integer", description: "0-100 on the everyday-speaker scale" },
          note: { type: "string" },
        },
        required: ["metric", "score", "note"],
      },
    },
    tips: {
      type: "array",
      description: "2-3 specific physical adjustments tied to observed moments",
      items: { type: "string" },
    },
  },
  required: ["summary", "metrics", "tips"],
} as const;

const STAGE_SYSTEM = `You are Felix, the fox coach inside Elovox, watching a speaker on video. You are given still frames sampled at even intervals through one practice recording, in order, each labelled with its timestamp — plus the delivery metrics measured from the audio.

Assume an everyday person practising, not a trained performer. Reward natural, grounded presence over theatrical polish, and don't compare them to actors or TED speakers. Score each thing 0-100 on this scale: 95-100 exceptional, 90-94 excellent, 85-89 very good, 80-84 good, 75-79 average, 70-74 developing, below 70 real problems. Don't heavily penalise small, normal movement.

Score six things, honestly:
- Posture: are they grounded and open, or closed, hunched, leaning on something?
- Eye contact: are they addressing the camera/audience, or reading, glancing away, drifting down?
- Hand gestures: purposeful and matched to the words, or absent, repetitive, fidgeting, hidden?
- Facial expression: alive and matched to the content, or flat, tense, over-smiling?
- Stillness: do they sway, rock, pace, shift weight? Compare the frames — position drift between consecutive frames is your evidence.
- Pacing & pauses: read the measured audio metrics together with what the body is doing during the gaps. A pause with a still, open body reads as command; the same pause while looking away reads as lost.

Rules:
- Reference specific frames by their timestamp. "At 0:24 your hands disappear behind your back and don't come out" — never "use more gestures."
- You are looking at stills, so be honest about uncertainty: say "in these frames" rather than inventing continuous motion you can't see. Never claim to have heard tone — you only have the transcript metrics.
- If a frame is dark, cropped, or the speaker is out of shot, say so plainly and score what you can.
- Warm, direct, specific. Banned words: insight, leverage, optimize, utilize, impactful.`;

async function runStage(
  geminiKey: string,
  frames: { time: string; data: string }[],
  metrics: ReturnType<typeof computeMetrics>,
  durationSec: number
): Promise<StageAnalysis> {
  const parsed = await generateJson<{
    summary: string;
    metrics: { metric: string; score: number; note: string }[];
    tips: string[];
  }>(geminiKey, {
    system: STAGE_SYSTEM,
    schema: STAGE_SCHEMA,
    maxOutputTokens: 4000,
    parts: [
      {
        text: `Recording length: ${Math.round(durationSec)}s
Measured from the audio — pace ${metrics.paceWpm} wpm, ${metrics.fillerWords} filler words, ${metrics.pauses} pauses over 1.2s${
          metrics.pauseSpots.length
            ? ` (at ${metrics.pauseSpots.slice(0, 6).join(", ")})`
            : ""
        }.

${frames.length} frames follow, in order.`,
      },
      ...frames.flatMap((f) => [
        { text: `Frame at ${f.time}:` },
        { inlineData: { mimeType: "image/jpeg", data: f.data } },
      ]),
    ],
  });

  // Same encouragement calibration as the voice report: boost each observed
  // metric and compute presence as their mean, so the headline matches the
  // bars and a nervous first-timer isn't greeted with a discouraging number.
  const boosted = parsed.metrics.map((m) => ({ ...m, score: boost(m.score) }));
  const overall =
    boosted.length > 0
      ? Math.round(boosted.reduce((sum, m) => sum + m.score, 0) / boosted.length)
      : 80;
  return { overall, summary: parsed.summary, metrics: boosted, tips: parsed.tips };
}

/** Pulls frame0..frameN out of the form, newest API tolerant of gaps. */
function readFrames(form: FormData): { time: string; data: string }[] {
  const frames: { time: string; data: string }[] = [];
  for (let i = 0; i < MAX_FRAMES; i++) {
    const raw = form.get(`frame${i}`);
    if (typeof raw !== "string" || !raw) continue;
    // "0:12|<base64>" — timestamp travels with the image
    const sep = raw.indexOf("|");
    if (sep === -1) continue;
    const data = raw.slice(sep + 1);
    if (!data || data.length > MAX_FRAME_BYTES) continue;
    frames.push({ time: raw.slice(0, sep), data });
  }
  return frames;
}

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (rateLimited(uid)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const form = await req.formData();
  const audio = form.get("audio");
  const category = (form.get("category") as CategoryId) ?? "general-coaching";
  // Free text from the browser that flows into the model prompt — sanitize
  // (strip HTML/script/control chars) and length-cap before use.
  const prompt = sanitizeText(form.get("prompt")).slice(0, 2000);
  const goal = sanitizeText(form.get("goal")).slice(0, 500);
  const durationSec = Number(form.get("durationSec") ?? 0);

  const assemblyKey = process.env.ASSEMBLYAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Cost guardrails: cap upload size and claimed duration.
  if (
    (audio instanceof Blob && audio.size > MAX_AUDIO_BYTES) ||
    durationSec > MAX_DURATION_SEC
  ) {
    return NextResponse.json({ error: "recording too long" }, { status: 413 });
  }

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "no audio" }, { status: 400 });
  }

  // Keys genuinely not configured (fresh clone / local demo) → labeled
  // sample so the app is explorable. This is the ONLY place we ever return
  // fabricated feedback: when the pipeline is wired up, a real recording
  // always gets real analysis or an honest error — never invented words.
  if (!assemblyKey || !geminiKey) {
    return NextResponse.json(
      generateSampleAnalysis({ category, durationSec, goal })
    );
  }

  // --- Free-tier enforcement (server-side, tamper-proof) ----------------
  // The paid pipeline is metered here so it can't be bypassed from the
  // browser. Free users get the daily challenge only, capped at three
  // attempts a day; Premium is unlimited. The counter is written through
  // the Admin SDK (rules deny every client write to users/{uid}/usage), so
  // the number can't be forged. Without a service account (local build) we
  // skip the count but still keep the non-daily lock.
  const isDaily = form.get("daily") === "1";
  const clientDate = String(form.get("date") ?? "");
  const db = getAdminDb();

  // Entitlement is resolved once and reused for both the free-tier gate and
  // the camera pass below, so we never make the same lookup twice.
  const premium = uid === "local-dev" ? true : await isPremiumServer(req, uid);

  let reservation: { date: string } | null = null;
  if (!premium) {
    if (!isDaily) {
      return NextResponse.json(
        {
          error: "premium-required",
          message:
            "Free practice is the daily challenge. Go Premium for the speech library, your own material, interview practice and camera coaching.",
        },
        { status: 403 }
      );
    }
    if (db) {
      const date = usageDateKey(clientDate);
      const { ok } = await reserveFreeDailyAttempt(db, uid, date);
      if (!ok) {
        return NextResponse.json(
          {
            error: "daily-limit",
            message: `That's all ${MAX_FREE_DAILY_ATTEMPTS} of today's attempts. Come back tomorrow for a new challenge — or go Premium for unlimited practice.`,
          },
          { status: 429 }
        );
      }
      reservation = { date };
    } else {
      console.warn(
        "free-tier daily cap not enforced: FIREBASE_SERVICE_ACCOUNT unset"
      );
    }
  }

  try {
    const { words } = await transcribe(await audio.arrayBuffer(), assemblyKey);
    if (words.length === 0) {
      // Nothing usable — this take didn't cost us the pipeline, so hand the
      // reserved attempt back before telling the user plainly.
      if (reservation && db) await refundFreeDailyAttempt(db, uid, reservation.date);
      // Never dress this up as a scored report.
      return NextResponse.json(
        {
          error: "no-speech",
          message:
            "Felix couldn't make out any speech in that recording. Check your microphone and try again, speaking a little louder.",
        },
        { status: 422 }
      );
    }
    const metrics = computeMetrics(words, durationSec);
    const segments = buildSegments(words);

    // The camera pass is Premium and costs a second vision call, so the
    // plan is verified server-side. A free user who sends frames simply
    // gets the voice report — no error, nothing to work around client-side.
    const frames = readFrames(form);
    const wantsStage = frames.length > 0 && premium;

    const [report, stage] = await Promise.all([
      runGemini(geminiKey, {
        category,
        prompt,
        goal,
        durationSec,
        segments,
        metrics,
        premium,
        improv: isDaily,
      }),
      wantsStage
        ? runStage(geminiKey, frames, metrics, durationSec).catch((err) => {
            // A failed camera pass must never cost the user their voice report.
            console.error("stage analysis failed:", err);
            return undefined;
          })
        : Promise.resolve(undefined),
    ]);

    const analysis: Analysis = {
      isSample: false,
      ...report,
      ...(stage ? { stage } : {}),
      paceWpm: metrics.paceWpm,
      fillerWords: metrics.fillerWords,
      pauses: metrics.pauses,
    };
    return NextResponse.json(analysis);
  } catch (err) {
    // The pipeline failed (transcription or the model chain). We will NOT
    // invent a score and a transcript for a real recording — that is the
    // one thing this app must never do. Fail honestly, and give back the
    // attempt so a busy coaching service never costs the user one of their
    // three; the client keeps the session recoverable and lets them retry.
    if (reservation && db) await refundFreeDailyAttempt(db, uid, reservation.date);
    console.error("analyze pipeline failed:", err);
    return NextResponse.json(
      {
        error: "analysis-failed",
        message:
          "Felix couldn't finish analysing that one — the coaching service is busy. Your recording is safe; give it another go in a moment.",
      },
      { status: 503 }
    );
  }
}
