import type { Analysis, CategoryId } from "./types";
import { isFirebaseConfigured, getUser } from "./firebase";

// Sends the recording to /api/analyze (AssemblyAI transcription + Gemini
// coaching feedback, running server-side so API keys never reach the
// browser). When Firebase is configured, the request carries the user's
// Firebase ID token — the server rejects anonymous internet traffic, so
// strangers can't burn the transcription/LLM budget.
//
// This is the core promise of the app, so it fails HONESTLY: if the
// pipeline can't produce real analysis of the real recording, we throw an
// AnalysisError with a human message instead of inventing a score and a
// transcript. The caller keeps the recording and lets the user retry — a
// fabricated report about words the speaker never said is worse than none.

export class AnalysisError extends Error {
  /** true when a retry has a good chance of working (server busy / offline). */
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "AnalysisError";
    this.retryable = retryable;
  }
}

export async function analyzeRecording(opts: {
  category: CategoryId;
  prompt: string;
  goal?: string;
  durationSec: number;
  audioBlob: Blob;
  /** True when this is the daily challenge — the only practice free users
   *  get. The server meters and gates on this; the browser flag is a hint,
   *  not the authority. */
  isDaily: boolean;
  /** The user's local day key (YYYY-MM-DD) the attempt counts against. */
  date: string;
  /**
   * Sampled video frames ("m:ss|<base64>") for the Premium camera pass.
   * The server re-checks the plan, so sending these on a free account is
   * harmless — the frames are ignored and the voice report comes back.
   */
  frames?: string[];
}): Promise<Analysis> {
  const form = new FormData();
  form.append("audio", opts.audioBlob, "recording.webm");
  form.append("category", opts.category);
  form.append("prompt", opts.prompt);
  if (opts.goal) form.append("goal", opts.goal);
  form.append("durationSec", String(opts.durationSec));
  form.append("daily", opts.isDaily ? "1" : "0");
  form.append("date", opts.date);
  opts.frames?.forEach((frame, i) => form.append(`frame${i}`, frame));

  const headers: Record<string, string> = {};
  if (isFirebaseConfigured()) {
    const user = await getUser();
    if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }

  let res: Response;
  try {
    res = await fetch("/api/analyze", { method: "POST", headers, body: form });
  } catch {
    // Network error — offline, dropped connection. Almost always retryable.
    throw new AnalysisError(
      "Couldn't reach Felix — check your connection and try again. Your recording is still here.",
      true
    );
  }

  if (res.ok) return (await res.json()) as Analysis;

  // Prefer the server's own human message; fall back by status. A 429/403
  // (daily cap reached, or Premium-only) is a limit, not a hiccup — retrying
  // the same take won't help, so it's not offered as retryable.
  const body = await res.json().catch(() => ({}) as { message?: string });
  const retryable = res.status >= 500;
  throw new AnalysisError(
    body.message ??
      (retryable
        ? "Felix is busy right now. Your recording is safe — try again in a moment."
        : "Felix couldn't analyse that recording. Please try again."),
    retryable
  );
}
