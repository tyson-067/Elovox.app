import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";

// The data-portability payload, shared by the self-serve route
// (/api/account/export — GDPR Art. 20 / CCPA "right to know") and the
// operator route (/api/admin/export — servicing the same right when it
// arrives by email instead of by button, inside the 30-day window /privacy
// promises). One builder so the two exports can never diverge on what
// "everything" means — the failure mode of two lists is a silently
// incomplete export, which is exactly what the right is meant to prevent.
//
// AUTH IS THE CALLER'S JOB: the self route only ever exports the verified
// token's own uid; the admin route requires adminIdentity and audit-logs
// every export it generates.

/** Firestore Timestamps don't survive JSON.stringify; render them readably. */
function serialize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(serialize);
  // Timestamp instances expose toDate(); anything else falls through.
  const maybeTs = value as { toDate?: () => Date };
  if (typeof maybeTs.toDate === "function") {
    return maybeTs.toDate().toISOString();
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serialize(v);
  }
  return out;
}

// Bounded per collection. Each session carries a full transcript plus its
// analysis, so an unbounded read of a heavy account both blew the function's
// memory and produced a body past the platform's response cap — turning a
// data-portability request into a 500 the user has no way around, which is
// worse than a large-but-complete file. The cap is far above any real
// account, and when it does bite the export says so in the payload instead
// of silently truncating.
const MAX_DOCS_PER_COLLECTION = 5000;

export async function buildAccountExport(
  app: App,
  db: Firestore,
  uid: string
): Promise<Record<string, unknown>> {
  const { getAuth } = await import("firebase-admin/auth");
  const user = await getAuth(app).getUser(uid);

  // Walk every subcollection under users/{uid} rather than naming them, so a
  // collection added later is exported without anyone remembering to edit
  // this code.
  const root = db.doc(`users/${uid}`);
  const collections = await root.listCollections();
  const data: Record<string, unknown> = {};
  const truncated: string[] = [];
  for (const col of collections) {
    const snap = await col.limit(MAX_DOCS_PER_COLLECTION + 1).get();
    const docs = snap.docs.slice(0, MAX_DOCS_PER_COLLECTION);
    if (snap.docs.length > MAX_DOCS_PER_COLLECTION) truncated.push(col.id);
    data[col.id] = docs.map((d) => ({ id: d.id, ...(serialize(d.data()) as object) }));
  }

  return {
    exportedAt: new Date().toISOString(),
    account: {
      uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      emailVerified: user.emailVerified,
      createdAt: user.metadata.creationTime ?? null,
      lastSignInAt: user.metadata.lastSignInTime ?? null,
      // Which sign-in methods are attached (password, google.com, …).
      providers: user.providerData.map((p) => p.providerId),
    },
    data,
    // Named so the file is self-explanatory to whoever receives it, a
    // regulator, or the user moving to another service.
    note: "Every record Elovox holds for this account. Payment records live with Stripe, which retains them for tax and accounting purposes; request those from Stripe or via the billing portal.",
    ...(truncated.length
      ? {
          incomplete: `These sections hit the ${MAX_DOCS_PER_COLLECTION}-record export limit and are not complete: ${truncated.join(", ")}. Contact us and we'll send the rest.`,
        }
      : {}),
  };
}
