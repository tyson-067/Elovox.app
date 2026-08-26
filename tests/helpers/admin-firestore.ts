import { makeDb, type FakeDb } from "./firestore-fake";

/**
 * The shared Firestore fake, plus exactly the surface the /api/admin routes
 * use and tests/helpers/firestore-fake.ts deliberately does not model.
 *
 * Namespaced to the admin area rather than folded into the shared fake,
 * because the shared one earns its narrowness: it models buffered transaction
 * writes and nothing else, which is what makes the webhook's two-phase claim
 * genuinely testable. This file adds, on top of the SAME in-memory map:
 *
 *   - collection().add() / .doc() / .where() / .orderBy() / .limit() / .get()
 *     — adminAudit, opsEvents and moderationEvents are collections, and the
 *     audit read is an ordered, limited query.
 *   - collectionGroup() — /api/admin/users joins every users/{uid}/profile/plan
 *     doc in one scan.
 *   - FieldValue.delete() actually deleting. The comp DELETE route closes a
 *     window by writing that sentinel through a merge; a fake that stored the
 *     sentinel as a value would report the window as still open (truthy) and
 *     the revoke test would pass while the field survived in production.
 *
 * The delete sentinel is matched structurally (`__sentinel: "delete"`), so this
 * helper never has to import firebase-admin — the test file supplies the
 * sentinels through its own module mock.
 */

const DELETE_SENTINEL = "delete";

function isDeleteSentinel(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __sentinel?: unknown }).__sentinel === DELETE_SENTINEL
  );
}

export interface FakeDocRefLike {
  id: string;
  path: string;
  get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  set: (v: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
  update: (v: Record<string, unknown>) => Promise<void>;
  delete: () => Promise<void>;
}

export interface FakeQueryDoc {
  id: string;
  data: () => Record<string, unknown>;
  ref: {
    id: string;
    path: string;
    parent: { id: string; parent: { id: string } | null };
  };
}

export interface FakeQuery {
  where: (field: string, op: string, value: unknown) => FakeQuery;
  orderBy: (field: string, dir?: "asc" | "desc") => FakeQuery;
  limit: (n: number) => FakeQuery;
  get: () => Promise<{ docs: FakeQueryDoc[]; empty: boolean; size: number }>;
}

export interface FakeCollection extends FakeQuery {
  add: (v: Record<string, unknown>) => Promise<{ id: string; path: string }>;
  doc: (id?: string) => FakeDocRefLike;
}

export interface AdminFakeDb extends Omit<FakeDb, "doc"> {
  doc: (path: string) => FakeDocRefLike;
  collection: (name: string) => FakeCollection;
  collectionGroup: (name: string) => FakeQuery;
  /** Every doc currently in a top-level collection, insertion-ordered. */
  docsIn: (name: string) => Array<{ id: string; data: Record<string, unknown> }>;
  /** The adminAudit tail, insertion-ordered. Attribution lives here. */
  audit: () => Record<string, unknown>[];
}

export function makeAdminDb(
  seed: Record<string, Record<string, unknown>> = {}
): AdminFakeDb {
  const base = makeDb(seed);
  let autoId = 0;
  const nextId = () => `auto_${++autoId}`;

  /** Apply FieldValue.delete() sentinels left behind by a merge write. */
  const sweep = () => {
    for (const [path, doc] of base.data) {
      let dirty = false;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(doc)) {
        if (isDeleteSentinel(v)) dirty = true;
        else out[k] = v;
      }
      if (dirty) base.data.set(path, out);
    }
  };

  const wrapDoc = (path: string): FakeDocRefLike => {
    const ref = base.doc(path);
    const segs = path.split("/");
    return {
      ...ref,
      id: segs[segs.length - 1],
      path,
      set: async (v, opts) => {
        await ref.set(v, opts);
        sweep();
      },
      update: async (v) => {
        await ref.update(v);
        sweep();
      },
    };
  };

  const queryDoc = (path: string): FakeQueryDoc => {
    const segs = path.split("/");
    return {
      id: segs[segs.length - 1],
      data: () => ({ ...(base.data.get(path) ?? {}) }),
      ref: {
        id: segs[segs.length - 1],
        path,
        parent: {
          id: segs[segs.length - 2] ?? "",
          parent: segs.length >= 3 ? { id: segs[segs.length - 3] } : null,
        },
      },
    };
  };

  interface Filter {
    field: string;
    op: string;
    value: unknown;
  }

  const buildQuery = (
    select: () => string[],
    filters: Filter[] = [],
    order: { field: string; dir: "asc" | "desc" } | null = null,
    cap: number | null = null
  ): FakeQuery => ({
    where: (field, op, value) =>
      buildQuery(select, [...filters, { field, op, value }], order, cap),
    orderBy: (field, dir = "asc") => buildQuery(select, filters, { field, dir }, cap),
    limit: (n) => buildQuery(select, filters, order, n),
    get: async () => {
      let paths = select().filter((p) =>
        filters.every((f) => {
          const v = (base.data.get(p) ?? {})[f.field];
          if (f.op === "==") return v === f.value;
          if (f.op === "<") return (v as number) < (f.value as number);
          if (f.op === ">") return (v as number) > (f.value as number);
          throw new Error(`admin-firestore fake: unsupported operator ${f.op}`);
        })
      );
      if (order) {
        const { field, dir } = order;
        paths = [...paths].sort((a, b) => {
          const av = (base.data.get(a) ?? {})[field] as number;
          const bv = (base.data.get(b) ?? {})[field] as number;
          return dir === "desc" ? Number(bv) - Number(av) : Number(av) - Number(bv);
        });
      }
      if (cap !== null) paths = paths.slice(0, cap);
      const docs = paths.map(queryDoc);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });

  const collection = (name: string): FakeCollection => {
    const select = () =>
      [...base.data.keys()].filter((p) => {
        const segs = p.split("/");
        return segs.length === 2 && segs[0] === name;
      });
    return {
      ...buildQuery(select),
      add: async (v) => {
        const id = nextId();
        const path = `${name}/${id}`;
        await wrapDoc(path).set(v);
        return { id, path };
      },
      doc: (id?: string) => wrapDoc(`${name}/${id ?? nextId()}`),
    };
  };

  const collectionGroup = (name: string): FakeQuery =>
    buildQuery(() =>
      [...base.data.keys()].filter((p) => {
        const segs = p.split("/");
        return segs.length >= 2 && segs[segs.length - 2] === name;
      })
    );

  return {
    ...base,
    doc: wrapDoc,
    collection,
    collectionGroup,
    docsIn: (name) =>
      [...base.data.entries()]
        .filter(([p]) => p.split("/").length === 2 && p.startsWith(`${name}/`))
        .map(([p, d]) => ({ id: p.split("/")[1], data: d })),
    audit: () =>
      [...base.data.entries()]
        .filter(([p]) => p.startsWith("adminAudit/"))
        .map(([, d]) => d),
  };
}
