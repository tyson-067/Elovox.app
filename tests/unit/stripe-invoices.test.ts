import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

/** vi.fn() defaults to a signature TS will not let you call with arguments. */
type AnyMock = Mock<(...args: unknown[]) => unknown>;
import { makeDb, type FakeDb } from "../helpers/firestore-fake";

/* ---------------------------------------------------------------------------
   /api/stripe/invoices is the only account of the money the user can see from
   inside the app, and it used to show one direction of it. We refund without
   being asked (account deletion, the webhook's duplicate cleanup), so the
   person most likely to open billing history is someone who has just been
   refunded — and the page showed the charge, no refund, and nothing to say the
   money had come back. These tests hold that line, plus the cap: a truncated
   list must be reported as truncated, never served as if it were everything.
   --------------------------------------------------------------------------- */

let db: FakeDb;
let verifyUser: AnyMock;
let limited: AnyMock;
let invoicesList: AnyMock;
let chargesList: AnyMock;
let stripeClient: unknown;

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminDb: () => db,
  getAdminApp: () => ({}),
}));
vi.mock("@/lib/verify", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  verifyUser: (...a: unknown[]) => verifyUser(...a),
}));
vi.mock("@/lib/rateLimit", () => ({ limited: (...a: unknown[]) => limited(...a) }));
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getStripe: () => (stripeClient === null ? null : stripeClient),
}));

const { GET } = await import("@/app/api/stripe/invoices/route");
import type { InvoiceRow } from "@/app/api/stripe/invoices/route";

const get = () =>
  GET(new Request("https://elovox.app/api/stripe/invoices") as never);

const body = async (): Promise<{
  invoices: InvoiceRow[];
  hasMore?: boolean;
  limit?: number;
  error?: string;
}> => (await get()).json();

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "in_1",
  number: "ELX-0001",
  created: 1_700_000_000,
  total: 1199,
  currency: "usd",
  status: "paid",
  hosted_invoice_url: "https://invoice.stripe.com/1",
  invoice_pdf: "https://invoice.stripe.com/1.pdf",
  ...over,
});

const charge = (over: Record<string, unknown> = {}) => ({
  id: "ch_1",
  receipt_url: "https://pay.stripe.com/receipts/1",
  refunds: { data: [] },
  ...over,
});

const refund = (over: Record<string, unknown> = {}) => ({
  id: "re_1",
  amount: 800,
  currency: "usd",
  created: 1_700_086_400,
  status: "succeeded",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.STRIPE_SECRET_KEY = "sk_test";
  db = makeDb({ "users/uid_1/profile/plan": { stripeCustomerId: "cus_1" } });
  verifyUser = vi.fn().mockResolvedValue("uid_1");
  limited = vi.fn().mockResolvedValue(false);
  invoicesList = vi.fn().mockResolvedValue({ data: [invoice()], has_more: false });
  chargesList = vi.fn().mockResolvedValue({ data: [charge()], has_more: false });
  stripeClient = {
    invoices: { list: (...a: unknown[]) => invoicesList(...a) },
    charges: { list: (...a: unknown[]) => chargesList(...a) },
  };
});
afterEach(() => vi.restoreAllMocks());

describe("who can read a billing history", () => {
  it("401s a signed-out caller", async () => {
    verifyUser.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(invoicesList).not.toHaveBeenCalled();
  });

  it("returns an empty history for someone who never subscribed", async () => {
    db = makeDb();
    expect(await body()).toEqual({ invoices: [] });
    expect(invoicesList).not.toHaveBeenCalled();
  });
});

describe("refunds appear alongside the charges", () => {
  it("lists a refund as its own negative row", async () => {
    chargesList.mockResolvedValue({
      data: [charge({ refunds: { data: [refund()] } })],
      has_more: false,
    });
    const { invoices } = await body();
    const back = invoices.find((r) => r.kind === "refund");
    expect(back).toBeTruthy();
    expect(back?.total).toBe(-800);
    expect(back?.id).toBe("re_1");
    // The charge's receipt is kept current with its refunds, so it is the
    // right thing to link a refund row at.
    expect(back?.hostedUrl).toBe("https://pay.stripe.com/receipts/1");
  });

  it("asks Stripe to expand the refunds, without which they never come back", async () => {
    await get();
    expect(chargesList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", expand: ["data.refunds"] })
    );
  });

  it("hides a failed or canceled refund, which is money that never moved", async () => {
    chargesList.mockResolvedValue({
      data: [
        charge({
          refunds: {
            data: [
              refund({ id: "re_failed", status: "failed" }),
              refund({ id: "re_canceled", status: "canceled" }),
              refund({ id: "re_pending", status: "pending" }),
            ],
          },
        }),
      ],
      has_more: false,
    });
    const { invoices } = await body();
    const ids = invoices.filter((r) => r.kind === "refund").map((r) => r.id);
    // Pending has left our side and the row carries its own status, so the
    // user waiting on their bank sees it rather than nothing.
    expect(ids).toEqual(["re_pending"]);
  });

  it("interleaves refunds with charges, newest first", async () => {
    invoicesList.mockResolvedValue({
      data: [invoice({ id: "in_old", created: 1_700_000_000 })],
      has_more: false,
    });
    chargesList.mockResolvedValue({
      data: [charge({ refunds: { data: [refund({ created: 1_700_500_000 })] } })],
      has_more: false,
    });
    const { invoices } = await body();
    expect(invoices.map((r) => r.id)).toEqual(["re_1", "in_old"]);
  });

  it("fails the whole request rather than serving a refund-blind history", async () => {
    chargesList.mockRejectedValue(new Error("stripe down"));
    const res = await get();
    expect(res.status).toBe(502);
    expect((await res.json()).invoices).toBeUndefined();
  });
});

describe("the list never pretends to be complete", () => {
  it("reports when Stripe has more than the page it returned", async () => {
    invoicesList.mockResolvedValue({ data: [invoice()], has_more: true });
    expect((await body()).hasMore).toBe(true);
  });

  it("says how many rows it was willing to ask for", async () => {
    const { limit } = await body();
    expect(limit).toBe(100);
    expect(invoicesList).toHaveBeenCalledWith(
      expect.objectContaining({ limit })
    );
  });

  it("still drops drafts, which are charges that may never happen", async () => {
    invoicesList.mockResolvedValue({
      data: [invoice(), invoice({ id: "in_draft", status: "draft" })],
      has_more: false,
    });
    const { invoices } = await body();
    expect(invoices.map((r) => r.id)).toEqual(["in_1"]);
  });
});
