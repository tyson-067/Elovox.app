import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";

// The operator action log, read side. Every mutating /api/admin route writes
// an entry via lib/adminAudit.ts; this returns the recent tail so "who
// comped that account / cleared that handle / flipped the kill switch" is a
// tab, not a Firestore spelunk. Read-only by design — an audit log someone
// can edit from the console it audits isn't one.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(60);

export async function GET(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/audit", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const snap = await db
    .collection("adminAudit")
    .orderBy("at", "desc")
    .limit(200)
    .get();

  const entries = snap.docs.map((d) => {
    const e = d.data();
    return {
      id: d.id,
      at: typeof e.at === "number" ? e.at : null,
      actor: typeof e.actor === "string" ? e.actor : null,
      action: typeof e.action === "string" ? e.action : null,
      targetUid: typeof e.targetUid === "string" ? e.targetUid : null,
      targetEmail: typeof e.targetEmail === "string" ? e.targetEmail : null,
      ok: e.ok !== false,
      detail:
        e.detail && typeof e.detail === "object" && !Array.isArray(e.detail)
          ? (e.detail as Record<string, unknown>)
          : null,
    };
  });

  return NextResponse.json(
    { generatedAt: Date.now(), entries },
    { headers: { "cache-control": "private, no-store" } }
  );
}
