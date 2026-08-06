import { NextRequest, NextResponse } from "next/server";
import { getAdminApp, getAdminDb } from "@/lib/firebaseAdmin";
import { verifyUser } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { buildAccountExport } from "@/lib/accountExport";

// Data portability, the other half of the right that /api/account/delete
// already covers. GDPR Art. 20 (and CCPA's "right to know") entitle a user to
// a copy of their data in a machine-readable form, so this returns everything
// under users/{uid} as a single JSON download.
//
// The payload itself is built in lib/accountExport.ts, shared with the
// operator route so "everything" always means the same thing in both. This
// file owns what is specific to SELF-service: a user can only ever export
// their own uid — it comes from the verified token, never from the request.

export const runtime = "nodejs";

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
  if (await limited(getAdminDb(), "account-export", uid)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429 }
    );
  }

  const payload = await buildAccountExport(app, db, uid);

  // No pretty-print indent: it inflated the body by roughly a third for a file
  // that is read by machines far more often than by people.
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
