import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, clientIp } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { buildAccountExport } from "@/lib/accountExport";

// Operator-generated data export, for servicing the access/portability right
// when it arrives by EMAIL rather than by the self-serve button — /privacy
// promises a copy of their data and a response within 30 days, and this is
// the tool that honors it for a user who can't sign in (lost password,
// disabled account, a parent asking under /children).
//
// POST {uid, confirmEmail} returns the exact same file /api/account/export
// produces, built by the same lib/accountExport.ts. The file contains the
// user's practice content, which /dmca promises stays private — so this is
// the console's ONE content-bearing surface, and it is deliberately shaped
// for servicing a request, not for browsing: the operator must TYPE the
// account's email, verified server-side against the live auth record (the
// same second factor the admin DELETE requires), which makes each export a
// per-account decision a compromised token can't turn into a bulk crawl.
// Every export is audit-logged with the operator's identity, so "who pulled
// this file and when" always has an answer — /privacy's operator-access
// paragraph describes exactly this mechanic.

export const runtime = "nodejs";

const UID_RE = /^[A-Za-z0-9]{1,128}$/;

export async function POST(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/export", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const app = getAdminApp();
  const db = getAdminDb();
  if (!app || !db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (await limited(getAdminDb(), "admin-export", admin.uid)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed;
    }
  } catch {
    // falls through to validation below
  }
  const uid = typeof body.uid === "string" ? body.uid : "";
  const confirmEmail =
    typeof body.confirmEmail === "string"
      ? body.confirmEmail.trim().toLowerCase()
      : "";
  if (!UID_RE.test(uid)) {
    return NextResponse.json({ error: "Bad uid." }, { status: 400 });
  }

  const { getAuth } = await import("firebase-admin/auth");
  let user;
  try {
    user = await getAuth(app).getUser(uid);
  } catch (err) {
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      return NextResponse.json({ error: "No such account." }, { status: 404 });
    }
    throw err;
  }
  const targetEmail = user.email?.toLowerCase() ?? null;
  if (!targetEmail || targetEmail !== confirmEmail) {
    return NextResponse.json(
      {
        error:
          "confirmEmail doesn't match the account's email. Nothing was exported.",
      },
      { status: 400 }
    );
  }

  const payload = await buildAccountExport(app, db, uid);

  await recordAdminAction(db, {
    action: "account.export",
    actor: admin.email,
    targetUid: uid,
  });

  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="elovox-data-${uid}.json"`,
      // Never let a proxy or the browser cache someone's personal data.
      "cache-control": "no-store, private",
    },
  });
}
