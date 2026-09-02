import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

/** vi.fn() defaults to a signature TS will not let you call with arguments. */
type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   Four things a route can get wrong that no type catches, each pinned here
   because each one was live:

     1. An upstream's error text handed to the browser. Stripe writes its
        messages for whoever holds the API key — they name price ids, customer
        ids and account configuration — and both money routes were forwarding
        them verbatim into the page.
     2. A query parameter used as an object key. `?type=constructor` found a
        function on Object.prototype, passed the "do we know this template?"
        guard, and was called, so a request for a name we do not have answered
        500 instead of showing the index.
     3. A body read that skipped lib/requestBody.ts. Its header calls itself
        "one way in for every JSON request body" and applies a size cap; the
        admin routes went around it, which made that sentence false.
     4. A guard that reads one document and writes another, outside a
        transaction. Two accounts redeeming each other's invite at the same
        moment both passed the reciprocity check and minted 400 XP.
   --------------------------------------------------------------------------- */

/* --- Shared module doubles ------------------------------------------------ */

let db: unknown;
let dbAvailable = true;
let limited: AnyMock;
let verifyVerifiedUser: AnyMock;
let verifyUser: AnyMock;
let opsFlags: Record<string, unknown>;
let stripeClient: unknown;
let sessionsCreate: AnyMock;
let portalCreate: AnyMock;

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminDb: () => (dbAvailable ? db : null),
  getAdminApp: () => ({}),
}));
// Partial: adminIdentity and clientIp stay REAL, so the admin suite below
// exercises the actual allow-list rather than a boolean someone set.
vi.mock("@/lib/verify", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  verifyVerifiedUser: (...a: unknown[]) => verifyVerifiedUser(...a),
  verifyUser: (...a: unknown[]) => verifyUser(...a),
}));
vi.mock("@/lib/rateLimit", () => ({ limited: (...a: unknown[]) => limited(...a) }));
vi.mock("@/lib/opsMetrics", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getOpsFlags: async () => opsFlags,
}));
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getStripe: () => (stripeClient === null ? null : stripeClient),
}));
// The real sentinels are opaque objects; these are structural so the store
// below can recognise them.
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
    increment: (n: number) => ({ __sentinel: "increment", n }),
    delete: () => ({ __sentinel: "delete" }),
  },
  Timestamp: {
    now: () => ({ toMillis: () => Date.now() }),
    fromMillis: (ms: number) => ({ toMillis: () => ms }),
  },
  FieldPath: { documentId: () => "__name__" },
}));

const checkout = await import("@/app/api/stripe/checkout/route");
const portal = await import("@/app/api/stripe/portal/route");
const preview = await import("@/app/api/email/preview/route");
const daily = await import("@/app/api/admin/daily/route");
const { redeemInvite } = await import("@/lib/referral");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  dbAvailable = true;
  limited = vi.fn().mockResolvedValue(false);
  verifyVerifiedUser = vi.fn().mockResolvedValue("uid_1");
  verifyUser = vi.fn().mockResolvedValue("uid_1");
  opsFlags = {};
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ===========================================================================
   1. Stripe's message is a server-log fact, not a page.
   =========================================================================== */

describe("upstream error text never reaches the browser", () => {
  // Verbatim shapes Stripe produces for the two failures these routes were
  // written to explain: a price from the wrong mode, and a Portal that was
  // only ever configured in test.
  const PRICE_ERROR =
    "No such price: 'price_1PfakeABCDEFGHIJ'; a similar object exists in test mode, " +
    "but a live mode key was used to make this request.";
  const PORTAL_ERROR =
    "No configuration provided and your test mode default configuration has not been " +
    "created. Provide a configuration or create your default by saving your customer " +
    "portal settings in test mode at https://dashboard.stripe.com/test/settings/billing/portal.";

  const stripeStub = () => ({
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }) },
    prices: { retrieve: vi.fn().mockResolvedValue({ unit_amount: 1199 }) },
    customers: {
      search: vi.fn().mockResolvedValue({ data: [] }),
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: "cus_new" }),
      update: vi.fn().mockResolvedValue({}),
    },
    checkout: { sessions: { create: (...a: unknown[]) => sessionsCreate(...a) } },
    billingPortal: { sessions: { create: (...a: unknown[]) => portalCreate(...a) } },
  });

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_m");
    db = makeStore().db;
    sessionsCreate = vi.fn().mockRejectedValue(new Error(PRICE_ERROR));
    portalCreate = vi.fn().mockRejectedValue(new Error(PORTAL_ERROR));
    stripeClient = stripeStub();
  });

  it("checkout answers 502 with a sentence a customer can act on", async () => {
    const res = await checkout.POST(
      new Request("https://elovox.app/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ cycle: "monthly" }),
        headers: { "content-type": "application/json" },
      }) as never
    );
    expect(res.status).toBe(502);
    const { error } = (await res.json()) as { error: string };
    // The whole point: nothing Stripe said about OUR account is in the body.
    expect(error).not.toContain("price_1PfakeABCDEFGHIJ");
    expect(error).not.toContain("live mode key");
    expect(error).toMatch(/try again/i);
    // …and everything Stripe said IS in the log, where it is the only thing
    // that explains the failure.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("price_1PfakeABCDEFGHIJ"),
      expect.anything()
    );
  });

  it("portal answers 502 without naming the Portal configuration", async () => {
    db = makeStore({
      "users/uid_1/profile/plan": { stripeCustomerId: "cus_9" },
    }).db;
    const res = await portal.POST(
      new Request("https://elovox.app/api/stripe/portal", { method: "POST" }) as never
    );
    expect(res.status).toBe(502);
    const { error } = (await res.json()) as { error: string };
    expect(error).not.toContain("default configuration");
    expect(error).not.toContain("dashboard.stripe.com");
    expect(error).toMatch(/try again/i);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("default configuration"),
      expect.anything()
    );
  });
});

/* ===========================================================================
   2. A template name is a name we have, or it is not a name.
   =========================================================================== */

describe("/api/email/preview template lookup", () => {
  // The route reads req.nextUrl; a plain Request carries everything else it
  // needs (headers, for clientIp).
  const req = (query: string) => {
    const url = `https://elovox.app/api/email/preview${query}`;
    return Object.assign(new Request(url), { nextUrl: new URL(url) }) as never;
  };

  beforeEach(() => {
    // Development is the wide-open branch, which is the one worth testing:
    // it is where a runaway script or a curious visitor actually points.
    vi.stubEnv("NODE_ENV", "development");
    db = makeStore().db;
  });

  it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"])(
    "shows the index for ?type=%s instead of calling Object.prototype",
    async (name) => {
      const res = await preview.GET(req(`?type=${name}`));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Email previews");
    }
  );

  it("still renders a template it does have", async () => {
    const res = await preview.GET(req("?type=welcome"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("Email previews</h1>");
    expect(body.length).toBeGreaterThan(200);
  });
});

/* ===========================================================================
   3. Every admin body goes through the shared reader, cap included.
   =========================================================================== */

describe("admin routes read bodies through lib/requestBody", () => {
  const ADMIN_EMAIL = "ops@elovox.app";

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "test-api-key");
    db = makeStore().db;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          users: [{ localId: "adminuid", email: ADMIN_EMAIL, emailVerified: true }],
        }),
      }))
    );
  });

  const post = (body: string) =>
    daily.POST(
      new Request("https://elovox.app/api/admin/daily", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok-admin",
          "x-real-ip": "203.0.113.5",
        },
        body,
      }) as never
    );

  /** Tomorrow, so the route's "future days only" rule is satisfied. */
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  it("accepts an ordinary body", async () => {
    // Every field the route requires: it rejects a partial body with 400
    // regardless of how the body was read, so a body missing `scenario`,
    // `focus` or the exactly-three bullets would prove nothing about the
    // shared reader.
    const res = await post(
      JSON.stringify({
        date: tomorrow,
        title: "Ask for a raise",
        topic: "money",
        scenario: "You are in a one-to-one with your manager.",
        focus: "Stay concrete about the number.",
        bullets: ["Name the figure", "Give one reason", "Stop talking"],
      })
    );
    expect(res.status).toBe(200);
  });

  it("refuses a body past the cap rather than parsing it", async () => {
    // Valid in every way except its size — before the shared reader this was
    // parsed and applied, which is the cost an operator console should not be
    // able to impose on a serverless instance either.
    const res = await post(
      JSON.stringify({ date: tomorrow, title: "x", topic: "y".repeat(100_000) })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Bad date.");
  });

  it("still answers its own 400 for a body that is simply wrong", async () => {
    const res = await post(JSON.stringify({ date: "not-a-date" }));
    expect(res.status).toBe(400);
  });

  it("survives a body that is not an object at all", async () => {
    const res = await post("[]");
    expect(res.status).toBe(400);
  });
});

/* ===========================================================================
   4. The mutual-referral guard has to survive two people pressing at once.
   =========================================================================== */

describe("redeemInvite is transactional", () => {
  it("records the referral and the friendship both ways", async () => {
    const store = makeStore({ "invites/CODEA": { uid: "alice" } });
    const out = await redeemInvite(store.db as Firestore, "bob", "CODEA");
    expect(out).toEqual({ ok: true, inviterUid: "alice" });
    expect(store.data.get("users/bob/score/referral")).toMatchObject({
      inviterUid: "alice",
      code: "CODEA",
      bonusPaid: false,
    });
    expect(store.data.has("users/bob/friends/alice")).toBe(true);
    expect(store.data.has("users/alice/friends/bob")).toBe(true);
  });

  it("refuses a second redemption on the same account", async () => {
    const store = makeStore({
      "invites/CODEA": { uid: "alice" },
      "users/bob/score/referral": { inviterUid: "carol", bonusPaid: false },
    });
    const out = await redeemInvite(store.db as Firestore, "bob", "CODEA");
    expect(out).toEqual({
      ok: false,
      reason: "This account already used an invite link.",
    });
    // The existing record is the one that stands.
    expect(store.data.get("users/bob/score/referral")).toMatchObject({
      inviterUid: "carol",
    });
  });

  it("refuses the second half of a mutual pair, one after the other", async () => {
    const store = makeStore({
      "invites/CODEA": { uid: "alice" },
      "invites/CODEB": { uid: "bob" },
    });
    expect(await redeemInvite(store.db as Firestore, "bob", "CODEA")).toMatchObject({
      ok: true,
    });
    expect(await redeemInvite(store.db as Firestore, "alice", "CODEB")).toEqual({
      ok: false,
      reason: "You two can't invite each other.",
    });
  });

  it("refuses the second half of a mutual pair redeemed at the same moment", async () => {
    // The bug this replaced: both reads landed before either write, so both
    // calls passed the reciprocity check and the pair collected 400 XP. The
    // store below aborts and retries a transaction whose reads were written
    // underneath it, exactly as Firestore does — so the fix is what makes
    // this pass, not the fake.
    const store = makeStore({
      "invites/CODEA": { uid: "alice" },
      "invites/CODEB": { uid: "bob" },
    });
    const [first, second] = await Promise.all([
      redeemInvite(store.db as Firestore, "bob", "CODEA"),
      redeemInvite(store.db as Firestore, "alice", "CODEB"),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const loser = first.ok ? second : first;
    expect(loser).toEqual({ ok: false, reason: "You two can't invite each other." });
  });
});

/* ---------------------------------------------------------------------------
   The store.

   tests/helpers/firestore-fake.ts models buffered transaction writes and
   deliberately nothing else, which is right for the webhook it was written
   for and one property short here: the referral race is only visible if a
   transaction ABORTS when a document it read is written underneath it. So
   this store versions every path, remembers what a transaction read, and
   re-runs the body on conflict — Firestore's actual contract, and the only
   thing that can tell a transactional guard from a read-then-write one.
   --------------------------------------------------------------------------- */

interface Snap {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}
interface Ref {
  path: string;
  get: () => Promise<Snap>;
  set: (v: Record<string, unknown>, o?: { merge?: boolean }) => Promise<void>;
  update: (v: Record<string, unknown>) => Promise<void>;
  delete: () => Promise<void>;
}

function makeStore(seed: Record<string, Record<string, unknown>> = {}) {
  const data = new Map(Object.entries(seed));
  const versions = new Map<string, number>();
  const versionOf = (path: string) => versions.get(path) ?? 0;
  const bump = (path: string) => versions.set(path, versionOf(path) + 1);

  const snap = (path: string): Snap => {
    const v = data.get(path);
    return { exists: v !== undefined, data: () => (v ? { ...v } : undefined) };
  };
  const write = (path: string, v: Record<string, unknown>, merge?: boolean) => {
    data.set(path, merge ? { ...(data.get(path) ?? {}), ...v } : { ...v });
    bump(path);
  };

  const doc = (path: string): Ref => ({
    path,
    // Genuinely async, so two callers interleave the way two requests do.
    get: async () => {
      await Promise.resolve();
      return snap(path);
    },
    set: async (v, o) => write(path, v, o?.merge),
    update: async (v) => write(path, v, true),
    delete: async () => {
      data.delete(path);
      bump(path);
    },
  });

  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: Ref) => Promise<Snap>;
      set: (ref: Ref, v: Record<string, unknown>, o?: { merge?: boolean }) => void;
      update: (ref: Ref, v: Record<string, unknown>) => void;
    }) => Promise<T>
  ): Promise<T> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const readAt = new Map<string, number>();
      const buffered: Array<() => void> = [];
      const out = await fn({
        get: async (ref) => {
          await Promise.resolve();
          readAt.set(ref.path, versionOf(ref.path));
          return snap(ref.path);
        },
        set: (ref, v, o) => void buffered.push(() => write(ref.path, v, o?.merge)),
        update: (ref, v) => void buffered.push(() => write(ref.path, v, true)),
      });
      // Commit only if nothing we read moved while we were deciding.
      const stale = [...readAt].some(([p, v]) => versionOf(p) !== v);
      if (stale) continue;
      buffered.forEach((w) => w());
      return out;
    }
    throw new Error("transaction failed after 5 attempts");
  };

  return {
    data,
    db: { doc, runTransaction } as unknown as Firestore & {
      doc: (p: string) => Ref;
    },
  };
}
