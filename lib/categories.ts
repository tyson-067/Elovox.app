import type { Category, CategoryId } from "./types";

// Interview practice has its own feature, its own question banks, and its
// own tab (/interviews). It is NOT one of the things you bring your own
// material for: there is no such thing as a job interview you've already
// written. It lived in this list anyway and sent people to a screen that
// asked them to perform a prompt instead of a question, so it's out of the
// picker and kept here only as the bucket the interview mode scores against.
const JOB_INTERVIEW: Category = {
  id: "job-interview",
  name: "Job interview",
  description:
    "Practice answering real interview questions with a steady pace and a confident close.",
};

/**
 * What "My own material" offers: four kinds of thing you can walk in with
 * already written. Rendered in the order below, two columns on desktop.
 */
export const CATEGORIES: Category[] = [
  {
    id: "sales-pitch",
    name: "Sales pitch",
    description:
      "Land the problem fast, keep energy up, and end with a clear ask.",
  },
  {
    id: "prepared-speech",
    name: "Prepared speech",
    description:
      "Rehearse a talk you've written, pacing, pauses, and how your ending lands.",
  },
  {
    id: "toast-tribute",
    name: "Toast or tribute",
    description:
      "A wedding, a retirement, an award, a eulogy. Warmth and timing, where most speakers rush.",
  },
  {
    id: "general-coaching",
    name: "General coaching",
    description:
      "Meetings, tough conversations, or anything else you want to say out loud first.",
  },
];

/** Every bucket, including the internal interview one, for lookups. */
const ALL_CATEGORIES: Category[] = [...CATEGORIES, JOB_INTERVIEW];

export function getCategory(id: CategoryId | string): Category {
  // Falls back to general coaching, which is the catch-all by design, found
  // by id rather than by index so reordering CATEGORIES can't silently
  // change what an unknown category resolves to.
  return (
    ALL_CATEGORIES.find((c) => c.id === id) ??
    ALL_CATEGORIES.find((c) => c.id === "general-coaching")!
  );
}

// Small static prompt bank per category (per PRD: no dynamic generation in v1)
//
// These are headlines over the user's OWN material, so they set the scene and
// then get out of the way. They deliberately do NOT prescribe a length or a
// slice: the earlier bank said things like "the opening two minutes" and
// "under two minutes", which told someone with a nine-minute talk that they
// were doing it wrong. The only hard time limit in the product is the sixty
// seconds of the daily challenge. Everything here runs as long as the
// speaker's material runs.
export const PROMPTS: Record<CategoryId, string[]> = {
  "job-interview": [
    "Answer as if the panel just asked about a time you disagreed with your manager.",
    "Walk them through your background, at whatever length it actually takes.",
    "Talk about a project that failed, and what you'd do differently.",
    "Make the case for why you want this role, and why now.",
  ],
  "sales-pitch": [
    "Pitch your product to a skeptical buyer, for as long as the pitch needs.",
    "Your prospect says the price is too high. Respond and hold your ground.",
    "Open a cold call with someone who almost hung up already.",
    "Explain what makes you different from the incumbent they already use.",
  ],
  "prepared-speech": [
    "Deliver your talk as if the room just went quiet. Run as much of it as you want.",
    "Run whichever section you're least sure of, from wherever it starts.",
    "Take the part where you make your hardest argument, and make it.",
    "Open with your first ninety seconds, the part that decides whether they stay with you.",
  ],
  "toast-tribute": [
    "Raise your glass and give it, exactly as you'd give it on the night.",
    "Tell the one story about them that makes your case, and let it breathe.",
    "Say the part you're worried will land badly, and say it kindly.",
    "Run just your closing line and the toast itself, until it stops sounding rehearsed.",
  ],
  "general-coaching": [
    "Explain something you know well to someone hearing it for the first time.",
    "Practice giving a teammate difficult feedback, kindly and directly.",
    "Talk through what you did last week as if your boss asked out of the blue.",
    "Argue for a decision you believe in to a room that's leaning against it.",
  ],
};

export function pickPrompt(category: CategoryId): string {
  const bank = PROMPTS[category];
  return bank[Math.floor(Math.random() * bank.length)];
}
