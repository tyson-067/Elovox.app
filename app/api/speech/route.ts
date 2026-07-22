import { NextRequest, NextResponse } from "next/server";
import { generateJson, geminiKey } from "@/lib/gemini";
import { verifyUser, makeRateLimiter } from "@/lib/verify";
import { sanitizeText } from "@/lib/validation";

// Premium speech writing. Two jobs, one route:
//
//   kind: "regenerate"  — you finished a library speech and improved on it,
//                         so replace it with a new one on a similar topic
//                         (drill the same muscle) or a different one.
//   kind: "custom"      — Felix writes a speech to order, from what the
//                         user says they actually need to be ready for.
//
// Both return the same shape as a library speech, so the practice screen
// doesn't care where the script came from.

export const runtime = "nodejs";
export const maxDuration = 60;

const rateLimited = makeRateLimiter(30); // per user per hour

export interface GeneratedSpeech {
  id: string;
  title: string;
  scenario: string;
  text: string;
  topic: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short evocative title, 2-4 words" },
    scenario: {
      type: "string",
      description:
        "One second-person sentence putting the speaker in the moment, with the stakes",
    },
    text: { type: "string", description: "The speech itself, to be read aloud" },
    topic: {
      type: "string",
      description: "Two-to-four word topic tag, e.g. 'Rallying a team'",
    },
  },
  required: ["title", "scenario", "text", "topic"],
} as const;

const SYSTEM = `You are Felix, the fox coach inside Elovox, writing practice speeches for someone to read aloud and be scored on.

What makes a good one:
- Written for the mouth, not the page: short sentences, plain words, real rhythm. It should feel good to say.
- One clear emotional arc — a turn, a build, or a reveal — so there is something to perform. A flat list of facts is a bad speech.
- At least one line that only works if the speaker pauses before it, and one that needs real conviction.
- Concrete and specific. Invent details — names, numbers, places. Never generic corporate filler.
- Self-contained. No references to slides, the app, or anything off-screen.
- Banned words: insight, leverage, optimize, utilize, impactful, journey, passionate.

The scenario line is second person and puts them in the room ("You have ninety seconds before the vote..."). Hit the requested word count closely — it is calibrated to a target speaking time.`;

function wordTarget(seconds: number): string {
  // ~140 wpm read-aloud pace, the middle of the conversational range.
  const words = Math.round((seconds / 60) * 140);
  return `${Math.round(words * 0.92)}-${Math.round(words * 1.08)} words`;
}

export async function POST(req: NextRequest) {
  const uid = await verifyUser(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited(uid)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const key = geminiKey();
  if (!key) {
    return NextResponse.json(
      { error: "speech generation is not configured yet" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "custom" ? "custom" : "regenerate";
  const durationSec = Math.min(180, Math.max(20, Number(body.durationSec) || 30));

  let instruction: string;

  if (kind === "custom") {
    // Felix writes to order. The brief is free text from the user, so every
    // field is sanitized (HTML/script/control chars stripped), length-capped,
    // and quoted as data rather than interpolated as prose.
    const need = sanitizeText(body.need).slice(0, 600);
    if (!need.trim()) {
      return NextResponse.json({ error: "tell Felix what you need" }, { status: 400 });
    }
    const audience = sanitizeText(body.audience).slice(0, 200);
    const occasion = sanitizeText(body.occasion).slice(0, 200);
    const tone = sanitizeText(body.tone).slice(0, 100);

    instruction = `Write a bespoke practice speech for this user.

What they need it for (their words):
"""
${need}
"""
${audience ? `Audience: ${audience}\n` : ""}${occasion ? `Occasion: ${occasion}\n` : ""}${tone ? `Tone they want: ${tone}\n` : ""}
Length: ${wordTarget(durationSec)} (about ${durationSec} seconds read aloud).

Write it as the speech they would actually give, in their situation — not a template with blanks. Where you need specifics they didn't give you, invent plausible ones.`;
  } else {
    const previousTopic = sanitizeText(body.previousTopic).slice(0, 120);
    const previousTitle = sanitizeText(body.previousTitle).slice(0, 120);
    const relation = body.relation === "different" ? "different" : "similar";

    instruction =
      relation === "similar"
        ? `The speaker just finished practicing "${previousTitle}" (topic: ${previousTopic}) and improved on it. Write them a NEW speech on a similar topic so they keep drilling the same muscle — same emotional territory and demands, completely different situation, characters, and words. It must not echo the original's lines.

Length: ${wordTarget(durationSec)} (about ${durationSec} seconds read aloud).`
        : `The speaker just finished practicing "${previousTitle}" (topic: ${previousTopic}) and wants something different. Write them a NEW speech in a clearly different emotional register and situation — if the last one was rousing, try intimate or grave; if it was an ask, try a thank-you or a hard truth. Avoid the topic "${previousTopic}" entirely.

Length: ${wordTarget(durationSec)} (about ${durationSec} seconds read aloud).`;
  }

  try {
    const result = await generateJson<Omit<GeneratedSpeech, "id">>(key, {
      system: SYSTEM,
      temperature: 1.15, // creative writing; sameness is the failure mode
      parts: [{ text: instruction }],
      schema: SCHEMA,
    });

    const speech: GeneratedSpeech = {
      id: `gen-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      ...result,
    };
    return NextResponse.json(speech);
  } catch (err) {
    console.error("speech generation failed:", err);
    return NextResponse.json(
      { error: "Felix couldn't write that one. Try again in a moment." },
      { status: 502 }
    );
  }
}
