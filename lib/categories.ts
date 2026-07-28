import type { Category, CategoryId } from "./types";

export const CATEGORIES: Category[] = [
  {
    id: "job-interview",
    name: "Job interview",
    description:
      "Practice answering real interview questions with a steady pace and a confident close.",
  },
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
    id: "general-coaching",
    name: "General coaching",
    description:
      "Meetings, tough conversations, or anything else you want to say out loud first.",
  },
];

export function getCategory(id: CategoryId | string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[3];
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
    "Give a toast or short remarks for an occasion that matters to you.",
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
