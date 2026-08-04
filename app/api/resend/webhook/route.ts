import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clientIp, makeRateLimiter } from "@/lib/verify";
import { applyEvent, parseEvent, verifySignature } from "@/lib/email/webhook";

/**
 * Resend → Firestore. Delivery status, and the two events that put an address
 * on the suppression list for good.
 *
 * Shaped after the Stripe webhook next door, and for the same reasons: public,
 * unauthenticated before verification, signature-checked against the raw
 * bytes, rate-limited so a flood of forged bodies costs a Map lookup rather
 * than an invocation's worth of work.
 *
 * FAILS CLOSED. With no RESEND_WEBHOOK_SECRET set this returns 503 and writes
 * nothing. That is not a cautious default, it is the only safe one — an
 * unverified endpoint that writes to the suppression list is a way for anyone
 * on the internet to permanently block Elovox from emailing an address they
 * name, including a password-reset notice. Better that delivery telemetry go
 * missing loudly than that.
 *
 * Always answers 2xx once verified, even when handling failed. Svix retries
 * with backoff for a day, and a retry cannot fix a payload this app can't
 * parse — while a 500 for a soft failure means the same event redelivered
 * eight more times.
 */

export const runtime = "nodejs";

// Far above anything Resend produces (their retries are per-event, backed
// off, from a small set of IPs), so a real delivery can never meet it.
const rateLimited = makeRateLimiter(600, 60 * 1000);

export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return new NextResponse(null, { status: 429 });
  }

  // Raw bytes, verified before parsing. Re-serializing the parsed JSON would
  // change key order and whitespace and no signature would ever match again.
  const raw = await req.text();

  const verdict = verifySignature(raw, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  });

  if (!verdict.ok) {
    if (verdict.reason === "not-configured") {
      console.error(
        "[mail-webhook] RESEND_WEBHOOK_SECRET is unset — refusing. Delivery status and bounce suppression are off until it's set."
      );
      return NextResponse.json({ error: "Not configured." }, { status: 503 });
    }
    // Reason only. The body is attacker-controlled and echoing any of it into
    // a shared log is how a log viewer becomes an injection surface.
    console.warn(`[mail-webhook] rejected: ${verdict.reason}`);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad payload." }, { status: 400 });
  }

  const event = parseEvent(payload);
  if (!event) {
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    const { suppressed } = await applyEvent(getAdminDb(), event);
    if (suppressed) {
      // Worth a line: this is the system permanently declining to write to an
      // address, and "why did they stop getting email?" is a real question.
      // Type and id only — never the address, this goes to a shared log.
      console.warn(`[mail-webhook] suppressed via ${event.type} (${event.emailId ?? "no id"})`);
    }
  } catch (err) {
    // Acked anyway. See the note at the top: a redelivery can't fix this.
    console.error(`[mail-webhook] handler error for ${event.type}`, err);
  }

  return NextResponse.json({ received: true });
}
