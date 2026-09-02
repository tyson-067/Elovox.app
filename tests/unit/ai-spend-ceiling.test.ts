import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { makeDb, type FakeDb } from "../helpers/firestore-fake";
import type { Analysis } from "@/lib/types";

type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   The GLOBAL daily AI spend ceiling (lib/opsMetrics.ts).

   Per-user and per-IP limits bound one account and one address; nothing bound
   the total, so a set of accounts each politely inside its own limit could run
   up an upstream bill many times the day's revenue with every limiter
   reporting green. What these pin:

     - every paid call lands on ONE durable, day-keyed counter, and the analyze
       pipeline's counter costs no extra Firestore write;
     - the kill switch that spent nothing (`paused`) is not counted as spend;
     - the ceiling is env-configurable, reads are cached per instance, and a
       Firestore failure fails OPEN — a database blip must never be able to
       refuse paying customers;
     - /api/flags, polled by every client, pays nothing for any of it;
     - crossing three quarters, and the ceiling itself, tells an operator on
       the path that already exists (billingAlerts), once per level;
     - a route with a graceful answer degrades to it rather than erroring, and
       the answer never mentions money.
   --------------------------------------------------------------------------- */

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    delete: () => ({ __sentinel: "delete" }),
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
    increment: (n: number) => ({ __sentinel: "increment", n }),
  },
  Timestamp: {
    now: () => ({ toMillis: () => Date.now() }),
    fromMillis: (ms: number) => ({ toMillis: () => ms }),
  },
  FieldPath: { documentId: () => "__name__" },
}));

/**
 * The shared fake stores whatever it is handed, so an increment sentinel would
 * sit in the document as an object and every read of the day's spend would be
 * NaN. This resolves the sentinel against the value already there, which is
 * the one Firestore behaviour these counters depend on.
 */
function makeCountingDb(seed: Record<string, Record<string, unknown>> = {}): FakeDb {
  const base = makeDb(seed);
  const doc = (path: string) => {
    const ref = base.doc(path);
    return {
      ...ref,
      set: async (v: Record<string, unknown>, opts?: { merge?: boolean }) => {
        const prev = base.data.get(path) ?? {};
        const resolved: Record<string, unknown> = {};
        for (const [k, value] of Object.entries(v)) {
          const inc = value as { __sentinel?: string; n?: number };
          resolved[k] =
            inc?.__sentinel === "increment"
              ? Number(prev[k] ?? 0) + Number(inc.n ?? 0)
              : value;
        }
        await ref.set(resolved, opts);
      },
    };
  };
  return { ...base, doc: vi.fn(doc) as unknown as FakeDb["doc"] };
}

const {
  getAiSpend,
  getOpsFlags,
  invalidateAiSpendCache,
  invalidateOpsFlagsCache,
  overAiSpendCeiling,
  recordAiOperation,
  recordAnalyzeOutcome,
  utcDayKey,
} = await import("@/lib/opsMetrics");

const DAY = () => `opsDaily/${utcDayKey()}`;
const cents = (db: FakeDb) => Number(db.data.get(DAY())?.aiCostCents ?? 0);

beforeEach(() => {
  invalidateAiSpendCache();
  invalidateOpsFlagsCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the durable daily counter", () => {
  it("counts an analysis on the counter doc the pipeline already writes", async () => {
    const db = makeCountingDb();
    await recordAnalyzeOutcome(db as never, { outcome: "ok", premium: true });
    const day = db.data.get(DAY())!;
    expect(day.runs).toBe(1);
    expect(day.aiOps).toBe(1);
    expect(day.aiOpsAnalyze).toBe(1);
    expect(day.aiCostCents).toBe(5);
    // The whole point of folding it into recordAnalyzeOutcome: the most
    // expensive route in the app pays no extra Firestore write for the
    // ceiling.
    expect(db.writes).toEqual([DAY()]);
  });

  it("charges the camera pass on top, because it is a second model call", async () => {
    const db = makeCountingDb();
    await recordAnalyzeOutcome(db as never, { outcome: "ok", premium: true, camera: true });
    expect(cents(db)).toBe(8);
  });

  it("counts a run that failed after transcription: we were billed for it anyway", async () => {
    const db = makeCountingDb();
    await recordAnalyzeOutcome(db as never, { outcome: "model-failed" });
    await recordAnalyzeOutcome(db as never, { outcome: "no-speech" });
    expect(db.data.get(DAY())!.aiOps).toBe(2);
  });

  it("does not count a run the kill switch refused, which spent nothing", async () => {
    const db = makeCountingDb();
    await recordAnalyzeOutcome(db as never, { outcome: "paused" });
    const day = db.data.get(DAY())!;
    expect(day.paused).toBe(1);
    expect(day.aiOps).toBeUndefined();
    expect(day.aiCostCents).toBeUndefined();
  });

  it("puts speech and Felix on the same counter, so the ceiling sees one bill", async () => {
    const db = makeCountingDb();
    await recordAiOperation(db as never, "speech");
    await recordAiOperation(db as never, "felix");
    await recordAnalyzeOutcome(db as never, { outcome: "ok" });
    const day = db.data.get(DAY())!;
    expect(day.aiOps).toBe(3);
    expect(day.aiOpsSpeech).toBe(1);
    expect(day.aiOpsFelix).toBe(1);
    expect(day.aiCostCents).toBe(8);
  });

  it("never throws when Firestore does; telemetry cannot break the money path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeCountingDb();
    (db as FakeDb).doc = vi.fn(() => ({
      get: async () => ({ exists: false, data: () => undefined }),
      set: async () => {
        throw new Error("unreachable");
      },
    })) as unknown as FakeDb["doc"];
    await expect(recordAiOperation(db as never, "speech")).resolves.toBeUndefined();
  });
});

describe("the ceiling itself", () => {
  it("is not reached on an ordinary day", async () => {
    const db = makeCountingDb({ [DAY()]: { aiCostCents: 1200 } });
    expect(await overAiSpendCeiling(db as never)).toBe(false);
  });

  it("reads the ceiling from AI_DAILY_CEILING_USD", async () => {
    vi.stubEnv("AI_DAILY_CEILING_USD", "10");
    const db = makeCountingDb({ [DAY()]: { aiCostCents: 999 } });
    expect(await getAiSpend(db as never)).toMatchObject({
      cents: 999,
      ceilingCents: 1000,
      near: true,
      over: false,
    });
    invalidateAiSpendCache();
    db.data.set(DAY(), { aiCostCents: 1000 });
    expect(await overAiSpendCeiling(db as never)).toBe(true);
  });

  it("falls back to a sane default when the env var is missing or nonsense", async () => {
    const db = makeCountingDb();
    for (const junk of ["", "0", "-5", "lots"]) {
      vi.stubEnv("AI_DAILY_CEILING_USD", junk);
      invalidateAiSpendCache();
      expect((await getAiSpend(db as never)).ceilingCents, junk).toBe(50_000);
    }
  });

  it("FAILS OPEN when the counter can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("AI_DAILY_CEILING_USD", "1");
    const db = makeCountingDb({ [DAY()]: { aiCostCents: 100_000 } });
    (db as FakeDb).doc = vi.fn(() => ({
      get: async () => {
        throw new Error("firestore unreachable");
      },
      set: async () => {},
    })) as unknown as FakeDb["doc"];
    // A database blip must not be able to refuse every paying customer. One
    // minute of unbounded spend on an almost-certainly-ordinary day is the
    // cheaper mistake.
    expect(await overAiSpendCeiling(db as never)).toBe(false);
  });

  it("reads once per instance-minute, and sees its own spending immediately", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("AI_DAILY_CEILING_USD", "1");
    const db = makeCountingDb({ [DAY()]: { aiCostCents: 93 } });
    expect(await overAiSpendCeiling(db as never)).toBe(false);
    const reads = (db.doc as unknown as AnyMock).mock.calls.length;
    expect(await overAiSpendCeiling(db as never)).toBe(false);
    expect((db.doc as unknown as AnyMock).mock.calls.length).toBe(reads); // cached
    // Seven more cents of spending from THIS instance is over the line, and
    // the instance must not wait out its own cache to notice.
    await recordAiOperation(db as never, "speech");
    await recordAnalyzeOutcome(db as never, { outcome: "ok" });
    expect(await overAiSpendCeiling(db as never)).toBe(true);
  });
});

describe("what the ceiling costs the routes that don't need it", () => {
  it("/api/flags style call reads only the flags doc", async () => {
    const db = makeCountingDb({ [DAY()]: { aiCostCents: 100_000 } });
    const flags = await getOpsFlags(db as never);
    expect(flags.aiSpendOver).toBeUndefined();
    const paths = (db.doc as unknown as AnyMock).mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["ops/flags"]);
  });

  it("the paid routes get the answer on the read they already pay for", async () => {
    vi.stubEnv("AI_DAILY_CEILING_USD", "1");
    const db = makeCountingDb({ [DAY()]: { aiCostCents: 500 } });
    const flags = await getOpsFlags(db as never, { withAiSpend: true });
    expect(flags.aiSpendOver).toBe(true);
    expect(flags.pauseAnalyze).toBe(false);
  });
});

describe("telling an operator", () => {
  const alertsIn = (db: FakeDb) =>
    [...db.data.keys()].filter((p) => p.startsWith("billingAlerts/"));

  it("raises a heads-up at three quarters, before anyone is refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("AI_DAILY_CEILING_USD", "1");
    const db = makeCountingDb({ [DAY()]: { aiCostCents: 73 } });
    await overAiSpendCeiling(db as never); // primes this instance's view
    await recordAiOperation(db as never, "speech"); // 75 of 100 cents
    const [path] = alertsIn(db);
    expect(path).toBe(`billingAlerts/ai-spend-near-${utcDayKey()}`);
    const alert = db.data.get(path)!;
    expect(alert.kind).toBe("ai-spend-ceiling");
    // Unresolved is what puts it in the admin Billing queue and in the daily
    // operator email; an alert nobody is shown is a note in a database.
    expect(alert.resolved).toBe(false);
    expect(String(alert.context)).toContain("AI_DAILY_CEILING_USD");
  });

  it("raises the real one when it trips, and neither one twice", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("AI_DAILY_CEILING_USD", "1");
    const db = makeCountingDb({ [DAY()]: { aiCostCents: 73 } });
    await overAiSpendCeiling(db as never);
    for (let i = 0; i < 20; i++) await recordAiOperation(db as never, "speech");
    expect(alertsIn(db).sort()).toEqual([
      `billingAlerts/ai-spend-near-${utcDayKey()}`,
      `billingAlerts/ai-spend-over-${utcDayKey()}`,
    ]);
    // A hot loop past the ceiling writes two documents, not two thousand.
    expect(db.writes.filter((p) => p.startsWith("billingAlerts/"))).toHaveLength(2);
  });

  it("says nothing at all on a normal day", async () => {
    const db = makeCountingDb();
    for (let i = 0; i < 5; i++) await recordAiOperation(db as never, "felix");
    expect(alertsIn(db)).toEqual([]);
  });
});

/* --- The graceful degrade ------------------------------------------------ */

let db: FakeDb | null;
let verifyVerifiedUser: AnyMock;
let generateJson: AnyMock;
let reserveMeteredUse: AnyMock;

vi.mock("@/lib/firebaseAdmin", () => ({ getAdminDb: () => db, getAdminApp: () => ({}) }));
vi.mock("@/lib/verify", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  verifyVerifiedUser: (...a: unknown[]) => verifyVerifiedUser(...a),
  enforceAppCheck: async () => null,
}));
vi.mock("@/lib/rateLimit", () => ({ limitOr429: async () => null, limited: async () => false }));
vi.mock("@/lib/moderation", () => ({
  isRestricted: async () => ({ blocked: false }),
  applyAutoStrike: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/quota", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  reserveMeteredUse: (...a: unknown[]) => reserveMeteredUse(...a),
}));
vi.mock("@/lib/gemini", () => ({
  generateJson: (...a: unknown[]) => generateJson(...a),
  geminiKey: () => "gk_test_secret",
}));

const { POST: felixPOST } = await import("@/app/api/felix/route");

const analysis: Analysis = {
  overall: 71,
  summary: "Steady open, hurried finish.",
  audienceImpact: "They leaned in early.",
  skills: [{ skill: "Clarity", score: 80, note: "Plain sentences." }],
  transcript: [{ text: "thank you all for coming", mark: "strong", time: "0:02", note: "Warm." }],
  tips: ["Slow the last line."],
  strengths: ["A plain opening."],
  paceWpm: 165,
  fillerWords: 2,
  pauses: 1,
};

describe("/api/felix over the ceiling", () => {
  const SESSION = "users/uid_1/sessions/s1";
  const req = () =>
    new Request("https://elovox.app/api/felix", {
      method: "POST",
      body: JSON.stringify({ sessionId: "s1" }),
    }) as never;

  beforeEach(() => {
    vi.stubEnv("AI_DAILY_CEILING_USD", "1");
    invalidateAiSpendCache();
    verifyVerifiedUser = vi.fn().mockResolvedValue("uid_1");
    generateJson = vi.fn().mockResolvedValue({ text: "unused" });
    reserveMeteredUse = vi.fn().mockResolvedValue({ ok: true, used: 1 });
    db = makeCountingDb({
      [SESSION]: { id: "s1", analysis, goal: "Sound calm" },
      [DAY()]: { aiCostCents: 100 },
    });
  });

  it("still answers, with a take built from the user's own report", async () => {
    const res = await felixPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Not a 500, not an error the user has to act on, and not a word about
    // what a ceiling is.
    expect(body.take.source).toBe("fallback");
    expect(body.take.text).toContain("Steady open, hurried finish.");
    expect(JSON.stringify(body)).not.toMatch(/spend|ceiling|budget|cost/i);
    // Nothing paid for, and the user's own daily allowance is untouched.
    expect(generateJson).not.toHaveBeenCalled();
    expect(reserveMeteredUse).not.toHaveBeenCalled();
    expect(body.persisted).toBe(false);
  });

  it("still serves a take that was already written and paid for", async () => {
    db!.data.set(SESSION, {
      ...db!.data.get(SESSION),
      felix: {
        text: "A take from before the busy day, forty words long, already paid for once.",
        version: (await import("@/lib/felixTake")).FELIX_TAKE_VERSION,
        generatedAt: Date.now(),
        source: "model",
      },
    });
    const body = await (await felixPOST(req())).json();
    expect(body.cached).toBe(true);
    expect(generateJson).not.toHaveBeenCalled();
  });
});
