import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FELIX_SAMPLE_TAKE } from "@/lib/felixSample";
import {
  fingerprint,
  sampleDrift,
  voiceFingerprint,
  type FelixSampleStamp,
} from "@/lib/felixSampleStamp";

/* ---------------------------------------------------------------------------
   The landing page's sample is the one Felix a stranger hears, and it is the
   only surface that does NOT re-synthesize when the voice changes: it is a
   committed MP3. lib/felixSample.stamp.json records what went into it.

   Two halves. The VOICE half can only be checked where FISH_AUDIO_VOICE_ID
   exists, so next.config.ts does it on every build (where Vercel supplies
   it) and this file leaves it alone. The WORDS half needs no key at all,
   and it is the half that rots quietly: app/page.tsx prints
   FELIX_SAMPLE_TAKE beside the audio, so editing that string makes the fox
   say one thing while the caption reads another.
   --------------------------------------------------------------------------- */

const stamp = JSON.parse(
  readFileSync("lib/felixSample.stamp.json", "utf8")
) as FelixSampleStamp;

describe("the landing sample's stamp", () => {
  it("was cut from the words the landing page still prints", () => {
    expect(
      stamp.text,
      "\nFELIX_SAMPLE_TAKE changed but public/felix-hello.mp3 did not: the fox " +
        "and his caption now say different things.\nFix: npm run felix:voice, " +
        "then commit the MP3 and lib/felixSample.stamp.json.\n"
    ).toBe(fingerprint(FELIX_SAMPLE_TAKE));
  });

  it("describes a file that is actually there, at the size recorded", () => {
    // Catches a half-written or Git-LFS-pointer MP3 as surely as a missing one.
    expect(readFileSync("public/felix-hello.mp3").byteLength).toBe(stamp.bytes);
  });

  it("names a voice and a model, never the voice id itself", () => {
    expect(stamp.voice).toMatch(/^(stock|[0-9a-f]{16})$/);
    expect(stamp.model).toBeTruthy();
    expect(JSON.stringify(stamp)).not.toContain(process.env.FISH_AUDIO_VOICE_ID ?? "\0");
  });
});

describe("sampleDrift", () => {
  const cut = { voice: voiceFingerprint("voice-a"), model: "s2.1-pro-free", text: fingerprint("hi") };
  const asStamp = (o: typeof cut): FelixSampleStamp => ({
    ...o,
    bytes: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("is quiet when the sample matches the environment", () => {
    expect(sampleDrift(asStamp(cut), cut)).toEqual([]);
  });

  it("notices a new voice — the case this whole file exists for", () => {
    const drift = sampleDrift(asStamp(cut), { ...cut, voice: voiceFingerprint("voice-b") });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain("the voice changed");
  });

  it("notices a new model, new words, and all three at once", () => {
    expect(sampleDrift(asStamp(cut), { ...cut, model: "s1" })[0]).toContain("the model changed");
    expect(sampleDrift(asStamp(cut), { ...cut, text: fingerprint("bye") })[0]).toContain(
      "FELIX_SAMPLE_TAKE changed"
    );
    expect(
      sampleDrift(asStamp(cut), { voice: voiceFingerprint("v2"), model: "s1", text: fingerprint("x") })
    ).toHaveLength(3);
  });

  it("treats a never-stamped sample as drift, not as agreement", () => {
    // The failure mode of a guard that defaults to "fine": it is added, the
    // stamp is never written, and it passes forever while saying nothing.
    expect(sampleDrift(null, cut)).toEqual(["public/felix-hello.mp3 has never been stamped"]);
  });

  it("fingerprints, and does not echo, whatever it is given", () => {
    expect(fingerprint("sk-secret-voice-id")).toHaveLength(16);
    expect(fingerprint("sk-secret-voice-id")).not.toContain("secret");
    expect(voiceFingerprint(undefined)).toBe("stock");
  });
});
