import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

/** vi.fn() defaults to a signature TS will not let you call with arguments. */
type AnyMock = Mock<(...args: unknown[]) => unknown>;
import { makeDb, makeSubscription, type FakeDb } from "../helpers/firestore-fake";

/* ---------------------------------------------------------------------------
   The Stripe webhook is the ONLY writer of users/{uid}/profile/plan. Every
   entitlement in the product originates here, the endpoint is public, and it
   is unauthenticated until the signature is checked. It is the highest-stakes
   file in the repo and it had no tests.

   The idempotency logic in particular carries a bug that already cost real
   money: acking an IN-FLIGHT claim with a 200 meant a first attempt that died
   on a function timeout was never retried, `done` was never set, and for
   checkout.session.completed that is a paying customer who never gets
   Premium. The comment in the route explains it; nothing enforced it.
   --------------------------------------------------------------------------- */

const SECRET = "whsec_test_secret";

let db: FakeDb;
let constructEvent: AnyMock;
let subscriptionsRetrieve: AnyMock;
let subscriptionsList: AnyMock;
let subscriptionsCancel: AnyMock;
let customersRetrieve: AnyMock;
let getUser: AnyMock;
let limited: AnyMock;

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminDb: () => db,
  getAdminApp: () => ({}),
}));
vi.mock("@/lib/stripe", async (orig) => ({
  // isEntitled is pure and already tested — keep the real one so the
  // "derive from the customer, not the event" behaviour is genuinely exercised.
  ...(await orig<Record<string, unknown>>()),
  getStripe: () => ({
    webhooks: { constructEvent: (...a: unknown[]) => constructEvent(...a) },
    subscriptions: {
      retrieve: (...a: unknown[]) => subscriptionsRetrieve(...a),
      list: (...a: unknown[]) => subscriptionsList(...a),
      cancel: (...a: unknown[]) => subscriptionsCancel(...a),
    },
    customers: { retrieve: (...a: unknown[]) => customersRetrieve(...a) },
  }),
}));
vi.mock("@/lib/rateLimit", () => ({ limited: (...a: unknown[]) => limited(...a) }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ getUser: (...a: unknown[]) => getUser(...a) }) }));
// Email is a side effect of a successful sync, not part of what is under test.
vi.mock("@/lib/email/send", () => ({ send: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/email/config", () => ({ isMailConfigured: () => false, siteUrl: () => "https://elovox.app" }));
vi.mock("@/lib/refunds", () => ({ refundUnusedPortion: vi.fn().mockResolvedValue(undefined) }));

const { POST } = await import("@/app/api/stripe/webhook/route");

function post(body = "{}", headers: Record<string, string> = { "stripe-signature": "sig" }) {
  return POST(
    new Request("https://elovox.app/api/stripe/webhook", {
      method: "POST",
      body,
      headers,
    }) as never
  );
}

const event = (type: string, object: unknown, id = "evt_1") => ({
  id,
  type,
  data: { object },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  db = makeDb();
  limited = vi.fn().mockResolvedValue(false);
  getUser = vi.fn().mockResolvedValue({ uid: "uid_1" });
  const sub = makeSubscription();
  constructEvent = vi.fn().mockReturnValue(event("customer.subscription.updated", sub));
  subscriptionsRetrieve = vi.fn().mockResolvedValue(sub);
  subscriptionsList = vi.fn().mockResolvedValue({ data: [sub] });
  subscriptionsCancel = vi.fn().mockResolvedValue({});
  customersRetrieve = vi.fn().mockResolvedValue({ deleted: false, metadata: { firebaseUid: "uid_1" } });
});
afterEach(() => vi.restoreAllMocks());

describe("before the signature is trusted", () => {
  it("rate limits by IP before doing any work", async () => {
    limited.mockResolvedValue(true);
    const res = await post();
    expect(res.status).toBe(429);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature header", async () => {
    const res = await post("{}", {});
    expect(res.status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects a forged signature and does not touch Firestore", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    const res = await post();
    expect(res.status).toBe(400);
    expect(db.writes).toEqual([]);
  });

  it("never logs the signing secret's own characters", async () => {
    // The branch is publicly reachable — anyone can trigger it at will — so a
    // log line containing real prefix/suffix characters would leak the secret
    // to anyone with log access.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    constructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    await post();
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("test_secret");
    expect(logged).toMatch(/len=/); // shape, not contents
  });

  it("503s when the endpoint is not configured, rather than accepting blindly", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await post()).status).toBe(503);
  });

  it("trims a pasted secret so stray whitespace is not a silent outage", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = `  ${SECRET}\n`;
    await post();
    expect(constructEvent).toHaveBeenCalledWith(expect.anything(), "sig", SECRET);
  });
});

describe("idempotency", () => {
  it("claims the event before running the handler", async () => {
    await post();
    expect(db.data.get("stripeEvents/evt_1")).toMatchObject({
      type: "customer.subscription.updated",
      done: true,
    });
  });

  it("acks a genuinely completed redelivery without re-running the handler", async () => {
    db.data.set("stripeEvents/evt_1", { done: true, at: Date.now(), type: "x" });
    const res = await post();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ duplicate: true });
    expect(subscriptionsList).not.toHaveBeenCalled();
  });

  it("409s an IN-FLIGHT claim — it must not ack work that never finished", async () => {
    // THE regression. A 200 here tells Stripe to stop retrying, so an attempt
    // that died on a function timeout is never retried, `done` is never set,
    // and for checkout.session.completed that is a paying customer left on the
    // free tier with no event left to fix it.
    db.data.set("stripeEvents/evt_1", { done: false, at: Date.now(), type: "x" });
    const res = await post();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ inFlight: true });
    expect(subscriptionsList).not.toHaveBeenCalled();
  });

  it("reclaims a stale claim so a crashed attempt is retried, not lost forever", async () => {
    db.data.set("stripeEvents/evt_1", {
      done: false,
      at: Date.now() - 6 * 60 * 1000, // past the 5-minute window
      type: "x",
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(subscriptionsList).toHaveBeenCalled();
    expect(db.data.get("stripeEvents/evt_1")).toMatchObject({ done: true });
  });

  it("500s when Firestore is unreachable, so Stripe retries", async () => {
    db.failTransactions();
    const res = await post();
    expect(res.status).toBe(500);
    // An infrastructure blip must never be recorded as a processed event.
    expect(db.data.has("stripeEvents/evt_1")).toBe(false);
  });

  it("does not leave a claim standing when the transaction body throws", async () => {
    // Writes are buffered until the body resolves; a throw must leave no trace,
    // which is what keeps "claim failed" distinguishable from "claimed then
    // crashed".
    db.failTransactions(new Error("aborted"));
    await post();
    expect(db.writes).toEqual([]);
  });
});

describe("entitlement is derived from the CUSTOMER, not the event's subscription", () => {
  it("keeps Premium when a cancellation arrives for one of two subscriptions", async () => {
    const canceled = makeSubscription({ id: "sub_old", status: "canceled" });
    const live = makeSubscription({ id: "sub_new", status: "active" });
    constructEvent.mockReturnValue(event("customer.subscription.deleted", canceled));
    subscriptionsList.mockResolvedValue({ data: [canceled, live] });

    await post();

    const plan = db.data.get("users/uid_1/profile/plan");
    // Deriving from the event alone would write plan:"free" over a live
    // subscription the customer still holds.
    expect(plan).toMatchObject({ plan: "premium" });
  });

  it("cancels superseded live subscriptions instead of billing for both", async () => {
    // A real subscriber who moved monthly -> annual kept paying for BOTH: the
    // plan doc said "premium, annual", the app looked right, and Stripe billed
    // the old monthly alongside it every month.
    const older = makeSubscription({
      id: "sub_monthly",
      items: { data: [{ price: { id: "price_m" }, current_period_end: Math.floor(Date.now() / 1000) + 10 * 864e2 }] },
    });
    const newer = makeSubscription({
      id: "sub_annual",
      items: { data: [{ price: { id: "price_a" }, current_period_end: Math.floor(Date.now() / 1000) + 300 * 864e2 }] },
    });
    constructEvent.mockReturnValue(event("customer.subscription.updated", newer));
    subscriptionsList.mockResolvedValue({ data: [older, newer] });

    await post();

    expect(subscriptionsCancel).toHaveBeenCalledWith("sub_monthly");
    expect(subscriptionsCancel).not.toHaveBeenCalledWith("sub_annual");
  });

  it("falls back to the event's own subscription when the list call fails", async () => {
    subscriptionsList.mockRejectedValue(new Error("stripe down"));
    const res = await post();
    // A slightly stale answer beats dropping the event and retrying forever.
    expect(res.status).toBe(200);
    expect(db.data.get("users/uid_1/profile/plan")).toMatchObject({ plan: "premium" });
  });
});

describe("mapping an event back to a user", () => {
  it("writes nothing when no firebaseUid can be found anywhere", async () => {
    const orphan = makeSubscription({ metadata: {}, customer: "cus_orphan" });
    constructEvent.mockReturnValue(event("customer.subscription.updated", orphan));
    subscriptionsList.mockResolvedValue({ data: [orphan] });
    customersRetrieve.mockResolvedValue({ deleted: false, metadata: {} });

    const res = await post();

    expect(res.status).toBe(200); // acked: retrying will not find a uid either
    expect([...db.data.keys()].some((k) => k.startsWith("users/"))).toBe(false);
  });

  it("recovers the uid from the customer when the subscription lacks it", async () => {
    // A subscription created from the Stripe dashboard (comping an account)
    // has no metadata of ours, and subscription.* events arrive unexpanded.
    const dashboardSub = makeSubscription({ metadata: {} });
    constructEvent.mockReturnValue(event("customer.subscription.updated", dashboardSub));
    subscriptionsList.mockResolvedValue({ data: [dashboardSub] });
    customersRetrieve.mockResolvedValue({ deleted: false, metadata: { firebaseUid: "uid_from_customer" } });

    await post();

    expect(db.data.get("users/uid_from_customer/profile/plan")).toMatchObject({ plan: "premium" });
  });

  it("skips a deleted account rather than resurrecting its plan doc", async () => {
    getUser.mockRejectedValue(Object.assign(new Error("nope"), { code: "auth/user-not-found" }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(db.data.has("users/uid_1/profile/plan")).toBe(false);
  });

  it("500s on a TRANSIENT auth failure instead of dropping a real event", async () => {
    // Treating this like a deleted user would strand a paying subscriber with
    // no entitlement and no event left to fix it.
    getUser.mockRejectedValue(Object.assign(new Error("backend"), { code: "auth/internal-error" }));
    const res = await post();
    expect(res.status).toBe(500);
  });

  it("releases the claim when the handler throws, so the retry can reclaim it", async () => {
    // Without this the 500 tells Stripe to retry, and the retry is then
    // rejected as a duplicate by the claim the failed attempt left behind —
    // the event is lost with a claim standing over work that never happened.
    getUser.mockRejectedValue(Object.assign(new Error("backend"), { code: "auth/internal-error" }));
    await post();
    expect(db.data.has("stripeEvents/evt_1")).toBe(false);
    expect(db.writes).toContain("delete:stripeEvents/evt_1");
  });
});

describe("invoice events", () => {
  it("reads the subscription from parent.subscription_details, not invoice.subscription", async () => {
    // The top-level field was removed in the Basil API release. Reading the old
    // path returns undefined, which silently turned both invoice cases into
    // no-ops: events received, recorded as processed, and dropped.
    const invoice = { parent: { subscription_details: { subscription: "sub_from_parent" } } };
    constructEvent.mockReturnValue(event("invoice.paid", invoice));
    await post();
    expect(subscriptionsRetrieve).toHaveBeenCalledWith("sub_from_parent", expect.anything());
  });

  it("still reads the legacy field so archived events replay", async () => {
    const invoice = { subscription: "sub_legacy" };
    constructEvent.mockReturnValue(event("invoice.payment_failed", invoice));
    await post();
    expect(subscriptionsRetrieve).toHaveBeenCalledWith("sub_legacy", expect.anything());
  });

  it("acks an invoice with no subscription rather than erroring", async () => {
    constructEvent.mockReturnValue(event("invoice.paid", {}));
    const res = await post();
    expect(res.status).toBe(200);
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
  });
});

describe("unhandled events", () => {
  it("acks an event type it does not handle, and marks it done", async () => {
    constructEvent.mockReturnValue(event("customer.created", {}, "evt_other"));
    const res = await post();
    expect(res.status).toBe(200);
    expect(db.data.get("stripeEvents/evt_other")).toMatchObject({ done: true });
  });
});
