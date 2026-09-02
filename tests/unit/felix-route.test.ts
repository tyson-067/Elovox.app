import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock, MockInstance } from "vitest";
import { makeDb, type FakeDb } from "../helpers/firestore-fake";
import { FELIX_TAKE_VERSION } from "@/lib/felixTake";
import type { Analysis } from "@/lib/types";

type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   /api/felix writes Felix's take once per session with Gemini and stores it
   on the session doc. What these pin:

     - nobody reaches the paid call without a verified user, an hourly
       allowance, App Check and good standing, and every refusal happens
       BEFORE the model is touched;
     - the take is written from the SERVER's copy of the session: the client
       sends a session id and nothing about the analysis travels up;
     - a stored, current take is read back with no model call and no meter;
     - a sample report, a missing key, a failed model, and a hiccup of a
       reply all come back as a fallback take that is never stored;
     - a real take is merged onto the doc, and a take of an older version is
       rewritten.
   --------------------------------------------------------------------------- */

let db: FakeDb | null;
let verifyVerifiedUser: AnyMock;
let limitOr429: AnyMock;
let enforceAppCheck: AnyMock;
let isRestricted: AnyMock;
let reserveMeteredUse: AnyMock;
let generateJson: AnyMock;
let errorLog: MockInstance;

vi.mock("@/lib/firebaseAdmin", () => ({ getAdminDb: () => db, getAdminApp: () => ({}) }));
vi.mock("@/lib/verify", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  verifyVerifiedUser: (...a: unknown[]) => verifyVerifiedUser(...a),
  enforceAppCheck: (...a: unknown[]) => enforceAppCheck(...a),
}));
vi.mock("@/lib/rateLimit", () => ({
  limitOr429: (...a: unknown[]) => limitOr429(...a),
  limited: async () => false,
}));
vi.mock("@/lib/moderation", () => ({
  isRestricted: (...a: unknown[]) => isRestricted(...a),
  applyAutoStrike: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/quota", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  reserveMeteredUse: (...a: unknown[]) => reserveMeteredUse(...a),
}));
vi.mock("@/lib/gemini", () => ({
  generateJson: (...a: unknown[]) => generateJson(...a),
  geminiKey: () => process.env.GEMINI_API_KEY || undefined,
}));

const { POST } = await import("@/app/api/felix/route");

const analysis: Analysis = {
  overall: 74,
  summary: "Confident opening, rushed close.",
  audienceImpact: "They trusted the start and lost the end.",
  skills: [
    { skill: "Clarity", score: 80, note: "Plain sentences." },
    { skill: "Pacing", score: 58, note: "The last twenty seconds ran." },
  ],
  transcript: [
    { text: "our secret revenue number is nine million", mark: "strong", time: "0:10", note: "Stated plainly." },
  ],
  tips: ["Pause before the key line."],
  strengths: ["The opening was plain."],
  paceWpm: 170,
  fillerWords: 3,
  pauses: 1,
};

const MODEL_TAKE =
  "Confident start. Your opening line was plain and it landed. The close ran away from you, and that is the one thing to fix. Next time, stop before the last line and count two.";

const storedTake = (over: Record<string, unknown> = {}) => ({
  text: MODEL_TAKE,
  version: FELIX_TAKE_VERSION,
  generatedAt: 1,
  source: "model",
  ...over,
});

function felixReq(body: unknown) {
  return new Request("https://elovox.app/api/felix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

const SESSION = "users/uid_1/sessions/s1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("GEMINI_API_KEY", "gk_test_secret");
  db = makeDb({
    [SESSION]: { id: "s1", analysis, goal: "Sound like a leader", mode: "daily", createdAt: 1 },
  });
  verifyVerifiedUser = vi.fn().mockResolvedValue("uid_1") as AnyMock;
  limitOr429 = vi.fn().mockResolvedValue(null) as AnyMock;
  enforceAppCheck = vi.fn().mockResolvedValue(null) as AnyMock;
  isRestricted = vi.fn().mockResolvedValue({ blocked: false }) as AnyMock;
  reserveMeteredUse = vi.fn().mockResolvedValue({ ok: true, used: 1 }) as AnyMock;
  generateJson = vi.fn().mockResolvedValue({ text: MODEL_TAKE }) as AnyMock;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/felix — who gets in", () => {
  it("401 signed out, and the model is never asked", async () => {
    verifyVerifiedUser.mockResolvedValue(null);
    const res = await POST(felixReq({ sessionId: "s1" }));
    expect(res.status).toBe(401);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("403 with an unverified email", async () => {
    verifyVerifiedUser.mockResolvedValue("unverified");
    expect((await POST(felixReq({ sessionId: "s1" }))).status).toBe(403);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("429 from the hourly limiter, before the doc is read", async () => {
    limitOr429.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    expect((await POST(felixReq({ sessionId: "s1" }))).status).toBe(429);
    expect(db!.doc).not.toHaveBeenCalled();
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("refuses an unattested client", async () => {
    enforceAppCheck.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await POST(felixReq({ sessionId: "s1" }))).status).toBe(403);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("403 for a restricted account", async () => {
    isRestricted.mockResolvedValue({ blocked: true });
    expect((await POST(felixReq({ sessionId: "s1" }))).status).toBe(403);
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("/api/felix — which session", () => {
  it("400 without a well-formed session id", async () => {
    expect((await POST(felixReq({}))).status).toBe(400);
    expect((await POST(felixReq({ sessionId: "../x" }))).status).toBe(400);
    expect((await POST(felixReq("not json"))).status).toBe(400);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("404 for a session the caller doesn't have", async () => {
    expect((await POST(felixReq({ sessionId: "s2" }))).status).toBe(404);
    expect(db!.doc).toHaveBeenCalledWith("users/uid_1/sessions/s2");
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("422 when the session has no analysis to coach from", async () => {
    db!.data.set(SESSION, { id: "s1", createdAt: 1 });
    expect((await POST(felixReq({ sessionId: "s1" }))).status).toBe(422);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("ignores any analysis the client sends when there is a server copy", async () => {
    const forged = { ...analysis, summary: "Perfect in every way." };
    await POST(felixReq({ sessionId: "s1", analysis: forged }));
    const [, opts] = generateJson.mock.calls[0] as [string, { parts: { text: string }[] }];
    expect(opts.parts[0].text).toContain("Confident opening, rushed close.");
    expect(opts.parts[0].text).not.toContain("Perfect in every way.");
  });
});

describe("/api/felix — reading back", () => {
  it("answers from the doc when a current take is already there: no model, no meter", async () => {
    db!.data.set(SESSION, { ...db!.data.get(SESSION), felix: storedTake() });
    const res = await POST(felixReq({ sessionId: "s1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ take: storedTake(), cached: true, persisted: true });
    expect(generateJson).not.toHaveBeenCalled();
    expect(reserveMeteredUse).not.toHaveBeenCalled();
    expect(db!.writes).toEqual([]);
  });

  it("rewrites a take of an older prompt version", async () => {
    db!.data.set(SESSION, {
      ...db!.data.get(SESSION),
      felix: storedTake({ version: FELIX_TAKE_VERSION - 1, text: "An old take that said old things." }),
    });
    const body = await (await POST(felixReq({ sessionId: "s1" }))).json();
    expect(body.cached).toBe(false);
    expect(body.take.text).toBe(MODEL_TAKE);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("never treats a stored fallback as the answer", async () => {
    db!.data.set(SESSION, { ...db!.data.get(SESSION), felix: storedTake({ source: "fallback" }) });
    await POST(felixReq({ sessionId: "s1" }));
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});

describe("/api/felix — writing the take", () => {
  it("asks the model with the goal, the mode, the notes, and none of the speaker's words", async () => {
    const res = await POST(felixReq({ sessionId: "s1" }));
    expect(res.status).toBe(200);
    const [key, opts] = generateJson.mock.calls[0] as [
      string,
      { system: string; parts: { text: string }[]; schema: unknown; temperature: number },
    ];
    expect(key).toBe("gk_test_secret");
    expect(opts.system).toContain("You are Felix");
    expect(opts.system).toContain("30 to 60 words");
    const prompt = opts.parts[0].text;
    expect(prompt).toContain("Sound like a leader");
    expect(prompt).toContain("Daily Minute");
    expect(prompt).toContain("Stated plainly.");
    expect(prompt).not.toContain("nine million");
    expect(opts.temperature).toBeLessThan(1);
  });

  it("charges the daily meter once, then merges the take onto the doc", async () => {
    const body = await (await POST(felixReq({ sessionId: "s1" }))).json();
    expect(reserveMeteredUse).toHaveBeenCalledTimes(1);
    expect(reserveMeteredUse.mock.calls[0][3]).toBe("felixTakes");
    expect(body.take).toMatchObject({ text: MODEL_TAKE, version: FELIX_TAKE_VERSION, source: "model" });
    expect(body).toMatchObject({ cached: false, persisted: true });
    const doc = db!.data.get(SESSION)!;
    // Merged: the rest of the session is still there.
    expect(doc.analysis).toEqual(analysis);
    expect(doc.goal).toBe("Sound like a leader");
    expect((doc.felix as { text: string }).text).toBe(MODEL_TAKE);
  });

  it("tidies what the model sends back", async () => {
    generateJson.mockResolvedValue({
      text: 'Felix: "**Confident** start — and a plain opening that landed. The close ran, so fix that. Next time, count two before the last line"',
    });
    const body = await (await POST(felixReq({ sessionId: "s1" }))).json();
    expect(body.take.text).toBe(
      "Confident start, and a plain opening that landed. The close ran, so fix that. Next time, count two before the last line."
    );
  });

  it("429 when the day's takes are spent, without asking the model", async () => {
    reserveMeteredUse.mockResolvedValue({ ok: false, used: 60 });
    expect((await POST(felixReq({ sessionId: "s1" }))).status).toBe(429);
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("/api/felix — when the model can't", () => {
  it("a sample report gets a fallback, unstored, with no model call", async () => {
    db!.data.set(SESSION, { ...db!.data.get(SESSION), analysis: { ...analysis, isSample: true } });
    const body = await (await POST(felixReq({ sessionId: "s1" }))).json();
    expect(body.take.source).toBe("fallback");
    expect(body.reason).toBe("sample");
    expect(body.persisted).toBe(false);
    expect(generateJson).not.toHaveBeenCalled();
    expect(reserveMeteredUse).not.toHaveBeenCalled();
    expect(db!.writes).toEqual([]);
  });

  it("no key: a fallback built from the report, and no meter charged", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const body = await (await POST(felixReq({ sessionId: "s1" }))).json();
    expect(body.take.source).toBe("fallback");
    expect(body.reason).toBe("unconfigured");
    expect(body.take.text).toContain("Confident opening, rushed close.");
    expect(reserveMeteredUse).not.toHaveBeenCalled();
    expect(db!.writes).toEqual([]);
  });

  it("a model failure logs its name, not the notes, and falls back unstored", async () => {
    generateJson.mockRejectedValue(Object.assign(new Error("boom"), { name: "TimeoutError" }));
    const body = await (await POST(felixReq({ sessionId: "s1" }))).json();
    expect(body.take.source).toBe("fallback");
    expect(body.reason).toBe("model-failed");
    expect(db!.writes).toEqual([]);
    const logged = errorLog.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("TimeoutError");
    expect(logged).not.toContain("rushed close");
  });

  it("a reply too short to be a take is a failure, not a take", async () => {
    generateJson.mockResolvedValue({ text: "Nice." });
    const body = await (await POST(felixReq({ sessionId: "s1" }))).json();
    expect(body.take.source).toBe("fallback");
    expect(body.reason).toBe("model-failed");
    expect(db!.writes).toEqual([]);
  });

  it("still answers when the doc can't be written, and says it wasn't kept", async () => {
    const real = db!.doc;
    (db as FakeDb).doc = vi.fn((path: string) => {
      const ref = real(path);
      return { ...ref, set: async () => { throw new Error("unavailable"); } };
    }) as unknown as FakeDb["doc"];
    const body = await (await POST(felixReq({ sessionId: "s1" }))).json();
    expect(body.take.text).toBe(MODEL_TAKE);
    expect(body.persisted).toBe(false);
  });
});

describe("/api/felix — without the Admin SDK", () => {
  it("in production, fails closed rather than trusting the client's analysis", async () => {
    db = null;
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(felixReq({ sessionId: "s1", analysis }));
    expect(res.status).toBe(503);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("in local dev, coaches from the analysis the browser saved, and stores nothing", async () => {
    db = null;
    verifyVerifiedUser.mockResolvedValue("local-dev");
    const res = await POST(felixReq({ sessionId: "s1", analysis, goal: "trust", mode: "own" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.take.text).toBe(MODEL_TAKE);
    expect(body.persisted).toBe(false);
    expect(reserveMeteredUse).not.toHaveBeenCalled();
    const [, opts] = generateJson.mock.calls[0] as [string, { parts: { text: string }[] }];
    expect(opts.parts[0].text).toContain("Make people trust me");
    expect(opts.parts[0].text).toContain("own material");
  });

  it("in local dev, 400 with nothing to coach from", async () => {
    db = null;
    verifyVerifiedUser.mockResolvedValue("local-dev");
    expect((await POST(felixReq({ sessionId: "s1" }))).status).toBe(400);
  });
});
