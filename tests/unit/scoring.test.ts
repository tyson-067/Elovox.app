import { describe, expect, it } from "vitest";
import { GOOD_MIN, MIDDLING_MIN, barClass, scoreTier } from "@/lib/scoring";

// The band boundaries are a CONTRACT, not a preference: the same three tiers
// are written out in prose for the model in SYSTEM_PROMPT and STAGE_SYSTEM
// (app/api/analyze/route.ts). The model picks a tier, then a number inside it.
// If a boundary moves here and not there, the bar stops agreeing with the
// sentence printed next to it, and nobody notices until a user does.
describe("score tiers", () => {
  it("puts each band's floor in that band, not the one below", () => {
    expect(scoreTier(GOOD_MIN)).toBe("good");
    expect(scoreTier(MIDDLING_MIN)).toBe("middling");
    expect(scoreTier(MIDDLING_MIN - 1)).toBe("bad");
  });

  it("covers 0..100 with no gap and no overlap", () => {
    for (let s = 0; s <= 100; s++) {
      const tier = scoreTier(s);
      expect(["good", "middling", "bad"]).toContain(tier);
      if (s >= GOOD_MIN) expect(tier).toBe("good");
      else if (s >= MIDDLING_MIN) expect(tier).toBe("middling");
      else expect(tier).toBe("bad");
    }
  });

  it("gives bad its own colour rather than more amber", () => {
    // A 40 and a 75 arriving in the same colour is the visual version of the
    // sugarcoating the scale was changed to stop.
    expect(barClass(40, "bg-accent")).toBe("bg-error");
    expect(barClass(75, "bg-accent")).toBe("bg-amber");
    expect(barClass(95, "bg-accent")).toBe("bg-accent");
    expect(barClass(95, "bg-violet")).toBe("bg-violet");
  });
});
