// Server-side Gemini client shared by the analysis, daily-challenge, and
// speech-writing routes. Structured output only — every caller passes a
// responseSchema and gets parsed JSON back.
//
// gemini-3.5-flash returns "high demand" 503s (and occasionally hangs) at
// peak, so each attempt is capped and we fall through a model list.
//
// The last two rungs matter: the flagship 3.x models share a capacity pool
// and 503 together, and when they do, a lighter model still writes a real
// speech instead of dropping users to the canned fallback bank. (Don't add
// gemini-2.5-flash here — it 404s, "no longer available to new users".)

const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];
const ATTEMPT_TIMEOUT_MS = 45_000;

// --- Quota tracking ------------------------------------------------------
// Free-tier quotas are per-model, and the newest flagship has by far the
// smallest daily allowance (gemini-3.5-flash: 20/day, observed). Without
// this, every request after the 20th would still try that model first and
// burn a guaranteed 429 — plus usually a 503 on the next rung — before
// reaching a model that works. Remembering the exhaustion turns those
// wasted round-trips into an immediate skip.
//
// Per-instance and best-effort: a cold start just re-learns it in one call.

interface QuotaBlock {
  until: number; // epoch ms
  daily: boolean;
}

const blocked = new Map<string, QuotaBlock>();

/**
 * Milliseconds until the next midnight in Pacific time, when Google resets
 * free-tier daily quotas. Measures how far through the Pacific day we are
 * rather than doing offset arithmetic, so it needs no DST table. (A DST
 * boundary makes this off by an hour; it only delays a retry, so that's
 * an acceptable error for a best-effort optimization.)
 */
function msUntilPacificMidnight(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Intl renders midnight as hour "24" in some ICU versions.
  const elapsed =
    (get("hour") % 24) * 3_600_000 + get("minute") * 60_000 + get("second") * 1000;
  return 86_400_000 - elapsed;
}

/**
 * A 429 body distinguishes a per-day quota from a per-minute one via the
 * quotaId, and carries a RetryInfo. Blocking a model until tomorrow when
 * it was only rate-limited for 18 seconds would throw away most of its
 * capacity, so the two are handled differently.
 */
function noteQuotaError(model: string, body: string, now: number): void {
  const daily = /PerDay/i.test(body);
  const retrySec = Number(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1] ?? 0);

  const until = daily
    ? now + msUntilPacificMidnight(now)
    : now + Math.max(retrySec * 1000, 30_000);

  blocked.set(model, { until, daily });
  console.warn(
    `gemini ${model} quota exhausted (${daily ? "daily" : "per-minute"}), skipping until ${new Date(until).toISOString()}`
  );
}

function available(now: number): string[] {
  const open = GEMINI_MODELS.filter((m) => {
    const block = blocked.get(m);
    if (!block) return true;
    if (block.until <= now) {
      blocked.delete(m);
      return true;
    }
    return false;
  });
  // If everything is marked exhausted, try the full list anyway rather than
  // failing outright — the block is a guess, and a real attempt is better
  // than serving the canned fallback on the strength of it.
  return open.length ? open : GEMINI_MODELS;
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface GeminiOptions {
  system: string;
  parts: GeminiPart[];
  schema: unknown;
  /** Higher for creative writing, lower for evaluation. Defaults to 1. */
  temperature?: number;
  maxOutputTokens?: number;
  thinkingLevel?: "low" | "medium" | "high";
}

export function geminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

/** Exported for tests only — not part of this module's public surface. */
export const __internal = {
  msUntilPacificMidnight,
  noteQuotaError,
  available,
  blocked,
  GEMINI_MODELS,
};

export async function generateJson<T>(
  key: string,
  opts: GeminiOptions
): Promise<T> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: opts.parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      thinkingConfig: { thinkingLevel: opts.thinkingLevel ?? "low" },
      maxOutputTokens: opts.maxOutputTokens ?? 8000,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    },
  });

  let lastErr: unknown;
  for (const model of available(Date.now())) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body,
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        // Read the quota window off the 429 before discarding the body, so
        // the next caller skips this model instead of repeating the 429.
        if (res.status === 429) noteQuotaError(model, text, Date.now());
        throw new Error(`Gemini ${model}: ${res.status} ${text}`);
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error(`Gemini ${model}: no text in response`);
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
      console.warn(`gemini model ${model} failed, trying next:`, err);
    }
  }
  throw lastErr ?? new Error("all Gemini models failed");
}
