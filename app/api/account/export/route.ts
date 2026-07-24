import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser, makeRateLimiter } from "@/lib/verify";

// Data portability — the other half of the right that /api/account/delete
// already covers. GDPR Art. 20 (and CCPA's "right to know") entitle a user to
// a copy of their data in a machine-readable form, so this returns everything
// under users/{uid} as a single JSON download.
//
// Runs server-side with the Admin SDK for the same reason deletion does: the
// browser can't walk a subtree, and the plan doc is deliberately unreadable
// to the client's own credentials in places. A user can only ever export
// their own uid — it comes from the verified token, never from the request.

export const runtime = "nodejs";

// Each export reads the user's whole subtree, so it is heavier than a normal
// request. Nobody needs more than a few a day.
const rateLimited = makeRateLimiter(10);

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

export async function GET(req: NextRequest) {
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json(
      { error: "Data export isn't available right now." },
      { status: 503 }
    );
  }

  const uid = await verifyUser(req);
  if (!uid || uid === "local-dev") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (rateLimited(uid)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429 }
    );
  }

  const { getAuth } = await import("firebase-admin/auth");
  const user = await getAuth(app).getUser(uid);

  // Walk every subcollection under users/{uid} rather than naming them, so a
  // collection added later is exported without anyone remembering to edit
  // this route — the failure mode of a hardcoded list is a silently
  // incomplete export, which is exactly what the right is meant to prevent.
  const root = db.doc(`users/${uid}`);
  const collections = await root.listCollections();
  const data: Record<string, unknown> = {};
  for (const col of collections) {
    const snap = await col.get();
    data[col.id] = snap.docs.map((d) => ({ id: d.id, ...(serialize(d.data()) as object) }));
  }

  const payload = {
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
    // Named so the file is self-explanatory to whoever receives it — a
    // regulator, or the user moving to another service.
    note: "Every record Elovox holds for this account. Payment records live with Stripe, which retains them for tax and accounting purposes; request those from Stripe or via the billing portal.",
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="elovox-data-${uid}.json"`,
      // Never let a proxy or the browser cache someone's personal data.
      "cache-control": "no-store, private",
    },
  });
}
