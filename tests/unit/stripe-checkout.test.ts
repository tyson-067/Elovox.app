import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

/** vi.fn() defaults to a signature TS will not let you call with arguments. */
type AnyMock = Mock<(...args: unknown[]) => unknown>;
import { makeDb, type FakeDb } from "../helpers/firestore-fake";

/* ---------------------------------------------------------------------------
   /api/stripe/checkout is the other end of the money path. Its guards are the
   difference between "a user subscribes" and "a user subscribes twice", or
   subscribes on an address nobody owns and never receives a receipt.
   --------------------------------------------------------------------------- */

let db: FakeDb;
let verifyVerifiedUser: AnyMock;
let limited: AnyMock;
let subscriptionsList: AnyMock;
let customersList: AnyMock;
let customersCreate: AnyMock;
let sessionsCreate: AnyMock;
let opsFlags: Record<string, unknown>;
let stripeClient: unknown;

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminDb: () => db,
  getAdminApp: () => ({}),
}));
vi.mock("@/lib/verify", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  verifyVerifiedUser: (...a: unknown[]) => verifyVerifiedUser(...a),
}));
vi.mock("@/lib/rateLimit", () => ({ limited: (...a: unknown[]) => limited(...a) }));
vi.mock("@/lib/opsMetrics", () => ({ getOpsFlags: async () => opsFlags }));
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // Returns null when the test switches billing off, which is the same shape
  // the real module produces with no STRIPE_SECRET_KEY.
  getStripe: () => (stripeClient === null ? null : stripeClient),
}));
const makeStripe = () => ({
    subscriptions: { list: (...a: unknown[]) => subscriptionsList(...a) },
    customers: {
      list: (...a: unknown[]) => customersList(...a),
      create: (...a: unknown[]) => customersCreate(...a),
      update: vi.fn().mockResolvedValue({}),
    },
    checkout: { sessions: { create: (...a: unknown[]) => sessionsCreate(...a) } },
});

const { POST } = await import("@/app/api/stripe/checkout/route");

const post = (body: unknown = { cycle: "monthly" }) =>
  POST(
    new Request("https://elovox.app/api/stripe/checkout", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as never
  );

const sub = (status: string) => ({ id: `sub_${status}`, status, items: { data: [] } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.STRIPE_SECRET_KEY = "sk_test";
  process.env.STRIPE_PRICE_WEEKLY = "price_w";
  process.env.STRIPE_PRICE_MONTHLY = "price_m";
  process.env.STRIPE_PRICE_ANNUAL = "price_a";
  opsFlags = {};
  db = makeDb();
  verifyVerifiedUser = vi.fn().mockResolvedValue("uid_1");
  limited = vi.fn().mockResolvedValue(false);
  subscriptionsList = vi.fn().mockResolvedValue({ data: [] });
  customersList = vi.fn().mockResolvedValue({ data: [] });
  customersCreate = vi.fn().mockResolvedValue({ id: "cus_new" });
  sessionsCreate = vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/x" });
  stripeClient = makeStripe();
});
afterEach(() => vi.restoreAllMocks());

describe("who is allowed to start a checkout", () => {
  it("401s a signed-out caller", async () => {
    verifyVerifiedUser.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("401s the local-dev pseudo-user rather than billing it", async () => {
    verifyVerifiedUser.mockResolvedValue("local-dev");
    expect((await post()).status).toBe(401);
  });

  it("403s an unconfirmed email address", async () => {
    // A subscription on an unconfirmed address is a support problem waiting to
    // happen: receipts and password resets go to an inbox nobody owns.
    verifyVerifiedUser.mockResolvedValue("unverified");
    const res = await post();
    expect(res.status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("429s a caller hammering the endpoint", async () => {
    limited.mockResolvedValue(true);
    expect((await post()).status).toBe(429);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("503s when billing is not configured, instead of half-starting a purchase", async () => {
    stripeClient = null;
    const res = await post();
    expect(res.status).toBe(503);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});

describe("what may be purchased", () => {
  it("rejects a cycle that is not one of the three", async () => {
    const res = await post({ cycle: "lifetime" });
    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing cycle rather than defaulting to one", async () => {
    // Defaulting here would charge someone for a plan they did not choose.
    expect((await post({})).status).toBe(400);
  });

  it("503s a cycle whose price id is not configured", async () => {
    delete process.env.STRIPE_PRICE_ANNUAL;
    const res = await post({ cycle: "annual" });
    expect(res.status).toBe(503);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});

describe("the double-subscription guard", () => {
  for (const status of ["trialing", "active", "past_due", "unpaid"]) {
    it(`409s when the customer already holds a ${status} subscription`, async () => {
      subscriptionsList.mockResolvedValue({ data: [sub(status)] });
      customersList.mockResolvedValue({ data: [{ id: "cus_1", metadata: { firebaseUid: "uid_1" } }] });

      const res = await post();

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ code: "already_subscribed" });
      // The bug this prevents is being billed twice for the same product.
      expect(sessionsCreate).not.toHaveBeenCalled();
    });
  }

  it("allows a new checkout when the only prior subscription is dead", async () => {
    subscriptionsList.mockResolvedValue({ data: [sub("canceled"), sub("incomplete_expired")] });
    customersList.mockResolvedValue({ data: [{ id: "cus_1", metadata: { firebaseUid: "uid_1" } }] });

    const res = await post();

    expect(res.status).toBe(200);
    expect(sessionsCreate).toHaveBeenCalled();
  });
});

describe("the operator kill switch", () => {
  it("refuses new purchases while checkout is paused", async () => {
    opsFlags = { pauseCheckout: true };
    const res = await post();
    expect(res.status).toBe(503);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("also refuses on the global unavailable flag", async () => {
    opsFlags = { unavailable: true };
    expect((await post()).status).toBe(503);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("sells normally when the flags are clear", async () => {
    opsFlags = { pauseCheckout: false };
    expect((await post()).status).toBe(200);
  });
});
