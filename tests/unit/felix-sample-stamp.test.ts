import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { FELIX_SAMPLE_NOTE, FELIX_SAMPLE_TAKE } from "@/lib/felixSample";
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

// Both static samples, each with its own stamp: the hero's take and the note
// the Felix beside the report reads aloud. A guard that only ever covered the
// first would have gone quiet the day a second one was added, which is the
// same "defaults to fine" failure the last case in this file is about.
const SAMPLES = [
  { name: "FELIX_SAMPLE_TAKE", words: FELIX_SAMPLE_TAKE, mp3: "public/felix-hello.mp3", stampPath: "lib/felixSample.stamp.json" },
  { name: "FELIX_SAMPLE_NOTE", words: FELIX_SAMPLE_NOTE, mp3: "public/felix-note.mp3", stampPath: "lib/felixSampleNote.stamp.json" },
] as const;

for (const sample of SAMPLES) {
  const stamp = JSON.parse(readFileSync(sample.stampPath, "utf8")) as FelixSampleStamp;

  describe(`${sample.mp3}'s stamp`, () => {
    it("was cut from the words the landing page still prints", () => {
      expect(
        stamp.text,
        `\n${sample.name} changed but ${sample.mp3} did not: the fox ` +
          "and his caption now say different things.\nFix: npm run felix:voice, " +
          `then commit the MP3 and ${sample.stampPath}.\n`
      ).toBe(fingerprint(sample.words));
    });

    it("describes a file that is actually there, at the size recorded", () => {
      // Catches a half-written or Git-LFS-pointer MP3 as surely as a missing one.
      expect(readFileSync(sample.mp3).byteLength).toBe(stamp.bytes);
    });

    it("names a voice and a model, never the voice id itself", () => {
      expect(stamp.voice).toMatch(/^(stock|[0-9a-f]{16})$/);
      expect(stamp.model).toBeTruthy();
      expect(JSON.stringify(stamp)).not.toContain(process.env.FISH_AUDIO_VOICE_ID ?? "\0");
    });
  });
}

describe("the static samples match the voice this machine is configured with", () => {
  /* The VOICE half used to be left entirely to next.config.ts, on the grounds
     that it needs FISH_AUDIO_VOICE_ID and only a build has one. That was true
     of CI and false of the machine that matters: re-cutting the samples happens
     where .env.local lives, and .env.local is readable from here.

     So this reads it the same way scripts/felix-voice-sample.mjs does and
     fails — not warns — when the committed MP3s were cut in some other voice.
     A build warning is a line someone scrolls past; a red test is not.

     Skipped, not failed, where there is no .env.local or no voice in it: that
     is CI without secrets, which has nothing to compare and must not go red
     for it. */
  const envPath = "\.env.local";
  const readEnv = (): Record<string, string> | null => {
    if (!existsSync(envPath)) return null;
    const out: Record<string, string> = {};
    for (const raw of readFileSync(envPath, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      out[line.slice(0, eq).trim()] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
    return out;
  };

  const env = readEnv();
  const configuredVoice = env?.FISH_AUDIO_VOICE_ID ?? "";
  const run = configuredVoice ? it : it.skip;

  for (const sample of SAMPLES) {
    run(`${sample.mp3} was cut in the voice .env.local names`, () => {
      const stamp = JSON.parse(readFileSync(sample.stampPath, "utf8")) as FelixSampleStamp;
      // Fingerprints on both sides: the voice id is a secret and this
      // assertion's failure message is not a place to print one.
      expect(
        stamp.voice,
        `\n${sample.mp3} was cut in a different voice than FISH_AUDIO_VOICE_ID ` +
          "currently names, so this machine's Felix and the one on the landing " +
          "page are two different foxes.\nFix: npm run felix:voice, then commit " +
          "the MP3s and their stamps.\n"
      ).toBe(voiceFingerprint(configuredVoice));
    });
  }
});

describe("every Felix on the site is the same Felix", () => {
  /* The voice is one value, FISH_AUDIO_VOICE_ID, read by /api/voice at request
     time and by scripts/felix-voice-sample.mjs when the static samples are
     cut. Nothing enforced that the CUT samples agreed with each other, though:
     re-cutting one and not the other would put two different foxes on the same
     page, and the per-sample drift check would be perfectly happy because each
     one matched its own stamp.

     Whether the committed samples match PRODUCTION's voice is a question only
     a build with the key can answer, and next.config.ts asks it there. This is
     the half that needs no key: they must at least all be each other. */
  const stamps = SAMPLES.map((sample) => ({
    ...sample,
    stamp: JSON.parse(readFileSync(sample.stampPath, "utf8")) as FelixSampleStamp,
  }));

  it("cut every static sample in one voice", () => {
    const voices = [...new Set(stamps.map((s) => s.stamp.voice))];
    expect(
      voices,
      `\nThe landing page's samples were cut in different voices:\n` +
        stamps.map((s) => `  ${s.mp3}: ${s.stamp.voice}`).join("\n") +
        "\nFix: npm run felix:voice, which re-cuts them all together.\n"
    ).toHaveLength(1);
  });

  it("cut every static sample on one model, and that model is the free one", () => {
    for (const { mp3, stamp } of stamps) {
      expect(stamp.model, `${mp3} was cut on ${stamp.model}`).toBe("s2.1-pro-free");
    }
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
