// @vitest-environment node
//
// Node, not the suite's default jsdom, and it is load-bearing: undici parses
// a multipart upload into a File that extends NODE's Blob, while jsdom
// replaces the global Blob with its own. Under jsdom the route's
// `audio instanceof Blob` check is false for every real upload, so the
// request never reaches AssemblyAI at all and these tests would pass against
// a 400 they never asked for.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateJson, __internal } from "@/lib/gemini";
import { makeDb, type FakeDb } from "../helpers/firestore-fake";

/** vi.fn() defaults to a signature TS will not let you call with arguments. */
type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   CONTRACT TESTS FOR THE TWO PAID THIRD PARTIES, AGAINST RECORDED FIXTURES.

   Nothing here touches the network. The point is not to check that Gemini and
   AssemblyAI work — it is to pin what WE do when they don't, because the
   unhappy paths are the ones that actually run in production, cost money, and
   cannot be reproduced on demand. Every fixture below is a real response
   SHAPE (real field names, real quota envelopes, realistic word timings) with
   invented content and no key, no user data.

   The two failure modes that matter to a user are decided here:
     - a vendor hiccup must cost one model attempt, never the whole report,
       and never the user's metered attempt (it is refunded);
     - a broken RECORDING must be told apart from a broken SERVICE, because
       one answer is "record it again" and the other is "we failed, try later".
   --------------------------------------------------------------------------- */

// Read from disk rather than imported: Vite's asset handling rewrites a
// new-URL-against-import.meta.url call built from a template literal, and it
// resolves to undefined at runtime.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (p: string) => readFileSync(join(FIXTURES, p), "utf8");
const fx = (p: string) => JSON.parse(fixture(p)) as Record<string, unknown>;

const GEMINI_HOST = "generativelanguage.googleapis.com";
/** lib/gemini's own per-attempt cap, mirrored (it is module-private). It has
 *  to stay well under the route's 120s maxDuration, or one hung model leaves
 *  no room for the next rung, let alone the refund. */
const ATTEMPT_TIMEOUT_MS = 45_000;

interface ReportShape {
  summary: string;
  dimensions: { name: string; score: number; note: string }[];
  tips: string[];
}

// --- the recorded fixtures ------------------------------------------------

const GEMINI = {
  ok: fx("gemini/report-ok.json"),
  wrongShape: fx("gemini/report-wrong-shape.json"),
  fenced: fx("gemini/report-fenced-markdown.json"),
  noText: fx("gemini/response-no-text.json"),
  notFound: fx("gemini/error-404-model.json"),
  overloaded: fx("gemini/error-503-overloaded.json"),
  perDay: fx("gemini/error-429-per-day.json"),
  perMinute: fx("gemini/error-429-per-minute.json"),
  noRetryInfo: fx("gemini/error-429-no-retry-info.json"),
  proxyHtml: fixture("gemini/proxy-error-page.html"),
};

const AAI = {
  upload: fx("assemblyai/upload-ok.json"),
  created: fx("assemblyai/transcript-created.json"),
  processing: fx("assemblyai/transcript-processing.json"),
  completed: fx("assemblyai/transcript-completed.json"),
  silence: fx("assemblyai/transcript-completed-silence.json"),
  noAudio: fx("assemblyai/transcript-error-no-audio.json"),
  transcoding: fx("assemblyai/transcript-error-transcoding.json"),
  serverError: fx("assemblyai/transcript-error-server.json"),
  unauthorized: fx("assemblyai/auth-401.json"),
  rateLimited: fx("assemblyai/rate-limited-429.json"),
};

// --- a fetch that only ever answers from those fixtures -------------------

type Reply =
  | { status?: number; json?: unknown; html?: string }
  | { hang: true };

/** What undici actually rejects a timed-out fetch with: an Error named
 *  TimeoutError. (Node's DOMException extends Error; jsdom's does not, so
 *  using the global here would test a lie.) */
const timeoutError = () =>
  Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError",
  });

let geminiQueue: Reply[] = [];
let aaiUpload: Reply;
let aaiCreate: Reply;
let aaiPolls: Reply[] = [];
let geminiUrls: string[] = [];
let pollCount = 0;
/** Simulated wall-clock cost of one poll, for the budget tests. */
let pollCostMs = 0;

const at = (queue: Reply[], i: number) => queue[Math.min(i, queue.length - 1)];

function serve(reply: Reply, signal?: AbortSignal | null): Promise<Response> {
  if ("hang" in reply) {
    // A model that accepts the request and never answers — the module's own
    // comment says the flagship "occasionally hangs". Only the abort signal
    // ever ends this, which is exactly what the timeout test needs to observe.
    return new Promise((_, reject) => {
      const fail = () => reject(timeoutError());
      if (!signal) return;
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail);
    });
  }
  const body =
    reply.html !== undefined ? reply.html : JSON.stringify(reply.json ?? {});
  return Promise.resolve(
    new Response(body, {
      status: reply.status ?? 200,
      headers: {
        "content-type":
          reply.html !== undefined ? "text/html; charset=utf-8" : "application/json",
      },
    })
  );
}

const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  const signal = (init?.signal ?? null) as AbortSignal | null;
  if (url.includes(GEMINI_HOST)) {
    geminiUrls.push(url);
    return serve(at(geminiQueue, geminiUrls.length - 1), signal);
  }
  if (url.endsWith("/v2/upload")) return serve(aaiUpload, signal);
  if (url.endsWith("/v2/transcript")) return serve(aaiCreate, signal);
  if (url.includes("/v2/transcript/")) {
    const i = pollCount++;
    if (pollCostMs) vi.setSystemTime(Date.now() + pollCostMs);
    return serve(at(aaiPolls, i), signal);
  }
  throw new Error(`test made an unexpected network call: ${url}`);
});

/** Which models were attempted, in order. */
const modelsTried = () =>
  geminiUrls.map((u) => /\/models\/([^:]+):/.exec(u)?.[1] ?? u);

const geminiOpts = (over: Record<string, unknown> = {}) => ({
  system: "You are Felix.",
  parts: [{ text: "the transcript" }],
  schema: { type: "object" },
  ...over,
});

/** Records the per-attempt bound and lets the test decide when it fires. */
let attemptTimeouts: number[] = [];
function captureAttemptBounds() {
  attemptTimeouts = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(((ms: number) => {
    attemptTimeouts.push(ms);
    const ac = new AbortController();
    setTimeout(() => ac.abort(timeoutError()), ms);
    return ac.signal;
  }) as typeof AbortSignal.timeout);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
  geminiQueue = [{ json: GEMINI.ok }];
  aaiUpload = { json: AAI.upload };
  aaiCreate = { json: AAI.created };
  aaiPolls = [{ json: AAI.completed }];
  geminiUrls = [];
  pollCount = 0;
  pollCostMs = 0;
  // Module-level state in lib/gemini: a cooldown learned by one test would
  // otherwise silently change which model the next one attempts first.
  __internal.blocked.clear();

  db = makeDb();
  awardXp = vi.fn().mockResolvedValue(undefined) as AnyMock;
  recordAnalyzeOutcome = vi.fn().mockResolvedValue(undefined) as AnyMock;
  // Both keys present, or the route short-circuits to the labeled sample
  // analysis and never reaches either vendor.
  process.env.ASSEMBLYAI_API_KEY = "test-assemblyai-key-not-real";
  process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
});

afterEach(() => {
  delete process.env.ASSEMBLYAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ===========================================================================
   ASSEMBLYAI — transcribe() inside app/api/analyze/route.ts

   transcribe() is module-private in a Next route file (which rejects
   arbitrary exports), so it is exercised through POST with global fetch
   answering from the fixtures above. That is the honest way round anyway:
   what matters is not the thrown error, it is the STATUS CODE the user's
   client sees and whether their metered attempt came back.
   =========================================================================== */

let db: FakeDb;
let awardXp: AnyMock;
let recordAnalyzeOutcome: AnyMock;

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminDb: () => db,
  getAdminApp: () => ({}),
}));
vi.mock("@/lib/verify", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  verifyVerifiedUser: async () => "uid_1",
  enforceAppCheck: async () => null,
  // Premium, non-daily: the path that reserves against the durable ceiling,
  // which is the counter these tests watch being handed back.
  isPremiumServer: async () => "premium",
}));
vi.mock("@/lib/rateLimit", () => ({
  limitOr429: async () => null,
  limited: async () => false,
}));
vi.mock("@/lib/opsMetrics", () => ({
  getOpsFlags: async () => ({}),
  recordAnalyzeOutcome: (...a: unknown[]) => recordAnalyzeOutcome(...a),
}));
vi.mock("@/lib/moderation", () => ({
  isRestricted: async () => ({ blocked: false }),
  applyAutoStrike: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/leaderboardServer", () => ({
  awardXp: (...a: unknown[]) => awardXp(...a),
}));

const { POST } = await import("@/app/api/analyze/route");

function analyzeRequest() {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(4096)], { type: "audio/webm" }), "take.webm");
  form.set("durationSec", "30");
  form.set("category", "prepared-speech");
  form.set("prompt", "Sixty seconds on someone who never got thanked.");
  const req = new Request("https://elovox.app/api/analyze", { method: "POST", body: form });
  const headers = new Headers(req.headers);
  headers.set("content-length", "50000");
  return new Request(req, { headers }) as never;
}

/** The durable premium ceiling's counter for this user, today. */
const usagePath = () => `users/uid_1/usage/${new Date().toISOString().slice(0, 10)}`;
const premiumAnalysesUsed = () =>
  (db.data.get(usagePath()) ?? {}).premiumAnalyses ?? "no reservation was made";

/** Drives POST while the fake clock supplies the poll backoff's sleeps. */
async function postOnAFakeClock(): Promise<Response> {
  const p = POST(analyzeRequest()) as Promise<Response>;
  let settled = false;
  void p.then(
    () => (settled = true),
    () => (settled = true)
  );
  for (let i = 0; i < 600 && !settled; i++) await vi.advanceTimersByTimeAsync(1_000);
  return p;
}

/** An error transcript with the vendor's wording swapped, since the wording
 *  is explicitly not a contract — only the classification is. */
const aaiErrorSaying = (detail: string) => ({ ...AAI.noAudio, error: detail });

describe("AssemblyAI: a poll that is not ok fails in ONE step", () => {
  it("does not politely poll a rotated key 40 more times", async () => {
    // The incident in the source comment: a rotated key answers 401 with a
    // JSON body, `await res.json()` parsed it as an object with no `status`,
    // and the loop treated that as "still working" — forty more polls and
    // ~70s of a user's life before failing anyway. The status check has to
    // come first.
    aaiPolls = [{ status: 401, json: AAI.unauthorized }];

    const res = await POST(analyzeRequest());

    expect(pollCount).toBe(1);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "analysis-failed" });
  });

  it("hands the metered attempt back when the non-ok is OUR problem", async () => {
    // A rotated key, or our own account being throttled, is not something
    // the speaker did. They reserved one of the day's metered analyses on the
    // way in; a vendor 4xx must give it back on the way out.
    aaiPolls = [{ status: 429, json: AAI.rateLimited }];

    await POST(analyzeRequest());

    // Reserved on the way in, refunded on the way out: the doc exists (so the
    // reservation genuinely happened) and the count is back to zero.
    expect(db.data.has(usagePath())).toBe(true);
    expect(premiumAnalysesUsed()).toBe(0);
  });
});

describe("AssemblyAI: whose fault the failure was decides what the user is told", () => {
  it("turns an input error into a 422 that asks for another take", async () => {
    // 422, not 503. The client (lib/analyze.ts) marks 5xx retryable, so a 503
    // here blamed our own service for a recording we can never read and
    // invited the user to resend the identical bytes forever.
    aaiPolls = [{ json: AAI.noAudio }];

    const res = await POST(analyzeRequest());

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("unreadable-audio");
    expect(body.message).toMatch(/record it again/i);
  });

  it("classifies the real wordings AssemblyAI uses for a bad file", async () => {
    // The regex is loose ON PURPOSE — the vendor's wording is not a contract.
    // These are the shapes seen in production: silence, a corrupt container,
    // a fetch that failed, a clip too short to transcribe.
    const inputFailures = [
      String(AAI.noAudio.error),
      String(AAI.transcoding.error),
      "Download error, unable to download https://cdn.assemblyai.com/upload/…",
      "Audio file is too short to transcribe",
    ];

    for (const detail of inputFailures) {
      pollCount = 0;
      db = makeDb();
      aaiPolls = [{ json: aaiErrorSaying(detail) }];
      const res = await POST(analyzeRequest());
      expect(res.status, detail).toBe(422);
    }
  });

  it("leaves anything else retryable — being wrong in that direction is safe", async () => {
    // A vendor-side outage must NOT be reported as "your recording is
    // broken": the take is fine, and telling someone to re-record a good
    // recording is the one answer they cannot act on.
    aaiPolls = [{ json: AAI.serverError }];

    const res = await POST(analyzeRequest());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "analysis-failed" });
    expect(premiumAnalysesUsed()).toBe(0);
  });

  it("refuses to score a completed-but-empty transcript", async () => {
    // AssemblyAI succeeds on near-silence and returns zero words. Scoring
    // that would mean a report — pace, fillers, a headline number — computed
    // from nothing at all.
    aaiPolls = [{ json: AAI.silence }];

    const res = await POST(analyzeRequest());

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "no-speech" });
    expect(premiumAnalysesUsed()).toBe(0);
  });
});

describe("AssemblyAI: the polling timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  it("stops at the 40-attempt ceiling instead of polling forever", async () => {
    // A transcript stuck in "processing" is a vendor incident, not a hang we
    // are allowed to inherit: the loop is bounded, the caller gets an honest
    // 503, and the attempt is refunded.
    aaiPolls = [{ json: AAI.processing }];

    const startedAt = Date.now();
    const res = await postOnAFakeClock();
    const elapsed = Date.now() - startedAt;

    expect(pollCount).toBe(40);
    expect(res.status).toBe(503);
    expect(premiumAnalysesUsed()).toBe(0);

    // And here is what the ceiling actually costs: the 400ms→2s backoff
    // reaches 40 attempts after ~75s, so it is the attempt COUNT, not the
    // 105s budget, that ends a slow transcription — roughly 30s of granted
    // headroom is never used. A ten-minute premium take on a busy
    // AssemblyAI day is exactly the recording that needs those 30s. Change
    // the backoff and this fires: re-reason about the ceiling with it.
    expect(elapsed).toBeGreaterThan(70_000);
    expect(elapsed).toBeLessThan(80_000);
  });

  it("gives up EARLY on a slow vendor, leaving time to run the refund", async () => {
    // The margin is the whole point. Without a budget, undici's 300s default
    // ran well past maxDuration, the platform killed the function mid-await,
    // and the refund in the catch never ran — the user silently lost an
    // attempt to a slow third party. Here each poll costs six seconds, so the
    // budget is spent long before the 40-attempt ceiling, and the request has
    // to bail with room to spare rather than be cut off.
    aaiPolls = [{ json: AAI.processing }];
    pollCostMs = 6_000;

    const startedAt = Date.now();
    const res = await postOnAFakeClock();
    const elapsed = Date.now() - startedAt;

    expect(pollCount).toBeLessThan(40); // the budget ended it, not the ceiling
    // It used nearly all of the 105s budget, then stopped SHORT of it with
    // the margin intact — rather than being cut off at 110s with the refund
    // still unwritten.
    expect(elapsed).toBeGreaterThan(95_000);
    expect(elapsed).toBeLessThan(110_000);
    expect(res.status).toBe(503);
    expect(premiumAnalysesUsed()).toBe(0);
  });
});

describe("a transcript we can read plus a report we cannot", () => {
  it("never turns a wrong-shape model answer into a score", async () => {
    // The other half of the "generateJson does not validate" pair above. The
    // transcript succeeded, so the 200 stream is already open and the metrics
    // have been sent; the model then answered in its own words. This used to
    // substitute 77 for the missing dimensions — a fabricated headline saved
    // to history and awarded ranked XP. It must be an honest in-stream error
    // instead, with the attempt refunded and no XP awarded.
    geminiQueue = [{ json: GEMINI.wrongShape }];

    const res = await POST(analyzeRequest());
    expect(res.status).toBe(200); // headers went out with the metrics
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; retryable?: boolean });

    expect(events.map((e) => e.type)).toEqual(["metrics", "error"]);
    expect(events[1]).toMatchObject({ error: "analysis-failed", retryable: true });
    expect(awardXp).not.toHaveBeenCalled();
    expect(premiumAnalysesUsed()).toBe(0);
    // And the fallback chain never even saw it: a wrong-shape answer is a
    // perfectly successful HTTP call, so no other model is tried and the
    // dimension check in runGemini is the ONLY thing between it and a score.
    expect(geminiUrls).toHaveLength(1);
  });

  it("delivers the real report when the vendors behave", async () => {
    // The control. Without it, every assertion above could be passing because
    // the request never reached the vendors at all.
    const res = await POST(analyzeRequest());
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; analysis?: { overall: number; transcript: { text: string }[] } });

    expect(events.map((e) => e.type)).toEqual(["metrics", "report"]);
    const analysis = events[1].analysis!;
    expect(analysis.overall).toBeGreaterThan(0);
    // The transcript on screen is the words AssemblyAI heard, never the
    // model's paraphrase — the fixture report's own "transcript" field is
    // deliberately ignored.
    expect(analysis.transcript.map((t) => t.text).join("")).toContain("nobody clapped");
    expect(premiumAnalysesUsed()).toBe(1); // a real report DOES cost an attempt
  });
});

/* ===========================================================================
   GEMINI — lib/gemini.ts
   =========================================================================== */

describe("the model fallback chain", () => {
  it("falls through 404, 429 and 503 to a rung that answers", async () => {
    // The whole reason the list has four entries. The flagship 3.x models
    // share a capacity pool and 503 together; a 404 is a model Google
    // retired under us. Without the lighter rungs beneath them, one capacity
    // spike drops every user to the canned fallback bank instead of a real
    // report they paid for.
    geminiQueue = [
      { status: 404, json: GEMINI.notFound },
      { status: 429, json: GEMINI.perMinute },
      { status: 503, json: GEMINI.overloaded },
      { json: GEMINI.ok },
    ];

    const report = await generateJson<ReportShape>("k", geminiOpts());

    expect(modelsTried()).toEqual(__internal.GEMINI_MODELS);
    expect(report.dimensions).toHaveLength(6);
    expect(report.summary).toContain("real image");
  });

  it("tries each model at most once — a dead chain costs four calls, not a storm", async () => {
    // Every attempt is a paid round trip on a route the user is waiting on.
    // A retry loop layered on top of the fallback list would multiply both.
    geminiQueue = [{ status: 503, json: GEMINI.overloaded }];

    await expect(generateJson("k", geminiOpts())).rejects.toBeInstanceOf(Error);

    expect(geminiUrls).toHaveLength(__internal.GEMINI_MODELS.length);
    expect(new Set(modelsTried()).size).toBe(__internal.GEMINI_MODELS.length);
  });

  it("surfaces a failure that names the model and the status", async () => {
    // This string is all an operator gets in the log when every report on the
    // site starts 503ing. "429 on gemini-3.5-flash" (out of quota, self-heals
    // at Pacific midnight) and "503 on gemini-flash-latest" (Google is down,
    // page someone) are the same user-facing error and completely different
    // responses, so the surfaced error has to distinguish them.
    geminiQueue = [{ status: 503, json: GEMINI.overloaded }];

    await expect(generateJson("k", geminiOpts())).rejects.toThrow(
      /gemini-flash-latest[\s\S]*503/
    );
  });

  it("spends nothing when the caller's budget is already gone", async () => {
    // The analyze route hands down an absolute deadline so it regains control
    // (and runs its refunds) before the platform kills the function. With
    // under 3s left there is no point starting a paid call that cannot
    // finish — but it must still REJECT rather than resolve, because the
    // refund only runs in the caller's catch and a resolved value here would
    // be read as a report.
    await expect(
      generateJson("k", geminiOpts({ deadline: Date.now() + 1_000 }))
    ).rejects.toBeInstanceOf(Error);
    expect(geminiUrls).toHaveLength(0);
  });
});

describe("the per-attempt timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    captureAttemptBounds();
  });

  it("bounds a hung model and moves on to the next one", async () => {
    // A model that accepts the POST and never answers used to hold the whole
    // request until the platform killed the function — no report, no refund,
    // and the user's attempt gone. The cap turns a hang into one lost rung.
    geminiQueue = [{ hang: true }, { json: GEMINI.ok }];

    const p = generateJson<ReportShape>("k", geminiOpts());

    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS - 1_000);
    expect(geminiUrls).toHaveLength(1); // still stuck on the first model

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).resolves.toMatchObject({ summary: expect.any(String) });
    expect(attemptTimeouts[0]).toBe(ATTEMPT_TIMEOUT_MS);
    expect(modelsTried()).toEqual(__internal.GEMINI_MODELS.slice(0, 2));
  });

  it("shortens the bound to the caller's remaining budget, and stops there", async () => {
    // 45s of hang inside a request that only has 20s left would be cut off by
    // the platform mid-await, which is precisely the state where the refund
    // never runs. The attempt is bounded by whichever is SOONER, and once the
    // budget is spent the chain stops rather than starting a fifth attempt it
    // cannot afford.
    geminiQueue = [{ hang: true }];
    const p = generateJson("k", geminiOpts({ deadline: Date.now() + 20_000 }));
    const settled = p.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(21_000);
    await expect(settled).resolves.toBeInstanceOf(Error);

    expect(attemptTimeouts[0]).toBe(20_000);
    expect(geminiUrls).toHaveLength(1);
  });
});

describe("a response that is not the JSON we asked for", () => {
  it("survives an HTML error page from an intermediary", async () => {
    // A 200 whose body is a proxy's HTML error page is the classic one: the
    // status says success, res.json() throws, and before the per-attempt
    // try/catch that SyntaxError escaped the loop and skipped every remaining
    // model. One bad edge node must not cost the report.
    geminiQueue = [{ html: GEMINI.proxyHtml }, { json: GEMINI.ok }];

    await expect(
      generateJson<ReportShape>("k", geminiOpts())
    ).resolves.toMatchObject({ dimensions: expect.any(Array) });
    expect(geminiUrls).toHaveLength(2);
  });

  it("treats a 200 with no text part as a failed rung", async () => {
    // finishReason MAX_TOKENS with the thinking budget eaten and nothing
    // emitted is a real, frequent outcome. `data.candidates[0]...text` is
    // undefined; without the explicit check, JSON.parse(undefined) throws a
    // string-shaped error nobody could read, and a "successful" empty report
    // is worse still.
    geminiQueue = [{ json: GEMINI.noText }, { json: GEMINI.ok }];

    await expect(generateJson<ReportShape>("k", geminiOpts())).resolves.toBeTruthy();
    expect(geminiUrls).toHaveLength(2);
  });

  it("refuses text that is not JSON at all, on every rung", async () => {
    // The model ignoring responseMimeType and fencing its answer in
    // ```json … ``` is a known Gemini regression. The parse throws, and the
    // caller must end up with nothing rather than a string it will later read
    // fields off.
    geminiQueue = [{ json: GEMINI.fenced }];

    await expect(generateJson("k", geminiOpts())).rejects.toBeInstanceOf(Error);
    expect(geminiUrls).toHaveLength(__internal.GEMINI_MODELS.length);
  });

  it("does NOT validate the shape — that is the caller's job", async () => {
    // Pinning the contract boundary deliberately. generateJson is transport:
    // valid JSON of the WRONG shape comes back untouched, which means the
    // dimension check in runGemini is the only thing standing between a model
    // that answered in its own words and a fabricated score being saved to
    // history and awarded ranked XP. If anyone ever "helpfully" adds coercion
    // or defaults here, that guard stops being reachable — see the route test
    // below, which is the other half of this pair.
    geminiQueue = [{ json: GEMINI.wrongShape }];

    const parsed = await generateJson<Record<string, unknown>>("k", geminiOpts());

    expect(parsed).not.toHaveProperty("dimensions");
    expect(parsed).toMatchObject({ overall_score: 81 });
  });
});

describe("the quota cooldown around GEMINI_MODELS", () => {
  const { noteQuotaError, available, blocked, msUntilPacificMidnight } = __internal;
  const [FLAGSHIP, SECOND] = __internal.GEMINI_MODELS;

  it("skips a day-exhausted model on the NEXT call, without asking again", async () => {
    // The flagship's free-tier daily allowance is ~20. Without remembering
    // the exhaustion, every request after the 20th burns a guaranteed 429 and
    // usually a 503 on the rung below before reaching a model that answers —
    // two wasted round trips added to a request a user is watching a spinner
    // for.
    geminiQueue = [{ status: 429, json: GEMINI.perDay }, { json: GEMINI.ok }];
    await generateJson("k", geminiOpts());
    expect(modelsTried()[0]).toBe(FLAGSHIP);

    geminiUrls = [];
    geminiQueue = [{ json: GEMINI.ok }];
    await generateJson("k", geminiOpts());

    expect(modelsTried()[0]).toBe(SECOND);
    expect(modelsTried()).not.toContain(FLAGSHIP);
  });

  it("blocks a PerDay 429 until the Pacific reset, not for its retryDelay", async () => {
    // The body carries BOTH a daily quotaId and a 31s RetryInfo. Honouring
    // the 31s would re-burn the same guaranteed 429 every half minute for the
    // rest of the day.
    const now = Date.parse("2026-08-25T12:00:00Z");
    noteQuotaError(FLAGSHIP, JSON.stringify(GEMINI.perDay), now);

    const block = blocked.get(FLAGSHIP);
    expect(block?.daily).toBe(true);
    expect(block!.until - now).toBe(msUntilPacificMidnight(now));
    expect(block!.until - now).toBeGreaterThan(3_600_000);
  });

  it("blocks a per-minute 429 only briefly — the day's capacity is not thrown away", async () => {
    // Same status code, completely different meaning. Treating this like the
    // daily one would retire the best model for the rest of the day over an
    // 18-second window.
    const now = Date.parse("2026-08-25T12:00:00Z");
    noteQuotaError(FLAGSHIP, JSON.stringify(GEMINI.perMinute), now);

    expect(blocked.get(FLAGSHIP)?.daily).toBe(false);
    expect(blocked.get(FLAGSHIP)!.until - now).toBe(30_000);
    expect(available(now)).not.toContain(FLAGSHIP);
    expect(available(now + 31_000)).toContain(FLAGSHIP);
  });

  it("still waits when the 429 carries no retryDelay at all", async () => {
    // The parse of a missing retryDelay is 0. Without the 30s floor the model
    // is "blocked until now" — i.e. not blocked — and the very next request
    // hammers the same 429. The floor is what makes this a cooldown.
    const now = Date.parse("2026-08-25T12:00:00Z");
    noteQuotaError(FLAGSHIP, JSON.stringify(GEMINI.noRetryInfo), now);

    expect(blocked.get(FLAGSHIP)!.until - now).toBe(30_000);
    expect(available(now)).not.toContain(FLAGSHIP);
  });

  it("expires a cooldown instead of retiring a model for the life of the instance", async () => {
    const now = Date.parse("2026-08-25T12:00:00Z");
    noteQuotaError(FLAGSHIP, JSON.stringify(GEMINI.perMinute), now);

    expect(available(now + 30_001)).toContain(FLAGSHIP);
    expect(blocked.has(FLAGSHIP)).toBe(false); // and the entry is dropped
  });

  it("re-opens the whole list when every model is marked exhausted", async () => {
    // The block is a GUESS learned from one instance's 429s. If it were ever
    // allowed to empty the list, a wrong guess would serve the canned
    // fallback bank to a paying user with four working models available.
    const now = Date.parse("2026-08-25T12:00:00Z");
    for (const m of __internal.GEMINI_MODELS) {
      noteQuotaError(m, JSON.stringify(GEMINI.perDay), now);
    }
    expect(available(now)).toEqual(__internal.GEMINI_MODELS);
  });

  it("measures the Pacific reset correctly on both sides of DST", async () => {
    // Google resets free-tier daily quotas at Pacific midnight, and this is
    // computed with no DST table. Getting it wrong by using UTC midnight
    // would keep the best model retired for seven or eight hours after it had
    // actually come back — every report in that window written by a lighter
    // model, for nothing.
    const summer = Date.parse("2026-08-25T12:00:00Z"); // 05:00 PDT (UTC-7)
    const winter = Date.parse("2026-01-15T12:00:00Z"); // 04:00 PST (UTC-8)

    expect(msUntilPacificMidnight(summer)).toBe(19 * 3_600_000);
    expect(msUntilPacificMidnight(winter)).toBe(20 * 3_600_000);
  });
});
