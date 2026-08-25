import { vi } from "vitest";

/**
 * Just enough Firestore to exercise the webhook's idempotency.
 *
 * Deliberately NOT a general Firestore emulator. It models the three things
 * the route's correctness actually depends on:
 *
 *   - doc().get()/set()/update() against an in-memory map
 *   - runTransaction() with reads and writes, where writes are BUFFERED and
 *     only applied when the transaction body resolves
 *   - the ability to make any of those throw on demand, because "Firestore is
 *     unreachable" is a branch the route handles specifically (500 so Stripe
 *     retries) and it needs to be reachable from a test
 *
 * The buffering matters. A fake that applies writes immediately would let the
 * two-phase claim pass even if the route wrote outside the transaction, which
 * is exactly the property under test.
 */

export interface FakeDb {
  data: Map<string, Record<string, unknown>>;
  doc: (path: string) => FakeDocRef;
  runTransaction: <T>(fn: (tx: FakeTx) => Promise<T>) => Promise<T>;
  /** Force the next (or every) transaction to throw, simulating an outage. */
  failTransactions: (reason?: Error | null) => void;
  writes: string[];
}

interface FakeDocRef {
  path: string;
  get: () => Promise<FakeSnap>;
  set: (v: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
  update: (v: Record<string, unknown>) => Promise<void>;
  /** The route deletes a claim when its handler throws, so the retry can
   *  reclaim it rather than being rejected as a duplicate forever. */
  delete: () => Promise<void>;
}

interface FakeSnap {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

interface FakeTx {
  get: (ref: FakeDocRef) => Promise<FakeSnap>;
  set: (ref: FakeDocRef, v: Record<string, unknown>, opts?: { merge?: boolean }) => void;
  update: (ref: FakeDocRef, v: Record<string, unknown>) => void;
}

export function makeDb(seed: Record<string, Record<string, unknown>> = {}): FakeDb {
  const data = new Map(Object.entries(seed));
  const writes: string[] = [];
  let transactionError: Error | null = null;

  const snap = (path: string): FakeSnap => {
    const v = data.get(path);
    return { exists: v !== undefined, data: () => (v ? { ...v } : undefined) };
  };

  const doc = (path: string): FakeDocRef => ({
    path,
    get: async () => snap(path),
    set: async (v, opts) => {
      writes.push(path);
      data.set(path, opts?.merge ? { ...(data.get(path) ?? {}), ...v } : { ...v });
    },
    update: async (v) => {
      writes.push(path);
      data.set(path, { ...(data.get(path) ?? {}), ...v });
    },
    delete: async () => {
      writes.push(`delete:${path}`);
      data.delete(path);
    },
  });

  const runTransaction = async <T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> => {
    if (transactionError) throw transactionError;
    const buffered: Array<() => void> = [];
    const tx: FakeTx = {
      get: async (ref) => snap(ref.path),
      set: (ref, v, opts) =>
        void buffered.push(() => {
          writes.push(ref.path);
          data.set(ref.path, opts?.merge ? { ...(data.get(ref.path) ?? {}), ...v } : { ...v });
        }),
      update: (ref, v) =>
        void buffered.push(() => {
          writes.push(ref.path);
          data.set(ref.path, { ...(data.get(ref.path) ?? {}), ...v });
        }),
    };
    const out = await fn(tx);
    // Only on success — a throwing body must leave no trace, which is what
    // makes "claim failed" distinguishable from "claimed but crashed".
    buffered.forEach((w) => w());
    return out;
  };

  return {
    data,
    writes,
    doc: vi.fn(doc) as unknown as FakeDb["doc"],
    runTransaction: runTransaction as FakeDb["runTransaction"],
    failTransactions: (reason = new Error("firestore unreachable")) => {
      transactionError = reason;
    },
  };
}

/** A Stripe subscription shaped enough for syncSubscription to read it. */
export function makeSubscription(over: Record<string, unknown> = {}) {
  const periodEnd = Math.floor((Date.now() + 30 * 864e5) / 1000);
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    created: 1_700_000_000,
    cancel_at_period_end: false,
    metadata: { firebaseUid: "uid_1" },
    items: { data: [{ price: { id: "price_m" }, current_period_end: periodEnd }] },
    ...over,
  };
}
