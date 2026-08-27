import { describe, expect, it, vi, beforeEach } from "vitest";

// The erasure path is the one place a privacy promise is kept or broken in
// code, so the parts worth pinning are the ones a reader of /privacy would
// recognise: the money stops first, the public row goes, the tips-list lead
// goes, and the deletion-reason log stops pointing at a person.
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

const deleteUser = vi.fn().mockResolvedValue(undefined);
const getUser = vi.fn().mockResolvedValue({ email: "gone@example.com" });
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ deleteUser, getUser }),
}));

// No Stripe in this environment: getStripe() returning null is the real
// behaviour when the secret key is unset, and it skips the billing step
// without skipping anything else.
vi.mock("@/lib/stripe", () => ({ getStripe: () => null }));
vi.mock("@/lib/refunds", () => ({ refundUnusedPortion: vi.fn() }));

import { eraseAccount } from "@/lib/accountDeletion";

type Update = { path: string; data: Record<string, unknown> };

/** The smallest Firestore that this path actually touches. */
function makeDb(deletionRows: string[]) {
  const deleted: string[] = [];
  const updates: Update[] = [];
  const recursivelyDeleted: string[] = [];

  const docRef = (path: string) => ({
    path,
    get: async () => ({ exists: false, data: () => undefined }),
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
      recursivelyDeleted.push(ref.path);
    },
  };

  return { db, deleted, updates, recursivelyDeleted };
}

describe("eraseAccount", () => {
  beforeEach(() => {
    deleteUser.mockClear();
    getUser.mockClear();
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
