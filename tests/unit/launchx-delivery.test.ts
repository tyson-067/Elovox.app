import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

// The delivery path is where a student's voice rests on our side, so what is
// pinned here is the promise made to LaunchX and to /privacy: the link only
// works with the right token, only for 24 hours, a failed hand-off keeps the
// copy for a retry, and a confirmed one deletes it.

// Module-level state, read lazily by the mocks below. vi.mock calls are
// hoisted above everything, so state declared inside a describe is out of
// their reach (tests/unit/api-hygiene.test.ts does the same).
let routeDb: Firestore;
let dbAvailable = true;
let limited: Response | null = null;

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminDb: () => (dbAvailable ? routeDb : null),
  getAdminApp: () => ({}),
}));
vi.mock("@/lib/rateLimit", () => ({
  limitOr429: async () => limited,
}));

/** A just-enough Firestore: collection().doc() with set/get/delete. */
function fakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const snap = (key: string, mask?: string[]) => ({
    exists: store.has(key),
    data: () => {
      const d = store.get(key);
      if (!d || !mask) return d;
      return Object.fromEntries(Object.entries(d).filter(([k]) => mask.includes(k)));
    },
  });
  const docRef = (c: string, id: string) => {
    const key = `${c}/${id}`;
    return {
      _key: key,
      set: async (d: Record<string, unknown>) => void store.set(key, d),
      get: async () => snap(key),
      update: async (patch: Record<string, unknown>) => {
        if (!store.has(key)) throw new Error("NOT_FOUND");
        store.set(key, { ...store.get(key), ...patch });
      },
      delete: async () => void store.delete(key),
    };
  };
  const db = {
    collection: (c: string) => ({
      doc: (id: string) => docRef(c, id),
      // where("expiresAt", "<=", n).select().limit(k).get()
      where: (_f: string, _op: string, n: number) => ({
        select: () => ({
          limit: (k: number) => ({
            get: async () => {
              const docs = [...store.entries()]
                .filter(([key, v]) => key.startsWith(`${c}/`) && (v.expiresAt as number) <= n)
                .slice(0, k)
                .map(([key]) => ({ ref: { _key: key } }));
              return { empty: docs.length === 0, size: docs.length, docs };
            },
          }),
        }),
      }),
    }),
    getAll: async (ref: { _key: string }, opts?: { fieldMask?: string[] }) => [
      snap(ref._key, opts?.fieldMask),
    ],
    batch: () => {
      const pending: string[] = [];
      return {
        delete: (ref: { _key: string }) => void pending.push(ref._key),
        commit: async () => pending.forEach((k) => store.delete(k)),
      };
    },
  } as unknown as Firestore;
  return { db, store };
}

const lib = await import("@/lib/launchxDelivery");
const AUDIO = new Uint8Array([1, 2, 3, 4, 5]);
const input = {
  applicationId: "TEST-001",
  responseNumber: 1,
  bytes: AUDIO,
  contentType: "audio/webm",
};

describe("stageRecording / readRecording", () => {
  let db: Firestore;
  let store: Map<string, Record<string, unknown>>;
  beforeEach(() => ({ db, store } = fakeDb()));

  it("round-trips with the right token", async () => {
    const s = await lib.stageRecording(db, input);
    const hit = await lib.readRecording(db, s.id, s.token);
    expect(hit?.contentType).toBe("audio/webm");
    expect(Array.from(hit!.bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("stores only a hash of the token, never the token", async () => {
    const s = await lib.stageRecording(db, input);
    const doc = [...store.values()][0];
    expect(JSON.stringify(doc)).not.toContain(s.token);
    expect(doc.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("answers null for a wrong token, a malformed id, and an unknown id", async () => {
    const s = await lib.stageRecording(db, input);
    const other = "A".repeat(43);
    expect(await lib.readRecording(db, s.id, other)).toBeNull();
    expect(await lib.readRecording(db, "../etc", s.token)).toBeNull();
    expect(await lib.readRecording(db, "0000000000000000-r1", s.token)).toBeNull();
  });

  it("expires after 24 hours and sweeps the document", async () => {
    const t0 = 1_000_000;
    const s = await lib.stageRecording(db, { ...input, now: t0 });
    expect(s.expiresAt).toBe(t0 + lib.LINK_TTL_MS);
    expect(await lib.readRecording(db, s.id, s.token, t0 + lib.LINK_TTL_MS - 1)).not.toBeNull();
    expect(await lib.readRecording(db, s.id, s.token, t0 + lib.LINK_TTL_MS)).toBeNull();
    expect(store.size).toBe(0);
  });

  it("shortens the link's life after a successful fetch, so it is not replayable for a day", async () => {
    const t0 = 5_000_000;
    const s = await lib.stageRecording(db, { ...input, now: t0 });
    expect(await lib.readRecording(db, s.id, s.token, t0 + 1000)).not.toBeNull();
    const doc = [...store.values()][0];
    expect(doc.fetchedAt).toBe(t0 + 1000);
    expect(doc.expiresAt).toBe(t0 + 1000 + lib.REFETCH_WINDOW_MS);
    // A retry inside the window still works; after it, the link is dead.
    expect(await lib.readRecording(db, s.id, s.token, t0 + 60_000)).not.toBeNull();
    expect(await lib.readRecording(db, s.id, s.token, t0 + 1000 + lib.REFETCH_WINDOW_MS + 1)).toBeNull();
  });

  it("never lets an unauthenticated caller delete or learn about an expired document", async () => {
    const t0 = 1_000_000;
    const s = await lib.stageRecording(db, { ...input, now: t0 });
    const wrong = "C".repeat(43);
    expect(await lib.readRecording(db, s.id, wrong, t0 + lib.LINK_TTL_MS + 1)).toBeNull();
    expect(store.size).toBe(1); // untouched: only the real token may sweep it
  });

  it("reads only the small fields until the token has matched", async () => {
    const s = await lib.stageRecording(db, input);
    const getAll = vi.spyOn(db, "getAll");
    await lib.readRecording(db, s.id, "D".repeat(43));
    expect(getAll).toHaveBeenCalledWith(expect.anything(), {
      fieldMask: ["tokenHash", "expiresAt", "contentType"],
    });
  });

  it("restaging the same response replaces the copy and kills the old link", async () => {
    const a = await lib.stageRecording(db, input);
    const b = await lib.stageRecording(db, input);
    expect(b.id).toBe(a.id);
    expect(store.size).toBe(1);
    expect(await lib.readRecording(db, a.id, a.token)).toBeNull();
    expect(await lib.readRecording(db, b.id, b.token)).not.toBeNull();
  });

  it.each([
    [{ applicationId: "  " }, "bad-application-id"],
    [{ responseNumber: 0 }, "bad-response-number"],
    [{ responseNumber: 11 }, "bad-response-number"],
    [{ contentType: "audio/mpeg" }, "bad-content-type"],
    [{ bytes: new Uint8Array(0) }, "empty"],
    [{ bytes: new Uint8Array(lib.MAX_RECORDING_BYTES + 1) }, "too-large"],
  ])("rejects bad input %#", async (patch, code) => {
    await expect(lib.stageRecording(db, { ...input, ...patch })).rejects.toMatchObject({ code });
    expect(store.size).toBe(0);
  });
});

describe("deliverRecording", () => {
  const ok = () => new Response(JSON.stringify({ ok: true, record_id: "r-1" }), { status: 200 });

  it("sends the LaunchX request shape and deletes our copy on success", async () => {
    const { db, store } = fakeDb();
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const r = await lib.deliverRecording(
      db,
      { endpointBase: "https://zite.test/api/", apiKey: "k", fetchImpl },
      { ...input, baseUrl: "https://elovox.app/", fileName: "TEST-001-r1.webm" }
    );
    expect(r).toMatchObject({ ok: true, recordId: "r-1" });
    expect(store.size).toBe(0);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://zite.test/api/receiveRecording");
    const sent = JSON.parse(init.body).inputs;
    expect(sent).toMatchObject({
      api_key: "k",
      application_id: "TEST-001",
      response_number: 1,
      content_type: "audio/webm",
      size_bytes: 5,
      file_name: "TEST-001-r1.webm",
    });
    expect(sent.file_url).toMatch(/^https:\/\/elovox\.app\/api\/launchx\/file\/[a-f0-9]{16}-r1\?t=[A-Za-z0-9_-]{43}$/);
    // The candidate's email is never part of what we send.
    expect(sent).not.toHaveProperty("candidate_email");
  });

  it("keeps our copy when LaunchX refuses, so a retry can succeed", async () => {
    const { db, store } = fakeDb();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: "could not download" }), { status: 400 }));
    const r = await lib.deliverRecording(
      db,
      { endpointBase: "https://zite.test/api", apiKey: "k", fetchImpl },
      { ...input, baseUrl: "https://elovox.app" }
    );
    expect(r).toMatchObject({ ok: false, status: 400, message: "could not download" });
    expect(store.size).toBe(1);
  });
});

describe("hand-off safety", () => {
  const ok = () => new Response(JSON.stringify({ ok: true, record_id: "r-1" }), { status: 200 });

  it("a stale delivery's success does not delete a newer copy of the same response", async () => {
    const { db, store } = fakeDb();
    const first = await lib.stageRecording(db, input);
    const second = await lib.stageRecording(db, input); // same id, new token
    expect(await lib.deleteRecordingIfCurrent(db, first.id, first.token)).toBe(false);
    expect(store.size).toBe(1);
    expect(await lib.deleteRecordingIfCurrent(db, second.id, second.token)).toBe(true);
    expect(store.size).toBe(0);
  });

  it("refuses to follow redirects, so the key cannot be replayed elsewhere", async () => {
    const { db } = fakeDb();
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    await lib.deliverRecording(
      db,
      { endpointBase: "https://zite.test/api", apiKey: "k", fetchImpl },
      { ...input, baseUrl: "https://elovox.app" }
    );
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });

  it("refuses a non-https endpoint before sending anything", async () => {
    const fetchImpl = vi.fn();
    await expect(
      lib.deliverScore(
        { endpointBase: "http://zite.test/api", apiKey: "k", fetchImpl },
        { applicationId: "TEST-001", score: 1 }
      )
    ).rejects.toThrow(/https/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caps and scrubs LaunchX's error text so a key can never come back out", async () => {
    const leaky = "bad key sekret-key-123 " + "x".repeat(500);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: leaky }), { status: 401 }));
    const r = await lib.deliverScore(
      { endpointBase: "https://zite.test/api", apiKey: "sekret-key-123", fetchImpl },
      { applicationId: "TEST-001", score: 1 }
    );
    expect(r.message).not.toContain("sekret-key-123");
    expect(r.message!.length).toBeLessThanOrEqual(200);
  });

  it("a non-string application id is a DeliveryError, not a TypeError", async () => {
    const { db } = fakeDb();
    await expect(
      lib.stageRecording(db, { ...input, applicationId: 42 as unknown as string })
    ).rejects.toMatchObject({ code: "bad-application-id" });
  });
});

describe("purgeExpiredLaunchxDeliveries", () => {
  it("removes expired recordings that nobody ever fetched, and keeps live ones", async () => {
    const { db, store } = fakeDb();
    const t0 = 1_000_000;
    await lib.stageRecording(db, { ...input, applicationId: "OLD", now: t0 });
    await lib.stageRecording(db, { ...input, applicationId: "NEW", now: t0 + lib.LINK_TTL_MS });
    expect(store.size).toBe(2);
    const n = await lib.purgeExpiredLaunchxDeliveries(db, 200, t0 + lib.LINK_TTL_MS + 1);
    expect(n).toBe(1);
    expect(store.size).toBe(1);
    expect(await lib.purgeExpiredLaunchxDeliveries(db, 200, t0 + lib.LINK_TTL_MS + 1)).toBe(0);
  });
});

describe("deliverScore", () => {
  it("posts the score without a candidate email", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const r = await lib.deliverScore(
      { endpointBase: "https://zite.test/api", apiKey: "k", fetchImpl },
      { applicationId: "TEST-001", score: 72.5, maxScore: 100 }
    );
    expect(r.ok).toBe(true);
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body).inputs;
    expect(sent).toEqual({ api_key: "k", application_id: "TEST-001", score: 72.5, max_score: 100 });
  });
});

describe("GET /api/launchx/file/[id]", () => {
  let db: Firestore;

  beforeEach(() => {
    ({ db } = fakeDb());
    routeDb = db;
    dbAvailable = true;
    limited = null;
  });

  const call = async (id: string, token: string) => {
    const { GET } = await import("@/app/api/launchx/file/[id]/route");
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest(`https://elovox.app/api/launchx/file/${id}?t=${token}`), {
      params: Promise.resolve({ id }),
    });
  };

  it("serves the bytes with no-store and nosniff headers", async () => {
    const s = await lib.stageRecording(db, input);
    const res = await call(s.id, s.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/webm");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO);
  });

  it("answers the same 404 for a wrong token and an unknown id", async () => {
    const s = await lib.stageRecording(db, input);
    const wrong = await call(s.id, "B".repeat(43));
    const unknown = await call("0000000000000000-r1", s.token);
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("refuses a malformed request before touching the limiter or the database", async () => {
    dbAvailable = false; // would be a 503 if it got that far
    limited = new Response("{}", { status: 429 }); // ditto
    expect((await call("not-an-id", "short")).status).toBe(404);
  });

  it("sets no-referrer and keeps misses out of caches", async () => {
    const s = await lib.stageRecording(db, input);
    expect((await call(s.id, s.token)).headers.get("referrer-policy")).toBe("no-referrer");
    const miss = await call(s.id, "E".repeat(43));
    expect(miss.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers 503 with no database and passes a 429 through", async () => {
    const s = await lib.stageRecording(db, input);
    dbAvailable = false;
    expect((await call(s.id, s.token)).status).toBe(503);
    dbAvailable = true;
    limited = new Response("{}", { status: 429 });
    expect((await call(s.id, s.token)).status).toBe(429);
  });
});
