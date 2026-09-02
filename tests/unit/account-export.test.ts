import { describe, expect, it, vi } from "vitest";

// The export is the other half of the promise /privacy makes, and it is the
// half nobody notices is broken: a file that is missing something still looks
// like a file. So the properties pinned here are the ones that made it a lie —
// records that live outside users/{uid} are present — including the three
// (emailLog, emailSuppression, billingAlerts) the erasure never touches and
// which an export built by mirroring the erasure therefore missed — records
// that are deliberately withheld or deliberately kept are NAMED, nested
// subcollections are followed, and the note no longer claims to be everything.

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async () => ({
      email: "Gone@Example.com",
      displayName: "Anne-Marie",
      emailVerified: true,
      metadata: { creationTime: "2025-01-01", lastSignInTime: "2025-02-01" },
      providerData: [{ providerId: "password" }],
    }),
  }),
}));

import { buildAccountExport } from "@/lib/accountExport";

type Doc = Record<string, unknown>;

/**
 * A Firestore built from a flat map of document paths.
 *
 * Paths are the whole model: everything the walk does — listing the
 * collections under a document, listing the documents in a collection,
 * filtering by a field — falls out of splitting them, which is why this is a
 * dozen lines rather than an emulator.
 */
function makeDb(seed: Record<string, Doc>) {
  const paths = Object.keys(seed);
  const parentCollection = (docPath: string) =>
    docPath.split("/").slice(0, -1).join("/");
  const parentDoc = (colPath: string) => colPath.split("/").slice(0, -1).join("/");
  const lastSegment = (p: string) => p.split("/").slice(-1)[0];

  const snapFor = (path: string) => ({
    id: lastSegment(path),
    ref: docRef(path),
    data: () => seed[path],
  });

  const makeQuery = (docPaths: string[]) => ({
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(docPaths.filter((p) => seed[p]?.[field] === value)),
    limit: (n: number) => makeQuery(docPaths.slice(0, n)),
    get: async () => ({ docs: docPaths.map(snapFor) }),
  });

  const colRef = (colPath: string) => ({
    ...makeQuery(paths.filter((p) => parentCollection(p) === colPath)),
    id: lastSegment(colPath),
    path: colPath,
  });

  function docRef(path: string) {
    return {
      id: lastSegment(path),
      path,
      get: async () => ({
        id: lastSegment(path),
        exists: seed[path] !== undefined,
        data: () => seed[path],
      }),
      listCollections: async () => {
        const under = new Set(
          paths
            .map(parentCollection)
            .filter((c) => c && parentDoc(c) === path)
        );
        return [...under].map(colRef);
      },
    };
  }

  return { doc: docRef, collection: colRef };
}

/** An account with something in every store the erasure path touches. */
function seedAccount(): Record<string, Doc> {
  return {
    "users/u1/profile/plan": { tier: "premium" },
    "users/u1/sessions/s1": { overall: 71 },
    // Depth 2: the cached Felix take, which a flat listCollections() on the
    // root document could never see.
    "users/u1/sessions/s1/felix/voice": { url: "https://example.com/a.mp3" },
    "leaderboard/u1": { handle: "Anne-Marie", xp: 40 },
    "handles/annemarie": { uid: "u1", handle: "Anne-Marie" },
    "invites/CODE1": { uid: "u1" },
    "invites/CODE2": { uid: "someone-else" },
    "leads/gone%40example.com": { email: "gone@example.com" },
    "sessionDeletions/d1": { uid: "u1", reason: "bad-take" },
    "moderationEvents/m1": {
      uid: "u1",
      kind: "strike",
      severity: 1,
      reason: "language",
      source: "audio",
      actor: "operator@elovox.app",
    },
    "adminAudit/a1": { targetUid: "u1", actor: "operator@elovox.app" },
    // The three stores the erasure never touches, and which an export that
    // mirrored the erasure step by step therefore left out entirely.
    "emailLog/msg1": {
      to: "gone@example.com",
      uid: "u1",
      category: "billing",
      type: "receipt",
      status: "delivered",
    },
    // Same person, address they used to have: found by uid, not by address.
    "emailLog/msg2": { to: "old@example.com", uid: "u1", type: "welcome" },
    "emailLog/msg3": { to: "someone@example.com", uid: "u2", type: "welcome" },
    "emailSuppression/gone%40example.com": {
      email: "gone@example.com",
      reason: "unsubscribe",
      at: 1735689600000,
    },
    "billingAlerts/unused-refund-sub_1": {
      uid: "u1",
      kind: "unused-portion-refund",
      subscriptionId: "sub_1",
      resolved: true,
      resolvedBy: "operator@elovox.app",
    },
    // Not keyed to anyone (uid: null) — an operator's cost alarm, not a record
    // about this user, and it must not ride along.
    "billingAlerts/ai-spend-near-2026-09-02": {
      uid: null,
      kind: "ai-spend-ceiling",
    },
  };
}

async function build() {
  const db = makeDb(seedAccount());
  return (await buildAccountExport({} as never, db as never, "u1")) as Record<
    string,
    unknown
  >;
}

describe("buildAccountExport", () => {
  it("exports the subtree, including subcollections of subcollections", async () => {
    const payload = await build();
    const data = payload.data as Record<string, Array<Record<string, unknown>>>;

    expect(data.profile[0].id).toBe("plan");
    const session = data.sessions[0];
    expect(session.id).toBe("s1");
    const nested = session.subcollections as Record<
      string,
      Array<Record<string, unknown>>
    >;
    expect(nested.felix[0]).toMatchObject({ id: "voice" });
  });

  // The finding: five uid-keyed stores lived outside users/{uid}, the walk
  // covered none of them, and the file said it held everything.
  it("includes the records that live outside users/{uid}", async () => {
    const related = (await build()).related as Record<string, unknown>;

    expect(related.leaderboard).toMatchObject({ id: "u1", handle: "Anne-Marie" });
    expect(related.handleReservation).toMatchObject({ id: "annemarie" });
    expect(related.tipsListSignup).toMatchObject({ email: "gone@example.com" });
    expect(related.sessionDeletions).toEqual([
      { id: "d1", uid: "u1", reason: "bad-take" },
    ]);
    // Filtered to this account: another user's invite must not ride along.
    expect((related.invites as Array<{ id: string }>).map((i) => i.id)).toEqual([
      "CODE1",
    ]);
  });

  // The most damaging omission: a user struck by the automated language scan
  // got an export that positively denied the existence of the record they
  // would need to contest it.
  it("gives the user their strike record, without the operator's name", async () => {
    const related = (await build()).related as Record<string, unknown>;
    const events = related.moderationEvents as Array<Record<string, unknown>>;

    expect(events).toHaveLength(1);
    // Everything that makes the decision contestable survives...
    expect(events[0]).toMatchObject({
      id: "m1",
      severity: 1,
      reason: "language",
      source: "audio",
    });
    // ...and the third party named in it does not.
    expect(events[0]).not.toHaveProperty("actor");
  });

  it("names what it withholds instead of dropping it silently", async () => {
    const related = (await build()).related as Record<string, unknown>;
    const withheld = related.withheld as Array<Record<string, string>>;

    const audit = withheld.find((w) => w.record === "adminAudit");
    expect(audit).toBeDefined();
    expect(audit?.reason).toMatch(/operator/i);
    expect(audit?.howToGet).toBeTruthy();
  });

  // The second version of the same overclaim: `related` was built by walking
  // lib/accountDeletion.ts, so the three stores the erasure does not touch
  // were in neither `related` nor `related.withheld`, while the note went on
  // promising every record keyed to the user.
  it("includes the delivery log, found by address AND by uid", async () => {
    const related = (await build()).related as Record<string, unknown>;
    const log = related.emailLog as Array<Record<string, unknown>>;

    // msg2 is only reachable by uid (the address on it is an old one); msg1 is
    // reachable both ways and must appear once, not twice.
    expect(log.map((r) => r.id).sort()).toEqual(["msg1", "msg2"]);
    expect(log.find((r) => r.id === "msg1")).toMatchObject({ type: "receipt" });
  });

  it("gives the user their billing alerts, without the operator who closed them", async () => {
    const related = (await build()).related as Record<string, unknown>;
    const alerts = related.billingAlerts as Array<Record<string, unknown>>;

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: "unused-refund-sub_1",
      kind: "unused-portion-refund",
      resolved: true,
    });
    // Same treatment as moderationEvents.actor: the operator is a third party.
    expect(alerts[0]).not.toHaveProperty("resolvedBy");
  });

  // The suppression record is the one thing here that deliberately outlives
  // the account — deleting it would resume the mail it exists to stop — so it
  // is not enough to include it: the file has to say that it is kept.
  it("includes the suppression note and names it as kept after deletion", async () => {
    const related = (await build()).related as Record<string, unknown>;

    expect(related.emailSuppression).toMatchObject({
      id: "gone%40example.com",
      reason: "unsubscribe",
    });

    const retained = related.retained as Array<Record<string, string>>;
    const entry = retained.find((r) => r.record === "emailSuppression");
    expect(entry).toBeDefined();
    expect(entry?.reason).toMatch(/legitimate interest/i);
    // It has to say WHY keeping it is the user-respecting choice, not just
    // that we keep it.
    expect(entry?.reason).toMatch(/start the mail again|stops us mailing/i);
  });

  it("no longer claims to be every record Elovox holds", async () => {
    const note = (await build()).note as string;

    expect(note).not.toMatch(/every record/i);
    // It has to point at every half of the file, or the qualification is
    // just as unhelpful as the absolute claim was.
    expect(note).toContain("related");
    expect(note).toMatch(/withheld/);
    expect(note).toMatch(/retained/);
    // And it has to name the three stores that were missing, so a reader can
    // tell the difference between "not held" and "not exported".
    expect(note).toMatch(/emails we sent you/i);
    expect(note).toMatch(/suppression/i);
    expect(note).toMatch(/billing alert/i);
  });

  it("says nothing about records the account does not have", async () => {
    // A brand-new account: no handle, no lead, no strike. The keys are still
    // there (their absence is information too) but nothing is invented.
    const db = makeDb({ "users/u1/profile/plan": { tier: "free" } });
    const payload = (await buildAccountExport({} as never, db as never, "u1")) as
      Record<string, unknown>;
    const related = payload.related as Record<string, unknown>;

    expect(related.leaderboard).toBeNull();
    expect(related.handleReservation).toBeNull();
    expect(related.tipsListSignup).toBeNull();
    expect(related.moderationEvents).toEqual([]);
    expect(related.emailSuppression).toBeNull();
    expect(related.emailLog).toEqual([]);
    expect(related.billingAlerts).toEqual([]);
    // No section hit a limit, so the file must not imply one did.
    expect(payload).not.toHaveProperty("incomplete");
  });
});
