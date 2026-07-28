import { NextRequest, NextResponse } from "next/server";
import { generateJson, geminiKey } from "@/lib/gemini";
import { verifyVerifiedUser, makeRateLimiter, isPremiumServer } from "@/lib/verify";
import { sanitizeText } from "@/lib/validation";

// Premium speech writing. Two jobs, one route:
//
//   kind: "regenerate" , you finished a library speech and improved on it,
//                         so replace it with a new one on a similar topic
//                         (drill the same muscle) or a different one.
//   kind: "custom"     , Felix writes a speech to order, from what the
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
- One clear emotional arc, a turn, a build, or a reveal, so there is something to perform. A flat list of facts is a bad speech.
- At least one line that only works if the speaker pauses before it, and one that needs real conviction.
- Concrete and specific. Invent details, names, numbers, places. Never generic corporate filler.
- Self-contained. No references to slides, the app, or anything off-screen.
- Banned words: insight, leverage, optimize, utilize, impactful, journey, passionate.
- Never use em dashes or en dashes. Use a comma, a full stop, or a colon instead. This applies to every field you return.

The scenario line is second person and puts them in the room ("You have ninety seconds before the vote..."). Hit the requested word count closely, it is calibrated to a target speaking time.`;

// --- Interview question bank -------------------------------------------
// The static banks in lib/interviews.ts cover the general case well, but the
// interview someone is actually walking into has specific questions in it:
// the gap in the resume, the reason they left, the thing about THIS company.
// This writes that bank from a description of their situation.

const INTERVIEW_QUESTION_COUNT = 8;

const INTERVIEW_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: `Exactly ${INTERVIEW_QUESTION_COUNT} interview questions, each a single question asked out loud by an interviewer`,
      items: { type: "string" },
    },
  },
  required: ["questions"],
} as const;

const INTERVIEW_SYSTEM = `You are Felix, the fox coach inside Elovox. You write interview question banks for someone about to be interviewed, so they can practise answering out loud and be scored on the delivery.

You are given their situation in their own words. Write the questions THAT panel would actually ask THIS person.

What makes a good bank:
- Specific to what they told you. If they mention a career gap, a career change, a weak grade, a competitor, a particular company or programme, ask about it directly. That specific question is the whole reason they're here.
- Ask the way real interviewers ask: plain spoken language, one question at a time, occasionally blunt. "Why did you leave after seven months?" not "Please describe your reasons for departing your previous position."
- Include the follow-ups people fumble, not just the openers. At least two should be genuinely uncomfortable to answer.
- Range across the interview: an opener, competence, motivation, a weakness or risk, something about them as a person, and a closer.
- Each question stands alone and is answerable out loud in one to three minutes, with no reference to a document, a slide, or a previous question in the list.
- Never invent facts about them beyond what they told you. Where you need a detail, ask about it rather than asserting it.
- Banned words: insight, leverage, optimize, utilize, impactful, journey, passionate.
- Never use em dashes or en dashes. Use a comma, a full stop, or a colon instead.

Return questions only. No preamble, no numbering, no commentary.`;

function wordTarget(seconds: number): string {
  // ~140 wpm read-aloud pace, the middle of the conversational range.
  const words = Math.round((seconds / 60) * 140);
  return `${Math.round(words * 0.92)}-${Math.round(words * 1.08)} words`;
}

export async function POST(req: NextRequest) {
  const uid = await verifyVerifiedUser(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (uid === "unverified") {
    return NextResponse.json({ error: "verify your email first" }, { status: 403 });
  }
  if (rateLimited(uid)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  // Both /library (regenerate) and /custom are Premium features, and both
  // gate on usePlan(), in the browser, which protects nobody. An ordinary
  // verified free account could POST here directly and get unlimited Gemini
  // speech-writing, the same bypass /api/analyze already closes at its own
  // isPremiumServer call. Entitlement has to be checked where the money is
  // spent, not where the button is drawn.
  //
  // 403 with the same "premium-required" code /api/analyze returns, so the
  // client can treat both the same way.
  const premium = uid === "local-dev" ? true : await isPremiumServer(req, uid);
  if (!premium) {
    return NextResponse.json(
      {
        error: "premium-required",
        message:
          "Felix writes speeches for Premium members. Go Premium for the speech library, your own material, interview practice and camera coaching.",
      },
      { status: 403 }
    );
  }

  const key = geminiKey();
  if (!key) {
    return NextResponse.json(
      { error: "speech generation is not configured yet" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const kind =
    body.kind === "custom" || body.kind === "interview" ? body.kind : "regenerate";
  // 300s ceiling, matching the longest option on /custom. A five-minute
  // speech is ~700 words, comfortably inside the 8000-token default output
  // budget in lib/gemini.ts, so nothing else has to move for it.
  const durationSec = Math.min(300, Math.max(20, Number(body.durationSec) || 30));

  // Interview questions are a different shape entirely (a list, not a
  // speech), so this branch returns early rather than threading a union
  // through the speech path below.
  if (kind === "interview") {
    // Free text from the user: sanitized (HTML/script/control chars stripped),
    // length-capped, and quoted as data rather than interpolated as prose.
    const situation = sanitizeText(body.situation).slice(0, 600);
    if (!situation.trim()) {
      return NextResponse.json(
        { error: "tell Felix what you're interviewing for" },
        { status: 400 }
      );
    }
    const panel = sanitizeText(body.panel).slice(0, 120);

    try {
      const result = await generateJson<{ questions: string[] }>(key, {
        system: INTERVIEW_SYSTEM,
        temperature: 1.05,
        parts: [
          {
            text: `Write a question bank for this person's actual interview.

Their situation, in their words:
"""
${situation}
"""
${panel ? `The kind of panel they picked: ${panel}\n` : ""}
Return exactly ${INTERVIEW_QUESTION_COUNT} questions.`,
          },
        ],
        schema: INTERVIEW_SCHEMA,
      });

      // Never hand back an empty or malformed bank: the practice screen would
      // show a blank prompt and the user would record against nothing.
      const questions = (result.questions ?? [])
        .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
        .map((q) => sanitizeText(q).slice(0, 400))
        .filter(Boolean)
        .slice(0, INTERVIEW_QUESTION_COUNT);

      if (questions.length === 0) {
        return NextResponse.json(
          { error: "Felix couldn't write those. Try describing the role again." },
          { status: 502 }
        );
      }
      return NextResponse.json({ questions });
    } catch (err) {
      console.error("interview question generation failed:", err);
      return NextResponse.json(
        { error: "Felix couldn't write those. Try again in a moment." },
        { status: 502 }
      );
    }
  }

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

Write it as the speech they would actually give, in their situation, not a template with blanks. Where you need specifics they didn't give you, invent plausible ones.`;
  } else {
    const previousTopic = sanitizeText(body.previousTopic).slice(0, 120);
    const previousTitle = sanitizeText(body.previousTitle).slice(0, 120);
    const relation = body.relation === "different" ? "different" : "similar";

    instruction =
      relation === "similar"
        ? `The speaker just finished practicing "${previousTitle}" (topic: ${previousTopic}) and improved on it. Write them a NEW speech on a similar topic so they keep drilling the same muscle, same emotional territory and demands, completely different situation, characters, and words. It must not echo the original's lines.

Length: ${wordTarget(durationSec)} (about ${durationSec} seconds read aloud).`
        : `The speaker just finished practicing "${previousTitle}" (topic: ${previousTopic}) and wants something different. Write them a NEW speech in a clearly different emotional register and situation, if the last one was rousing, try intimate or grave; if it was an ask, try a thank-you or a hard truth. Avoid the topic "${previousTopic}" entirely.

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
