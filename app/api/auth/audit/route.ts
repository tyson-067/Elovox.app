import { NextRequest, NextResponse } from "next/server";
import { makeRateLimiter, clientIp } from "@/lib/verify";

// Server-side sink for client-reported auth validation failures, so they are
// recorded server-side for monitoring even though the auth itself runs in the
// browser against Firebase. This is telemetry, not a security boundary: it
// only ever receives non-sensitive machine reason codes (never the email or
// password), and it is IP rate-limited so it can't be used as a log-spam or
// budget-drain vector.

export const runtime = "nodejs";

// 10 requests per IP per minute — the same ceiling we'd want on a login route.
const rateLimited = makeRateLimiter(10, 60 * 1000);

// Only known, non-sensitive reason codes are accepted; anything else is
// dropped so an attacker can't stuff arbitrary strings into the logs.
const KNOWN_REASONS = new Set([
  "email_empty",
  "email_too_long",
  "email_format",
  "password_empty",
  "password_blank",
  "password_too_short",
  "password_too_long",
  "name_empty",
  "name_length",
]);

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return new NextResponse(null, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "signup" ? "signup" : "login";
  const reasons = Array.isArray(body?.reasons)
    ? body.reasons.filter((r: unknown): r is string => typeof r === "string" && KNOWN_REASONS.has(r)).slice(0, 8)
    : [];

  if (reasons.length > 0) {
    // Non-sensitive by construction: mode + reason codes + IP. No credentials.
    console.warn(
      `auth validation rejected [${mode}] ip=${ip} reasons=${reasons.join(",")}`
    );
  }

  // Always 204 — never tell the caller anything actionable.
  return new NextResponse(null, { status: 204 });
}
