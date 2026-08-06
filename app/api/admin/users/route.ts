import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { isAdmin, clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { recordAdminDenied } from "@/lib/opsMetrics";

// The user list behind /admin: who has an account, who is Premium, and on
// what terms. Exists so the team can see name/email/plan without anyone
// needing access to the Firebase console or Stripe dashboard.
//
// Same access story as /api/admin/stats: the ADMIN_EMAILS allow-list, a flat
// 404 for everyone else so the endpoint's existence isn't advertised, and
// nothing served at all without the Admin SDK. This returns personal data
// (names, emails), which is why it 404s rather than 403s and why the
// response is marked private, no-store for proxies.
//
// SCALE NOTE: reads every auth record and every plan doc per request, which
// is fine at launch scale and cached for a minute in the browser. Past a few
// thousand accounts, serve auth.listUsers pages instead of the whole list.

export const runtime = "nodejs";

interface Row {
  uid: string;
  name: string | null;
  email: string | null;
  verified: boolean;
  /** Suspended via Firebase Auth (the /admin disable action, or the console). */
  disabled: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
  premium: boolean;
  /** What grants the entitlement: a Stripe subscription, or a comp window
   *  (streak reward or operator grant). Null for free accounts. */
  source: "paid" | "comp" | null;
  status: string | null; // webhook-written: trialing / active / past_due / canceled / none
  cycle: string | null; // weekly / monthly / annual
  canceling: boolean; // cancelAtPeriodEnd: still premium, ending at period end
  premiumUntil: number | null; // comp window end, only when source === "comp"
  grantReason: string | null; // "streak-21" | "admin-comp", when source === "comp"
}

export async function GET(req: NextRequest) {
  // isAdmin FIRST, so an anonymous caller can't tell a real route that is
  // busy or unconfigured from one that doesn't exist. See the same note in
  // /api/admin/stats.
  if (!(await isAdmin(req))) {
    await recordAdminDenied(getAdminDb(), "admin/users", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-users", clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const now = Date.now();

  // Plan docs first: one collection-group scan into a uid-keyed map beats a
  // document read per user. Same trick as /api/admin/stats.
  const plans = new Map<string, Record<string, unknown>>();
  const profile = await db.collectionGroup("profile").get();
  for (const doc of profile.docs) {
    if (doc.id !== "plan") continue;
    const uid = doc.ref.parent.parent?.id;
    if (uid) plans.set(uid, doc.data());
  }

  const { getAuth } = await import("firebase-admin/auth");
  const auth = getAuth(app);

  const rows: Row[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const p = plans.get(u.uid);
      const paid = p?.plan === "premium";
      const premiumUntil =
        typeof p?.premiumUntil === "number" ? p.premiumUntil : null;
      const comp = !paid && premiumUntil !== null && premiumUntil > now;
      rows.push({
        uid: u.uid,
        name: u.displayName ?? null,
        email: u.email ?? null,
        verified: u.emailVerified,
        disabled: u.disabled,
        createdAt: u.metadata.creationTime
          ? Date.parse(u.metadata.creationTime)
          : null,
        lastSignInAt: u.metadata.lastSignInTime
          ? Date.parse(u.metadata.lastSignInTime)
          : null,
        premium: paid || comp,
        source: paid ? "paid" : comp ? "comp" : null,
        status: typeof p?.status === "string" ? p.status : null,
        cycle: typeof p?.cycle === "string" ? p.cycle : null,
        canceling: !!p?.cancelAtPeriodEnd,
        premiumUntil: comp ? premiumUntil : null,
        grantReason:
          comp && typeof p?.grantReason === "string" ? p.grantReason : null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return NextResponse.json(
    { generatedAt: now, users: rows },
    { headers: { "cache-control": "private, max-age=60" } }
  );
}
