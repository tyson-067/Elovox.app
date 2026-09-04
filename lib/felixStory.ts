import type { FelixMood } from "@/components/FoxLogo";

// Felix's backstory, four beats. This used to be a pinned, cross-faded section
// on the landing page; it was taken off because the homepage's job is to sell
// the product and the visitor's own communication objective, and a mascot
// whose history you have to learn first sits in front of that.
//
// The copy is kept here rather than deleted: it is written, it is good, and
// About is where a reader who wants the character can be given it. Nothing
// imports this yet — that is deliberate, and it is not dead weight, it is a
// draft parked where the next person will find it.
export const FELIX_STORY: Array<{ mood: FelixMood; title: string; body: string }> = [
  {
    mood: "sleepy",
    title: "Felix used to hate this",
    body: "Ears flat, tail down, rehearsing the same first line forty times and still losing it the moment anyone looked at him.",
  },
  {
    mood: "coach",
    title: "So he practiced out loud",
    body: "Every evening, one minute, in the den with the light on. Not reading. Speaking, badly at first, and listening back to it.",
  },
  {
    mood: "listening",
    title: "And he learned to hear it",
    body: "Where he rushed. Where he trailed off. Which pause landed and which one was just fear with a stopwatch on it.",
  },
  {
    mood: "cheer",
    title: "Now he listens for you",
    body: "Same den, same minute, same honest ear. He'll tell you what the room heard, and exactly what to change before tomorrow.",
  },
];
