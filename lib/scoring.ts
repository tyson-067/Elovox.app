// The score tiers, in one place.
//
// These same three bands are written out in prose for the model in
// SYSTEM_PROMPT and STAGE_SYSTEM (app/api/analyze/route.ts). The model decides
// which tier a delivery belongs to and then picks a number inside it, so these
// boundaries are the contract between what Felix judged and what the report
// draws. If a band moves, it has to move in both places or the bars start
// disagreeing with the words next to them.
//
// There is deliberately no numeric adjustment applied to scores anywhere in
// the pipeline. See the comment on calibrate() in the analyze route for why a
// flat offset was the wrong tool and got removed.

/** Floor of the GOOD tier: the delivery genuinely works. */
export const GOOD_MIN = 87;

/** Floor of the MIDDLING tier: it communicates, but it does not land. */
export const MIDDLING_MIN = 65;

export type ScoreTier = "good" | "middling" | "bad";

export function scoreTier(score: number): ScoreTier {
  if (score >= GOOD_MIN) return "good";
  if (score >= MIDDLING_MIN) return "middling";
  return "bad";
}

// Bar fill for a score, given the accent this surface uses for its good tier.
// The voice report scores in accent and the stage report in violet, so the
// good color is passed in; middling and bad are shared, because "not there
// yet" and "this went badly" should read the same wherever they appear.
//
// Bad gets the error red rather than more amber. A 40 and a 75 arriving in the
// same color is the visual version of the sugarcoating the scale was changed
// to stop: the number is honest and the bar underneath it should not soften
// it back up.
export function barClass(score: number, goodClass: string): string {
  const tier = scoreTier(score);
  if (tier === "good") return goodClass;
  if (tier === "middling") return "bg-amber";
  return "bg-error";
}
