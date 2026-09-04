import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock, MockInstance } from "vitest";
import { makeDb, type FakeDb } from "../helpers/firestore-fake";
import { VOICE_TEXT_MAX } from "@/lib/fishAudio";
import { FELIX_TAKE_MAX_WORDS, FELIX_TAKE_VERSION } from "@/lib/felixTake";

type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   /api/voice spends money at Fish Audio on every accepted request, so it sits
   behind the same guards as /api/speech, in the same order. What these pin:

     - nobody reaches the paid call without a verified user, an hourly
       allowance, and a daily allowance, and every refusal happens BEFORE
       fetch is touched;
     - the text is sanitised and capped at the boundary, so the client can't
       post a novel or a tag;
     - the key travels in a header, never a URL, and never a log line; and
       neither does the text, which is someone's own feedback.
   --------------------------------------------------------------------------- */

let db: FakeDb | null;
let verifyVerifiedUser: AnyMock;
let limitOr429: AnyMock;
let enforceAppCheck: AnyMock;
let isRestricted: AnyMock;
let reserveMeteredUse: AnyMock;
let fetchMock: AnyMock;
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

const { POST } = await import("@/app/api/voice/route");

function voiceReq(body: unknown) {
  return new Request("https://elovox.app/api/voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

/** Ten bytes that start with an ID3 tag, i.e. shaped like an MP3. */
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);

function upstream(status = 200) {
  return status === 200
    ? new Response(MP3, { status, headers: { "content-type": "audio/mpeg" } })
    : new Response(JSON.stringify({ message: "nope" }), {
        status,
        headers: { "content-type": "application/json" },
      });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("FISH_AUDIO_API_KEY", "fk_test_secret");
  vi.stubEnv("FISH_AUDIO_VOICE_ID", "voice_felix");
  vi.stubEnv("FISH_AUDIO_MODEL", "");
  db = makeDb();
  verifyVerifiedUser = vi.fn().mockResolvedValue("uid_1") as AnyMock;
  limitOr429 = vi.fn().mockResolvedValue(null) as AnyMock;
  enforceAppCheck = vi.fn().mockResolvedValue(null) as AnyMock;
  isRestricted = vi.fn().mockResolvedValue({ blocked: false }) as AnyMock;
  reserveMeteredUse = vi.fn().mockResolvedValue({ ok: true, used: 1 }) as AnyMock;
  fetchMock = vi.fn().mockResolvedValue(upstream()) as AnyMock;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/voice — who gets in", () => {
  it("401 signed out, and Fish Audio is never called", async () => {
    verifyVerifiedUser.mockResolvedValue(null);
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 with an unverified email", async () => {
    verifyVerifiedUser.mockResolvedValue("unverified");
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 from the hourly limiter, before the meter and before the call", async () => {
    limitOr429.mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(429);
    expect(reserveMeteredUse).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limits per user AND per IP, in the declared scopes", async () => {
    await POST(voiceReq({ text: "Read this." }));
    const scopes = limitOr429.mock.calls.map((c) => (c[1] as { scope: string }).scope);
    expect(scopes).toEqual(["voice", "voice-ip"]);
  });

  it("403 when the account is restricted", async () => {
    isRestricted.mockResolvedValue({ blocked: true, state: "suspended", until: 0 });
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/api/voice — what gets sent", () => {
  it("503 with no key, without calling out", async () => {
    vi.stubEnv("FISH_AUDIO_API_KEY", "");
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("voice-unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 with nothing to say, charging nothing", async () => {
    for (const body of [{}, { text: "" }, { text: "   " }, { text: "<b></b>" }, "not json", "[]"]) {
      const res = await POST(voiceReq(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(reserveMeteredUse).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends sanitised, capped text; the key in a header, never the URL", async () => {
    const text = "<script>x</script>Nice. " + "a".repeat(VOICE_TEXT_MAX * 2);
    const res = await POST(voiceReq({ text }));
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect(url).not.toContain("fk_test_secret");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer fk_test_secret");
    expect(headers.model).toBe("s2.1-pro-free");

    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(typeof sent.text).toBe("string");
    expect((sent.text as string).length).toBeLessThanOrEqual(VOICE_TEXT_MAX);
    expect(sent.text).not.toContain("<");
    expect((sent.text as string).startsWith("xNice. ")).toBe(true);
    expect(sent.reference_id).toBe("voice_felix");
    expect(sent.format).toBe("mp3");
  });

  it("IGNORES FISH_AUDIO_MODEL: the free model is the only one it asks for", async () => {
    // This used to assert the opposite. The override is gone on purpose — a
    // paid tier one env var away is a bill that arrives with nothing in the
    // product having said it would. See fishAudioModel in lib/fishAudio.ts.
    vi.stubEnv("FISH_AUDIO_MODEL", "s2.1-pro");
    await POST(voiceReq({ text: "Read this." }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).model).toBe("s2.1-pro-free");
  });

  it("charges the daily meter exactly once, on its own field, before the call", async () => {
    await POST(voiceReq({ text: "Read this." }));
    expect(reserveMeteredUse).toHaveBeenCalledTimes(1);
    expect(reserveMeteredUse.mock.calls[0][3]).toBe("voiceGens");
    expect(reserveMeteredUse.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0]
    );
  });

  it("429 when the day's meter is spent, without calling out", async () => {
    reserveMeteredUse.mockResolvedValue({ ok: false, used: 200 });
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the meter for local-dev, which has no Firestore to meter in", async () => {
    verifyVerifiedUser.mockResolvedValue("local-dev");
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(200);
    expect(reserveMeteredUse).not.toHaveBeenCalled();
  });
});

describe("/api/voice — the answer", () => {
  it("hands the bytes back as audio/mpeg, private and uncacheable", async () => {
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);
  });

  it("502 on an upstream failure, logging the status and neither the text nor the key", async () => {
    fetchMock.mockResolvedValue(upstream(402));
    const res = await POST(voiceReq({ text: "Something personal about my interview." }));
    expect(res.status).toBe(502);
    const logged = errorLog.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("402");
    expect(logged).not.toContain("personal");
    expect(logged).not.toContain("fk_test_secret");
  });

  it("502 when Fish Audio times out", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const res = await POST(voiceReq({ text: "Read this." }));
    expect(res.status).toBe(502);
  });
});

/* ---------------------------------------------------------------------------
   The session path: { sessionId } reads Felix's take off the caller's own
   doc, reads it aloud, and keeps the MP3 on the doc's felix/voice
   subdocument so a replay on any device never pays for a second synthesis.
   --------------------------------------------------------------------------- */

const TAKE =
  "Confident start. Your opening line was plain and it landed. The close ran away from you. Next time, stop before the last line and count two.";
const SESSION = "users/uid_1/sessions/s1";
const CACHE = `${SESSION}/felix/voice`;

function withTake(over: Record<string, unknown> = {}) {
  db!.data.set(SESSION, {
    id: "s1",
    createdAt: 1,
    analysis: { overall: 74, summary: "x" },
    felix: { text: TAKE, version: FELIX_TAKE_VERSION, generatedAt: 1, source: "model", ...over },
  });
}

describe("/api/voice — a session's take", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => upstream());
  });

  it("reads the doc's take, not the request's text, and caches the bytes", async () => {
    withTake();
    const res = await POST(voiceReq({ sessionId: "s1", text: "Say something else entirely." }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-felix-voice")).toBe("fresh");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).text).toBe(TAKE);
    expect(reserveMeteredUse).toHaveBeenCalledTimes(1);
    const cached = db!.data.get(CACHE)!;
    expect(cached.byteLength).toBe(MP3.byteLength);
    expect(cached.contentType).toBe("audio/mpeg");
    expect(typeof cached.textHash).toBe("string");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);
  });

  it("a second ask is served from the cache: no synthesis, no meter", async () => {
    withTake();
    await POST(voiceReq({ sessionId: "s1" }));
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-felix-voice")).toBe("cached");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reserveMeteredUse).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);
  });

  it("a rewritten take gets a fresh voice, not the old clip", async () => {
    withTake();
    await POST(voiceReq({ sessionId: "s1" }));
    withTake({ text: "A different take. Plain opening, rushed close, count two before the last line next time." });
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.headers.get("x-felix-voice")).toBe("fresh");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /* A clip is the take, the voice, AND the model. Keying the cache on the
     text alone meant changing FISH_AUDIO_VOICE_ID gave Felix a new voice on
     new reports while every report anyone had already opened kept the old
     one for good. The operator changes one setting and expects one voice. */
  it("a new voice re-synthesizes the same take, and replaces the clip", async () => {
    withTake();
    await POST(voiceReq({ sessionId: "s1" }));
    expect(db!.data.get(CACHE)!.voiceId).toBe("voice_felix");

    vi.stubEnv("FISH_AUDIO_VOICE_ID", "voice_new");
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.headers.get("x-felix-voice")).toBe("fresh");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).reference_id).toBe("voice_new");
    // Replaced, not appended: the next play is a hit again.
    expect(db!.data.get(CACHE)!.voiceId).toBe("voice_new");
    const again = await POST(voiceReq({ sessionId: "s1" }));
    expect(again.headers.get("x-felix-voice")).toBe("cached");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cannot be knocked off the free model by the environment", async () => {
    // The cache keys on model as well as voice, so this once proved that a
    // model change invalidated a clip. The model can no longer change from the
    // environment, so what it proves now is the stronger thing: the cached
    // clip stays a HIT, because nothing about the request moved.
    withTake();
    await POST(voiceReq({ sessionId: "s1" }));
    vi.stubEnv("FISH_AUDIO_MODEL", "s2.1-pro");
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.headers.get("x-felix-voice")).toBe("cached");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db!.data.get(CACHE)!.model).toBe("s2.1-pro-free");
  });

  it("dropping back to the stock voice is a change too, not a hit", async () => {
    withTake();
    await POST(voiceReq({ sessionId: "s1" }));
    vi.stubEnv("FISH_AUDIO_VOICE_ID", "");
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.headers.get("x-felix-voice")).toBe("fresh");
    expect(db!.data.get(CACHE)!.voiceId).toBeNull();
  });

  it("409 when Felix hasn't written a take for it yet", async () => {
    db!.data.set(SESSION, { id: "s1", createdAt: 1, analysis: { overall: 74, summary: "x" } });
    expect((await POST(voiceReq({ sessionId: "s1", text: TAKE }))).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("409 for a stored fallback or an older version: only a real take is voiced", async () => {
    withTake({ source: "fallback" });
    expect((await POST(voiceReq({ sessionId: "s1" }))).status).toBe(409);
    withTake({ version: FELIX_TAKE_VERSION - 1 });
    expect((await POST(voiceReq({ sessionId: "s1" }))).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* The session document is the BROWSER's to write (lib/store.ts), so the
     take on it is caller-controlled text, not server data. An email-verified
     user who pasted a novel into felix.text used to have every character of
     it read aloud by Fish Audio, which bills per character: the daily meter
     caps how many syntheses they buy, never how big each one is. Both halves
     of the fix are pinned here, because each one alone leaves a hole. */
  it("refuses a stored take longer than Felix is allowed to speak", async () => {
    withTake({ text: "word ".repeat(FELIX_TAKE_MAX_WORDS + 1).trim() });
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reserveMeteredUse).not.toHaveBeenCalled();
  });

  it("caps the stored take's characters too, since seventy words can still be huge", async () => {
    // Ten words, half a megabyte: under the word ceiling, far over the one
    // that costs money.
    const bloated = Array.from({ length: 10 }, () => "a".repeat(50_000)).join(" ");
    withTake({ text: bloated });
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.status).toBe(200);
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      text: string;
    };
    expect(sent.text.length).toBe(VOICE_TEXT_MAX);
  });

  it("sanitises the stored take, exactly as it sanitises posted text", async () => {
    withTake({ text: `<script>steal()</script>${TAKE}` });
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.status).toBe(200);
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      text: string;
    };
    expect(sent.text).toBe(`steal()${TAKE}`);
    expect(sent.text).not.toContain("<");
  });

  it("404 for someone else's session, by construction of the path", async () => {
    withTake();
    const res = await POST(voiceReq({ sessionId: "s2" }));
    expect(res.status).toBe(404);
    expect(db!.doc).toHaveBeenCalledWith("users/uid_1/sessions/s2");
  });

  it("a session id that isn't one falls through to the text path", async () => {
    const res = await POST(voiceReq({ sessionId: "../../x", text: "Read this." }));
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).text).toBe("Read this.");
    expect(db!.doc).not.toHaveBeenCalledWith(expect.stringContaining("sessions"));
  });

  it("in local dev the take's text rides along, since there is no doc to read", async () => {
    verifyVerifiedUser.mockResolvedValue("local-dev");
    const res = await POST(voiceReq({ sessionId: "s1", text: TAKE }));
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).text).toBe(TAKE);
  });

  it("a cache that can't be written is a clip that still plays", async () => {
    withTake();
    const real = db!.doc;
    (db as FakeDb).doc = vi.fn((path: string) => {
      const ref = real(path);
      return path === CACHE
        ? { ...ref, set: async () => { throw new Error("unavailable"); } }
        : ref;
    }) as unknown as FakeDb["doc"];
    const res = await POST(voiceReq({ sessionId: "s1" }));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);
  });
});
