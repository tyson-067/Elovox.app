import type { Analysis, CategoryId } from "./types";
import { isFirebaseConfigured, getUser } from "./firebase";
import { getAppCheckToken } from "./appCheck";

// Sends the recording to /api/analyze (AssemblyAI transcription + Gemini
// coaching feedback, running server-side so API keys never reach the
// browser). When Firebase is configured, the request carries the user's
// Firebase ID token, the server rejects anonymous internet traffic, so
// strangers can't burn the transcription/LLM budget.
//
// This is the core promise of the app, so it fails HONESTLY: if the
// pipeline can't produce real analysis of the real recording, we throw an
// AnalysisError with a human message instead of inventing a score and a
// transcript. The caller keeps the recording and lets the user retry, a
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

/** The measured delivery numbers, which exist the instant transcription is
 *  done — several seconds before the coaching. Streamed to the client first so
 *  it can show real results while the report is still being written. */
export interface LiveMetrics {
  paceWpm: number;
  fillerWords: number;
  pauses: number;
}

export async function analyzeRecording(opts: {
  category: CategoryId;
  prompt: string;
  goal?: string;
  durationSec: number;
  audioBlob: Blob;
  /** True when this is the daily challenge, the only practice free users
   *  get. The server meters and gates on this; the browser flag is a hint,
   *  not the authority. */
  isDaily: boolean;
  /** The user's local day key (YYYY-MM-DD) the attempt counts against. */
  date: string;
  /**
   * Sampled video frames ("m:ss|<base64>") for the Premium camera pass.
   * The server re-checks the plan, so sending these on a free account is
   * harmless, the frames are ignored and the voice report comes back.
   */
  frames?: string[];
  /**
   * Called once, early, with the delivery metrics as soon as transcription
   * finishes — before the coaching report is ready. Lets the UI replace the
   * spinner with real numbers while Felix writes. Optional; the sample/demo
   * path (no API keys) returns in one shot and never calls this.
   */
  onMetrics?: (metrics: LiveMetrics) => void;
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
    if (user) {
      // The ID token proves who; the App Check token proves the request came
      // from our real client. Fetched together to keep attestation off the
      // critical path — getUser() has already run startAppCheck via ensureApp,
      // so the token is normally warm. getAppCheckToken() is null when App
      // Check isn't configured or reCAPTCHA hiccups, and the server soft-fails
      // a missing one during rollout, so a stale attestation never blocks a
      // real recording.
      const [idToken, appCheckToken] = await Promise.all([
        user.getIdToken(),
        getAppCheckToken(),
      ]);
      headers.Authorization = `Bearer ${idToken}`;
      if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;
    }
  }

  let res: Response;
  try {
    res = await fetch("/api/analyze", { method: "POST", headers, body: form });
  } catch {
    // Network error, offline, dropped connection. Almost always retryable.
    throw new AnalysisError(
      "Couldn't reach Felix. Check your connection and try again. Your recording is still here.",
      true
    );
  }

  // A non-200 is a pre-stream failure (auth, entitlement, quota, transcription,
  // an unreadable recording): still a single JSON body with a status code.
  // Prefer the server's own human message; fall back by status. A 429/403
  // (daily cap reached, or Premium-only) is a limit, not a hiccup, retrying
  // the same take won't help, so it's not offered as retryable.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    const retryable = res.status >= 500;
    throw new AnalysisError(
      body.message ??
        (retryable
          ? "Felix is busy right now. Your recording is safe. Try again in a moment."
          : "Felix couldn't analyze that recording. Please try again."),
      retryable
    );
  }

  // The sample/demo path (API keys unset) answers with one JSON object, not a
  // stream — take it as-is.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("ndjson") || !res.body) {
    return (await res.json()) as Analysis;
  }

  // Real analysis streams NDJSON: a `metrics` line the instant transcription
  // lands, then a `report` line — or an `error` line if the model failed after
  // the 200 opened (a status code is no longer available to carry it, so the
  // failure and its retryable-ness ride in the message).
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let analysis: Analysis | null = null;

  const handle = (line: string) => {
    const text = line.trim();
    if (!text) return;
    let msg: {
      type?: string;
      paceWpm?: number;
      fillerWords?: number;
      pauses?: number;
      analysis?: Analysis;
      message?: string;
      retryable?: boolean;
    };
    try {
      msg = JSON.parse(text);
    } catch {
      return; // a partial or malformed line; the next chunk completes it
    }
    if (msg.type === "metrics") {
      opts.onMetrics?.({
        paceWpm: msg.paceWpm ?? 0,
        fillerWords: msg.fillerWords ?? 0,
        pauses: msg.pauses ?? 0,
      });
    } else if (msg.type === "report" && msg.analysis) {
      analysis = msg.analysis;
    } else if (msg.type === "error") {
      throw new AnalysisError(
        msg.message ??
          "Felix couldn't finish that one. Your recording is safe, so try again in a moment.",
        msg.retryable !== false
      );
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    buffer += decoder.decode();
    handle(buffer);
  } catch (err) {
    if (err instanceof AnalysisError) throw err;
    // The connection dropped mid-stream. The take is still in the browser.
    throw new AnalysisError(
      "Lost the connection to Felix mid-analysis. Your recording is safe, so try again.",
      true
    );
  }

  if (!analysis) {
    // Stream ended with neither a report nor an explicit error.
    throw new AnalysisError(
      "Felix couldn't finish analyzing that one. Your recording is safe, so try again in a moment.",
      true
    );
  }
  return analysis;
}
