import { describe, expect, it, vi, beforeEach } from "vitest";

/* ===========================================================================
   What each account agreed to, and when.

   The Terms carry an arbitration agreement, a class-action waiver and an
   indemnity. Those are the clauses somebody disputes by saying they never
   agreed to them, and "the Terms" is not an answer — so the acceptance has to
   be recorded server-side, has to be un-rewritable by the person it is
   evidence about, and has to keep the FIRST date rather than the latest.

   The three failures pinned here are the ones that would make the record
   worthless without looking broken:
     1. a second sign-in re-stamping the timestamp, so the row says "accepted
        today" forever and the 30-day opt-out window can never be evaluated;
     2. the version coming from the client, which could name an older one;
     3. a write failure taking somebody's sign-in down with it.
   =========================================================================== */

const { LEGAL } = await import("@/lib/legal");
const { recordTermsAcceptance, readTermsAcceptance } = await import(
  "@/lib/termsConsent"
);

type Doc = Record<string, unknown>;

/** Firestore's create() semantics: ALREADY_EXISTS (code 6) on a second write. */
function makeDb() {
  const data = new Map<string, Doc>();
  const err = (code: number) => Object.assign(new Error("exists"), { code });
  // `failWith` lives in the closure rather than on the returned object, so
  // doc() does not need to reach back through `this` to see a later change.
  let failWith: Error | null = null;
  return {
    data,
    fail(e: Error | null) {
      failWith = e;
    },
    doc(path: string) {
      return {
        async create(v: Doc) {
          if (failWith) throw failWith;
          if (data.has(path)) throw err(6);
          data.set(path, v);
        },
        async get() {
          if (failWith) throw failWith;
          return { data: () => data.get(path) };
        },
      };
    },
  };
}
const asDb = (d: ReturnType<typeof makeDb>) =>
  d as unknown as Parameters<typeof recordTermsAcceptance>[0];

describe("recording what was agreed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the published version, not one a caller could name", async () => {
    const db = makeDb();
    await recordTermsAcceptance(asDb(db), "uid_1");
    expect(db.data.get("termsAcceptances/uid_1")).toMatchObject({
      version: LEGAL.termsVersion,
    });
    // A real date, not a placeholder — the opt-out window runs from it.
    expect(
      (db.data.get("termsAcceptances/uid_1") as { at: number }).at
    ).toBeGreaterThan(0);
  });

  it("keeps the FIRST acceptance when the ping repeats", async () => {
    // The ping fires on every verified sign-in. If the second one overwrote
    // the first, the row would say "accepted today" forever and could never
    // show whether an arbitration opt-out arrived inside its 30 days.
    const db = makeDb();
    await recordTermsAcceptance(asDb(db), "uid_1");
    const first = { ...(db.data.get("termsAcceptances/uid_1") as Doc) };
    await recordTermsAcceptance(asDb(db), "uid_1");
    await recordTermsAcceptance(asDb(db), "uid_1");
    expect(db.data.get("termsAcceptances/uid_1")).toEqual(first);
  });

  it("does not log the expected already-exists case as an error", async () => {
    // Otherwise every sign-in after the first writes a console error, and the
    // log stops being somewhere anyone looks.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb();
    await recordTermsAcceptance(asDb(db), "uid_1");
    await recordTermsAcceptance(asDb(db), "uid_1");
    expect(spy).not.toHaveBeenCalled();
  });

  it("never throws when the store is unavailable", async () => {
    // A consent write must not be able to fail somebody's sign-in.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb();
    db.fail(new Error("firestore down"));
    await expect(
      recordTermsAcceptance(asDb(db), "uid_1")
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  it("is a no-op without a db or a uid, rather than writing a junk row", async () => {
    const db = makeDb();
    await recordTermsAcceptance(null, "uid_1");
    await recordTermsAcceptance(asDb(db), "");
    expect(db.data.size).toBe(0);
  });

  it("reads back what it wrote, and null when there is nothing", async () => {
    const db = makeDb();
    expect(await readTermsAcceptance(asDb(db), "uid_1")).toBeNull();
    await recordTermsAcceptance(asDb(db), "uid_1");
    expect(await readTermsAcceptance(asDb(db), "uid_1")).toMatchObject({
      version: LEGAL.termsVersion,
    });
  });

  it("returns null rather than throwing when the read fails", async () => {
    // This one runs inside the account export, where a throw would take the
    // whole download down over an optional section.
    const db = makeDb();
    db.fail(new Error("firestore down"));
    expect(await readTermsAcceptance(asDb(db), "uid_1")).toBeNull();
  });
});

describe("the version the record pins", () => {
  it("is the same string the Terms page and the sign-up screen display", async () => {
    // Three copies of this would drift; there is one, in LEGAL. If this ever
    // fails, someone reintroduced a literal.
    const terms = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/terms/page.tsx", "utf8")
    );
    const form = await import("node:fs/promises").then((fs) =>
      fs.readFile("components/AuthForm.tsx", "utf8")
    );
    expect(terms).toContain("LEGAL.termsVersion");
    expect(form).toContain("LEGAL.termsVersion");
    expect(terms).not.toMatch(/const TERMS_VERSION\s*=/);
    expect(form).not.toMatch(/const TERMS_VERSION\s*=/);
  });

  it("is denied to every client, because a rewritable consent record proves nothing", async () => {
    const rules = await import("node:fs/promises").then((fs) =>
      fs.readFile("firestore.rules", "utf8")
    );
    // Not named in the rules at all, so the catch-all denies it both ways.
    expect(rules).not.toContain("termsAcceptances");
    expect(rules).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  });
});
