// Fish Audio text-to-speech, the voice behind Felix.
//
// Deliberately import-free: scripts/felix-voice-sample.mjs runs this under
// Node's type stripping to write the landing page's static sample, and a
// `@/` alias or a `next/*` import would break that. Everything Elovox-shaped
// (auth, limits, quotas) stays in app/api/voice/route.ts; this file only
// knows how to turn a string into MP3 bytes.
//
// Contract, from docs.fish.audio (api-reference → text-to-speech):
//   POST https://api.fish.audio/v1/tts
//   Authorization: Bearer <key>     model: s1 | s2-pro | s2.1-pro | s2.1-pro-free
//   { text, reference_id?, format: "mp3", mp3_bitrate, latency, normalize }
//   200 → audio bytes; 401/402/422/503 → JSON error.

export const FISH_AUDIO_TTS_URL = "https://api.fish.audio/v1/tts";

/** The free developer tier. Paid plans override it via FISH_AUDIO_MODEL. */
export const FISH_AUDIO_DEFAULT_MODEL = "s2.1-pro-free";

/**
 * Longest text the voice route will read in one go. ~1200 characters is
 * around ninety seconds of speech, which is already more feedback than
 * anyone wants read to them; lib/felixScript.ts trims well under it. The
 * cap is here, at the boundary, so a client can't post a novel.
 */
export const VOICE_TEXT_MAX = 1200;

export function fishAudioKey(): string | undefined {
  return process.env.FISH_AUDIO_API_KEY || undefined;
}

export function fishAudioVoiceId(): string | undefined {
  return process.env.FISH_AUDIO_VOICE_ID || undefined;
}

export function fishAudioModel(): string {
  return process.env.FISH_AUDIO_MODEL || FISH_AUDIO_DEFAULT_MODEL;
}

export class FishAudioError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`fish audio ${status}: ${detail}`);
    this.name = "FishAudioError";
    this.status = status;
  }
}

export interface SynthesizeOptions {
  text: string;
  /** A voice's reference_id from fish.audio. Omit for the stock voice. */
  voiceId?: string;
  model?: string;
  /** Hard ceiling on the round trip. The route's maxDuration minus headroom. */
  timeoutMs?: number;
  /** Speech rate, 1 = as recorded. Felix reads a touch brisk. */
  speed?: number;
}

/**
 * Text in, MP3 bytes out. Throws FishAudioError on a non-2xx, with the body
 * trimmed to something loggable and the key nowhere in it.
 */
export async function synthesize(
  key: string,
  opts: SynthesizeOptions
): Promise<ArrayBuffer> {
  const body: Record<string, unknown> = {
    text: opts.text,
    format: "mp3",
    // 64kbps is transparent for a single voice and a third the bytes of the
    // 128 default, which matters on a phone opening a report over cellular.
    mp3_bitrate: 64,
    latency: "balanced",
    normalize: true,
  };
  if (opts.voiceId) body.reference_id = opts.voiceId;
  if (opts.speed && opts.speed !== 1) body.prosody = { speed: opts.speed };

  const res = await fetch(FISH_AUDIO_TTS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      model: opts.model ?? fishAudioModel(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new FishAudioError(res.status, detail || res.statusText);
  }
  return res.arrayBuffer();
}
