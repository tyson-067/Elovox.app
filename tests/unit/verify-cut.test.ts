import { describe, expect, it } from "vitest";
import { words, startsRight } from "@/lib/verifyCut";
import { FELIX_SAMPLE_NOTE } from "@/lib/felixSample";

/* ---------------------------------------------------------------------------
   The guard that would have caught the mis-cut, tested on the mis-cut.

   The landing samples are cut out of one synthesis request at the pause
   between the takes, and the boundary is guessed from character counts. On
   2026-09-04 the guess was wrong: the model pauses after the bare "um" that
   opens the report take, that hesitation sat nearer the prediction than the
   real separator AND was longer than it, and the committed sample opened on
   "and basically". Pitch, band, spread and rate checks all passed — both
   halves were fluent speech at a believable speed.

   Only the words could tell. These are the pure halves of that check
   (lib/verifyCut.ts); the transcription around them runs at cut time in
   scripts/felix-voice-sample.mjs.
   --------------------------------------------------------------------------- */

// Verbatim from AssemblyAI, transcribing the clips that actually shipped.
const MIS_CUT = "And basically, the filler and qualifier make you sound less certain. Start clean. We're well ahead of schedule.";
const GOOD_CUT = "Cut! Um, and basically, the filler and qualifier make you sound less certain. Start clean. We're well ahead of schedule.";

describe("words", () => {
  it("compares what was said, not how it was punctuated", () => {
    // "Cut!" and "Cut", "We're" and "were" — a transcriber's punctuation is
    // not a difference in the audio, and treating it as one would make this
    // check cry wolf on every clean cut.
    expect(words("Cut! Um, and basically...")).toEqual(["cut", "um", "and", "basically"]);
    expect(words("We're well ahead")).toEqual(["we", "re", "well", "ahead"]);
  });

  it("drops nothing that carries meaning", () => {
    expect(words("  Start   clean:  193 Hz ")).toEqual(["start", "clean", "193", "hz"]);
  });
});

describe("startsRight", () => {
  it("REJECTS the clip that actually shipped", () => {
    const got = startsRight(MIS_CUT, FELIX_SAMPLE_NOTE);
    expect(got.ok, `it accepted "${got.got}" for "${got.want}"`).toBe(false);
  });

  it("accepts the re-cut that fixed it", () => {
    expect(startsRight(GOOD_CUT, FELIX_SAMPLE_NOTE).ok).toBe(true);
  });

  it("tolerates one misheard word, because a transcriber is not a cut", () => {
    // "um" heard as "hm" is the transcriber's problem. Two words wrong is the
    // cut's problem.
    expect(startsRight("Cut hm and basically, the filler", FELIX_SAMPLE_NOTE).ok).toBe(true);
    expect(startsRight("Hm hm and basically, the filler", FELIX_SAMPLE_NOTE).ok).toBe(false);
  });

  it("catches a clip that starts EARLY as well as one that starts late", () => {
    // The other half of the same failure: a boundary before the separator
    // carries the tail of the previous take into this clip.
    const early = "a little more space. Cut! Um, and basically, the filler";
    expect(startsRight(early, FELIX_SAMPLE_NOTE).ok).toBe(false);
  });

  it("catches a clip that is empty or silent", () => {
    expect(startsRight("", FELIX_SAMPLE_NOTE).ok).toBe(false);
  });
});
