import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { createHash, createHmac } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { makeDb, type FakeDb } from "../helpers/firestore-fake";

/** vi.fn() defaults to a signature TS will not let you call with arguments. */
type AnyMock = Mock<(...args: unknown[]) => unknown>;

/* ---------------------------------------------------------------------------
   lib/email/ sends real mail to real people, on a cron, with no human in the
   loop. Four things can go wrong here that nothing else in the repo can do:

     1. mail somebody who unsubscribed, hard-bounced, or pressed "spam" —
        which is how a sending domain stops being able to reach ANYONE;
     2. mail the same person the same thing twice;
     3. spend a day's allowance at 9am so the 3pm lockout notice never sends;
     4. ship a forgeable unsubscribe link, which lets anyone unsubscribe
        anyone — including from their own billing mail.

   None of it had tests. Everything below pins one of those four.
   --------------------------------------------------------------------------- */

/* --- The fake ------------------------------------------------------------- */

// FieldValue sentinels. budget.ts and suppression.ts both write through
// increment()/delete(), so the store has to understand them or every counter
// test would silently assert 0 === 0.
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (n: number) => ({ __inc__: n }),
    delete: () => ({ __del__: true }),
  },
  FieldPath: { documentId: () => "__name__" },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}));

interface SnapLike {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}
interface DocRef {
  path: string;
  get: () => Promise<SnapLike>;
  set: (v: Record<string, unknown>, o?: { merge?: boolean }) => Promise<void>;
  update: (v: Record<string, unknown>) => Promise<void>;
  delete: () => Promise<void>;
  create: (v: Record<string, unknown>) => Promise<void>;
}
interface TxLike {
  get: (ref: DocRef) => Promise<SnapLike>;
  set: (ref: DocRef, v: Record<string, unknown>, o?: { merge?: boolean }) => void;
  update: (ref: DocRef, v: Record<string, unknown>) => void;
}

const isInc = (v: unknown): v is { __inc__: number } =>
  typeof v === "object" && v !== null && "__inc__" in v;
const isDel = (v: unknown): v is { __del__: true } =>
  typeof v === "object" && v !== null && "__del__" in v;

function resolvePatch(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): { out: Record<string, unknown>; drop: string[] } {
  const out: Record<string, unknown> = {};
  const drop: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (isInc(v)) {
      const cur = existing?.[k];
      out[k] = (typeof cur === "number" ? cur : 0) + v.__inc__;
    } else if (isDel(v)) {
      drop.push(k);
    } else {
      out[k] = v;
    }
  }
  return { out, drop };
}

interface EmailDb {
  data: FakeDb["data"];
  writes: string[];
  doc: (path: string) => DocRef;
  collection: (name: string) => { doc: (id?: string) => DocRef };
  getAll: (...refs: DocRef[]) => Promise<SnapLike[]>;
  batch: () => {
    set: (ref: DocRef, v: Record<string, unknown>, o?: { merge?: boolean }) => void;
    commit: () => Promise<void>;
  };
  runTransaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T>;
  failTransactions: FakeDb["failTransactions"];
  failReads: (on: boolean) => void;
  failWrites: (on: boolean) => void;
  failCreates: (on: boolean) => void;
}

/**
 * tests/helpers/firestore-fake.ts, plus the four surfaces the email system
 * uses that the webhook did not: create() (the once-claim), getAll() (the
 * bulk suppression read), batch() (the delivery log) and FieldValue
 * increments (every budget counter). The buffered-transaction semantics —
 * the part that actually matters — come straight from the helper.
 */
function makeEmailDb(seed: Record<string, Record<string, unknown>> = {}): EmailDb {
  const base = makeDb(seed);
  let readsFail = false;
  let writesFail = false;
  let createsFail = false;
  let auto = 0;

  const wrap = (path: string): DocRef => {
    // Firestore throws out of db.doc() — synchronously — for the reserved
    // __x__ id shape. suppression.ts guards against it; the guard is only
    // testable if the fake enforces the rule.
    const id = path.split("/").pop() ?? "";
    if (/^__.*__$/.test(id)) throw new Error(`invalid document id: ${id}`);
    const r = base.doc(path) as unknown as Omit<DocRef, "create">;
    return {
      ...r,
      get: async () => {
        if (readsFail) throw new Error("firestore unreachable");
        return r.get();
      },
      set: async (v, o) => {
        if (writesFail) throw new Error("firestore unreachable");
        const { out, drop } = resolvePatch(base.data.get(path), v);
        await r.set(out, o);
        if (drop.length) {
          const cur = base.data.get(path);
          if (cur) {
            for (const k of drop) delete cur[k];
            base.data.set(path, cur);
          }
        }
      },
      create: async (v) => {
        if (createsFail) throw new Error("firestore unreachable");
        if (base.data.has(path)) {
          const err = Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
          throw err;
        }
        await r.set(v);
      },
    };
  };

  return {
    data: base.data,
    writes: base.writes,
    doc: wrap,
    collection: (name) => ({ doc: (id?: string) => wrap(`${name}/${id ?? `auto_${++auto}`}`) }),
    getAll: async (...refs) => {
      if (readsFail) throw new Error("firestore unreachable");
      return refs.map((ref) => ({
        exists: base.data.has(ref.path),
        data: () => {
          const v = base.data.get(ref.path);
          return v ? { ...v } : undefined;
        },
      }));
    },
    batch: () => {
      const ops: Array<() => Promise<void>> = [];
      return {
        set: (ref, v, o) => void ops.push(() => wrap(ref.path).set(v, o)),
        commit: async () => {
          for (const op of ops) await op();
        },
      };
    },
    runTransaction: <T>(fn: (tx: TxLike) => Promise<T>): Promise<T> =>
      base.runTransaction((tx) =>
        fn({
          get: (ref) => tx.get(ref as never),
          set: (ref, v, o) =>
            tx.set(ref as never, resolvePatch(base.data.get(ref.path), v).out, o),
          update: (ref, v) =>
            tx.update(ref as never, resolvePatch(base.data.get(ref.path), v).out),
        })
      ),
    failTransactions: base.failTransactions,
    failReads: (on) => void (readsFail = on),
    failWrites: (on) => void (writesFail = on),
    failCreates: (on) => void (createsFail = on),
  };
}

const asDb = (d: EmailDb) => d as unknown as Firestore;

/* --- Resend, stubbed ------------------------------------------------------ */

let sendEmailMock: AnyMock;
let sendBatchMock: AnyMock;

vi.mock("@/lib/email/client", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // The 600ms inter-chunk pause is a real-plan constraint, not a property
  // under test, and a bulk test should not take a second per chunk.
  throttle: () => Promise.resolve(),
  sendEmail: (...a: unknown[]) => sendEmailMock(...a),
  sendBatch: (...a: unknown[]) => sendBatchMock(...a),
}));

const {
  signUnsubToken,
  verifyUnsubToken,
  unsubUrl,
  unsubHeaders,
  applyUnsubscribe,
  readPrefs,
  writePrefs,
  PREF_KEYS,
} = await import("@/lib/email/prefs");
const {
  suppress,
  suppressionFor,
  filterSuppressed,
  getSuppression,
} = await import("@/lib/email/suppression");
const { claimOnce, confirmOnce, releaseOnce } = await import("@/lib/email/once");
const { reserve, release, utcMonthKey } = await import("@/lib/email/budget");
const { send, sendBulk, EMAIL_LOG_TTL_MS } = await import("@/lib/email/send");
const { CATEGORY, FREE_PLAN } = await import("@/lib/email/config");
const { isHardBounce } = await import("@/lib/email/webhook");
const { utcDayKey } = await import("@/lib/opsMetrics");
const { render } = await import("@/lib/email/render");
const {
  subscriptionStarted,
  tipsWelcome,
  winBack,
  lockoutNotice,
  paymentFailed,
  welcome,
} = await import("@/lib/email/messages");
const { LEGAL } = await import("@/lib/legal");
import type { AppMessage } from "@/lib/email/send";
import type { EmailPrefKey } from "@/lib/email/config";

const SECRET = "unit-test-email-token-secret";
let db: EmailDb;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  for (const k of [
    "EMAIL_TOKEN_SECRET",
    "FIREBASE_SERVICE_ACCOUNT",
    "RESEND_API_KEY",
    "MAIL_FROM",
    "NEXT_PUBLIC_APP_URL",
  ]) {
    savedEnv[k] = process.env[k];
  }
  process.env.EMAIL_TOKEN_SECRET = SECRET;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAIL_FROM = "Elovox <hello@elovox.app>";
  process.env.NEXT_PUBLIC_APP_URL = "https://elovox.app";
  db = makeEmailDb();
  sendEmailMock = vi.fn().mockResolvedValue({ ok: true, id: "re_123" });
  sendBatchMock = vi.fn(async (msgs: unknown) => ({
    ok: true,
    ids: (msgs as unknown[]).map((_, i) => `re_b${i}`),
  })) as unknown as AnyMock;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

/* ===========================================================================
   1. THE UNSUBSCRIBE TOKEN — the one forgeable thing in the email system

   The link has to work with no account and no session, so the token IS the
   authorisation. If it can be tampered with, anybody who receives one email
   can unsubscribe any address they can name, from any stream they choose.
   =========================================================================== */

/** Mint a token by hand under the same key, so payloads the app would never
 *  produce (unknown pref keys, spliced signatures) can be tested. */
function handMint(payloadObj: unknown, keyMaterial = SECRET): string {
  const key = createHash("sha256").update(keyMaterial).digest();
  const b64 = (b: Buffer | string) =>
    Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payload = b64(JSON.stringify(payloadObj));
  return `v1.${payload}.${b64(createHmac("sha256", key).update(payload).digest())}`;
}
const partsOf = (t: string) => t.split(".");
const reB64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("unsubscribe tokens", () => {
  it("round-trips an address and the stream it came from", () => {
    const t = signUnsubToken({ email: "  Sam@Example.COM ", key: "streak" });
    expect(t).not.toBeNull();
    // Normalised at mint time, so the claim always names the same identity
    // the suppression list is keyed by. A token carrying "Sam@Example.COM"
    // would unsubscribe a row nothing ever reads.
    expect(verifyUnsubToken(t as string)).toEqual({ email: "sam@example.com", key: "streak" });
  });

  it("rejects a swapped address — the whole point of signing the link", () => {
    // Without this, "unsubscribe anyone" is a text edit in the URL bar. The
    // worst version is not spite: it is a scanner or a script walking a list.
    const t = signUnsubToken({ email: "victim@example.com", key: "progress" }) as string;
    const [v, , sig] = partsOf(t);
    const forged = `${v}.${reB64({ e: "someone-else@example.com", k: "progress" })}.${sig}`;
    expect(verifyUnsubToken(forged)).toBeNull();
  });

  it("rejects a signature lifted from a different address's token", () => {
    const mine = signUnsubToken({ email: "me@example.com", key: "tips" }) as string;
    const theirs = signUnsubToken({ email: "you@example.com", key: "tips" }) as string;
    const spliced = `v1.${partsOf(theirs)[1]}.${partsOf(mine)[2]}`;
    expect(verifyUnsubToken(spliced)).toBeNull();
  });

  it("rejects widening a scoped link into unsubscribe-from-everything", () => {
    // A footer link says "stop the weekly digest". An unscoped claim stops
    // ALL optional mail and — see the applyUnsubscribe test below — takes a
    // different, less careful code path. It must not be reachable by editing.
    const t = signUnsubToken({ email: "user@example.com", key: "progress" }) as string;
    const widened = `v1.${reB64({ e: "user@example.com", k: null })}.${partsOf(t)[2]}`;
    expect(verifyUnsubToken(widened)).toBeNull();
  });

  it("rejects a truncated or an oversized signature instead of throwing", () => {
    // timingSafeEqual throws on unequal lengths, so the length gate is what
    // stops a short signature turning a rejection into a 500 — and a 500 on
    // an unsubscribe link is a spam-button press.
    const t = signUnsubToken({ email: "user@example.com" }) as string;
    const [v, p, sig] = partsOf(t);
    for (const bad of [sig.slice(0, 20), "", sig + "AAAAAAAA", "!!!!"]) {
      expect(verifyUnsubToken(`${v}.${p}.${bad}`), bad).toBeNull();
    }
  });

  it("rejects a flipped byte in the middle of the signature", () => {
    const t = signUnsubToken({ email: "user@example.com", key: "tips" }) as string;
    const [v, p, sig] = partsOf(t);
    const flip = sig[20] === "z" ? "y" : "z";
    expect(verifyUnsubToken(`${v}.${p}.${sig.slice(0, 20)}${flip}${sig.slice(21)}`)).toBeNull();
    // NOTE for whoever writes the next one of these: do NOT mutate the LAST
    // character. A 32-byte digest is 43 base64 chars and the final char has
    // two unused bits, so four distinct strings decode to the same signature.
    // That is benign — the decoded bytes, and therefore the claim, are
    // unchanged — but a test that flipped the last char would be flaky.
  });

  it("rejects a token minted under a different secret", () => {
    // Rotating EMAIL_TOKEN_SECRET must actually invalidate old links; if the
    // secret were not in the MAC, rotating it after a leak would do nothing.
    expect(verifyUnsubToken(handMint({ e: "user@example.com", k: null }, "some-other-secret"))).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    for (const junk of ["", "v1", "a.b", "v1.a.b.c", "v2.abc.def", "....", "v1..", "v1.@@@.@@@"]) {
      expect(verifyUnsubToken(junk), junk).toBeNull();
    }
  });

  it("rejects a validly-signed token whose payload is not an address", () => {
    // The signature proves WE minted it; it does not prove the contents are
    // sane. A claim with no address would suppress the doc id "" — one shared
    // row that then blocks nobody and hides everybody.
    for (const payload of [{ e: "", k: null }, { e: "not-an-address", k: null }, { e: 42, k: null }, {}]) {
      expect(verifyUnsubToken(handMint(payload)), JSON.stringify(payload)).toBeNull();
    }
  });

  it("mints nothing at all when no signing key is configured", () => {
    // Fails CLOSED in both directions: no unsigned links go out, and a token
    // from a configured deploy does not verify on an unconfigured one.
    delete process.env.EMAIL_TOKEN_SECRET;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    expect(signUnsubToken({ email: "user@example.com" })).toBeNull();
    expect(unsubUrl("user@example.com", "tips")).toBeNull();
    expect(unsubHeaders("user@example.com", "tips", true)).toEqual({});
  });

  it("falls back to the service-account key so links are never silently omitted", () => {
    // The alternative is an email with no unsubscribe link because one more
    // env var wasn't set — and no unsubscribe link is a spam complaint.
    delete process.env.EMAIL_TOKEN_SECRET;
    process.env.FIREBASE_SERVICE_ACCOUNT = '{"private_key":"x"}';
    const t = signUnsubToken({ email: "user@example.com", key: "tips" });
    expect(t).not.toBeNull();
    expect(verifyUnsubToken(t as string)).toEqual({ email: "user@example.com", key: "tips" });
    // ...and the raw service account never appears in the token.
    expect(t).not.toContain("private_key");
  });

  it("treats an unrecognised stream as unsubscribe-from-everything", () => {
    // Recorded because it is a decision, not an accident: retire a value from
    // PREF_KEYS and every link already sitting in somebody's inbox for that
    // stream silently becomes a kill switch for ALL their optional mail,
    // routed through applyUnsubscribe's unscoped branch. Add keys freely;
    // never remove one.
    expect(verifyUnsubToken(handMint({ e: "user@example.com", k: "newsletter" }))).toEqual({
      email: "user@example.com",
      key: undefined,
    });
  });
});

describe("List-Unsubscribe headers", () => {
  it("carries both RFC 8058 headers on optional mail, or neither", () => {
    // Gmail and Yahoo render their own Unsubscribe button only when BOTH are
    // present. One without the other is the same as none — and every press of
    // that button is a press that was not the spam button.
    const h = unsubHeaders("user@example.com", "progress", true);
    expect(Object.keys(h).sort()).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(h["List-Unsubscribe"]).toMatch(/^<https:\/\/elovox\.app\/api\/email\/unsubscribe\?t=/);
  });

  it("never puts an unsubscribe header on mail that cannot be unsubscribed from", () => {
    // A lockout notice with an Unsubscribe button is a lie: pressing it stops
    // nothing, and a button that does nothing is worse than no button.
    expect(unsubHeaders("user@example.com", null, false)).toEqual({});
    expect(unsubHeaders("user@example.com", "progress", false)).toEqual({});
  });

  it("every optional category names a preference key", () => {
    // If an optional category had a null prefKey, send.ts would mint an
    // UNSCOPED token for its footer link, so "stop the weekly digest" would
    // silently stop everything optional.
    for (const [name, policy] of Object.entries(CATEGORY)) {
      if (policy.optional) expect(policy.prefKey, name).not.toBeNull();
      else expect(policy.prefKey, name).toBeNull();
    }
    for (const [, policy] of Object.entries(CATEGORY)) {
      if (policy.prefKey) expect(PREF_KEYS).toContain(policy.prefKey);
    }
  });
});

/* ===========================================================================
   2. WHAT THE CLAIM DOES — one store, and it must not be widened by accident
   =========================================================================== */

describe("applying an unsubscribe", () => {
  it("stops the named stream and only the named stream", async () => {
    await applyUnsubscribe(asDb(db), { email: "user@example.com", key: "streak" });
    expect(await readPrefs(asDb(db), "user@example.com")).toEqual({
      progress: true,
      streak: false,
      product: true,
      tips: true,
    });
    const opts = { optional: true };
    expect(await suppressionFor(asDb(db), "user@example.com", { ...opts, prefKey: "streak" })).toBe("unsubscribe");
    expect(await suppressionFor(asDb(db), "user@example.com", { ...opts, prefKey: "progress" })).toBeNull();
  });

  it("never stops billing or security mail, however much is turned off", async () => {
    // The account page says so, and the law is on the other side of this one:
    // a payment-failed notice is a term of the paid relationship, not marketing.
    for (const k of PREF_KEYS) {
      await applyUnsubscribe(asDb(db), { email: "user@example.com", key: k });
    }
    expect(await readPrefs(asDb(db), "user@example.com")).toEqual({
      progress: false, streak: false, product: false, tips: false,
    });
    expect(
      await suppressionFor(asDb(db), "user@example.com", { optional: false, prefKey: null })
    ).toBeNull();
  });

  it("turning every switch back on removes the row rather than leaving a husk", async () => {
    await applyUnsubscribe(asDb(db), { email: "user@example.com", key: "tips" });
    await writePrefs(asDb(db), "user@example.com", { tips: true });
    // A leftover row with an empty `categories` array reads as "unsubscribed
    // from everything" in readPrefs — the opposite of what they just asked.
    expect(await getSuppression(asDb(db), "user@example.com")).toBeNull();
    expect(await readPrefs(asDb(db), "user@example.com")).toEqual({
      progress: true, streak: true, product: true, tips: true,
    });
  });

  it("refuses to switch anything back on for an address that complained", async () => {
    await suppress(asDb(db), "user@example.com", "complaint", { detail: "spam-report" });
    expect(await writePrefs(asDb(db), "user@example.com", { progress: true, tips: true })).toEqual({
      progress: false, streak: false, product: false, tips: false,
    });
    expect((await getSuppression(asDb(db), "user@example.com"))?.reason).toBe("complaint");
  });

  it("an unscoped claim cannot DOWNGRADE a complaint to a plain unsubscribe", async () => {
    // Found by this suite, then fixed.
    //
    // writePrefs — the scoped path, and the account page — refuses to weaken a
    // complaint. applyUnsubscribe's unscoped branch called suppress() straight
    // through with reason "unsubscribe", and suppress() merges, so `reason`
    // was overwritten. A plain unsubscribe blocks only OPTIONAL mail, so an
    // address that had pressed the spam button went back to receiving security
    // and billing mail — which lib/email/suppression.ts says is never ours to
    // undo, and which `unsuppress` explicitly refuses to do.
    //
    // Reachable from any claim with no key. Note verifyUnsubToken returns
    // key: undefined for any `k` outside PREF_KEYS, so retiring a preference
    // key turned every already-delivered link for that stream into this path.
    await suppress(asDb(db), "user@example.com", "complaint", { detail: "spam-report" });
    expect(
      await suppressionFor(asDb(db), "user@example.com", { optional: false, prefKey: null })
    ).toBe("complaint");

    await applyUnsubscribe(asDb(db), { email: "user@example.com" });

    // The stronger reason survives, and required mail stays blocked.
    expect((await getSuppression(asDb(db), "user@example.com"))?.reason).toBe("complaint");
    expect(
      await suppressionFor(asDb(db), "user@example.com", { optional: false, prefKey: null })
    ).toBe("complaint");
  });

  it("an unscoped claim still suppresses an address with no prior record", async () => {
    // The guard must not turn the ordinary case into a no-op.
    await applyUnsubscribe(asDb(db), { email: "fresh@example.com" });
    expect((await getSuppression(asDb(db), "fresh@example.com"))?.reason).toBe("unsubscribe");
    expect(
      await suppressionFor(asDb(db), "fresh@example.com", { optional: true, prefKey: "progress" })
    ).toBe("unsubscribe");
  });
});

/* ===========================================================================
   3. SUPPRESSION — the list this app must never write to again
   =========================================================================== */

describe("suppression", () => {
  const opt = { optional: true, prefKey: "progress" as EmailPrefKey };
  const req = { optional: false, prefKey: null };

  it("a hard bounce blocks every category, security included", async () => {
    await suppress(asDb(db), "dead@example.com", "hard-bounce", { detail: "Permanent / NoEmail" });
    expect(await suppressionFor(asDb(db), "dead@example.com", opt)).toBe("hard-bounce");
    expect(await suppressionFor(asDb(db), "dead@example.com", req)).toBe("hard-bounce");
  });

  it("a complaint blocks billing and security too", async () => {
    // Arguable and argued: the suppression doc makes the call deliberately.
    // Continuing to mail someone who reported this domain as spam is how the
    // domain stops being able to mail anyone, and they still have every
    // in-app route to their account.
    await suppress(asDb(db), "angry@example.com", "complaint");
    expect(await suppressionFor(asDb(db), "angry@example.com", req)).toBe("complaint");
  });

  it("a later hard reason widens an earlier scoped unsubscribe", async () => {
    // Otherwise the narrower row wins on merge and a dead mailbox keeps
    // getting billing mail because the user once turned off the digest.
    await suppress(asDb(db), "x@example.com", "unsubscribe", { categories: ["tips"] });
    await suppress(asDb(db), "x@example.com", "hard-bounce");
    const rec = await getSuppression(asDb(db), "x@example.com");
    expect(rec?.categories).toBeUndefined();
    expect(await suppressionFor(asDb(db), "x@example.com", req)).toBe("hard-bounce");
  });

  it("normalises case and whitespace, so a re-typed address is still blocked", async () => {
    // Signup forms hand back "  Sam@Example.COM ". If that missed the row,
    // one capital letter would re-open a suppressed mailbox.
    await suppress(asDb(db), "  Sam@Example.COM ", "hard-bounce");
    expect(await suppressionFor(asDb(db), "sam@example.com", req)).toBe("hard-bounce");
    expect(await suppressionFor(asDb(db), "SAM@EXAMPLE.COM", req)).toBe("hard-bounce");
  });

  it("always stores the normalised address, because the bulk path matches on it", async () => {
    // suppressionFor finds the row by DOC ID; filterSuppressed matches by the
    // stored `email` FIELD. Drop that field from the write and every cron —
    // digest, streak, tips — starts mailing the entire suppression list while
    // the single-send path keeps blocking it.
    await suppress(asDb(db), "  Sam@Example.COM ", "complaint");
    const stored = [...db.data.values()][0];
    expect(stored.email).toBe("sam@example.com");
  });

  it("an address Firestore cannot name is allowed rather than crashing the run", async () => {
    // `__a@b.co__` is a valid address and a reserved Firestore id; db.doc()
    // throws synchronously on it. One such subscriber must not take down a
    // whole digest run.
    await expect(suppressionFor(asDb(db), "__a@b.co__", req)).resolves.toBeNull();
    await expect(suppress(asDb(db), "__a@b.co__", "hard-bounce")).resolves.toBe(false);
  });

  it("bulk and single agree about who is blocked", async () => {
    // They are two implementations of one rule (getAll vs a point read, so a
    // 500-person digest is not 500 reads). If they drift, the cron mails
    // people the single path would refuse — and only the cron mails in bulk.
    await suppress(asDb(db), "bounced@example.com", "hard-bounce");
    await suppress(asDb(db), "complained@example.com", "complaint");
    await suppress(asDb(db), "digest-off@example.com", "unsubscribe", { categories: ["progress"] });
    await suppress(asDb(db), "streak-off@example.com", "unsubscribe", { categories: ["streak"] });
    await suppress(asDb(db), "all-off@example.com", "unsubscribe", {});

    const everyone = [
      "bounced@example.com", "complained@example.com", "digest-off@example.com",
      "streak-off@example.com", "all-off@example.com", "fine@example.com",
    ];
    for (const mode of [opt, req]) {
      const bulk = await filterSuppressed(asDb(db), everyone, mode);
      const single: string[] = [];
      for (const e of everyone) {
        if (!(await suppressionFor(asDb(db), e, mode))) single.push(e);
      }
      expect(bulk.allowed, JSON.stringify(mode)).toEqual(single);
      expect(bulk.dropped).toBe(everyone.length - single.length);
    }
  });

  it("bulk drops a suppressed address whatever case the queue supplies it in", async () => {
    await suppress(asDb(db), "sam@example.com", "hard-bounce");
    const { allowed, dropped } = await filterSuppressed(
      asDb(db),
      [" Sam@Example.COM ", "other@example.com"],
      req
    );
    expect(allowed).toEqual(["other@example.com"]);
    expect(dropped).toBe(1);
  });

  it("FAILS OPEN when the lookup errors — single and bulk alike", async () => {
    // Pinned as-is because it is a deliberate, documented trade: a Firestore
    // blip must not silence a lockout notice. The cost is real and worth
    // knowing: during an outage this mails hard bounces, complainers and
    // unsubscribers, including on the MARKETING path where the justification
    // does not apply — and reserve() fails open in the same outage, so the
    // day's cap is not holding the run down either.
    await suppress(asDb(db), "angry@example.com", "complaint");
    db.failReads(true);
    expect(await suppressionFor(asDb(db), "angry@example.com", req)).toBeNull();
    expect(await filterSuppressed(asDb(db), ["angry@example.com"], opt)).toEqual({
      allowed: ["angry@example.com"],
      dropped: 0,
    });
  });

  it("no database means no suppression list, so nothing is blocked", async () => {
    expect(await suppressionFor(null, "angry@example.com", req)).toBeNull();
    expect(await suppress(null, "angry@example.com", "complaint")).toBe(false);
  });
});

describe("isHardBounce", () => {
  it("recognises SES's vocabulary, which does not contain the word 'hard'", () => {
    // A first version substring-matched "hard" and therefore matched NOTHING:
    // every permanent bounce was filed as transient, no address was ever
    // suppressed, and the domain kept writing to dead mailboxes. Caught by
    // posting a real-shaped Permanent payload and finding the list empty.
    expect(isHardBounce("Permanent", "General")).toBe(true);
    expect(isHardBounce("Permanent", "NoEmail")).toBe(true);
    expect(isHardBounce(null, "Suppressed")).toBe(true);
    expect(isHardBounce("PERMANENT", "general")).toBe(true);
  });

  it("treats transient and undetermined as soft, so a full mailbox is not a death sentence", () => {
    // Suppressing a soft bounce drops a paying user's receipts forever
    // because their inbox was full on a Tuesday. An ambiguous one bounces
    // again, and the repeat usually arrives classified.
    expect(isHardBounce("Transient", "MailboxFull")).toBe(false);
    expect(isHardBounce("Undetermined", "Undetermined")).toBe(false);
    expect(isHardBounce("Transient", "NoEmail")).toBe(false);
    expect(isHardBounce(null, null)).toBe(false);
  });
});

/* ===========================================================================
   4. ONCE — "exactly once, ever"
   =========================================================================== */

describe("claimOnce", () => {
  it("only one caller wins, so two crons cannot both send", async () => {
    // create() rather than set(): set would overwrite and both instances
    // would believe they had the claim.
    expect(await claimOnce(asDb(db), "winback", "uid_1")).toBe(true);
    expect(await claimOnce(asDb(db), "winback", "uid_1")).toBe(false);
  });

  it("the loser does not stamp on the winner's record", async () => {
    await claimOnce(asDb(db), "winback", "uid_1");
    const before = { ...(db.data.get("emailOnce/winback:uid_1") as Record<string, unknown>) };
    await claimOnce(asDb(db), "winback", "uid_1");
    expect(db.data.get("emailOnce/winback:uid_1")).toEqual(before);
  });

  it("a confirmed send stays claimed forever", async () => {
    // "Once" here means once in the lifetime of the account — a month later,
    // long past any provider idempotency key. A win-back that arrives twice
    // reads as a system that has forgotten you exist.
    await claimOnce(asDb(db), "winback", "uid_1");
    await confirmOnce(asDb(db), "winback", "uid_1");
    expect(await claimOnce(asDb(db), "winback", "uid_1")).toBe(false);
    expect(db.data.get("emailOnce/winback:uid_1")?.sent).toBe(true);
  });

  it("a released claim is retryable, so one bad afternoon is not permanent", async () => {
    // Over budget, suppressed, provider down: without release, those users
    // lose their one win-back for good and nobody ever finds out.
    await claimOnce(asDb(db), "winback", "uid_1");
    await releaseOnce(asDb(db), "winback", "uid_1");
    expect(await claimOnce(asDb(db), "winback", "uid_1")).toBe(true);
  });

  it("keys the trial warning on the end date, so a second trial gets a second warning", async () => {
    // Cron fires daily over a three-day window, so the same trial is a
    // candidate up to three times — exactly one warning. A later trial is a
    // different charge and must be warned about again.
    const aug = "uid_1:August 28, 2026";
    const nov = "uid_1:November 28, 2026";
    expect(await claimOnce(asDb(db), "trial-ending", aug)).toBe(true);
    expect(await claimOnce(asDb(db), "trial-ending", aug)).toBe(false);
    expect(await claimOnce(asDb(db), "trial-ending", aug)).toBe(false);
    expect(await claimOnce(asDb(db), "trial-ending", nov)).toBe(true);
  });

  it("different kinds never collide", async () => {
    await claimOnce(asDb(db), "welcome", "uid_1");
    expect(await claimOnce(asDb(db), "winback", "uid_1")).toBe(true);
  });

  it("fails OPEN on an unexpected Firestore error, and on no database at all", async () => {
    // Deliberate: a lifecycle programme that silently does nothing on a
    // misconfigured deploy is worse than a duplicate win-back. The cost is
    // that a Firestore blip during the cron can double-send — acceptable for
    // win-back and trial warnings, and worth remembering before this is
    // reused for anything where a duplicate costs money.
    expect(await claimOnce(null, "winback", "uid_1")).toBe(true);
    db.failCreates(true);
    expect(await claimOnce(asDb(db), "winback", "uid_2")).toBe(true);
  });
});

/* ===========================================================================
   5. BUDGET — 100 a day, and who gets the hundredth
   =========================================================================== */

describe("utcMonthKey", () => {
  it("rolls at UTC midnight on the 1st, not at any local midnight", () => {
    // The month counter is compared against Resend's own 3,000, which resets
    // in UTC. A local-time key double-counts one day and under-counts another
    // every month, in whichever direction the deploy region happens to sit.
    expect(utcMonthKey(Date.parse("2026-08-31T23:59:59.999Z"))).toBe("2026-08");
    expect(utcMonthKey(Date.parse("2026-09-01T00:00:00.000Z"))).toBe("2026-09");
    expect(utcMonthKey(Date.parse("2026-12-31T23:59:59.999Z"))).toBe("2026-12");
    expect(utcMonthKey(Date.parse("2027-01-01T00:00:00.000Z"))).toBe("2027-01");
  });

  it("actually rolls the monthly counter over, rather than accruing forever", async () => {
    // The month doc is the 3,000 cap. If the key did not roll, the counter
    // would climb past 3,000 once and then refuse every email this app ever
    // sends again — a total outage that looks like a quota problem.
    const AUG = Date.parse("2026-08-31T23:00:00Z");
    const SEP = Date.parse("2026-09-01T01:00:00Z");
    db.data.set(`emailBudget/m-${utcMonthKey(AUG)}`, { total: FREE_PLAN.monthly });
    expect(await reserve(asDb(db), "security", 10, AUG)).toEqual({ granted: 0, limited: "month" });
    expect(await reserve(asDb(db), "security", 10, SEP)).toEqual({ granted: 10, limited: null });
    // Day and month docs share one collection; the "m-" prefix is what keeps
    // a month counter and a day counter off the same row.
    expect([...db.data.keys()]).toContain(`emailBudget/${utcDayKey(SEP)}`);
    expect([...db.data.keys()]).toContain(`emailBudget/m-${utcMonthKey(SEP)}`);
  });
});

describe("reserve", () => {
  const NOW = Date.parse("2026-08-25T09:00:00Z");
  const DAY = `emailBudget/${utcDayKey(NOW)}`;
  const MONTH = `emailBudget/m-${utcMonthKey(NOW)}`;

  it("caps a category at its share and says which cap bound", async () => {
    // lifecycle is 60% of 100. A digest run that asks for 80 gets 60 and is
    // TOLD it got 60 — it must send exactly that many. The alternative is
    // sending 80 and letting Resend reject an arbitrary 20, which is the same
    // twenty people failing every single week.
    const r = await reserve(asDb(db), "lifecycle", 80, NOW);
    expect(r).toEqual({ granted: 60, limited: "category" });
    expect(db.data.get(DAY)).toMatchObject({ total: 60, lifecycle: 60 });
    expect(db.data.get(MONTH)).toMatchObject({ total: 60 });
  });

  it("caps ONE optional run so a security notice can still take the hundredth message", async () => {
    // The guarantee config.ts states in so many words: a digest run that
    // wants the world gets 60, and 40 are left for the person locked out of
    // their account at 3pm.
    await reserve(asDb(db), "lifecycle", 500, NOW);
    expect(await reserve(asDb(db), "security", 40, NOW)).toEqual({ granted: 40, limited: null });
  });

  it("BUG: two optional runs on one day CAN take all 100 and starve security", async () => {
    // Reported, not endorsed. The shares are per-category ceilings, not
    // reservations, and the optional ones sum to 110% of a 100-message day
    // (lifecycle 60 + marketing 50). /api/cron/email runs the three lifecycle
    // jobs AND the tips drip in a single 09:00 UTC invocation, so on a busy
    // Monday optional mail can consume the entire day before anyone is awake
    // — and every lockout notice and card-declined email for the next fifteen
    // hours is dropped. That is precisely the failure budget.ts exists to
    // make impossible. A floor reserved for the non-optional categories, or
    // optional shares that sum to less than 1.0, would close it.
    expect(CATEGORY.lifecycle.dailyShare + CATEGORY.marketing.dailyShare).toBeGreaterThan(1);
    await reserve(asDb(db), "lifecycle", 500, NOW); // 60
    await reserve(asDb(db), "marketing", 500, NOW); // 40, day-bound
    expect(await reserve(asDb(db), "security", 1, NOW)).toEqual({ granted: 0, limited: "day" });
  });

  it("the day cap still binds once every share has been spent", async () => {
    await reserve(asDb(db), "lifecycle", 60, NOW);
    await reserve(asDb(db), "security", 40, NOW);
    expect(await reserve(asDb(db), "billing", 1, NOW)).toEqual({ granted: 0, limited: "day" });
  });

  it("the monthly cap binds even on an otherwise quiet day", async () => {
    db.data.set(MONTH, { total: FREE_PLAN.monthly - 5, month: utcMonthKey(NOW) });
    expect(await reserve(asDb(db), "security", 10, NOW)).toEqual({ granted: 5, limited: "month" });
  });

  it("grants zero rather than a negative number, and writes nothing when it does", async () => {
    // A counter can legitimately overshoot (a release that never landed, a
    // hand edit). Math.max(0, ...) is what stops that becoming a grant of
    // -20, which every caller would happily slice() into an empty send and
    // then report as success.
    db.data.set(DAY, { total: 130, lifecycle: 130, day: utcDayKey(NOW) });
    const before = db.writes.length;
    expect(await reserve(asDb(db), "lifecycle", 5, NOW)).toEqual({ granted: 0, limited: "category" });
    expect(db.writes.length).toBe(before);
  });

  it("two runs in the same day cannot both see the whole allowance", async () => {
    // The reservation is a transaction for exactly this reason: two instances
    // of one cron must not both see 60 remaining and both send 60.
    const first = await reserve(asDb(db), "lifecycle", 45, NOW);
    const second = await reserve(asDb(db), "lifecycle", 45, NOW);
    expect(first.granted + second.granted).toBe(60);
    expect(second).toEqual({ granted: 15, limited: "category" });
  });

  it("asking for nothing costs nothing", async () => {
    expect(await reserve(asDb(db), "billing", 0, NOW)).toEqual({ granted: 0, limited: null });
    expect(db.data.size).toBe(0);
  });

  it("FAILS OPEN when Firestore is unreachable, and with no database at all", async () => {
    // Deliberate: the budget is a safety rail, and a security notice that
    // does not send because a counter was unavailable is the worse failure.
    // What it means in practice is that during an outage the only thing
    // holding the free plan is Resend's own 429 — and 429 is a DROPPED email,
    // not a delayed one. Same outage also makes suppression fail open.
    db.failTransactions();
    expect(await reserve(asDb(db), "lifecycle", 80, NOW)).toEqual({ granted: 80, limited: null });
    expect(await reserve(null, "lifecycle", 80, NOW)).toEqual({ granted: 80, limited: null });
  });
});

describe("release", () => {
  const NOW = Date.parse("2026-08-25T09:00:00Z");
  const DAY = `emailBudget/${utcDayKey(NOW)}`;

  it("hands headroom back so a retry is not locked out", async () => {
    // Without it a provider outage burns the whole day's allowance on emails
    // that never left the building, and the retry an hour later finds nothing.
    await reserve(asDb(db), "lifecycle", 60, NOW);
    await release(asDb(db), "lifecycle", 60, NOW);
    expect(db.data.get(DAY)).toMatchObject({ total: 0, lifecycle: 0 });
    expect(await reserve(asDb(db), "lifecycle", 60, NOW)).toEqual({ granted: 60, limited: null });
  });

  it("never throws, whatever the store does", async () => {
    // A lost release costs a few messages of headroom. An exception here
    // would cost the caller's request — mid-checkout, mid-login.
    db.failWrites(true);
    await expect(release(asDb(db), "billing", 1, NOW)).resolves.toBeUndefined();
    await expect(release(null, "billing", 1, NOW)).resolves.toBeUndefined();
  });

  it("credits whatever day it is GIVEN, so callers must give it the reservation's", async () => {
    // Found by this suite, then fixed in the callers.
    //
    // reserve() and release() each default `now` to Date.now(), and send.ts,
    // sendBulk and audience.ts all called release() without one. A send
    // reserved at 23:59:59 that failed at 00:00:00 burned a message of today
    // and credited one to TOMORROW, whose counter went negative — so
    // tomorrow's EFFECTIVE cap rose above Resend's real 100, and message 101
    // was refused by the provider. That is a dropped email, not a delayed one.
    // At a month boundary it corrupted the monthly counter the same way.
    //
    // release() itself was never wrong: it credits the day it is given. The
    // bug was the callers not giving it one. Both halves are pinned here —
    // the mismatch still misattributes (so the parameter keeps mattering),
    // and the matched call is exact.
    const NEXT = Date.parse("2026-08-26T00:00:01Z");

    // Mismatched: still wrong, still the reason callers must thread it.
    await reserve(asDb(db), "billing", 1, NOW);
    await release(asDb(db), "billing", 1, NEXT);
    expect(db.data.get(DAY)).toMatchObject({ total: 1 }); // yesterday stays spent
    expect(db.data.get(`emailBudget/${utcDayKey(NEXT)}`)).toMatchObject({ total: -1 });

    // Matched, which is what send.ts/audience.ts now do: exact, no drift.
    const db2 = makeEmailDb();
    await reserve(asDb(db2), "billing", 1, NOW);
    await release(asDb(db2), "billing", 1, NOW);
    expect(db2.data.get(DAY)).toMatchObject({ total: 0 });
    expect(db2.data.get(`emailBudget/${utcDayKey(NEXT)}`)).toBeUndefined();
  });
});

/* ===========================================================================
   6. SEND — the one door, and what each outcome means
   =========================================================================== */

const doc = { preheader: "p", heading: "h", blocks: [{ kind: "p" as const, text: "body" }] };
const msg = (over: Partial<AppMessage> = {}): AppMessage => ({
  to: "user@example.com",
  subject: "Subject",
  category: "lifecycle",
  type: "weekly-progress",
  prefKey: "progress",
  prefLabel: "weekly progress emails",
  doc,
  ...over,
});

/**
 * LEGAL is `as const` and `postalAddress` is deliberately blank in the repo,
 * because we chose to hold commercial mail rather than publish an address.
 * `send`/`sendBulk` therefore refuse `lifecycle` and `marketing` outright, and
 * every pipeline test below would assert against that gate instead of against
 * the thing it names. So those two suites run with an address written in, and
 * the gate gets its own suite where the blank is the point.
 */
const TEST_POSTAL = "Elovox, 123 Example St, New York, NY 10001";
function setPostal(address: string): string {
  const legal = LEGAL as unknown as { postalAddress: string };
  const saved = legal.postalAddress;
  legal.postalAddress = address;
  return saved;
}

describe("send", () => {
  let savedPostal = "";
  beforeEach(() => {
    savedPostal = setPostal(TEST_POSTAL);
  });
  afterEach(() => {
    setPostal(savedPostal);
  });

  const budgetDocs = () => [...db.data.keys()].filter((k) => k.startsWith("emailBudget/"));
  const logDocs = () => [...db.data.keys()].filter((k) => k.startsWith("emailLog/"));

  it("`sent` is true for exactly one outcome, and callers branch on it", async () => {
    // "What a caller must NOT do is report 'we've emailed you' without
    // checking." Every path through this function returns a result; only one
    // of them means the message is with the provider.
    const outcomes: Array<{ outcome: string; sent: boolean }> = [];

    delete process.env.RESEND_API_KEY;
    outcomes.push(await send(asDb(db), msg()));
    process.env.RESEND_API_KEY = "re_test";

    await suppress(asDb(db), "user@example.com", "hard-bounce");
    outcomes.push(await send(asDb(db), msg()));
    db.data.clear();

    db.data.set(`emailBudget/${utcDayKey()}`, { total: 100, lifecycle: 100 });
    outcomes.push(await send(asDb(db), msg()));
    db.data.clear();

    sendEmailMock.mockResolvedValue({ ok: false, reason: "rate-limited" });
    outcomes.push(await send(asDb(db), msg()));
    sendEmailMock.mockResolvedValue({ ok: true, id: "re_123" });
    db.data.clear();

    outcomes.push(await send(asDb(db), msg()));

    expect(outcomes.map((o) => o.outcome)).toEqual([
      "not-configured", "suppressed", "budget", "failed", "sent",
    ]);
    for (const o of outcomes) expect(o.sent, o.outcome).toBe(o.outcome === "sent");
  });

  it("a misconfigured deploy touches nothing at all", async () => {
    // No reads, no reservation, no log row claiming a send that could not
    // have happened.
    delete process.env.MAIL_FROM;
    expect(await send(asDb(db), msg())).toEqual({ sent: false, outcome: "not-configured" });
    expect(db.writes).toEqual([]);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("a suppressed address is refused BEFORE any allowance is spent", async () => {
    // Order matters: suppression, then budget. A bounced address that spent a
    // message of the day's 100 would let a dead mailbox starve a live one.
    await suppress(asDb(db), "user@example.com", "hard-bounce");
    expect(await send(asDb(db), msg())).toEqual({
      sent: false, outcome: "suppressed", detail: "hard-bounce",
    });
    expect(budgetDocs()).toEqual([]);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("a complaint stops a billing email too", async () => {
    await suppress(asDb(db), "user@example.com", "complaint");
    const r = await send(asDb(db), msg({ category: "billing", type: "payment-failed", prefKey: undefined }));
    expect(r).toMatchObject({ sent: false, outcome: "suppressed", detail: "complaint" });
  });

  it("an unsubscribe from one stream does not stop a security notice", async () => {
    await applyUnsubscribe(asDb(db), { email: "user@example.com", key: "progress" });
    const r = await send(asDb(db), msg({ category: "security", type: "lockout", prefKey: undefined }));
    expect(r).toMatchObject({ sent: true, outcome: "sent" });
  });

  it("over budget, the provider is never called", async () => {
    db.data.set(`emailBudget/${utcDayKey()}`, { total: 60, lifecycle: 60 });
    expect(await send(asDb(db), msg())).toEqual({
      sent: false, outcome: "budget", detail: "category",
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(logDocs()).toEqual([]);
  });

  it("a provider failure hands the budget back AND writes no log row", async () => {
    // The delivery log is the answer to "which of our emails bounced?". A row
    // for a message that was never accepted makes that answer wrong, and
    // makes an outage look like a delivery problem at the far end.
    sendEmailMock.mockResolvedValue({ ok: false, reason: "timeout" });
    expect(await send(asDb(db), msg())).toEqual({
      sent: false, outcome: "failed", detail: "timeout",
    });
    expect(logDocs()).toEqual([]);
    expect(db.data.get(`emailBudget/${utcDayKey()}`)).toMatchObject({ total: 0, lifecycle: 0 });
  });

  it("a failure is retryable and a suppression is not", async () => {
    // The practical difference between the two non-terminal-looking outcomes.
    // After `failed` the allowance is back, so the same call can succeed.
    // After `suppressed` nothing was ever spent and nothing ever will be.
    sendEmailMock.mockResolvedValueOnce({ ok: false, reason: "error" });
    expect((await send(asDb(db), msg())).outcome).toBe("failed");
    expect((await send(asDb(db), msg())).outcome).toBe("sent");

    await suppress(asDb(db), "gone@example.com", "hard-bounce");
    const spent = db.data.get(`emailBudget/${utcDayKey()}`)?.total;
    expect((await send(asDb(db), msg({ to: "gone@example.com" }))).outcome).toBe("suppressed");
    expect((await send(asDb(db), msg({ to: "gone@example.com" }))).outcome).toBe("suppressed");
    expect(db.data.get(`emailBudget/${utcDayKey()}`)?.total).toBe(spent);
  });

  it("logs one row keyed by Resend's own id, and never calls it delivered", async () => {
    // The key IS the design: every webhook event carries `email_id`, so
    // keying on it turns the webhook into an update of this row rather than a
    // second, unjoinable stream. And "delivered" is a fact only the webhook
    // can know — writing it here would make the log claim deliveries that
    // bounced ten minutes later.
    await send(asDb(db), msg({ uid: "uid_1" }));
    expect(logDocs()).toEqual(["emailLog/re_123"]);
    const row = db.data.get("emailLog/re_123") as Record<string, unknown>;
    expect(row).toMatchObject({
      to: "user@example.com",
      category: "lifecycle",
      type: "weekly-progress",
      uid: "uid_1",
      resendId: "re_123",
      status: "sent",
    });
    expect(row.status).not.toBe("delivered");
    // The row holds an address, so it must carry its own expiry — the purge
    // cron sweeps on this field and nothing else.
    expect(row.expiresAt).toBe((row.at as number) + EMAIL_LOG_TTL_MS);
  });

  it("logs a scheduled message as scheduled, not as sent", async () => {
    await send(asDb(db), msg({ scheduledAt: "in 1 hour" }));
    expect(db.data.get("emailLog/re_123")?.status).toBe("scheduled");
  });

  it("lower-cases the logged address so the log joins the suppression list", async () => {
    await send(asDb(db), msg({ to: "  Sam@Example.COM " }));
    expect(db.data.get("emailLog/re_123")?.to).toBe("sam@example.com");
  });

  it("passes the caller's stable key to the provider as the idempotency key", async () => {
    // Derived from what the message IS ("welcome:{uid}"), never a uuid. It is
    // what collapses a redelivered webhook, a Vercel function retry and the
    // client's own retry loop into the one send Resend already accepted.
    await send(asDb(db), msg({ key: "welcome:uid_1" }));
    expect(sendEmailMock.mock.calls[0][1]).toBe("welcome:uid_1");
  });

  it("optional mail carries the unsubscribe link; billing and security do not", async () => {
    await send(asDb(db), msg());
    const optional = sendEmailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(optional.headers as object).sort()).toEqual([
      "List-Unsubscribe", "List-Unsubscribe-Post",
    ]);
    expect(optional.text).toContain("Unsubscribe: https://elovox.app/api/email/unsubscribe?t=");

    sendEmailMock.mockClear();
    await send(asDb(db), msg({ category: "billing", type: "payment-failed", prefKey: undefined, to: "b@example.com" }));
    const billing = sendEmailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(billing.headers).toEqual({});
    expect(billing.text).not.toContain("Unsubscribe");
    expect(billing.html).not.toContain("unsubscribe");
  });

  it("the footer link is scoped to the stream it came from", async () => {
    // A "stop the weekly digest" link that unsubscribes from everything is
    // how one annoying email costs the streak nudge and the tips list too.
    await send(asDb(db), msg({ prefKey: "streak" }));
    const sent = sendEmailMock.mock.calls[0][0] as { headers: Record<string, string> };
    const token = decodeURIComponent(
      sent.headers["List-Unsubscribe"].replace(/^<.*\?t=/, "").replace(/>$/, "")
    );
    expect(verifyUnsubToken(token)).toEqual({ email: "user@example.com", key: "streak" });
  });
});

describe("sendBulk", () => {
  let savedPostal = "";
  beforeEach(() => {
    savedPostal = setPostal(TEST_POSTAL);
  });
  afterEach(() => {
    setPostal(savedPostal);
  });

  const many = (emails: string[]) => emails.map((to) => msg({ to, key: `weekly:${to}` }));

  it("reports exactly who was accepted — not the first N of the input", async () => {
    // The documented reason `sentTo` exists at all. The queue is REORDERED by
    // suppression filtering and then TRIMMED by the budget, so a drip that
    // advanced positionally would skip a tip for everybody standing behind a
    // suppressed subscriber, silently, every week.
    await suppress(asDb(db), "b@example.com", "hard-bounce");
    db.data.set(`emailBudget/${utcDayKey()}`, { total: 59, lifecycle: 59 });

    const r = await sendBulk(asDb(db), "lifecycle", many([
      "a@example.com", "b@example.com", "c@example.com",
    ]));

    expect(r.suppressed).toBe(1);
    expect(r.overBudget).toBe(1);
    expect(r.sent).toBe(1);
    expect(r.sentTo).toEqual(["a@example.com"]);
    expect(r.sentTo).not.toContain("b@example.com");
  });

  it("trims the run to the grant instead of letting the provider reject a random slice", async () => {
    // 80 due, 60 of the lifecycle allowance: send 60 and report 20 over
    // budget. Sending 80 would be the same twenty people failing every week.
    const r = await sendBulk(asDb(db), "lifecycle", many(
      Array.from({ length: 80 }, (_, i) => `u${i}@example.com`)
    ));
    expect(r.sent).toBe(60);
    expect(r.overBudget).toBe(20);
    expect(r.sentTo).toHaveLength(60);
    expect((sendBatchMock.mock.calls[0][0] as unknown[]).length).toBe(60);
  });

  it("suppressed recipients never spend a message of the allowance", async () => {
    await suppress(asDb(db), "b@example.com", "complaint");
    await sendBulk(asDb(db), "lifecycle", many(["a@example.com", "b@example.com"]));
    expect(db.data.get(`emailBudget/${utcDayKey()}`)).toMatchObject({ total: 1, lifecycle: 1 });
  });

  it("a failed batch is not in sentTo and its allowance comes back", async () => {
    // The tips drip advances `tipIndex` from sentTo. Counting a failed batch
    // would skip a tip for all hundred people in it.
    sendBatchMock.mockResolvedValue({ ok: false, ids: [], reason: "rate-limited" });
    const r = await sendBulk(asDb(db), "lifecycle", many(["a@example.com", "b@example.com"]));
    expect(r).toMatchObject({ sent: 0, failed: 2, sentTo: [] });
    expect(db.data.get(`emailBudget/${utcDayKey()}`)).toMatchObject({ total: 0, lifecycle: 0 });
    expect([...db.data.keys()].filter((k) => k.startsWith("emailLog/"))).toEqual([]);
  });

  it("an empty or unconfigured run is a no-op, not an error", async () => {
    expect(await sendBulk(asDb(db), "lifecycle", [])).toEqual({
      sent: 0, suppressed: 0, overBudget: 0, failed: 0, sentTo: [],
    });
    delete process.env.RESEND_API_KEY;
    expect((await sendBulk(asDb(db), "lifecycle", many(["a@example.com"]))).sent).toBe(0);
    expect(db.writes).toEqual([]);
  });
});

/* ===========================================================================
   6. THE TWO THINGS A REGULATOR READS

   Neither of these is a bug a user would report, and both are the kind that
   gets counted per message once somebody does complain.
   =========================================================================== */

describe("commercial mail is held while the postal address is blank", () => {
  /* The decision this pins (2026-09-02): rather than publish a postal
     address, the commercial sends pause. CAN-SPAM counts each commercial
     message without one as its own violation, and the tips drip and win-back
     run from a daily cron — so "remember not to send" was never a control.
     The gate is. What must NOT break is the mail somebody is owed: a lockout
     notice, a receipt and a failed-payment warning are about an account the
     person already has, and the statute does not reach them. */

  it("refuses marketing without spending budget or touching the provider", async () => {
    const db = makeEmailDb();
    const r = await send(asDb(db), tipsWelcome("sam@example.com"));
    expect(r).toMatchObject({ sent: false, outcome: "no-postal-address" });
    expect(sendEmailMock).not.toHaveBeenCalled();
    // Nothing reserved: a held message must not consume the day's allowance.
    expect(db.data.get(`emailBudget/${utcDayKey()}`)).toBeUndefined();
  });

  it("refuses lifecycle in bulk without sending to anyone", async () => {
    const db = makeEmailDb();
    const r = await sendBulk(asDb(db), "lifecycle", [
      winBack("a@example.com", "uid_a", 3),
      winBack("b@example.com", "uid_b", 5),
    ]);
    expect(r).toMatchObject({ sent: 0, failed: 0, sentTo: [] });
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it("still sends security, billing and transactional mail", async () => {
    // The whole point of gating on `optional` rather than on a list of types:
    // these three are mail the recipient is owed, and holding them would be a
    // far worse bug than the one being fixed.
    for (const message of [
      lockoutNotice("sam@example.com", "https://elovox.app/reset", 15),
      paymentFailed("sam@example.com", "uid_1", "https://billing.example"),
      welcome("sam@example.com", "uid_1"),
    ]) {
      sendEmailMock.mockClear();
      const r = await send(asDb(makeEmailDb()), message);
      expect(r.outcome).not.toBe("no-postal-address");
      expect(sendEmailMock).toHaveBeenCalled();
    }
  });

  it("resumes commercial mail the moment an address exists", async () => {
    const saved = setPostal(TEST_POSTAL);
    try {
      const r = await send(asDb(makeEmailDb()), tipsWelcome("sam@example.com"));
      expect(r.outcome).not.toBe("no-postal-address");
      expect(sendEmailMock).toHaveBeenCalled();
    } finally {
      setPostal(saved);
    }
  });
});

describe("CAN-SPAM postal address", () => {
  /** LEGAL is `as const`, and the address is deliberately blank in the repo,
   *  so the filled-in case can only be exercised by writing it for the
   *  duration of one render. Restored in `finally` — a leaked address would
   *  make the "omitted while empty" test below pass for the wrong reason. */
  function withAddress<T>(address: string, fn: () => T): T {
    const legal = LEGAL as unknown as { postalAddress: string };
    const saved = legal.postalAddress;
    legal.postalAddress = address;
    try {
      return fn();
    } finally {
      legal.postalAddress = saved;
    }
  }

  const ADDRESS = "Elovox, 123 Example St, New York, NY 10001";

  it("prints the address in BOTH parts of a commercial message", () => {
    // Both, because the statute is about the message, not about the HTML
    // part — and a client showing the text alternative is a message that
    // shipped without an address.
    const { html, text } = withAddress(ADDRESS, () => render(tipsWelcome("sam@example.com").doc));
    expect(html).toContain(ADDRESS);
    expect(text).toContain(ADDRESS);
  });

  it("renders the same address into every message, because both footers are shared", () => {
    // The reason the fix lives in render.ts rather than in each builder: one
    // message that forgot the line is one violation per recipient.
    const { html, text } = withAddress(ADDRESS, () =>
      render(subscriptionStarted("sam@example.com", "uid_1", "monthly", "September 4, 2026").doc)
    );
    expect(html).toContain(ADDRESS);
    expect(text).toContain(ADDRESS);
  });

  it("escapes the address rather than injecting it into the footer markup", () => {
    const { html } = withAddress('Elovox & Co, "Suite 3"', () =>
      render(tipsWelcome("sam@example.com").doc)
    );
    expect(html).toContain("Elovox &amp; Co, &quot;Suite 3&quot;");
  });

  it("omits the line cleanly while the address is unset", () => {
    // The failure this pins is the template-string one: an absent value that
    // renders as "undefined", or as a blank line and a stray separator, in
    // every email the app sends.
    const { html, text } = render(tipsWelcome("sam@example.com").doc);
    expect(LEGAL.postalAddress).toBe("");
    expect(html).not.toContain("undefined");
    expect(text).not.toContain("undefined");
    // The text footer is the whole of the last stanza, so an empty slot would
    // show up here as a blank line between the brand and the site.
    expect(text.trimEnd().endsWith(`---\n— ${LEGAL.serviceName}\nhttps://elovox.app`)).toBe(true);
  });

  it("trims a padded address instead of rendering the padding", () => {
    const { text } = withAddress(`  ${ADDRESS}  `, () => render(tipsWelcome("s@example.com").doc));
    expect(text).toContain(`\n${ADDRESS}\n`);
  });
});

describe("subscription confirmation (California ARL)", () => {
  const conf = (...extra: Array<string | null>) =>
    render(
      subscriptionStarted(
        "sam@example.com",
        "uid_1",
        "monthly",
        "September 4, 2026",
        ...(extra as [(string | null)?, (string | null)?])
      ).doc
    );

  it("states the amount, the interval, the next charge date and a way out", () => {
    // §17602 wants all four in the acknowledgement. Asserted on the text part
    // because that is the one with no markup to hide a missing fact in.
    const { text } = conf("$9.99", "https://elovox.app/account");
    expect(text).toContain("$9.99");
    expect(text).toContain("a month");
    expect(text).toContain("every month");
    expect(text).toContain("September 4, 2026");
    expect(text).toContain("Cancel any time from your account");
    expect(text).toContain("https://elovox.app/account");
  });

  it("says it in the HTML part too", () => {
    const { html } = conf("$9.99", "https://elovox.app/account");
    expect(html).toContain("$9.99");
    expect(html).toContain("every month");
    expect(html).toContain("https://elovox.app/account");
  });

  it("still carries a cancellation path when the caller passes no URL", () => {
    // The four-argument call the Stripe webhook makes today. There is no such
    // thing as a compliant version of this email with no route to cancel, so
    // the account page is the floor rather than an omission.
    const { text } = conf();
    expect(text).toContain("https://elovox.app/account");
    expect(text).toContain("Cancel any time from your account");
  });

  it("does not invent an amount it was not given", () => {
    // The honest fallback. It is NOT compliant — see the note on the builder —
    // but a made-up figure in a billing email is worse than a missing one.
    const { text } = conf();
    expect(text).toContain("renews automatically every month");
    expect(text).toContain("The amount is on the receipt");
    expect(text).not.toMatch(/\$\d/);
  });

  it("says 'a year' for the annual plan and neither for a cycle it does not know", () => {
    const annual = render(
      subscriptionStarted("s@example.com", "u", "annual", "September 4, 2027", "$79.99").doc
    );
    expect(annual.text).toContain("$79.99 a year");
    expect(annual.text).toContain("every year");

    // Stripe's cycle string is passed straight through, and the webhook falls
    // back to "premium" when it has none. "Charged every premium" is the bug
    // this branch exists to avoid.
    const unknown = render(
      subscriptionStarted("s@example.com", "u", "premium", null, "$79.99").doc
    );
    expect(unknown.text).toContain("$79.99 per billing period");
    expect(unknown.text).toContain("every billing period");
    expect(unknown.text).not.toContain("a premium");
    // No renewal date supplied, so no sentence claiming one.
    expect(unknown.text).not.toContain("The next charge is on");
  });
});

describe("the settings panel tells the truth about held mail", () => {
  /* The bug this pins is the one the tips form already had once: closing the
     send path and leaving the surface that promises it. Every switch in the
     email panel is on a `lifecycle` or `marketing` category, and both are
     held while LEGAL.postalAddress is blank — so a panel headed "which
     optional emails you get" was describing something that was not
     happening, and one blurb pointed at a signup form that had been deleted. */

  it("reports paused exactly when send() would hold those categories", async () => {
    const { optionalMailPaused } = await import("@/lib/email/prefs");
    const saved = setPostal("");
    try {
      expect(optionalMailPaused()).toBe(true);
      setPostal(TEST_POSTAL);
      expect(optionalMailPaused()).toBe(false);
    } finally {
      setPostal(saved);
    }
  });

  it("every switch is on a category send() actually holds", async () => {
    // The blanket sentence ("all optional email is paused") is only true while
    // every switch sits on an optional category — those are the ones the gate
    // holds. A future switch added on billing or transactional would make the
    // panel's copy false, and this is what would catch it.
    const { CATEGORY } = await import("@/lib/email/config");
    const { PREF_LABELS } = await import("@/lib/email/prefs");
    const optionalPrefKeys = new Set(
      Object.values(CATEGORY)
        .filter((c) => c.optional)
        .map((c) => c.prefKey)
        .filter(Boolean)
    );
    // progress and tips are the category defaults; streak and product are
    // per-message overrides on lifecycle, which is itself optional.
    expect(optionalPrefKeys.has("progress")).toBe(true);
    expect(optionalPrefKeys.has("tips")).toBe(true);
    // And no switch is offered for a category that always sends.
    const alwaysSends = Object.values(CATEGORY)
      .filter((c) => !c.optional)
      .map((c) => c.prefKey)
      .filter(Boolean);
    for (const key of Object.keys(PREF_LABELS)) {
      expect(alwaysSends).not.toContain(key);
    }
  });

  it("no longer points at the signup form that was removed", async () => {
    const { PREF_LABELS } = await import("@/lib/email/prefs");
    expect(PREF_LABELS.tips.blurb).not.toMatch(/join from the site|from the site/i);
  });
});
