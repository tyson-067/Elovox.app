import type { Analysis, CategoryId } from "./types";
import { MIDDLING_MIN } from "./scoring";

// Sample-feedback generator. Used as the fallback whenever the real analysis
// pipeline (/api/analyze: AssemblyAI + Gemini) is unreachable or not yet
// configured. Results are marked isSample so the UI can label them honestly.
// (This said "Claude" for a long time. The analyzer has always been Gemini;
// the Anthropic name appears nowhere in the code.)

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// The six delivery dimensions Felix scores from the audio, mirrors
// VOICE_DIMENSIONS in the analyze route.
const SKILLS = [
  "Clarity",
  "Confidence",
  "Pacing",
  "Vocal variety",
  "Organization",
  "Audience engagement",
];

const SKILL_NOTES: Record<string, [string, string]> = {
  Clarity: [
    "Easy to follow start to finish, the point never got lost.",
    "A couple of thoughts ran together; a breath between them would sharpen it.",
  ],
  Confidence: [
    "Steady voice, no apologizing for being in the room. It carried.",
    "You trailed off at the ends of sentences, finish each one like you mean it.",
  ],
  Pacing: [
    "Nice rhythm, you gave the important lines room to land.",
    "The pace rushed when it mattered most. Slow down at the important part.",
  ],
  "Vocal variety": [
    "Real colour in your voice, the energy moved with the words.",
    "It flattened out in the middle. Lean on the words that carry the point.",
  ],
  Organization: [
    "Clear shape, a beginning, a turn, and a landing.",
    "The middle wandered a little; one clear order would carry more.",
  ],
  "Audience engagement": [
    "You sounded like you were talking to people, not at them.",
    "The ending lost energy, and the ending is where people decide. Land it.",
  ],
};

const OPENERS: Record<CategoryId, string> = {
  "job-interview":
    "So, when that happened, I realized I had to make a decision about how to handle it, and I think the way I approached it says a lot about how I work.",
  "sales-pitch":
    "Most teams are losing hours every week to this problem without realizing it, and that's exactly the gap we built this to close.",
  "prepared-speech":
    "I want to start with a moment that changed how I think about this, because it's the reason I'm standing here at all.",
  "toast-tribute":
    "I've known them long enough to have a lot of stories, and I promise I've picked the one that makes them look best.",
  "general-coaching":
    "Let me walk you through this from the beginning, because the context really matters for what I'm about to say.",
};

export function generateSampleAnalysis(opts: {
  category: CategoryId;
  durationSec: number;
  goal?: string;
}): Analysis {
  const rand = seededRandom(Math.floor(opts.durationSec * 1000) + Date.now());

  const skills = SKILLS.map((skill) => {
    // Kept in step with the real pipeline, which now spreads scores across
    // three tiers rather than bunching them (GOOD_MIN / MIDDLING_MIN in
    // lib/scoring.ts, and the bands written out for the model in
    // app/api/analyze/route.ts). This spans the middling tier and dips into
    // the top of bad, which is what an unremarkable practice attempt should
    // look like. It only renders when the API keys are unset and it is
    // labeled a sample, but a sample that scores well above the real thing
    // teaches the wrong expectation to anyone setting the project up for the
    // first time.
    const score = Math.round(58 + rand() * 26);
    const [good, bad] = SKILL_NOTES[skill];
    return { skill, score, note: score >= MIDDLING_MIN ? good : bad };
  });
  const overall = Math.round(
    skills.reduce((sum, s) => sum + s.score, 0) / skills.length
  );

  const weakest = [...skills].sort((a, b) => a.score - b.score)[0];
  const strongest = [...skills].sort((a, b) => b.score - a.score)[0];

  const flagTime = `0:${String(Math.floor(8 + rand() * 40)).padStart(2, "0")}`;
  const strongTime = `0:${String(Math.floor(8 + rand() * 40)).padStart(2, "0")}`;

  const goalClause = opts.goal
    ? ` Against your goal, "${opts.goal.toLowerCase()}", ${
        overall >= MIDDLING_MIN ? "you're most of the way there" : "the gap is in the delivery, not the words"
      }.`
    : "";

  return {
    isSample: true,
    overall,
    summary:
      (overall >= MIDDLING_MIN
        ? `Solid run. ${strongest.skill} carried this one, now tighten up ${weakest.skill.toLowerCase()}.`
        : `A real starting point. The content is there; the delivery work is in ${weakest.skill.toLowerCase()}.`) +
      goalClause,
    skills,
    transcript: [
      { text: OPENERS[opts.category] + " " },
      {
        text: "What I did first was take a step back and really look at what we were dealing with",
        mark: "strong",
        time: strongTime,
        note: "This is your best stretch, concrete, unhurried, and it sounds like you mean it.",
      },
      {
        text: ", because I think, um, I think the obvious answer wasn't actually the right one. ",
      },
      {
        text: "And so, I mean, we kind of ended up in a better place than we started, I guess",
        mark: "flag",
        time: flagTime,
        note: `At ${flagTime}, "kind of" and "I guess" undercut a genuinely strong result. State it plainly.`,
      },
      { text: ", which honestly taught me more than the original plan ever would have." },
    ],
    tips: [
      `Cut the hedge at ${flagTime}. "We ended up in a better place" is a strong sentence, "kind of, I guess" gives the win away.`,
      "You lost energy in the final ten seconds and the ending trailed off. Decide on your last sentence before you start, and land on it.",
      `Repeat the move from ${strongTime}: pause, then one concrete detail. That's when you were most convincing, build the rest around it.`,
    ],
    audienceImpact:
      overall >= MIDDLING_MIN
        ? "A listener would come away trusting you and remembering your middle section, that's where you sounded most like yourself. The one risk: the ending loses energy, so the last impression is softer than you deserve. Fix the close and the whole thing lands."
        : "A listener would follow you and believe you know your material, but they'd hesitate to act on it yet, the hedging reads as uncertainty, even though the content is solid. Say it plainly and the same words will move people.",
    paceWpm: Math.round(128 + rand() * 45),
    fillerWords: Math.round(2 + rand() * 9),
    pauses: Math.round(1 + rand() * 6),
  };
}
