// Does a cut clip actually begin with the words it is supposed to?
//
// WHY THIS EXISTS
//
// The landing samples are cut out of ONE synthesis request at the pause
// between the takes (splitByText in lib/voicePitch.ts), and where that pause
// is has to be guessed from the takes' character counts. The guess was wrong
// once in a way nothing caught: the report take opens "Cut um and basically",
// the model renders a bare "um" as a genuine hesitation and pauses after it,
// and that hesitation was both nearer the predicted boundary and LONGER than
// the separator. The cut landed after "Cut um", and the committed sample
// opened on "and basically".
//
// Every existing check passed, because both halves were fluent speech at a
// plausible rate and the right pitch. The only thing that can tell a good cut
// from a bad one is what the clip SAYS, so that is what this asks — through
// AssemblyAI, which the report pipeline already uses (app/api/analyze).
//
// Build-time only. Nothing ships this; scripts/felix-voice-sample.mjs runs it
// before it is willing to write an MP3.

const ASSEMBLYAI = "https://api.assemblyai.com/v2";

/** Words, lowercased, punctuation and apostrophes stripped. "We're" and
 *  "were" compare equal, which is what we want: this is checking WHICH WORDS
 *  are there, not how the transcriber spelled them. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export async function transcribeClip(bytes: Uint8Array, key: string): Promise<string> {
  const up = await fetch(`${ASSEMBLYAI}/upload`, {
    method: "POST",
    headers: { authorization: key },
    body: new Uint8Array(bytes),
  });
  if (!up.ok) throw new Error(`AssemblyAI upload: ${up.status}`);
  const { upload_url } = (await up.json()) as { upload_url: string };

  const create = await fetch(`${ASSEMBLYAI}/transcript`, {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    // disfluencies on, or "um" is silently dropped and the very mis-cut this
    // file exists to catch becomes invisible again.
    body: JSON.stringify({ audio_url: upload_url, disfluencies: true }),
  });
  if (!create.ok) throw new Error(`AssemblyAI create: ${create.status}`);
  const { id } = (await create.json()) as { id: string };

  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${ASSEMBLYAI}/transcript/${id}`, {
      headers: { authorization: key },
    });
    if (!poll.ok) throw new Error(`AssemblyAI poll: ${poll.status}`);
    const body = (await poll.json()) as { status: string; text?: string; error?: string };
    if (body.status === "completed") return body.text ?? "";
    if (body.status === "error") throw new Error(`AssemblyAI: ${body.error}`);
  }
  throw new Error("AssemblyAI: transcription timed out");
}

/**
 * Did this clip start where it was meant to?
 *
 * Compares the first `lead` words of the transcript against the first `lead`
 * words of the text it was cut for. The opening is the whole question — a cut
 * that is late loses words from the front, and a cut that is early carries the
 * tail of the previous take into them. Allows one mismatch out of the lead,
 * because a transcriber hearing "um" as "hm" is not a broken cut.
 */
export function startsRight(
  transcript: string,
  intended: string,
  lead = 5
): { ok: boolean; got: string; want: string } {
  const got = words(transcript).slice(0, lead);
  const want = words(intended).slice(0, lead);
  const hits = want.filter((w, i) => got[i] === w).length;
  return { ok: hits >= want.length - 1, got: got.join(" "), want: want.join(" ") };
}
