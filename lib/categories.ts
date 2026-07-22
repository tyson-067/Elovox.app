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
      "Rehearse a talk you've written — pacing, pauses, and how your ending lands.",
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
export const PROMPTS: Record<CategoryId, string[]> = {
  "job-interview": [
    "Tell me about a time you disagreed with your manager. What happened?",
    "Walk me through your background in about ninety seconds.",
    "Describe a project that failed. What would you do differently?",
    "Why do you want this role, and why now?",
  ],
  "sales-pitch": [
    "Pitch your product to a skeptical buyer in under two minutes.",
    "Your prospect says the price is too high. Respond and hold your ground.",
    "Open a cold call with someone who almost hung up already.",
    "Explain what makes you different from the incumbent they already use.",
  ],
  "prepared-speech": [
    "Deliver the opening two minutes of your talk as if the room just went quiet.",
    "Run your closing section — the last thing the audience will remember.",
    "Give the middle section where you make your hardest argument.",
    "Deliver a toast or short remarks for an occasion that matters to you.",
  ],
  "general-coaching": [
    "Explain something you know well to someone hearing it for the first time.",
    "Practice giving a teammate difficult feedback, kindly and directly.",
    "Summarize what you did last week as if your boss asked out of the blue.",
    "Argue for a decision you believe in to a room that's leaning against it.",
  ],
};

export function pickPrompt(category: CategoryId): string {
  const bank = PROMPTS[category];
  return bank[Math.floor(Math.random() * bank.length)];
}
