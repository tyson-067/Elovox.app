import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { makeAdminDb, type AdminFakeDb } from "../helpers/admin-firestore";

type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   The Ops tab is the only place an operator can SEE the global AI spend
   ceiling (lib/opsMetrics.ts) working. The counters behind it — the day's
   estimated cents and the per-route paid-call counts — ship on the same
   opsDaily documents as the pipeline health numbers, but GET /api/admin/ops
   whitelists the fields it returns, so a counter that is written and not
   listed is a counter nobody can read.

   That gap is worse than it sounds: the breaker's warning fires at 75% and
   says "raise AI_DAILY_CEILING_USD if this is real traffic". An operator who
   cannot see the trend, or which route is spending, has no way to tell real
   traffic from a fraud spike, which is the entire decision the alert asks
   them to make. These pin the fields onto the response.
   --------------------------------------------------------------------------- */

let db: AdminFakeDb;
let adminIdentity: AnyMock;

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminDb: () => db,
  getAdminApp: () => ({}),
}));
vi.mock("@/lib/rateLimit", () => ({ limited: async () => false }));
vi.mock("@/lib/verify", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  adminIdentity: (...a: unknown[]) => adminIdentity(...a),
}));
// verify.ts imports this at module scope; the GET path never calls it.
vi.mock("firebase-admin/app-check", () => ({
  getAppCheck: () => ({ verifyToken: async () => ({}) }),
}));
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
// Everything but `after`, which throws outside a real request scope. Running
// the callback inline keeps the purge under test rather than silently dropped.
vi.mock("next/server", async (orig) => {
  const mod = await orig<Record<string, unknown>>();
  return { ...mod, after: (fn: () => unknown) => void fn() };
});
vi.mock("@/lib/opsMetrics", () => ({
  recordAdminDenied: vi.fn().mockResolvedValue(undefined),
  recordOpsEvent: vi.fn().mockResolvedValue(undefined),
  purgeExpiredOpsEvents: vi.fn().mockResolvedValue(0),
  invalidateOpsFlagsCache: vi.fn(),
}));

const ops = await import("@/app/api/admin/ops/route");

const SPENDY_DAY = {
  runs: 12,
  ok: 10,
  totalMsSum: 24_000,
  totalMsCount: 12,
  aiCostCents: 137,
  aiOps: 25,
  aiOpsAnalyze: 12,
  aiOpsSpeech: 8,
  aiOpsFelix: 5,
};

interface OpsDay {
  date: string;
  runs: number;
  avgTotalMs: number | null;
  aiCostCents: number;
  aiOps: number;
  aiOpsAnalyze: number;
  aiOpsSpeech: number;
  aiOpsFelix: number;
}

function opsReq() {
  return new Request("https://elovox.app/api/admin/ops", {
    headers: { "x-real-ip": "203.0.113.5", authorization: "Bearer tok" },
  }) as never;
}

async function days(): Promise<OpsDay[]> {
  const res = await ops.GET(opsReq());
  expect(res.status).toBe(200);
  return (await res.json()).days as OpsDay[];
}

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "ops@elovox.app");
  adminIdentity = vi.fn().mockResolvedValue({ uid: "adminuid", email: "ops@elovox.app" });
  db = makeAdminDb({ "opsDaily/2026-09-01": { ...SPENDY_DAY } });
});

describe("GET /api/admin/ops exposes the spend-ceiling counters", () => {
  it("returns the day's estimated spend and every per-route call count", async () => {
    const [day] = await days();
    expect(day).toMatchObject({
      date: "2026-09-01",
      aiCostCents: 137,
      aiOps: 25,
      aiOpsAnalyze: 12,
      aiOpsSpeech: 8,
      aiOpsFelix: 5,
    });
  });

  it("reports a day that spent nothing as zero, not as a missing field", async () => {
    // opsDaily documents predate the ceiling, and a quiet day never touches
    // the spend fields at all. A chart that reads `undefined` as a gap draws
    // the wrong shape; the route's num() must floor them to 0.
    db = makeAdminDb({ "opsDaily/2026-09-01": { runs: 3, ok: 3 } });
    const [day] = await days();
    expect(day.aiCostCents).toBe(0);
    expect(day.aiOps).toBe(0);
    expect(day.aiOpsAnalyze).toBe(0);
    expect(day.aiOpsSpeech).toBe(0);
    expect(day.aiOpsFelix).toBe(0);
  });

  it("keeps the pipeline-health fields it already returned", async () => {
    // The counters are additive. The Ops tab charts these, and dropping one
    // while adding another would be a silent regression in the same response.
    const [day] = await days();
    expect(day.runs).toBe(12);
    expect(day.avgTotalMs).toBe(2000);
  });

  it("still answers a flat 404 to a non-operator, spend counters and all", async () => {
    // The counters are cost intelligence: how much the product spends a day
    // and on which route. The 404 is what keeps the console from advertising
    // its own existence, and it must come first.
    adminIdentity = vi.fn().mockResolvedValue(null);
    const res = await ops.GET(opsReq());
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("aiCostCents");
  });
});
