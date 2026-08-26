import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { makeAdminDb, type AdminFakeDb } from "../helpers/admin-firestore";
import { seedCoins } from "@/lib/coins";

/** vi.fn() defaults to a signature TS will not let you call with arguments. */
type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   /api/admin/* is the operator console, and its access control is ENTIRELY
   server-side: there is no admin claim, no separate deploy, no network ACL.
   One env var (ADMIN_EMAILS) and one function (adminIdentity) stand between
   an anonymous caller and the ability to grant Premium, adjust the currency,
   ban accounts, cancel subscriptions and refund cards.

   Two design decisions carry the weight, and neither is enforced by a type:

     1. Every route answers a flat 404 — not 403 — outside the allow-list, so
        the console does not advertise its own existence. The header of
        app/api/admin/stats/route.ts records the incident: the 503 and 429
        branches once ran AHEAD of the admin check, so an anonymous visitor
        could tell "no such route" from "a real route that is busy", which is
        the entire thing the flat 404 exists to prevent.

     2. Every MUTATING route writes an adminAudit entry naming the operator.
        A console without attribution is one nobody can answer questions about
        later ("why does this account have Premium?", "who banned them?").

   These tests drive the REAL adminIdentity through a stubbed identitytoolkit
   response rather than mocking it out, so "signed out", "signed in but not an
   operator" and "claims an operator's address but never proved it" are three
   genuinely different requests all the way down.
   --------------------------------------------------------------------------- */

const ADMIN_EMAIL = "ops@elovox.app";
const ADMIN_UID = "adminuid";

/** Tokens the stubbed identitytoolkit lookup will recognise. */
const ACCOUNTS: Record<string, Record<string, unknown>> = {
  // Deliberately mixed-case: adminIdentity must normalise before matching, or
  // the operator is locked out of their own console by a capital letter.
  "tok-admin": { localId: ADMIN_UID, email: "Ops@Elovox.APP", emailVerified: true },
  "tok-member": { localId: "memberuid", email: "member@example.com", emailVerified: true },
  // A hostile signup: anyone may register an operator's address, only
  // verification proves they own it.
  "tok-imposter": { localId: "imposteruid", email: ADMIN_EMAIL, emailVerified: false },
  // An operator whose account was disabled in the Firebase console. Their ID
  // token stays valid for up to an hour after; the console must not.
  "tok-expelled": {
    localId: ADMIN_UID,
    email: ADMIN_EMAIL,
    emailVerified: true,
    disabled: true,
  },
};

let db: AdminFakeDb;
/** Flipped to simulate a deploy with no service account. */
let dbAvailable: boolean;
let app: object | null;
let limited: AnyMock;
let getUser: AnyMock;
let updateUser: AnyMock;
let listUsers: AnyMock;
let subscriptionsRetrieve: AnyMock;
let subscriptionsUpdate: AnyMock;
let subscriptionsCancel: AnyMock;
let refundUnusedPortion: AnyMock;
let fetchMock: AnyMock;

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminDb: () => (dbAvailable ? db : null),
  getAdminApp: () => app,
}));
vi.mock("@/lib/rateLimit", () => ({ limited: (...a: unknown[]) => limited(...a) }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: (...a: unknown[]) => getUser(...a),
    updateUser: (...a: unknown[]) => updateUser(...a),
    listUsers: (...a: unknown[]) => listUsers(...a),
  }),
}));
// verify.ts imports this at module scope; no admin route calls it.
vi.mock("firebase-admin/app-check", () => ({
  getAppCheck: () => ({ verifyToken: async () => ({}) }),
}));
// Structural sentinels the admin-firestore helper knows how to apply. The real
// SDK's FieldValue.delete() is opaque, and a fake that stored it as a value
// would report a revoked comp window as still open.
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
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getStripe: () => ({
    subscriptions: {
      retrieve: (...a: unknown[]) => subscriptionsRetrieve(...a),
      update: (...a: unknown[]) => subscriptionsUpdate(...a),
      cancel: (...a: unknown[]) => subscriptionsCancel(...a),
    },
  }),
}));
vi.mock("@/lib/refunds", () => ({
  refundUnusedPortion: (...a: unknown[]) => refundUnusedPortion(...a),
}));

const verify = await import("@/lib/verify");
const coins = await import("@/app/api/admin/coins/route");
const comp = await import("@/app/api/admin/comp/route");
const moderation = await import("@/app/api/admin/moderation/route");
const subscription = await import("@/app/api/admin/subscription/route");
const users = await import("@/app/api/admin/users/route");
const stats = await import("@/app/api/admin/stats/route");
const audit = await import("@/app/api/admin/audit/route");

function apiReq(
  path: string,
  opts: { token?: string; method?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = { "x-real-ip": "203.0.113.5" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const hasBody = opts.body !== undefined;
  if (hasBody) headers["content-type"] = "application/json";
  return new Request(`https://elovox.app${path}`, {
    method: opts.method ?? (hasBody ? "POST" : "GET"),
    headers,
    ...(hasBody ? { body: JSON.stringify(opts.body) } : {}),
  }) as never;
}

/** Every route under test, as "one call an operator could make". */
const ROUTES: Array<{ label: string; mutates: boolean; call: (token?: string) => Promise<Response> }> = [
  { label: "GET /api/admin/stats", mutates: false, call: (t) => stats.GET(apiReq("/api/admin/stats", { token: t })) },
  { label: "GET /api/admin/users", mutates: false, call: (t) => users.GET(apiReq("/api/admin/users", { token: t })) },
  { label: "GET /api/admin/audit", mutates: false, call: (t) => audit.GET(apiReq("/api/admin/audit", { token: t })) },
  { label: "GET /api/admin/moderation", mutates: false, call: (t) => moderation.GET(apiReq("/api/admin/moderation?uid=target", { token: t })) },
  { label: "POST /api/admin/coins", mutates: true, call: (t) => coins.POST(apiReq("/api/admin/coins", { token: t, body: { uid: "target", delta: 50 } })) },
  { label: "POST /api/admin/comp", mutates: true, call: (t) => comp.POST(apiReq("/api/admin/comp", { token: t, body: { uid: "target", days: 30 } })) },
  { label: "DELETE /api/admin/comp", mutates: true, call: (t) => comp.DELETE(apiReq("/api/admin/comp", { token: t, method: "DELETE", body: { uid: "target" } })) },
  { label: "POST /api/admin/moderation", mutates: true, call: (t) => moderation.POST(apiReq("/api/admin/moderation", { token: t, body: { uid: "target", action: "strike", severity: 3, reason: "abuse in the ops log" } })) },
  { label: "POST /api/admin/subscription", mutates: true, call: (t) => subscription.POST(apiReq("/api/admin/subscription", { token: t, body: { uid: "target", action: "cancel_now_refund" } })) },
];

/** Writes the routes are answerable for, ignoring the opsEvents breadcrumb the
 *  denied path deliberately leaves. */
const realWrites = () => db.writes.filter((p) => !p.startsWith("opsEvents/"));

const liveSub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  cancel_at: null,
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: Math.floor((Date.now() + 20 * 864e5) / 1000) }] },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "test-api-key");
  vi.stubEnv("NODE_ENV", "production");

  db = makeAdminDb();
  dbAvailable = true;
  app = {};
  limited = vi.fn().mockResolvedValue(false);
  getUser = vi.fn().mockResolvedValue({
    uid: "target",
    email: "target@example.com",
    disabled: false,
  });
  updateUser = vi.fn().mockResolvedValue({});
  listUsers = vi.fn().mockResolvedValue({ users: [], pageToken: undefined });
  subscriptionsRetrieve = vi.fn().mockResolvedValue(liveSub());
  subscriptionsUpdate = vi.fn().mockResolvedValue(liveSub({ status: "active" }));
  subscriptionsCancel = vi.fn().mockResolvedValue(liveSub({ status: "canceled" }));
  refundUnusedPortion = vi.fn().mockResolvedValue(undefined);

  fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
    const body = JSON.parse((init as { body: string }).body) as { idToken: string };
    const record = ACCOUNTS[body.idToken];
    return {
      ok: true,
      json: async () => ({ users: record ? [record] : [] }),
    };
  }) as unknown as AnyMock;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ===========================================================================
   1. The allow-list itself.
   =========================================================================== */

describe("adminEmailList / adminIdentity — the whole access control surface", () => {
  it("grants NOBODY when ADMIN_EMAILS is unset", async () => {
    // Fails CLOSED. A deploy that forgets the variable must lock the console,
    // not open it: the alternative reading of an empty list ("no restrictions")
    // would hand /api/admin/* to any signed-in account on the internet.
    vi.stubEnv("ADMIN_EMAILS", "");
    delete process.env.ADMIN_EMAILS;
    expect(verify.adminEmailList()).toEqual([]);
    expect(await verify.adminIdentity(apiReq("/x", { token: "tok-admin" }))).toBeNull();
    // And it short-circuits before the network: an empty list is not a
    // question worth asking identitytoolkit.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a list of nothing but separators and spaces as empty", async () => {
    // " , , " is what a half-finished env edit looks like. Without the
    // filter(Boolean) the list is non-empty and holds an empty string, which
    // turns the length check — the fail-closed guard — into a no-op.
    vi.stubEnv("ADMIN_EMAILS", " , ,  ,");
    expect(verify.adminEmailList()).toEqual([]);
    expect(await verify.adminIdentity(apiReq("/x", { token: "tok-admin" }))).toBeNull();
  });

  it("rejects an UNVERIFIED account holding an operator's address", async () => {
    // Firebase Auth will happily mint a token for an account registered at
    // ops@elovox.app by someone who does not own the mailbox. emailVerified is
    // the only thing that separates the operator from that signup, and it is
    // the difference between an allow-list and a self-service one.
    expect(await verify.adminIdentity(apiReq("/x", { token: "tok-imposter" }))).toBeNull();
  });

  it("matches case-insensitively in both directions", async () => {
    vi.stubEnv("ADMIN_EMAILS", "OPS@Elovox.App");
    // Token address is "Ops@Elovox.APP"; list entry is differently cased again.
    const found = await verify.adminIdentity(apiReq("/x", { token: "tok-admin" }));
    // Normalised on BOTH sides, and the identity handed back is the normalised
    // address — every adminAudit `actor` in the app is this exact value, so it
    // must not vary with how the operator typed their address at signup.
    expect(found).toEqual({ uid: ADMIN_UID, email: ADMIN_EMAIL });
  });

  it("ignores whitespace around entries", async () => {
    vi.stubEnv("ADMIN_EMAILS", "  first@elovox.app ,  ops@elovox.app  ");
    expect(verify.adminEmailList()).toEqual(["first@elovox.app", ADMIN_EMAIL]);
    expect(await verify.isAdmin(apiReq("/x", { token: "tok-admin" }))).toBe(true);
  });

  it("requires the WHOLE address to match, not a prefix of it", async () => {
    // The list is a set of exact addresses. A substring/startsWith match would
    // make ops@elovox.app.attacker.example an operator, and that domain is
    // registrable by anyone.
    ACCOUNTS["tok-lookalike"] = {
      localId: "lookalikeuid",
      email: "ops@elovox.app.attacker.example",
      emailVerified: true,
    };
    expect(await verify.adminIdentity(apiReq("/x", { token: "tok-lookalike" }))).toBeNull();
    delete ACCOUNTS["tok-lookalike"];
  });

  it("drops an operator whose Firebase account has been disabled", async () => {
    // Offboarding is "disable the account in the console". Firebase stops
    // minting new tokens immediately but the one in their browser stays valid
    // for up to an hour; the console has to be gone before that hour is.
    expect(await verify.adminIdentity(apiReq("/x", { token: "tok-expelled" }))).toBeNull();
  });

  it("is null for a signed-out caller, without a lookup", async () => {
    expect(await verify.adminIdentity(apiReq("/x"))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never grants admin through the unconfigured-Firebase dev bypass", async () => {
    // With no NEXT_PUBLIC_FIREBASE_API_KEY, lookupUser hands every caller the
    // synthetic "local-dev" user so `next dev` is usable without credentials.
    // That user has NO email, and adminIdentity must refuse it — otherwise a
    // dev server (or a preview deploy missing its client vars) serves the
    // console, with all of its mutations, to anyone who can reach the port.
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "");
    delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    vi.stubEnv("NODE_ENV", "development");
    expect(await verify.verifyUser(apiReq("/x"))).toBe("local-dev");
    expect(await verify.adminIdentity(apiReq("/x"))).toBeNull();
    expect(await verify.isAdmin(apiReq("/x"))).toBe(false);
  });
});

/* ===========================================================================
   2. The flat 404, across the surface.
   =========================================================================== */

describe("every admin route is invisible to non-operators", () => {
  for (const route of ROUTES) {
    it(`${route.label} — signed out is a bare 404, not a 401`, async () => {
      const res = await route.call(undefined);
      expect(res.status).toBe(404);
      // Bare text, not a JSON error envelope. The client maps only a 404 to
      // "denied"; anything with a machine-readable body confirms /admin exists.
      expect(await res.text()).toBe("Not found");
    });

    it(`${route.label} — a signed-in non-operator gets the same 404 and no side effect`, async () => {
      const res = await route.call("tok-member");
      expect(res.status).toBe(404);
      expect(realWrites()).toEqual([]);
      expect(db.audit()).toEqual([]);
    });

    it(`${route.label} — an unverified claim on an operator's address gets 404`, async () => {
      const res = await route.call("tok-imposter");
      expect(res.status).toBe(404);
      expect(realWrites()).toEqual([]);
    });
  }

  it("still 404s when the service account is missing, rather than 503", async () => {
    // THE documented incident (see the header of app/api/admin/stats/route.ts):
    // the 503 branch used to run ahead of the admin check, so an anonymous
    // caller could distinguish a real-but-unconfigured route from a
    // non-existent one and confirm /admin was there to attack.
    app = null;
    dbAvailable = false;
    for (const route of ROUTES) {
      const res = await route.call("tok-member");
      expect(res.status, route.label).toBe(404);
    }
  });

  it("still 404s while the route is rate limited, rather than 429", async () => {
    // Same incident, the other branch. A 429 to an anonymous caller is a
    // confirmation that something real is behind the URL.
    limited.mockResolvedValue(true);
    for (const route of ROUTES) {
      const res = await route.call("tok-member");
      expect(res.status, route.label).toBe(404);
    }
    // ...and the limiter was never consulted, because the caller never got
    // far enough to have a quota.
    expect(limited).not.toHaveBeenCalled();
  });

  it("does not enumerate accounts or touch Stripe for a denied caller", async () => {
    // A 404 that has already read every auth record, or already cancelled a
    // subscription, is not a denial.
    for (const route of ROUTES) await route.call("tok-member");
    expect(listUsers).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(refundUnusedPortion).not.toHaveBeenCalled();
  });

  it("rate limits an authenticated operator on every mutating route", async () => {
    // The console is an authenticated surface, so the limit is not about
    // strangers: it bounds a stuck retry loop or a compromised operator
    // session from writing unbounded Firestore documents.
    limited.mockResolvedValue(true);
    for (const route of ROUTES.filter((r) => r.mutates)) {
      const res = await route.call("tok-admin");
      expect(res.status, route.label).toBe(429);
    }
    expect(realWrites()).toEqual([]);
    expect(db.audit()).toEqual([]);
  });
});

/* ===========================================================================
   3. /api/admin/coins — the in-app currency.
   =========================================================================== */

describe("/api/admin/coins", () => {
  const post = (body: unknown, token = "tok-admin") =>
    coins.POST(apiReq("/api/admin/coins", { token, body }));

  it("NEVER creates the progress doc for an account that has never scored", async () => {
    // The header comment on the route is unusually emphatic about this and it
    // is not style: the NON-EXISTENCE of users/{uid}/score/progress is a
    // signal three other systems read (XP backfill, referral bonus, invite
    // redemption — see lib/coinsServer.ts equip()). A well-meant `set` with
    // merge here would silently mark every comped account as "already
    // migrated" and those three systems would skip it forever.
    const res = await post({ uid: "neverscored", delta: 100 });
    expect(res.status).toBe(409);
    expect(db.data.has("users/neverscored/score/progress")).toBe(false);
    expect(realWrites()).toEqual([]);
    // No audit entry either: nothing happened, so nothing to attribute.
    expect(db.audit()).toEqual([]);
  });

  it("rejects a uid that is not a plain Firebase uid", async () => {
    // The uid is interpolated straight into a document path. Anything with a
    // slash re-targets the write to a different collection entirely, and a
    // 129-char value is not a uid at all.
    for (const uid of ["../../adminAudit/x", "users/other/score", "uid with space", "a".repeat(129), "", "uid#1"]) {
      const res = await post({ uid, delta: 10 });
      expect(res.status, uid).toBe(400);
    }
    expect(realWrites()).toEqual([]);
  });

  it("rejects a delta that is zero, fractional, non-numeric or oversized", async () => {
    // MAX_ABS_DELTA is the blast radius of one fat-fingered grant. 10,000,000
    // coins is not a make-good, it is the end of the shop's economy, and a
    // fractional balance breaks every `>=` price comparison downstream.
    for (const delta of [0, 1.5, "abc", null, 100_001, -100_001, Infinity, NaN]) {
      const res = await post({ uid: "target", delta });
      expect(res.status, String(delta)).toBe(400);
    }
    expect(realWrites()).toEqual([]);
  });

  it("materialises the XP-derived seed before adjusting, instead of starting from 0", async () => {
    // Before coinsSeeded is set, the spendable balance is DERIVED from XP
    // (lib/coins.seedCoins) and the stored `coins` field is ignored. An
    // adjustment that read `coins ?? 0` would compute a "before" of 0, write a
    // balance far below what the user can actually spend, and the next
    // awardXp would recompute the seed straight over it.
    const xp = 900;
    expect(seedCoins(xp)).toBeGreaterThan(0); // the number this test is about
    db.data.set("users/target/score/progress", { xp, coins: 0 });
    const res = await post({ uid: "target", delta: 25 });
    const json = await res.json();
    expect(json.before).toBe(seedCoins(xp));
    expect(json.after).toBe(seedCoins(xp) + 25);
    const doc = db.data.get("users/target/score/progress")!;
    expect(doc.coins).toBe(seedCoins(xp) + 25);
    // And the seed is now materialised, so it is never recomputed over.
    expect(doc.coinsSeeded).toBe(true);
  });

  it("floors a correction at zero rather than storing a negative balance", async () => {
    // A negative stored balance is not "owes us coins" anywhere in the app —
    // it is a number that every price check compares against and every UI
    // renders. The correction stops at 0.
    db.data.set("users/target/score/progress", { xp: 0, coins: 40, coinsSeeded: true });
    const res = await post({ uid: "target", delta: -1000 });
    const json = await res.json();
    expect(json.before).toBe(40);
    expect(json.after).toBe(0);
    expect(db.data.get("users/target/score/progress")!.coins).toBe(0);
  });

  it("records WHO adjusted WHAT, with the before and after", async () => {
    db.data.set("users/target/score/progress", { xp: 0, coins: 40, coinsSeeded: true });
    await post({ uid: "target", delta: -15 });
    expect(db.audit()).toEqual([
      expect.objectContaining({
        action: "coins.adjust",
        actor: ADMIN_EMAIL,
        targetUid: "target",
        ok: true,
        detail: { delta: -15, before: 40, after: 25 },
      }),
    ]);
  });

  it("attributes the adjustment to the TOKEN, never to a field in the body", async () => {
    // The whole point of the log is that the operator cannot choose what it
    // says about them. adminIdentity's return value is the only source.
    db.data.set("users/target/score/progress", { xp: 0, coins: 10, coinsSeeded: true });
    await post({ uid: "target", delta: 5, actor: "someone.else@elovox.app", action: "coins.gift" });
    expect(db.audit()[0]).toMatchObject({ actor: ADMIN_EMAIL, action: "coins.adjust" });
  });
});

/* ===========================================================================
   4. /api/admin/comp — free Premium, granted by hand.
   =========================================================================== */

describe("/api/admin/comp", () => {
  const grant = (body: unknown, token = "tok-admin") =>
    comp.POST(apiReq("/api/admin/comp", { token, body }));
  const revoke = (body: unknown, token = "tok-admin") =>
    comp.DELETE(apiReq("/api/admin/comp", { token, method: "DELETE", body }));
  const PLAN = "users/target/profile/plan";

  it("never writes the `plan` field — the Stripe webhook owns it alone", async () => {
    // A comp written as plan:"premium" reads correctly for about as long as it
    // takes the next subscription event to arrive, at which point the webhook
    // (the single writer of that field) overwrites it and the comp silently
    // evaporates. The window is a separate timestamp for exactly that reason.
    const res = await grant({ uid: "target", days: 7 });
    expect(res.status).toBe(200);
    const doc = db.data.get(PLAN)!;
    // Every field the webhook owns stays untouched by this route.
    for (const owned of ["plan", "status", "cycle", "cancelAtPeriodEnd", "currentPeriodEnd", "stripeSubscriptionId"]) {
      expect(doc[owned], owned).toBeUndefined();
    }
    // And these four are the entire write. Listed exactly, so a fifth field
    // added here has to be a deliberate decision rather than a drive-by.
    expect(Object.keys(doc).sort()).toEqual(
      ["adminCompAt", "adminCompBy", "grantReason", "premiumUntil"].sort()
    );
    expect(doc.grantReason).toBe("admin-comp");
    // Who comped it, on the doc itself as well as in the log.
    expect(doc.adminCompBy).toBe(ADMIN_EMAIL);
  });

  it("rejects a day count outside 1..90", async () => {
    // The cap is what stops "90" and "900" being one keystroke apart. A
    // hundred-year comp is indistinguishable from a lifetime account nobody
    // decided to give away.
    for (const days of [0, -7, 91, 3.5, "30d", "", null, 1e9]) {
      const res = await grant({ uid: "target", days });
      expect(res.status, String(days)).toBe(400);
    }
    expect(db.data.has(PLAN)).toBe(false);
  });

  it("rejects a uid that is not a plain Firebase uid", async () => {
    const res = await grant({ uid: "../billingAlerts/x", days: 7 });
    expect(res.status).toBe(400);
    expect(realWrites()).toEqual([]);
  });

  it("refuses to stack a comp under a live subscription, and writes nothing", async () => {
    // Stacking buys the user nothing until the subscription lapses, and it
    // leaves a premiumUntil behind that outlives a later cancellation — the
    // account keeps Premium after it stops paying, with no record of a
    // decision to give it away.
    db.data.set(PLAN, { plan: "premium", status: "active", currentPeriodEnd: Date.now() + 864e5 });
    const res = await grant({ uid: "target", days: 30 });
    expect(res.status).toBe(409);
    expect(db.data.get(PLAN)!.premiumUntil).toBeUndefined();
    expect(realWrites()).toEqual([]);
    expect(db.audit()).toEqual([]);
  });

  it("EXTENDS an open window instead of clobbering it", async () => {
    // Two grants for two separate make-goods must add up. Overwriting would
    // silently shorten a window the operator believed they were lengthening.
    const open = Date.now() + 40 * 864e5;
    db.data.set(PLAN, { premiumUntil: open });
    await grant({ uid: "target", days: 10 });
    expect(db.data.get(PLAN)!.premiumUntil).toBe(open + 10 * 864e5);
  });

  it("measures a STALE window from now, not from the date it expired", async () => {
    // Extending from a premiumUntil that has already passed would hand back a
    // window that is already over — the operator sees "granted", the user sees
    // nothing, and it looks like a billing bug.
    const stale = Date.now() - 200 * 864e5;
    db.data.set(PLAN, { premiumUntil: stale });
    const before = Date.now();
    await grant({ uid: "target", days: 3 });
    const until = db.data.get(PLAN)!.premiumUntil as number;
    expect(until).toBeGreaterThanOrEqual(before + 3 * 864e5);
    expect(until).toBeLessThan(before + 4 * 864e5);
  });

  it("revoking really removes the window rather than leaving a stale value", async () => {
    db.data.set(PLAN, { premiumUntil: Date.now() + 30 * 864e5, grantReason: "admin-comp" });
    const res = await revoke({ uid: "target" });
    expect(res.status).toBe(200);
    const doc = db.data.get(PLAN)!;
    expect("premiumUntil" in doc).toBe(false);
    expect("grantReason" in doc).toBe(false);
  });

  it("revoking leaves the streak-reward bookkeeping alone", async () => {
    // A comp that came from the 21-day streak reward must not become
    // re-claimable off the same 21 days just because an operator closed the
    // window early. The anchor and the granted counter are the record that it
    // was already paid out.
    db.data.set(PLAN, {
      premiumUntil: Date.now() + 5 * 864e5,
      grantReason: "streak-21",
      streakRewardAnchor: 12345,
      streakRewardsGranted: 1,
    });
    await revoke({ uid: "target" });
    const doc = db.data.get(PLAN)!;
    expect(doc.streakRewardAnchor).toBe(12345);
    expect(doc.streakRewardsGranted).toBe(1);
  });

  it("refuses to revoke a window that is not open, and writes nothing", async () => {
    db.data.set(PLAN, { premiumUntil: Date.now() - 1000 });
    const res = await revoke({ uid: "target" });
    expect(res.status).toBe(409);
    expect(realWrites()).toEqual([]);
    expect(db.audit()).toEqual([]);
  });

  it("still grants the comp when the audit write itself fails", async () => {
    // lib/adminAudit.ts is best-effort BY DESIGN: the action the operator asked
    // for must never fail because the log hiccuped. The inverse — a route that
    // 500s after the Firestore write already landed — is the worst outcome
    // available here, because the operator retries and comps twice.
    const realCollection = db.collection;
    db.collection = ((name: string) => {
      const c = realCollection(name);
      return name === "adminAudit"
        ? { ...c, add: async () => { throw new Error("firestore unreachable"); } }
        : c;
    }) as typeof db.collection;

    const res = await grant({ uid: "target", days: 7 });
    expect(res.status).toBe(200);
    expect(db.data.get(PLAN)!.premiumUntil).toBeGreaterThan(Date.now());
  });

  it("logs both the grant and the revoke against the operator", async () => {
    await grant({ uid: "target", days: 14 });
    await revoke({ uid: "target" });
    expect(db.audit().map((e) => [e.action, e.actor])).toEqual([
      ["comp.grant", ADMIN_EMAIL],
      ["comp.revoke", ADMIN_EMAIL],
    ]);
    expect(db.audit()[0].detail).toMatchObject({ days: 14 });
  });
});

/* ===========================================================================
   5. /api/admin/moderation — the console that can close accounts.
   =========================================================================== */

describe("/api/admin/moderation", () => {
  const act = (body: unknown, token = "tok-admin") =>
    moderation.POST(apiReq("/api/admin/moderation", { token, body }));
  const STATUS = "users/target/moderation/status";

  it("cannot strike an account on ADMIN_EMAILS", async () => {
    // "The console must not be able to eat its operators." A severity-3 strike
    // bans on the spot AND disables the Firebase account — one operator doing
    // that to another (or to themselves) locks everybody out of the only tool
    // that could undo it.
    getUser.mockResolvedValue({ uid: "target", email: ADMIN_EMAIL, disabled: false });
    const res = await act({ uid: "target", action: "strike", severity: 3, reason: "test" });
    expect(res.status).toBe(403);
    expect(db.data.has(STATUS)).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("recognises an operator's address whatever its case", async () => {
    // The allow-list is lower-cased; the address on the Firebase record is
    // whatever the operator typed. Comparing them raw would leave the
    // protection above bypassable by anyone who knew the capitalisation.
    getUser.mockResolvedValue({ uid: "target", email: "OPS@Elovox.App", disabled: false });
    const res = await act({ uid: "target", action: "strike", severity: 3, reason: "test" });
    expect(res.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses a strike with no written reason", async () => {
    // The reason is the only thing in the record that says WHY, and it goes to
    // two durable logs. A strike nobody can justify later is a strike that
    // gets reversed and an account that gets an apology.
    for (const reason of ["", "  ", "ab", undefined, 42]) {
      const res = await act({ uid: "target", action: "strike", severity: 1, reason });
      expect(res.status, String(reason)).toBe(400);
    }
    expect(db.data.has(STATUS)).toBe(false);
  });

  it("refuses a severity outside 1|2|3", async () => {
    for (const severity of [0, 4, -1, 2.5, "high"]) {
      const res = await act({ uid: "target", action: "strike", severity, reason: "abuse in ops log" });
      expect(res.status, String(severity)).toBe(400);
    }
    expect(db.data.has(STATUS)).toBe(false);
  });

  it("refuses an unrecognised action instead of falling through to a strike", async () => {
    const res = await act({ uid: "target", action: "delete_everything", severity: 3, reason: "x" });
    expect(res.status).toBe(400);
    expect(db.data.has(STATUS)).toBe(false);
  });

  it("a ban actually disables the Firebase account", async () => {
    // A "banned" row in Firestore blocks the paid pipeline but leaves sign-in
    // working. The word means the full lock, and lookupUser only stops
    // honouring the account's tokens once Auth says disabled.
    const res = await act({ uid: "target", action: "strike", severity: 3, reason: "slurs in a public handle" });
    const json = await res.json();
    expect(json.state).toBe("banned");
    expect(json.lockedLogin).toBe(true);
    expect(updateUser).toHaveBeenCalledWith("target", { disabled: true });
  });

  it("leaves billing completely alone, and flags it for the operator instead", async () => {
    // Refund rules live in the Billing controls; a moderation action that
    // cancelled or refunded on its own would route real money around them.
    db.data.set("users/target/profile/plan", {
      plan: "premium",
      status: "active",
      stripeSubscriptionId: "sub_1",
    });
    const res = await act({ uid: "target", action: "strike", severity: 3, reason: "abuse in the ops log" });
    const json = await res.json();
    expect(json.hasLiveSubscription).toBe(true);
    expect(db.writes.filter((p) => p.endsWith("/profile/plan"))).toEqual([]);
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(refundUnusedPortion).not.toHaveBeenCalled();
  });

  it("records the strike in BOTH durable logs, naming the operator", async () => {
    // moderationEvents is the per-account history the appeal is judged from;
    // adminAudit is the cross-account record of what operators did. Losing
    // either one leaves a question that cannot be answered.
    await act({ uid: "target", action: "strike", severity: 2, reason: "harassment reported by two users" });
    expect(db.audit()).toEqual([
      expect.objectContaining({
        action: "moderation.strike",
        actor: ADMIN_EMAIL,
        targetUid: "target",
        targetEmail: "target@example.com",
        detail: expect.objectContaining({
          severity: 2,
          reason: "harassment reported by two users",
        }),
      }),
    ]);
    expect(db.docsIn("moderationEvents").map((d) => d.data)).toEqual([
      expect.objectContaining({
        uid: "target",
        kind: "strike",
        actor: ADMIN_EMAIL,
        source: "manual",
        reason: "harassment reported by two users",
      }),
    ]);
  });

  it("reinstating restores the login it took away", async () => {
    // The undo has to be complete. Wiping the strikes while leaving the
    // Firebase account disabled produces an account that looks fine in the
    // console and still cannot sign in.
    getUser.mockResolvedValue({ uid: "target", email: "target@example.com", disabled: true });
    const res = await act({ uid: "target", action: "reinstate" });
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith("target", { disabled: false });
    expect(db.audit()[0]).toMatchObject({
      action: "moderation.reinstate",
      actor: ADMIN_EMAIL,
      detail: { reEnabledLogin: true },
    });
  });

  it("404s an unknown uid rather than creating a moderation record for it", async () => {
    getUser.mockRejectedValue(Object.assign(new Error("nope"), { code: "auth/user-not-found" }));
    const res = await act({ uid: "ghost", action: "strike", severity: 1, reason: "typo in the uid" });
    expect(res.status).toBe(404);
    expect(realWrites()).toEqual([]);
  });
});

/* ===========================================================================
   6. /api/admin/subscription — the route that moves money.
   =========================================================================== */

describe("/api/admin/subscription", () => {
  const act = (body: unknown, token = "tok-admin") =>
    subscription.POST(apiReq("/api/admin/subscription", { token, body }));
  const PLAN = "users/target/profile/plan";

  beforeEach(() => {
    db.data.set(PLAN, { plan: "premium", status: "active", stripeSubscriptionId: "sub_1" });
  });

  it("writes NOTHING to the plan doc — the webhook mirrors Stripe on its own", async () => {
    // Same single-writer rule as the comp route, from the other side. Writing
    // the plan doc here races the customer.subscription.updated event this
    // very call produces, and whichever lands second wins: that is precisely
    // the drift the single-writer rule was introduced to end.
    const res = await act({ uid: "target", action: "cancel_at_period_end" });
    expect(res.status).toBe(200);
    expect(subscriptionsUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(db.writes.filter((p) => p.endsWith("/profile/plan"))).toEqual([]);
  });

  it("only accepts the three named actions, and calls Stripe for nothing else", async () => {
    // `action` is read off the body and cast; the allow-list is the only thing
    // between a typo (or a probe) and an unintended Stripe mutation.
    for (const action of ["cancel", "delete", "cancel_now", "", null, "resume "]) {
      const res = await act({ uid: "target", action });
      expect(res.status, String(action)).toBe(400);
    }
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(refundUnusedPortion).not.toHaveBeenCalled();
  });

  it("refuses when no subscription is on record, before touching Stripe", async () => {
    db.data.set(PLAN, { plan: "free" });
    const res = await act({ uid: "target", action: "cancel_now_refund" });
    expect(res.status).toBe(409);
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(refundUnusedPortion).not.toHaveBeenCalled();
  });

  it("refunds the unused portion from the PRE-cancel subscription object", async () => {
    // The refund is prorated from the period bounds, and a cancelled
    // subscription is not where you read those from. Cancelling first and then
    // handing the helper a re-fetched object is how a customer gets cancelled
    // and not refunded.
    let seenStatus: unknown;
    refundUnusedPortion.mockImplementation(async (...args: unknown[]) => {
      seenStatus = (args[2] as { status: string }).status;
    });
    await act({ uid: "target", action: "cancel_now_refund" });
    expect(seenStatus).toBe("active");
    expect(subscriptionsCancel).toHaveBeenCalledWith("sub_1");
    // Card, via the one shared helper — never a hand-rolled credit here.
    expect(refundUnusedPortion).toHaveBeenCalledTimes(1);
    expect(refundUnusedPortion.mock.calls[0][3]).toMatchObject({
      uid: "target",
      context: "admin-cancel",
    });
  });

  it("puts the refund's OUTCOME in the audit entry, not just the intent", async () => {
    // "We cancelled them" and "we cancelled them and the money went back" are
    // different facts, and a refund that failed leaves a customer who is owed
    // money and a console that says the job is done.
    refundUnusedPortion.mockImplementation(async () => {
      await db.doc("billingAlerts/unused-refund-sub_1").set({
        resolved: false,
        amount: 1299,
        currency: "usd",
        error: "charge_already_refunded",
      });
    });
    const res = await act({ uid: "target", action: "cancel_now_refund" });
    const json = await res.json();
    expect(json.refund).toMatchObject({ resolved: false, amount: 1299, error: "charge_already_refunded" });
    expect(db.audit()[0]).toMatchObject({
      action: "subscription.cancel-now-refund",
      actor: ADMIN_EMAIL,
      targetUid: "target",
      detail: { subscriptionId: "sub_1", refundResolved: false, refundAmount: 1299 },
    });
  });

  it("does not double-cancel an already-cancelled subscription", async () => {
    // Re-running the action on a cancelled subscription must not reach the
    // refund helper a second time — the first run already returned the money.
    subscriptionsRetrieve.mockResolvedValue(liveSub({ status: "canceled" }));
    const res = await act({ uid: "target", action: "cancel_now_refund" });
    expect(res.status).toBe(409);
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(refundUnusedPortion).not.toHaveBeenCalled();
  });

  it("logs a resume against the operator who authorised it", async () => {
    subscriptionsRetrieve.mockResolvedValue(liveSub({ cancel_at_period_end: true }));
    await act({ uid: "target", action: "resume" });
    expect(db.audit()[0]).toMatchObject({
      action: "subscription.resume",
      actor: ADMIN_EMAIL,
      targetUid: "target",
    });
  });
});

/* ===========================================================================
   7. The read side.
   =========================================================================== */

describe("/api/admin/users — a list of real people's names and addresses", () => {
  it("marks the response private so no shared cache can hold it", async () => {
    // The body is every account's name, email and plan. A cacheable response
    // here is a personal-data leak through whatever proxy sits in front.
    listUsers.mockResolvedValue({
      users: [
        {
          uid: "u1",
          displayName: "A Person",
          email: "a@example.com",
          emailVerified: true,
          disabled: false,
          metadata: { creationTime: new Date().toUTCString(), lastSignInTime: null },
          providerData: [],
        },
      ],
      pageToken: undefined,
    });
    const res = await users.GET(apiReq("/api/admin/users", { token: "tok-admin" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("private");
  });

  it("reports a comp window as a comp, not as a paid subscription", async () => {
    // The list is how an operator answers "why does this account have
    // Premium?". Collapsing both sources into one boolean is how a comped
    // tester gets chased for a payment that never existed.
    const until = Date.now() + 5 * 864e5;
    db.data.set("users/u1/profile/plan", { premiumUntil: until, grantReason: "admin-comp" });
    db.data.set("users/u2/profile/plan", { plan: "premium", status: "active" });
    listUsers.mockResolvedValue({
      users: ["u1", "u2"].map((uid) => ({
        uid,
        displayName: null,
        email: `${uid}@example.com`,
        emailVerified: true,
        disabled: false,
        metadata: { creationTime: new Date().toUTCString(), lastSignInTime: null },
        providerData: [],
      })),
      pageToken: undefined,
    });
    const json = await (await users.GET(apiReq("/api/admin/users", { token: "tok-admin" }))).json();
    const byUid = Object.fromEntries(
      (json.users as Array<Record<string, unknown>>).map((r) => [r.uid, r])
    );
    expect(byUid.u1).toMatchObject({ premium: true, source: "comp", premiumUntil: until, grantReason: "admin-comp" });
    expect(byUid.u2).toMatchObject({ premium: true, source: "paid", premiumUntil: null });
  });
});

describe("/api/admin/audit — the log has to be readable, and honest", () => {
  const seedEntry = (id: string, e: Record<string, unknown>) =>
    db.data.set(`adminAudit/${id}`, e);

  it("does not report a FAILED action as a successful one", async () => {
    // Dangerous actions (account deletion, disable) record their failures on
    // purpose, so a half-done one is visible. Reading a stored ok:false as
    // true hides exactly the entries an operator most needs to see; a missing
    // ok field is the old shape and does mean success.
    seedEntry("a", { at: 2, actor: ADMIN_EMAIL, action: "account.delete", ok: false });
    seedEntry("b", { at: 1, actor: ADMIN_EMAIL, action: "comp.grant" });
    const json = await (await audit.GET(apiReq("/api/admin/audit", { token: "tok-admin" }))).json();
    expect(json.entries.map((e: { action: string; ok: boolean }) => [e.action, e.ok])).toEqual([
      ["account.delete", false],
      ["comp.grant", true],
    ]);
  });

  it("answers 'who did this' for an action taken through another route", async () => {
    // The end-to-end promise of the whole audit system: a mutation made
    // through one route is retrievable, with its operator, through this one.
    await comp.POST(apiReq("/api/admin/comp", { token: "tok-admin", body: { uid: "target", days: 30 } }));
    const json = await (await audit.GET(apiReq("/api/admin/audit", { token: "tok-admin" }))).json();
    expect(json.entries).toEqual([
      expect.objectContaining({
        action: "comp.grant",
        actor: ADMIN_EMAIL,
        targetUid: "target",
      }),
    ]);
  });

  it("is private and uncached", async () => {
    // Two stakes in one header. `private` keeps a body full of operator
    // addresses and target uids out of any shared cache; `no-store` means the
    // tab an operator opens mid-incident shows what just happened rather than
    // a minute-old tail that omits it.
    const res = await audit.GET(apiReq("/api/admin/audit", { token: "tok-admin" }));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
