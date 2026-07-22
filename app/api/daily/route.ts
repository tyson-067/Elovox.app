import { NextRequest, NextResponse } from "next/server";
import { generateJson, geminiKey } from "@/lib/gemini";
import { makeRateLimiter, clientIp } from "@/lib/verify";

// Writes the improv challenge of the day. Called once per day by whichever
// client opens the app first; that client publishes the result to Firestore
// so everybody else reads the shared copy. Nobody has to press anything.
//
// The challenge is a topic plus three talking points — NOT a script to read.
// The speaker improvises about a minute off the cuff, hitting the three
// points in their own words. That trains the thing reading a speech aloud
// can't: thinking on your feet, organising thoughts, and cutting filler.
//
// Variety without memory: the theme, audience, and register are picked
// from the date itself using coprime strides through each list, so
// consecutive days never repeat a combination and the cycle is long.

export const runtime = "nodejs";
export const maxDuration = 60;

export interface DailyChallenge {
  date: string;
  title: string;
  topic: string; // the subject to speak about, in one phrase
  bullets: string[]; // exactly three angles to hit while improvising
  scenario: string;
  theme: string;
  focus: string;
  /**
   * False when this came from the canned bank because generation failed.
   * The client uses it to avoid caching or publishing a fallback as the
   * day's challenge — otherwise one request during a Gemini outage would
   * pin canned content for that device (and every other user, via the
   * shared doc) for the rest of the day.
   */
  generated: boolean;
}

const THEMES = [
  "Persuasion",
  "Gratitude",
  "Bad news, told well",
  "Selling an idea",
  "Telling a story",
  "Rallying a team",
  "Standing your ground",
  "Explaining something hard",
  "Making a case for change",
  "Celebrating someone",
  "Admitting a mistake",
  "Asking for something big",
];

const AUDIENCES = [
  "a room of colleagues who are skeptical",
  "a small team who just had a rough week",
  "a panel of strangers deciding your future",
  "a hall of people who came to be inspired",
  "one person who can say yes",
  "a crowd that isn't listening yet",
  "friends and family at a celebration",
];

const FOCUSES = [
  "the pause before your most important sentence",
  "keeping energy in the final ten seconds",
  "warmth — do they believe you like them?",
  "conviction on the single hardest claim",
  "pace: resisting the urge to speed up when nervous",
  "emphasis on the words that carry the argument",
  "sounding certain without sounding rehearsed",
];

/** Stable integer from a date string, so the same day always seeds alike. */
function seedFrom(date: string): number {
  let h = 0;
  for (let i = 0; i < date.length; i++) {
    h = (h * 31 + date.charCodeAt(i)) >>> 0;
  }
  return h;
}

const SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Short evocative title for today's topic, 2-4 words, like 'The Last Ask'",
    },
    topic: {
      type: "string",
      description:
        "The subject to speak about, one clear phrase an everyday person can have a take on without research, e.g. 'Why your city should keep libraries open late'",
    },
    scenario: {
      type: "string",
      description:
        "One second-person sentence putting the speaker in the moment: who they are talking to and what is at stake",
    },
    bullets: {
      type: "array",
      description:
        "EXACTLY three short talking points to hit while improvising — angles or prompts, NOT sentences to read aloud. Each is a few words to a short phrase, distinct from the others, giving the speaker something to say.",
      items: { type: "string" },
    },
    focus: {
      type: "string",
      description: "One short line naming what to concentrate on in delivery today",
    },
  },
  required: ["title", "topic", "scenario", "bullets", "focus"],
} as const;

const SYSTEM = `You are Felix, the fox coach inside Elovox, writing today's IMPROV challenge. Every user gets the same topic and the same three talking points, and speaks for about a minute off the cuff — in their own words, with no script. Three attempts, trying to beat their own score.

The whole point is to train what reading a speech aloud cannot: thinking on your feet, organising thoughts in real time, and cutting filler. So you are NOT writing a speech — you are setting up a prompt they improvise around.

What makes a good one:
- A topic an everyday person can have an opinion on immediately, with no research or expertise. Relatable, a little provocative, easy to feel something about.
- Exactly three bullet points: distinct angles or prompts to hit, a few words each — NOT full sentences to read. They are scaffolding for improvisation, not a script. Think "a time it went wrong", "who it really costs", "what you'd change" — openers that pull a real answer out of the speaker.
- Improvisable in about sixty seconds by someone speaking naturally.
- Concrete and human, never generic corporate filler.
- Self-contained: no references to slides, the app, or previous days.
- Banned words: insight, leverage, optimize, utilize, impactful, journey, passionate.

The scenario line is second person and puts them in the room ("You have sixty seconds to convince the room..."). The focus line is one specific delivery thing to watch, in the coach's voice.`;

// Used before GEMINI_API_KEY is set, and if generation fails. Deterministic
// by date so the day still has *a* challenge and everyone sees the same one.
const FALLBACK: Omit<DailyChallenge, "date" | "generated">[] = [
  {
    title: "One Rule To Keep",
    theme: "Making a case for change",
    topic: "The one rule at your school or workplace you'd never change",
    focus: "Say why it matters before you say what it is. Land the reason.",
    scenario:
      "You have sixty seconds to convince a room that this one rule is worth keeping.",
    bullets: [
      "The rule, in one plain sentence",
      "A moment it clearly did its job",
      "What breaks the day it's gone",
    ],
  },
  {
    title: "Worth The Money",
    theme: "Selling an idea",
    topic: "A cheap thing you own that you'd tell anyone to buy",
    focus: "Sound like you actually mean it — conviction over a sales voice.",
    scenario:
      "A friend says they're not spending the money. You have a minute to change their mind.",
    bullets: [
      "What it is and what it cost",
      "The exact moment it earned its keep",
      "Who you'd hand one to tomorrow",
    ],
  },
  {
    title: "The Overrated One",
    theme: "Standing your ground",
    topic: "Something everyone loves that you think is overrated",
    focus: "Hold your ground warmly — disagree without getting defensive.",
    scenario:
      "The whole room disagrees with you, and they're waiting. Make your case anyway.",
    bullets: [
      "The popular thing, and the take",
      "Why the hype doesn't hold up",
      "What deserves the love instead",
    ],
  },
  {
    title: "Two More Hours",
    theme: "Persuasion",
    topic: "One thing your town should spend a little more money on",
    focus: "Slow down on any numbers. Let them do the work.",
    scenario:
      "Two minutes at a town meeting, in front of people who've heard a hundred requests this year.",
    bullets: [
      "Who it's really for",
      "What it costs — kept concrete",
      "The cost of doing nothing",
    ],
  },
  {
    title: "The Best Advice",
    theme: "Telling a story",
    topic: "The best piece of advice you were ever given",
    focus: "Let the pause land before the advice itself.",
    scenario:
      "A younger version of you is in the room. You get one minute that matters.",
    bullets: [
      "Who said it, and when",
      "Why you almost ignored it",
      "What changed once you didn't",
    ],
  },
  {
    title: "Fix This One Thing",
    theme: "Making a case for change",
    topic: "One everyday thing that's needlessly annoying — and how you'd fix it",
    focus: "Keep the energy up through the final line — don't fade out.",
    scenario:
      "You've got the ear of the person who could actually change it. Go.",
    bullets: [
      "The annoyance, made vivid",
      "Why it's been left broken",
      "Your fix, in one clear move",
    ],
  },
  {
    title: "Say Thank You",
    theme: "Gratitude",
    topic: "Someone who helped you that you never properly thanked",
    focus: "Warmth. Do they believe you actually mean it?",
    scenario:
      "That person is finally in front of you. Sixty seconds to say the thing.",
    bullets: [
      "Who they are to you",
      "The specific thing they did",
      "What it would've cost you without them",
    ],
  },
];

// Per-instance memo, so a burst of first-of-the-day clients doesn't fan
// out into a burst of generations on the same warm instance.
const memo = new Map<string, DailyChallenge>();

// This route is public (no auth token), so it's limited per-IP to stop one
// caller from forcing generations across many distinct dates.
const rateLimited = makeRateLimiter(30, 60 * 1000);

function fallbackFor(date: string): DailyChallenge {
  const pick = FALLBACK[seedFrom(date) % FALLBACK.length];
  return { date, ...pick, generated: false };
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }

  // Cached days are cheap; only rate-limit requests that could cause work.
  const cached = memo.get(date);
  if (cached) return NextResponse.json(cached);

  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const key = geminiKey();
  if (!key) {
    // No key configured: the bank is the permanent answer, so memo it.
    const challenge = fallbackFor(date);
    memo.set(date, challenge);
    return NextResponse.json(challenge);
  }

  // Coprime strides so theme/audience/focus advance at different rates and
  // the same trio doesn't recur for hundreds of days.
  const seed = seedFrom(date);
  const theme = THEMES[seed % THEMES.length];
  const audience = AUDIENCES[(seed * 3) % AUDIENCES.length];
  const focusHint = FOCUSES[(seed * 5) % FOCUSES.length];

  try {
    const result = await generateJson<
      Omit<DailyChallenge, "date" | "theme" | "generated">
    >(key, {
      system: SYSTEM,
      temperature: 1.15, // this is creative writing; sameness is the failure mode
      parts: [
        {
          text: `Today's date: ${date}
Theme: ${theme}
Speaking to: ${audience}
Delivery focus to build the speech around: ${focusHint}

Write today's one-minute speech.`,
        },
      ],
      schema: SCHEMA,
    });

    const challenge: DailyChallenge = { date, theme, ...result, generated: true };
    memo.set(date, challenge);
    return NextResponse.json(challenge);
  } catch (err) {
    // Deliberately not memoized: the next request should retry generation
    // rather than serve the bank for the rest of the day.
    console.error("daily challenge generation failed:", err);
    return NextResponse.json(fallbackFor(date));
  }
}
