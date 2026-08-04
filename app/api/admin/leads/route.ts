import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { adminIdentity, makeRateLimiter, clientIp } from "@/lib/verify";
import { recordAdminDenied } from "@/lib/opsMetrics";
import { recordAdminAction } from "@/lib/adminAudit";
import { validateEmail } from "@/lib/validation";

// The tips list, from the operator side. /privacy promises the address is
// used "only to send those tips" and that anyone can "come off the list any
// time by emailing" — and until now honoring that email meant deleting a
// Firestore doc by hand. GET shows the list (count + when each joined);
// DELETE {email} services an unsubscribe request, audit-logged.
//
// Worth saying out loud since this is a list of email addresses: viewing it
// here is administration of Elovox's own capture form, and removal is the
// promised right. What would NOT be within the policy is pointing any other
// kind of mail at it — the "only to send those tips" sentence is the whole
// contract with these addresses.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(60);

export async function GET(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/leads", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const [snap, countSnap] = await Promise.all([
    db.collection("leads").orderBy("since", "desc").limit(500).get(),
    db.collection("leads").count().get(),
  ]);

  const leads = snap.docs.map((d) => {
    const l = d.data();
    const since = l.since;
    return {
      email: typeof l.email === "string" ? l.email : d.id,
      since:
        since && typeof since.toMillis === "function" ? since.toMillis() : null,
      submissions: typeof l.submissions === "number" ? l.submissions : 1,
    };
  });

  return NextResponse.json(
    { generatedAt: Date.now(), total: countSnap.data().count, leads },
    { headers: { "cache-control": "private, no-store" } }
  );
}

export async function DELETE(req: NextRequest) {
  const admin = await adminIdentity(req);
  if (!admin) {
    await recordAdminDenied(getAdminDb(), "admin/leads", clientIp(req));
    return new NextResponse("Not found", { status: 404 });
  }
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Not available." }, { status: 503 });
  }
  if (rateLimited(admin.uid)) {
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
  const check = validateEmail(body.email);
  if (!check.ok) {
    return NextResponse.json({ error: "Bad email." }, { status: 400 });
  }
  const email = check.value.toLowerCase();
  const docId = encodeURIComponent(email);
  // Same reserved-id guard as the capture route: db.doc() THROWS on __x__.
  if (/^__.*__$/.test(docId) || docId === "." || docId === "..") {
    return NextResponse.json({ error: "Bad email." }, { status: 400 });
  }

  const ref = db.doc(`leads/${docId}`);
  const existed = (await ref.get()).exists;
  if (existed) await ref.delete();

  await recordAdminAction(db, {
    action: "leads.remove",
    actor: admin.email,
    targetEmail: email,
    detail: { existed },
  });

  return NextResponse.json({ ok: true, removed: existed });
}
