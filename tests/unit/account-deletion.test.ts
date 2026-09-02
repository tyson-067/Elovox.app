import { describe, expect, it, vi, beforeEach } from "vitest";

// The erasure path is the one place a privacy promise is kept or broken in
// code, so the parts worth pinning are the ones a reader of /privacy would
// recognise: the money stops first, the public row goes, the tips-list lead
// goes, the deletion-reason log stops pointing at a person, and the one call
// that leaves the building happens last and cannot hold the request open.
//
// FieldValue.delete() is an opaque sentinel in the real SDK, so it is faked
// structurally here (the same approach and the same reason as
// tests/unit/admin-routes.test.ts).
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    delete: () => ({ __sentinel: "delete" }),
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
  },
}));

/** Call order across the mocks, so "the third party goes last" is assertable.
 *  Hoisted because the mock factories below run before the module body. */
const calls = vi.hoisted(() => [] as string[]);

const deleteUser = vi.fn().mockResolvedValue(undefined);
const getUser = vi.fn().mockResolvedValue({ email: "gone@example.com" });
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    deleteUser: (uid: string) => {
      calls.push("deleteUser");
      return deleteUser(uid);
    },
    getUser,
  }),
}));

// No Stripe in this environment: getStripe() returning null is the real
// behaviour when the secret key is unset, and it skips the billing step
// without skipping anything else.
vi.mock("@/lib/stripe", () => ({ getStripe: () => null }));
vi.mock("@/lib/refunds", () => ({ refundUnusedPortion: vi.fn() }));

// The Resend audience is a network call to a US processor. Mocked so the test
// asserts the erasure ASKS for the removal — the thing that was missing — and
// not that Resend was reachable from a unit test.
const deleteContact = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/email/audience", () => ({
  deleteContact: (email: string) => {
    calls.push("deleteContact");
    return deleteContact(email);
  },
}));

// An Audience id, because without one there is no mirror to remove and the
// whole step is skipped — which is its own test below.
const cfg = vi.hoisted(() => ({ audienceId: "aud_1" as string | null }));
vi.mock("@/lib/email/config", () => ({ audienceId: () => cfg.audienceId }));

import { eraseAccount, reconcileAudiencePurges } from "@/lib/accountDeletion";

type Update = { path: string; data: Record<string, unknown> };

/** The smallest Firestore that this path actually touches. `docs` seeds the
 *  handful of documents the sequence READS (the leaderboard row, which is
 *  where the handle reservation has to be found from). */
function makeDb(deletionRows: string[], docs: Record<string, Record<string, unknown>> = {}) {
  const deleted: string[] = [];
  const updates: Update[] = [];
  const sets: Update[] = [];
  const recursivelyDeleted: string[] = [];

  const docRef = (path: string) => ({
    path,
    get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
    set: async (data: Record<string, unknown>) => {
      sets.push({ path, data });
    },
    delete: async () => {
      deleted.push(path);
    },
  });

  const db = {
    doc: (path: string) => docRef(path),
    collection: (name: string) => ({
      // users/{uid}/friends and invites are both empty here; the deletion log
      // is the collection under test.
      get: async () => ({ docs: [] }),
      where: () => ({
        get: async () => ({
          docs:
            name === "sessionDeletions"
              ? deletionRows.map((id) => ({ ref: { path: `sessionDeletions/${id}` } }))
              : [],
        }),
      }),
    }),
    batch: () => {
      const queued: Array<() => void> = [];
      return {
        delete: (ref: { path: string }) => queued.push(() => deleted.push(ref.path)),
        update: (ref: { path: string }, data: Record<string, unknown>) =>
          queued.push(() => updates.push({ path: ref.path, data })),
        commit: async () => queued.forEach((fn) => fn()),
      };
    },
    recursiveDelete: async (ref: { path: string }) => {
      calls.push("recursiveDelete");
      recursivelyDeleted.push(ref.path);
    },
  };

  return { db, deleted, updates, sets, recursivelyDeleted };
}

/** A Firestore holding only the purge queue, for the reconcile sweep. */
function makeQueueDb(rows: Record<string, Record<string, unknown>>) {
  const deleted: string[] = [];
  const sets: Update[] = [];
  const snapFor = (id: string) => ({
    id,
    data: () => rows[id],
    ref: {
      path: `audiencePurges/${id}`,
      delete: async () => {
        deleted.push(id);
      },
      set: async (data: Record<string, unknown>) => {
        sets.push({ path: `audiencePurges/${id}`, data });
      },
    },
  });
  const db = {
    collection: (name: string) => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            docs: name === "audiencePurges" ? Object.keys(rows).map(snapFor) : [],
          }),
        }),
      }),
    }),
  };
  return { db, deleted, sets };
}

describe("eraseAccount", () => {
  beforeEach(() => {
    deleteUser.mockClear();
    getUser.mockClear();
    deleteContact.mockClear();
    deleteContact.mockResolvedValue(true);
    calls.length = 0;
    cfg.audienceId = "aud_1";
  });

  it("removes the public leaderboard row and the tips-list lead", async () => {
    const { db, deleted } = makeDb([]);

    const res = await eraseAccount({} as never, db as never, "u1", {
      refundContext: "test",
    });

    expect(res).toEqual({ ok: true });
    expect(deleted).toContain("leaderboard/u1");
    expect(deleted).toContain("leads/gone%40example.com");
  });

  // The finding: deleteContact() existed, documented as "used by account
  // deletion", and had no callers at all. Resend fans a broadcast out from ITS
  // copy of the list, so an erased account's plaintext address stayed live at
  // a US processor and still reachable by the next tips mail, while /privacy
  // told the user the account was permanently erased.
  it("removes the address from the Resend audience too", async () => {
    const { db } = makeDb([]);

    await eraseAccount({} as never, db as never, "u1", { refundContext: "test" });

    expect(deleteContact).toHaveBeenCalledWith("gone@example.com");
  });

  it("still erases the account when the Resend removal fails", async () => {
    const { db, recursivelyDeleted } = makeDb([]);
    deleteContact.mockRejectedValueOnce(new Error("resend is down"));

    const res = await eraseAccount({} as never, db as never, "u1", {
      refundContext: "test",
    });

    // An erasure is a right, not a favour a third-party API can veto.
    expect(res).toEqual({ ok: true });
    expect(recursivelyDeleted).toEqual(["users/u1"]);
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  // The ordering finding. The Resend call used to sit at step 3, in front of
  // recursiveDelete and the Auth delete, so an outage at a third party could
  // fail a deletion whose public row and handle were already gone.
  it("asks Resend only after everything irreversible has succeeded", async () => {
    const { db } = makeDb([]);

    await eraseAccount({} as never, db as never, "u1", { refundContext: "test" });

    expect(calls).toEqual(["recursiveDelete", "deleteUser", "deleteContact"]);
  });

  // The latency finding. lib/email/client.ts retries three times with an 8s
  // timeout and ~0.6s/1.8s of backoff, so an outage could hold the request for
  // ~26s on a route that declares no maxDuration — long enough for Vercel to
  // kill it and show a failed deletion for an account that was already gone.
  it("does not wait on a hung Resend", async () => {
    vi.useFakeTimers();
    try {
      const { db, sets, deleted } = makeDb([]);
      deleteContact.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(true), 30_000))
      );

      const pending = eraseAccount({} as never, db as never, "u1", {
        refundContext: "test",
      });
      // Well inside the client's own ladder, and past this function's bound.
      await vi.advanceTimersByTimeAsync(3_100);

      expect(await pending).toEqual({ ok: true });
      // ...and it does not pretend the address is gone: the queue row it wrote
      // before asking is still there for the sweep to pick up.
      expect(sets.map((w) => w.path)).toContain("audiencePurges/gone%40example.com");
      expect(deleted).not.toContain("audiencePurges/gone%40example.com");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the queue row once Resend confirms the removal", async () => {
    const { db, sets, deleted } = makeDb([]);

    await eraseAccount({} as never, db as never, "u1", { refundContext: "test" });

    // Written first, cleared second: the other order loses the address
    // entirely if the function is frozen between the call and the write.
    expect(sets.map((w) => w.path)).toContain("audiencePurges/gone%40example.com");
    expect(deleted).toContain("audiencePurges/gone%40example.com");
  });

  // deleteContact reports "Resend refused" with a plain `false`, the same
  // shape as success. A dropped `false` is an erased user's plaintext address
  // still live at a US processor with nothing recording that it is there.
  it("keeps the queue row when Resend refuses without throwing", async () => {
    const { db, sets, deleted } = makeDb([]);
    deleteContact.mockResolvedValue(false);

    const res = await eraseAccount({} as never, db as never, "u1", {
      refundContext: "test",
    });

    expect(res).toEqual({ ok: true });
    expect(sets.map((w) => w.path)).toContain("audiencePurges/gone%40example.com");
    expect(deleted).not.toContain("audiencePurges/gone%40example.com");
  });

  it("neither calls nor queues anything when no audience is configured", async () => {
    cfg.audienceId = null;
    const { db, sets } = makeDb([]);

    await eraseAccount({} as never, db as never, "u1", { refundContext: "test" });

    // Nothing is mirrored anywhere, so there is nothing to remove — and a row
    // no sweep could ever clear would be worse than no row at all.
    expect(deleteContact).not.toHaveBeenCalled();
    expect(sets.some((w) => w.path.startsWith("audiencePurges/"))).toBe(false);
  });
});

describe("reconcileAudiencePurges", () => {
  beforeEach(() => {
    deleteContact.mockClear();
    deleteContact.mockResolvedValue(true);
    calls.length = 0;
    cfg.audienceId = "aud_1";
  });

  it("removes the queued addresses and drops the rows it clears", async () => {
    const { db, deleted } = makeQueueDb({
      "a%40example.com": { email: "a@example.com", at: 1, attempts: 0 },
      "b%40example.com": { email: "b@example.com", at: 2, attempts: 0 },
    });

    const res = await reconcileAudiencePurges(db as never);

    expect(deleteContact.mock.calls.map((c) => c[0])).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(deleted).toEqual(["a%40example.com", "b%40example.com"]);
    expect(res).toEqual({ removed: 2, pending: 0 });
  });

  it("keeps a row Resend still will not take, and counts the attempt", async () => {
    const { db, deleted, sets } = makeQueueDb({
      "a%40example.com": { email: "a@example.com", at: 1, attempts: 2 },
    });
    deleteContact.mockResolvedValue(false);

    const res = await reconcileAudiencePurges(db as never);

    // Counted up, never dropped: the row is the only record that the address
    // is still sitting in the audience.
    expect(deleted).toEqual([]);
    expect(sets[0].data.attempts).toBe(3);
    expect(res).toEqual({ removed: 0, pending: 1 });
  });

  // handles/{folded} is the one collection that maps a public display name
  // back to an account id, and nothing in the sequence used to touch it: the
  // uid and the chosen name of a deleted account stayed there for good.
  it("releases the handle reservation with the leaderboard row", async () => {
    const { db, deleted } = makeDb([], {
      "leaderboard/u1": { handle: "Anne-Marie", xp: 40 },
    });

    await eraseAccount({} as never, db as never, "u1", { refundContext: "test" });

    // Folded exactly as setHandle reserved it (case, separators and
    // confusables collapsed) — a different fold here would leave the real
    // reservation untouched and delete nothing.
    expect(deleted).toContain("handles/annemarie");
    expect(deleted).toContain("leaderboard/u1");
  });

  it("deletes nothing extra when the account never picked a handle", async () => {
    const { db, deleted } = makeDb([], { "leaderboard/u1": { xp: 40 } });

    await eraseAccount({} as never, db as never, "u1", { refundContext: "test" });

    expect(deleted.some((p) => p.startsWith("handles/"))).toBe(false);
  });

  it("deletes the account subtree and the login", async () => {
    const { db, recursivelyDeleted } = makeDb([]);

    await eraseAccount({} as never, db as never, "u1", { refundContext: "test" });

    expect(recursivelyDeleted).toEqual(["users/u1"]);
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  // The finding this test exists for: sessionDeletions lives outside
  // users/{uid}, so recursiveDelete never reached it and a deleted account
  // kept leaving its uid, session ids and scores behind for good.
  it("severs the deletion log from the person, keeping the reason", async () => {
    const { db, updates, deleted } = makeDb(["a", "b"]);

    await eraseAccount({} as never, db as never, "u1", { refundContext: "test" });

    expect(updates.map((u) => u.path)).toEqual([
      "sessionDeletions/a",
      "sessionDeletions/b",
    ]);
    for (const update of updates) {
      // The identifying fields go...
      expect(update.data.uid).toEqual({ __sentinel: "delete" });
      expect(update.data.sessionId).toEqual({ __sentinel: "delete" });
      expect(update.data.erasedAccount).toBe(true);
      // ...and the product signal stays, untouched rather than overwritten.
      expect(update.data).not.toHaveProperty("reason");
      expect(update.data).not.toHaveProperty("mode");
      expect(update.data).not.toHaveProperty("overall");
    }
    // Scrubbed, never dropped: losing the rows would lose the churn feedback
    // from the one cohort that actually left.
    expect(deleted).not.toContain("sessionDeletions/a");
  });

  it("does not fail the deletion when the log scrub throws", async () => {
    const { db } = makeDb([]);
    db.collection = ((name: string) => ({
      get: async () => ({ docs: [] }),
      where: () => ({
        get: async () => {
          if (name === "sessionDeletions") throw new Error("firestore is down");
          return { docs: [] };
        },
      }),
    })) as never;

    const res = await eraseAccount({} as never, db as never, "u1", {
      refundContext: "test",
    });

    // Best-effort by design: analytics housekeeping must never be the reason
    // someone cannot erase their account.
    expect(res).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });
});
