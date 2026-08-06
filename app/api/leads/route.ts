import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { validateEmail } from "@/lib/validation";
import { clientIp, logRejectedInput } from "@/lib/verify";
import { limited } from "@/lib/rateLimit";
import { FieldValue } from "firebase-admin/firestore";
import { readJsonObject } from "@/lib/requestBody";
import { send } from "@/lib/email/send";
import { tipsWelcome } from "@/lib/email/messages";
import { upsertContact } from "@/lib/email/audience";

// The tips list: a low-commitment way in for someone not ready to make an
// account. The address lands in `leads/{email}` — which firestore.rules'
// catch-all denies to every client, written here through the Admin SDK — and
// a first signup also gets a confirmation tip and a mirrored contact in the
// Resend Audience. `leads` stays the source of truth; the Audience is a copy
// kept so the list can be reached by a Broadcast.
//
// Public and unauthenticated by design (the whole point is pre-signup), so:
// per-IP rate limit, server-side format validation, a honeypot field bots
// fill and people never see, and email-as-doc-id so resubmits are idempotent
// rather than duplicate rows.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (await limited(getAdminDb(), "leads", clientIp(req))) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  // Size-capped before it is parsed. This route is public and
  // unauthenticated, so an unbounded body is a memory cost anyone can impose.
  const parsed = await readJsonObject(req);
  if (!parsed.ok) {
    logRejectedInput("leads", parsed.reason);
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const body: { email?: unknown; company?: unknown } = parsed.body;
  // `JSON.parse("null")` and `JSON.parse("[]")` parse fine but aren't the
  // object the rest of this handler reads; guard before touching properties
  // so a `null`/array body is a clean 400, not an unhandled 500.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    logRejectedInput("leads", "bad-shape");
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Honeypot: the form hides this field, so anything in it is a bot. Answer
  // success so the bot moves on, write nothing.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const check = validateEmail(body.email);
  if (!check.ok) {
    logRejectedInput("leads", check.reason ?? "invalid-email");
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
  const docId = encodeURIComponent(email);

  // Firestore reserves ids matching __.*__ and rejects them by THROWING out of
  // db.doc() — synchronously, which is why this can't sit below the try. A
  // perfectly valid address like `__a@b.co__` survives validateEmail (and
  // encodeURIComponent leaves underscores alone), so this public,
  // unauthenticated route answered a bare 500. Same shape of check the session
  // delete route already applies to ids it is handed.
  if (/^__.*__$/.test(docId) || docId === "." || docId === "..") {
    logRejectedInput("leads", "reserved-doc-id");
    return NextResponse.json(
      { error: "That doesn't look like an email address." },
      { status: 400 }
    );
  }

  const ref = db.doc(`leads/${docId}`);
  // Whether this submission is the one that created the row. Only a FIRST
  // signup gets the confirmation email — a resubmit (a double-click, a second
  // visit) must not send a second one, and the durable row is the only honest
  // record of which this was.
  let isNew = false;
  try {
    // Doc id is the address (URI-encoded for safety), so subscribing twice
    // is one row, not a duplicate. create() stamps `since` exactly once; a
    // resubmit hits ALREADY_EXISTS (code 6) and just bumps the counter.
    await ref.create({
      email,
      since: FieldValue.serverTimestamp(),
      submissions: 1,
    });
    isNew = true;
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

  if (isNew) {
    // Two follow-ups, neither of which the caller waits on and neither of
    // which can fail this request: the address is already saved, which was
    // the promise the form made.
    //
    // The confirmation is a tip, which is the ONLY thing this list may ever
    // receive — /privacy tells these addresses they are used "only to send
    // those tips", and lib/email/audience.ts repeats that where it would be
    // easiest to forget. Category "marketing", so the unsubscribe link and
    // the one-click headers come as standard.
    void send(db, tipsWelcome(email)).catch(() => {});
    // Mirror into the Resend Audience so this list can also be reached by a
    // Broadcast — one API call for the whole list, rather than one per person
    // against a two-request-per-second ceiling. No-op when unconfigured.
    void upsertContact({ email }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
