import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { validateEmail } from "@/lib/validation";
import { makeRateLimiter, clientIp } from "@/lib/verify";
import { FieldValue } from "firebase-admin/firestore";

// The tips list: a low-commitment way in for someone not ready to make an
// account. No mail provider is wired up yet, so this only CAPTURES the
// address — into `leads/{email}`, which firestore.rules' catch-all denies to
// every client, written here through the Admin SDK. When a sender exists,
// the drip reads from this collection; nothing about the form changes.
//
// Public and unauthenticated by design (the whole point is pre-signup), so:
// per-IP rate limit, server-side format validation, a honeypot field bots
// fill and people never see, and email-as-doc-id so resubmits are idempotent
// rather than duplicate rows.

export const runtime = "nodejs";

const rateLimited = makeRateLimiter(10, 60 * 1000); // per IP per minute

export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  let body: { email?: unknown; company?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  // `JSON.parse("null")` and `JSON.parse("[]")` parse fine but aren't the
  // object the rest of this handler reads; guard before touching properties
  // so a `null`/array body is a clean 400, not an unhandled 500.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Honeypot: the form hides this field, so anything in it is a bot. Answer
  // success so the bot moves on, write nothing.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const check = validateEmail(body.email);
  if (!check.ok) {
    return NextResponse.json(
      { error: "That doesn't look like an email address." },
      { status: 400 }
    );
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Can't save that right now. Try again in a bit." },
      { status: 503 }
    );
  }

  const email = check.value.toLowerCase();
  const ref = db.doc(`leads/${encodeURIComponent(email)}`);
  try {
    // Doc id is the address (URI-encoded for safety), so subscribing twice
    // is one row, not a duplicate. create() stamps `since` exactly once; a
    // resubmit hits ALREADY_EXISTS (code 6) and just bumps the counter.
    await ref.create({
      email,
      since: FieldValue.serverTimestamp(),
      submissions: 1,
    });
  } catch (err) {
    if ((err as { code?: number })?.code !== 6) {
      console.error("[leads] write failed", err);
      return NextResponse.json(
        { error: "Can't save that right now. Try again in a bit." },
        { status: 503 }
      );
    }
    await ref
      .update({ submissions: FieldValue.increment(1) })
      .catch(() => {}); // the row exists; losing a resubmit count is nothing
  }

  return NextResponse.json({ ok: true });
}
