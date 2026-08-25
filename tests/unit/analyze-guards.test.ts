import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { makeDb, type FakeDb } from "../helpers/firestore-fake";

type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   /api/analyze is the expensive route: every accepted request spends real
   money at AssemblyAI and Gemini. Its guards are cost control, and two of them
   exist because of specific incidents recorded in the file — an unbounded body
   that could OOM the instance, and a duration check strict enough that a
   full-length recording was always refused.
   --------------------------------------------------------------------------- */

let db: FakeDb;
let verifyVerifiedUser: AnyMock;
let limitOr429: AnyMock;
let enforceAppCheck: AnyMock;
let opsFlags: Record<string, unknown>;
let isRestricted: AnyMock;

vi.mock("@/lib/firebaseAdmin", () => ({ getAdminDb: () => db, getAdminApp: () => ({}) }));
vi.mock("@/lib/verify", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  verifyVerifiedUser: (...a: unknown[]) => verifyVerifiedUser(...a),
  enforceAppCheck: (...a: unknown[]) => enforceAppCheck(...a),
  isPremiumServer: async () => "free",
}));
vi.mock("@/lib/rateLimit", () => ({
  limitOr429: (...a: unknown[]) => limitOr429(...a),
  limited: async () => false,
}));
vi.mock("@/lib/opsMetrics", () => ({
  getOpsFlags: async () => opsFlags,
  recordAnalyzeOutcome: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/moderation", () => ({
  isRestricted: (...a: unknown[]) => isRestricted(...a),
  applyAutoStrike: vi.fn().mockResolvedValue(undefined),
}));

const { POST } = await import("@/app/api/analyze/route");

/** A multipart request whose Content-Length we control independently. */
function analyzeReq(opts: { contentLength?: string | null; durationSec?: string; audioBytes?: number } = {}) {
  const { contentLength = "1000", durationSec = "30", audioBytes = 1024 } = opts;
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(audioBytes)], { type: "audio/webm" }), "take.webm");
  form.set("durationSec", durationSec);
  form.set("category", "daily");
  form.set("prompt", "The Unsung Hero");

  const req = new Request("https://elovox.app/api/analyze", { method: "POST", body: form });
  // Override whatever the runtime computed, so the header can be absent or lie.
  const headers = new Headers(req.headers);
  if (contentLength === null) headers.delete("content-length");
  else headers.set("content-length", contentLength);
  return new Request(req, { headers }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = makeDb();
  opsFlags = {};
  verifyVerifiedUser = vi.fn().mockResolvedValue("uid_1") as AnyMock;
  limitOr429 = vi.fn().mockResolvedValue(null) as AnyMock;
  enforceAppCheck = vi.fn().mockResolvedValue(null) as AnyMock;
  // The route reads restriction.blocked directly — a null here would throw
  // inside the route rather than exercise the guard.
  isRestricted = vi.fn().mockResolvedValue({ blocked: false }) as AnyMock;
});
afterEach(() => vi.restoreAllMocks());

describe("who may spend money here", () => {
  it("401s a signed-out caller", async () => {
    verifyVerifiedUser.mockResolvedValue(null);
    expect((await POST(analyzeReq())).status).toBe(401);
  });

  it("403s an unconfirmed email", async () => {
    verifyVerifiedUser.mockResolvedValue("unverified");
    expect((await POST(analyzeReq())).status).toBe(403);
  });

  it("returns the rate limiter's own response when capped", async () => {
    limitOr429.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await POST(analyzeReq())).status).toBe(429);
  });

  it("honours an App Check rejection", async () => {
    // A valid ID token proves WHO is calling, not that the call came from our
    // client. Without this a script can drive paid spend from curl.
    enforceAppCheck.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await POST(analyzeReq())).status).toBe(403);
  });

  it("503s while the operator brake is on", async () => {
    opsFlags = { pauseAnalyze: true };
    const res = await POST(analyzeReq());
    expect(res.status).toBe(503);
  });

  it("403s a restricted account", async () => {
    isRestricted.mockResolvedValue({
      blocked: true,
      state: "suspended",
      until: Date.now() + 86_400_000,
    });
    expect((await POST(analyzeReq())).status).toBe(403);
  });
});

describe("body size — the check runs BEFORE the body is buffered", () => {
  it("413s a request that declares more than the ceiling", async () => {
    const tooBig = String(25 * 1024 * 1024 + 12 * 400 * 1024 + 1024 * 1024 + 1);
    expect((await POST(analyzeReq({ contentLength: tooBig }))).status).toBe(413);
  });

  it("413s a request with NO Content-Length rather than trusting it", async () => {
    // Reading the header with `?? 0` meant a request that simply omitted it —
    // chunked transfer encoding does — sailed past with a declared size of
    // zero and reached formData() unbounded. That is the exact OOM the check
    // was added to stop, one missing header away. Next route handlers have no
    // default body limit; bodySizeLimit applies to Server Actions only.
    const res = await POST(analyzeReq({ contentLength: null }));
    expect(res.status).toBe(413);
  });

  it("413s a non-numeric Content-Length", async () => {
    expect((await POST(analyzeReq({ contentLength: "not-a-number" }))).status).toBe(413);
  });

  it("lets an ordinary request through the size gate", async () => {
    // It will fail later for want of API keys, but it must not be a 413.
    expect((await POST(analyzeReq({ contentLength: "50000" }))).status).not.toBe(413);
  });
});

describe("claimed duration", () => {
  it("413s a genuinely impossible claim", async () => {
    expect((await POST(analyzeReq({ durationSec: "5000" }))).status).toBe(413);
  });

  it("accepts a full-length take whose measured duration overshoots slightly", async () => {
    // THE regression the grace exists for. The client stops itself at exactly
    // MAX_RECORDING_SEC and measures with performance.now(), so a take that
    // runs the full ten minutes reports 600.2 or 600.4 — whatever the stop
    // handler cost. Compared strictly, `600.2 > 600` is TRUE, so the runaway
    // guard produced a recording this endpoint then ALWAYS refused, and the
    // ten minutes behind it were gone.
    for (const d of ["600", "600.2", "600.9", "604"]) {
      const res = await POST(analyzeReq({ durationSec: d }));
      expect(res.status, `durationSec=${d}`).not.toBe(413);
    }
  });

  it("still refuses past the grace window", async () => {
    expect((await POST(analyzeReq({ durationSec: "606" }))).status).toBe(413);
  });

  it("treats an unparseable duration as unknown rather than NaN", async () => {
    // `|| 0` turns NaN into 0, which computeMetrics reads as "unknown
    // duration" instead of producing a NaN or negative pace on the report.
    expect((await POST(analyzeReq({ durationSec: "abc" }))).status).not.toBe(413);
  });

  it("does not clamp an over-long claim into a fabricated denominator", async () => {
    // Clamping silently rewrote the claim to 600 and then computed paceWpm
    // against a number the user never recorded — and made this 413 branch
    // unreachable. An impossible duration is refused, not fudged.
    expect((await POST(analyzeReq({ durationSec: "99999" }))).status).toBe(413);
  });
});
