import { NextRequest, NextResponse } from "next/server";
import { generateJson, geminiKey } from "@/lib/gemini";
import {
  verifyVerifiedUser,
  isPremiumServer,
  enforceAppCheck,
  logRejectedInput,
  clientIp,
} from "@/lib/verify";
import { limitOr429 } from "@/lib/rateLimit";
import { sanitizeText } from "@/lib/validation";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { isRestricted } from "@/lib/moderation";
import { usageDateKey, reserveMeteredUse } from "@/lib/quota";
import { readJsonObject } from "@/lib/requestBody";

// Durable per-user DAILY ceiling on Gemini speech generation, on the same
// Admin-SDK-only usage doc as the analysis meter. This is a second, longer
// window than the hourly limit in lib/rateLimit.ts, not a replacement for it:
// the hourly one stops a burst, this one stops a patient script spreading the
// same volume across a day. Set well above any honest day. No refund path: a
// failed generation costs little.
const SPEECH_GENS_PER_DAY = 100;

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

const INTERVIEW_SYSTEM = `You are Felix, the fox coach inside Elovox. You write interview question banks for someone about to be interviewed, so they can practice answering out loud and be scored on the delivery.

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

/**
 * One budget for the whole handler, anchored to the top of the request.
 *
 * Without it, lib/gemini.ts walks its fallback chain on a 45s-per-attempt
 * timeout — up to four models, a 180s worst case against this route's 60s
 * `maxDuration`. The platform killed the function during the second attempt,
 * so the client got a raw 504 instead of the graceful 502, and the fallback
 * chain was unreachable precisely when a hung first model made it necessary.
 * 8s of headroom leaves room to answer.
 */
function speechDeadline(startedAt: number): number {
  return startedAt + (maxDuration - 8) * 1000;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const uid = await verifyVerifiedUser(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (uid === "unverified") {
    return NextResponse.json({ error: "verify your email first" }, { status: 403 });
  }
  // The hourly ceiling. This is the route that got spiked, and the hole it
  // went through was that this check used to be a per-instance Map: the real
  // limit was (instances x 30), reset on every cold start. See the header note
  // in lib/rateLimit.ts. Fails CLOSED — a paid Gemini generation is not
  // something to hand out when we can't prove the caller is under their limit.
  const db = getAdminDb();
  const capped = await limitOr429(db, {
    scope: "speech",
    key: uid,
    message: "Felix needs a breather. Try again shortly.",
  });
  if (capped) return capped;

  // Also per-IP. The per-user limit is the one that matters for a compromised
  // account, but the spike that prompted all this came from one person, and
  // one person can hold several accounts. This bounds the source as well as
  // the account, at a ceiling a shared network of honest users won't reach.
  const ipCapped = await limitOr429(db, {
    scope: "speech-ip",
    key: clientIp(req),
    message: "Felix needs a breather. Try again shortly.",
  });
  if (ipCapped) return ipCapped;

  // Same App Check attestation gate as /api/analyze: a valid ID token alone
  // must not let a script drive paid Gemini speech-writing from curl.
  // Soft-fails (logs, never rejects) until APPCHECK_ENFORCE=true; see
  // lib/verify.ts.
  const appCheckReject = await enforceAppCheck(req, "speech");
  if (appCheckReject) return appCheckReject;

  // Same moderation gate as /api/analyze (lib/moderation.ts). A suspended or
  // banned account doesn't get paid Gemini generation either — a strike that
  // only closed one of the two expensive doors wouldn't be a suspension.
  // Fail-OPEN, so a Firestore blip never locks out honest subscribers.
  const restriction = await isRestricted(getAdminDb(), uid);
  if (restriction.blocked) {
    return NextResponse.json(
      {
        error: "account-restricted",
        message:
          restriction.state === "suspended"
            ? `Your account is suspended until ${new Date(restriction.until).toLocaleDateString()} for a Terms violation. Think that's wrong? Contact support.`
            : "This account has been closed for Terms violations. Contact support if you think this is a mistake.",
      },
      { status: 403 }
    );
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
  const entitlement =
    uid === "local-dev" ? "premium" : await isPremiumServer(req, uid);
  // Same distinction /api/analyze draws: a plan read that failed is not a
  // free account, and must not be answered with the upgrade pitch.
  if (entitlement === "unknown") {
    return NextResponse.json(
      {
        error: "entitlement-unavailable",
        message:
          "Couldn't check your subscription just now. Try again in a moment.",
      },
      { status: 503 }
    );
  }
  if (entitlement !== "premium") {
    return NextResponse.json(
      {
        error: "premium-required",
        message:
          "Felix writes speeches for Premium members. Go Premium for the speech library, your own material, interview practice, social skills and camera coaching.",
      },
      { status: 403 }
    );
  }

  // Durable daily ceiling: the in-memory limiter above is per-instance, this
  // is the abuse backstop that survives cold starts and concurrency.
  //
  // Charged as LATE as possible — immediately before the model call — rather
  // than up here. It used to run before the API-key check and before the
  // empty-field checks, so submitting a blank brief a hundred times locked a
  // user out for the day having generated nothing, and a deployment with no
  // GEMINI_API_KEY burned a unit on every 503. There is deliberately no
  // refund path (see the note on SPEECH_GENS_PER_DAY), which is only honest
  // if a charge really does imply a generation attempt.
  const meteredUid = uid;
  async function chargeGeneration(): Promise<NextResponse | null> {
    // Fail closed in production: without the Admin SDK the durable speech meter
    // can't be enforced, and this route has no refund path, so running
    // unmetered would be unbounded paid Gemini spend on a misconfigured deploy.
    // (local dev has no API key and returns the sample before ever reaching
    // here, so this only bites a broken production service account.)
    if (!db) {
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          {
            error: "unavailable",
            message: "Couldn't reach the server just now. Try again in a moment.",
          },
          { status: 503 }
        );
      }
      return null;
    }
    if (meteredUid === "local-dev") return null;
    const { ok } = await reserveMeteredUse(
      db,
      meteredUid,
      usageDateKey(""),
      "speechGens",
      SPEECH_GENS_PER_DAY
    );
    if (ok) return null;
    return NextResponse.json(
      {
        error: "rate-limited",
        message:
          "That's a lot of new speeches for one day. Come back tomorrow for more.",
      },
      { status: 429 }
    );
  }

  const key = geminiKey();
  if (!key) {
    return NextResponse.json(
      { error: "speech generation is not configured yet" },
      { status: 503 }
    );
  }

  // Size-capped and shape-checked in one place. An unusable body falls back to
  // the graceful "regenerate" default rather than a 500, exactly as before.
  const parsedBody = await readJsonObject(req);
  const body: Record<string, unknown> = parsedBody.ok ? parsedBody.body : {};
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
      logRejectedInput("speech", "missing-situation");
      return NextResponse.json(
        { error: "tell Felix what you're interviewing for" },
        { status: 400 }
      );
    }
    const panel = sanitizeText(body.panel).slice(0, 120);

    const overLimit = await chargeGeneration();
    if (overLimit) return overLimit;

    try {
      const result = await generateJson<{ questions: string[] }>(key, {
        system: INTERVIEW_SYSTEM,
        temperature: 1.05,
        deadline: speechDeadline(startedAt),
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
      logRejectedInput("speech", "missing-need");
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

  const overLimit = await chargeGeneration();
  if (overLimit) return overLimit;

  try {
    const result = await generateJson<Omit<GeneratedSpeech, "id">>(key, {
      system: SYSTEM,
      temperature: 1.15, // creative writing; sameness is the failure mode
      parts: [{ text: instruction }],
      schema: SCHEMA,
      deadline: speechDeadline(startedAt),
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
