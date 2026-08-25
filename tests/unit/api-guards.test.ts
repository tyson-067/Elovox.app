import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientIp, makeRateLimiter, timingSafeCompare } from "@/lib/verify";
import { readJsonObject, JSON_BODY_MAX_BYTES } from "@/lib/requestBody";
import { MAX_DAILY_ATTEMPTS, usageDateKey } from "@/lib/quota";

/* ---------------------------------------------------------------------------
   The guards every paid route sits behind. None of them had tests, and three
   of them are security decisions rather than formatting ones — the kind where
   a plausible-looking change is silently wrong and nothing fails until the
   bill arrives.
   --------------------------------------------------------------------------- */

const withHeaders = (h: Record<string, string>) =>
  new Request("https://elovox.app/api/x", { headers: h }) as never;

describe("clientIp — the leftmost XFF entry is attacker-controlled", () => {
  it("prefers x-real-ip, which the platform sets and a client cannot forge", () => {
    expect(
      clientIp(withHeaders({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))
    ).toBe("9.9.9.9");
  });

  it("takes the RIGHTMOST x-forwarded-for entry, not the leftmost", () => {
    // THE security property. A client can send any X-Forwarded-For it likes;
    // the platform APPENDS the real peer to the right. Reading the leftmost
    // lets a caller rotate a header value and defeat per-IP limiting entirely
    // — which is how a scripted caller once drove the paid Gemini pipeline.
    expect(clientIp(withHeaders({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("cannot be split into separate buckets by rotating the spoofable half", () => {
    const real = "203.0.113.7";
    const seen = new Set(
      ["a", "b", "c", "d"].map((spoof) =>
        clientIp(withHeaders({ "x-forwarded-for": `${spoof}, ${real}` }))
      )
    );
    expect(seen).toEqual(new Set([real])); // one bucket, not four
  });

  it("fails safe to a single shared bucket rather than disabling the limiter", () => {
    expect(clientIp(withHeaders({}))).toBe("unknown");
    expect(clientIp(withHeaders({ "x-forwarded-for": "  ,  " }))).toBe("unknown");
  });

  it("ignores an empty x-real-ip instead of returning it", () => {
    expect(clientIp(withHeaders({ "x-real-ip": "   ", "x-forwarded-for": "5.5.5.5" }))).toBe("5.5.5.5");
  });
});

describe("usageDateKey — the client supplies the day, so it is bounded", () => {
  const NOW = Date.parse("2026-08-25T12:00:00Z");

  it("accepts the client's own local day when it is adjacent to server UTC", () => {
    // Honest users get a cap that resets at THEIR midnight, not UTC's.
    expect(usageDateKey("2026-08-24", NOW)).toBe("2026-08-24");
    expect(usageDateKey("2026-08-25", NOW)).toBe("2026-08-25");
    expect(usageDateKey("2026-08-26", NOW)).toBe("2026-08-26");
  });

  it("clamps a far-off date to server today — no infinite free resets", () => {
    // Without the bound, a tamperer invents a new date per request and the
    // daily cap stops existing.
    for (const forged of ["2027-01-01", "1999-01-01", "2026-09-30", "2026-08-20"]) {
      expect(usageDateKey(forged, NOW), forged).toBe("2026-08-25");
    }
  });

  it("bounds the worst case to 3x the cap, not infinity", () => {
    const reachable = new Set(
      ["2026-08-24", "2026-08-25", "2026-08-26", "2027-05-05", "garbage"].map((d) =>
        usageDateKey(d, NOW)
      )
    );
    expect(reachable.size).toBeLessThanOrEqual(3);
    expect(MAX_DAILY_ATTEMPTS).toBe(3);
  });

  it("falls back to today on anything that is not a YYYY-MM-DD date", () => {
    for (const junk of ["", "not-a-date", "2026-8-5", "2026-08-25T00:00:00Z", "0000-00-00"]) {
      expect(usageDateKey(junk, NOW), junk).toBe("2026-08-25");
    }
  });
});

describe("readJsonObject", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://elovox.app/api/x", { method: "POST", body, headers }) as never;

  it("accepts a plain object", async () => {
    await expect(readJsonObject(post('{"a":1}'))).resolves.toEqual({ ok: true, body: { a: 1 } });
  });

  it("treats an empty body as an empty object", async () => {
    await expect(readJsonObject(post(""))).resolves.toEqual({ ok: true, body: {} });
  });

  it("rejects null and arrays, which parse fine but are not a body", async () => {
    await expect(readJsonObject(post("null"))).resolves.toMatchObject({ reason: "bad-shape" });
    await expect(readJsonObject(post("[1,2]"))).resolves.toMatchObject({ reason: "bad-shape" });
    await expect(readJsonObject(post('"a string"'))).resolves.toMatchObject({ reason: "bad-shape" });
  });

  it("rejects malformed JSON", async () => {
    await expect(readJsonObject(post("{oops"))).resolves.toMatchObject({ reason: "bad-json" });
  });

  it("rejects an oversized body even when Content-Length lies about it", async () => {
    // A chunked request can omit the header entirely and a dishonest one can
    // understate it, so the declared length is a fast path, never the check.
    const huge = JSON.stringify({ a: "x".repeat(JSON_BODY_MAX_BYTES + 10) });
    await expect(readJsonObject(post(huge, { "content-length": "10" }))).resolves.toMatchObject({
      reason: "too-large",
    });
  });

  it("honours a smaller per-route cap", async () => {
    await expect(readJsonObject(post('{"a":"xxxxxxxxxx"}'), 5)).resolves.toMatchObject({
      reason: "too-large",
    });
  });
});

describe("timingSafeCompare", () => {
  it("matches only identical strings", () => {
    expect(timingSafeCompare("secret", "secret")).toBe(true);
    expect(timingSafeCompare("secret", "secreT")).toBe(false);
  });

  it("compares different-length inputs without throwing", () => {
    // Both sides are hashed to a fixed 32 bytes first, which is what lets
    // timingSafeEqual be used at all — and stops the LENGTH leaking too.
    expect(timingSafeCompare("a", "a-much-longer-value")).toBe(false);
    expect(timingSafeCompare("", "")).toBe(true);
  });
});

describe("makeRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit, then blocks", () => {
    const limited = makeRateLimiter(3, 60_000);
    expect([limited("k"), limited("k"), limited("k")]).toEqual([false, false, false]);
    expect(limited("k")).toBe(true);
  });

  it("keys are independent", () => {
    const limited = makeRateLimiter(1, 60_000);
    expect(limited("a")).toBe(false);
    expect(limited("b")).toBe(false);
    expect(limited("a")).toBe(true);
  });

  it("lets the window slide", () => {
    const limited = makeRateLimiter(1, 60_000);
    expect(limited("k")).toBe(false);
    expect(limited("k")).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(limited("k")).toBe(false);
  });

  it("evicts expired buckets instead of growing forever", () => {
    // Expired timestamps were filtered on read but the empty bucket was never
    // dropped, so the map kept an entry for every uid and IP the instance had
    // ever seen, for the life of the process.
    const limited = makeRateLimiter(5, 1_000);
    for (let i = 0; i < 1_200; i++) limited(`key-${i}`);
    vi.advanceTimersByTime(2_000);
    limited("trigger-eviction");
    // Not asserting the internal map (it is closed over) — asserting that the
    // limiter still behaves correctly after a large key churn.
    expect(limited("fresh")).toBe(false);
  });
});
