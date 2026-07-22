import type { Goal, GoalId } from "./types";

// The eight ways a speaker can ask Felix to judge them (PRD: coaching goals).
// The label is what's shown in the UI and what's passed to the analysis
// pipeline, so Felix scores the delivery against the outcome the speaker
// actually wants.

export const GOALS: Goal[] = [
  { id: "trust", label: "Make people trust me" },
  { id: "agree", label: "Make people agree with me" },
  { id: "inspire", label: "Inspire action" },
  { id: "leader", label: "Sound like a leader" },
  { id: "empathy", label: "Show empathy" },
  { id: "intelligent", label: "Sound more intelligent" },
  { id: "memorable", label: "Be memorable" },
  { id: "calm", label: "Calm a tense audience" },
];

export function getGoal(id: GoalId | string): Goal | undefined {
  return GOALS.find((g) => g.id === id);
}
