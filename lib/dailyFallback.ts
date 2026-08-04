/**
 * The canned daily-challenge bank, and the deterministic pick from it.
 *
 * Lives here rather than inside /api/daily because TWO routes need the same
 * answer. /api/daily serves this when Gemini has no key or the generation
 * fails; /api/analyze has to be able to RECOGNISE it, because a fallback day
 * is deliberately never published to `dailyChallenges/{date}` (publishing is
 * create-only, and pinning the bank would block the real topic for the rest of
 * the day).
 *
 * Before this was shared, the consequence was severe and silent: on a fallback
 * day, /api/analyze looked for a published doc, found none, concluded the
 * submission was not the Daily Minute — and served a FREE user the Premium
 * paywall on the one surface that is free on every plan. A premium user lost
 * the streak and improvement bonuses for the same reason.
 *
 * The verification property is unchanged: the topic is still one fixed string
 * per date, so `daily=1` still cannot be claimed for arbitrary material.
 */
import type { DailyChallenge } from "./dailyTypes";

function seedFrom(date: string): number {
  let h = 0;
  for (let i = 0; i < date.length; i++) {
    h = (h * 31 + date.charCodeAt(i)) >>> 0;
  }
  return h;
}

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
    focus: "Sound like you actually mean it, conviction over a sales voice.",
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
    focus: "Hold your ground warmly, disagree without getting defensive.",
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
      "What it costs, kept concrete",
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
    topic: "One everyday thing that's needlessly annoying, and how you'd fix it",
    focus: "Keep the energy up through the final line, don't fade out.",
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

/** The bank's answer for a given date. Identical in both routes, by construction. */
export function fallbackChallengeFor(date: string): DailyChallenge {
  const pick = FALLBACK[seedFrom(date) % FALLBACK.length];
  return { date, ...pick, generated: false };
}

/** Just the topic, which is all the analyze route's verification needs. */
export function fallbackTopicFor(date: string): string {
  return FALLBACK[seedFrom(date) % FALLBACK.length].topic;
}
